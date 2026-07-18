import { Types } from "mongoose";
import { User } from "../../models/User.js";
import { Warehouse } from "../../models/Warehouse.js";
import {
  defaultWarehouseOperatorPermissions,
  isAdminOnlyPermission,
  type PermissionGrant,
} from "../../shared/constants/permissions.js";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../shared/errors/AppError.js";
import { UserRole } from "../../shared/constants/roles.js";
import type { AuthUser } from "../../shared/types/auth.js";
import {
  hashPassword,
  validatePasswordStrength,
} from "../../shared/utils/password.js";
import { isAdmin } from "../../shared/utils/permissions.js";
import { normalizePermissionGrants } from "../../shared/utils/permissions.js";
import { revokeAllUserSessions } from "../auth/session.service.js";
import type { CreateUserInput, UpdateUserInput } from "./users.validation.js";

function assertCanAssignAdminRole(actor: AuthUser): void {
  if (!isAdmin(actor)) {
    throw new ForbiddenError("Only admins can create or promote admin accounts");
  }
}

function assertNoAdminOnlyPermissionsForStaff(grants: PermissionGrant[]): void {
  const blocked = grants.filter((g) => isAdminOnlyPermission(g.code));
  if (blocked.length === 0) return;
  const codes = [...new Set(blocked.map((g) => g.code))].join(", ");
  throw new BadRequestError(
    `These permissions are admin-only and cannot be assigned to staff: ${codes}`
  );
}

function mapPermissions(
  perms: Array<{ code: string; warehouseId?: Types.ObjectId }> | undefined
): PermissionGrant[] {
  return (perms ?? []).map((p) => ({
    code: p.code as PermissionGrant["code"],
    warehouseId: p.warehouseId ? String(p.warehouseId) : undefined,
  }));
}

function toPublicUser(doc: {
  _id: Types.ObjectId;
  name: string;
  email: string;
  role: string;
  warehouseId?: { _id: Types.ObjectId; name: string; code: string } | null;
  permissions?: Array<{ code: string; warehouseId?: Types.ObjectId }>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  const warehouse = doc.warehouseId as
    | { _id: Types.ObjectId; name: string; code: string }
    | null
    | undefined;

  return {
    id: String(doc._id),
    name: doc.name,
    email: doc.email,
    role: doc.role,
    warehouseId: warehouse ? String(warehouse._id) : undefined,
    warehouse: warehouse
      ? { id: String(warehouse._id), name: warehouse.name, code: warehouse.code }
      : undefined,
    permissions: mapPermissions(doc.permissions),
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function validatePermissionWarehouses(grants: PermissionGrant[]): Promise<void> {
  const warehouseIds = [...new Set(grants.map((g) => g.warehouseId).filter(Boolean))] as string[];
  for (const id of warehouseIds) {
    const warehouse = await Warehouse.findOne({ _id: id, isActive: true });
    if (!warehouse) {
      throw new NotFoundError(`Warehouse not found or inactive: ${id}`);
    }
  }
}

async function toPublicUserHydrated(doc: {
  _id: Types.ObjectId;
  name: string;
  email: string;
  role: string;
  warehouseId?: { _id: Types.ObjectId; name: string; code: string } | null;
  permissions?: Array<{ code: string; warehouseId?: Types.ObjectId }>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  // Fail closed: empty permissions stay empty (no silent operator hydrate).
  return toPublicUser(doc);
}

export async function listUsers() {
  const users = await User.find()
    .populate("warehouseId", "name code")
    .sort({ createdAt: -1 })
    .lean();

  return Promise.all(
    users.map((u) =>
      toPublicUserHydrated(u as Parameters<typeof toPublicUserHydrated>[0])
    )
  );
}

export async function getUserById(id: string) {
  if (!Types.ObjectId.isValid(id)) {
    throw new NotFoundError("User not found");
  }

  const user = await User.findById(id).populate("warehouseId", "name code").lean();
  if (!user) {
    throw new NotFoundError("User not found");
  }

  return toPublicUserHydrated(user as Parameters<typeof toPublicUserHydrated>[0]);
}

export async function createUser(input: CreateUserInput, createdBy: AuthUser) {
  if (input.role === UserRole.ADMIN) {
    assertCanAssignAdminRole(createdBy);
  }

  const existing = await User.findOne({ email: input.email.toLowerCase() });
  if (existing) {
    throw new BadRequestError("Email is already registered");
  }

  validatePasswordStrength(input.password);

  let permissions: PermissionGrant[] = [];
  let warehouseId: string | undefined;

  if (input.role === UserRole.WAREHOUSE_USER) {
    if (input.permissions.length > 0) {
      permissions = normalizePermissionGrants(
        input.permissions as PermissionGrant[]
      );
      assertNoAdminOnlyPermissionsForStaff(permissions);
      const hasScoped = permissions.some((p) => p.warehouseId);
      if (!hasScoped) {
        throw new BadRequestError(
          "Staff users need at least one warehouse permission (e.g. Stock in for their home warehouse)."
        );
      }
    } else if (input.warehouseId) {
      permissions = defaultWarehouseOperatorPermissions(input.warehouseId);
    } else {
      throw new BadRequestError("Select a home warehouse or assign module permissions");
    }
    await validatePermissionWarehouses(permissions);
    warehouseId =
      input.warehouseId ?? permissions.find((p) => p.warehouseId)?.warehouseId;
  }

  const user = await User.create({
    name: input.name,
    email: input.email.toLowerCase(),
    passwordHash: await hashPassword(input.password),
    role: input.role,
    warehouseId:
      input.role === UserRole.WAREHOUSE_USER && warehouseId
        ? new Types.ObjectId(warehouseId)
        : undefined,
    permissions: permissions.map((p) => ({
      code: p.code,
      ...(p.warehouseId
        ? { warehouseId: new Types.ObjectId(p.warehouseId) }
        : {}),
    })),
    isActive: input.isActive ?? true,
  });

  const populated = await User.findById(user._id)
    .populate("warehouseId", "name code")
    .lean();

  return {
    user: toPublicUser(populated as Parameters<typeof toPublicUser>[0]),
    createdBy: createdBy.id,
  };
}

export async function updateUser(
  id: string,
  input: UpdateUserInput,
  updatedBy: AuthUser
) {
  if (!Types.ObjectId.isValid(id)) {
    throw new NotFoundError("User not found");
  }

  const user = await User.findById(id);
  if (!user) {
    throw new NotFoundError("User not found");
  }

  if (id === updatedBy.id && input.isActive === false) {
    throw new BadRequestError("You cannot deactivate your own account");
  }

  if (input.email && input.email.toLowerCase() !== user.email) {
    const existing = await User.findOne({
      email: input.email.toLowerCase(),
      _id: { $ne: id },
    });
    if (existing) {
      throw new BadRequestError("Email is already registered");
    }
    user.email = input.email.toLowerCase();
  }

  if (input.name) user.name = input.name;

  const nextRole = input.role ?? user.role;

  if (input.role !== undefined && input.role !== user.role) {
    if (input.role === UserRole.ADMIN || user.role === UserRole.ADMIN) {
      assertCanAssignAdminRole(updatedBy);
    }
    user.role = input.role;
  }

  if (input.warehouseId !== undefined) {
    user.warehouseId = input.warehouseId
      ? new Types.ObjectId(input.warehouseId)
      : undefined;
  }

  const permissionsChanging = input.permissions !== undefined;
  const roleChanging =
    input.role !== undefined && input.role !== user.role;
  const passwordChanging = Boolean(input.password);
  const deactivated =
    input.isActive === false && user.isActive === true;

  if (nextRole === UserRole.ADMIN) {
    user.warehouseId = undefined;
    user.permissions = [];
    user.markModified("permissions");
  } else if (input.permissions !== undefined) {
    const normalized = normalizePermissionGrants(
      input.permissions as PermissionGrant[]
    );
    assertNoAdminOnlyPermissionsForStaff(normalized);
    if (normalized.length === 0) {
      throw new BadRequestError("Assign at least one module permission");
    }
    const hasScoped = normalized.some((p) => p.warehouseId);
    if (!hasScoped) {
      throw new BadRequestError(
        "Include at least one warehouse permission (Stock, Inventory, or Transfers)"
      );
    }
    await validatePermissionWarehouses(normalized);
    user.permissions = normalized.map((p) => ({
      code: p.code,
      warehouseId: p.warehouseId ? new Types.ObjectId(p.warehouseId) : undefined,
    }));
    user.markModified("permissions");
    if (!user.warehouseId) {
      const wh = normalized.find((p) => p.warehouseId)?.warehouseId;
      if (wh) user.warehouseId = new Types.ObjectId(wh);
    }
  } else if (
    nextRole === UserRole.WAREHOUSE_USER &&
    roleChanging &&
    (!user.permissions || user.permissions.length === 0)
  ) {
    throw new BadRequestError(
      "Assign module permissions when demoting an admin to staff"
    );
  }

  if (input.isActive !== undefined) user.isActive = input.isActive;

  if (input.password) {
    validatePasswordStrength(input.password);
    user.passwordHash = await hashPassword(input.password);
  }

  await user.save();

  // Force the target user to re-authenticate so JWT route guards pick up
  // the new role/permissions immediately (API auth already reads from DB).
  if (permissionsChanging || roleChanging || passwordChanging || deactivated) {
    await revokeAllUserSessions(String(user._id));
  }

  const populated = await User.findById(user._id)
    .populate("warehouseId", "name code")
    .lean();

  return {
    user: toPublicUser(populated as Parameters<typeof toPublicUser>[0]),
    updatedBy: updatedBy.id,
  };
}
