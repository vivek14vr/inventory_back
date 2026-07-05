import { Types } from "mongoose";
import { User } from "../../models/User.js";
import { Warehouse } from "../../models/Warehouse.js";
import {
  defaultWarehouseOperatorPermissions,
  type PermissionGrant,
} from "../../shared/constants/permissions.js";
import {
  BadRequestError,
  NotFoundError,
} from "../../shared/errors/AppError.js";
import { UserRole } from "../../shared/constants/roles.js";
import type { AuthUser } from "../../shared/types/auth.js";
import {
  hashPassword,
  validatePasswordStrength,
} from "../../shared/utils/password.js";
import { normalizePermissionGrants } from "../../shared/utils/permissions.js";
import type { CreateUserInput, UpdateUserInput } from "./users.validation.js";

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

export async function listUsers() {
  const users = await User.find()
    .populate("warehouseId", "name code")
    .sort({ createdAt: -1 })
    .lean();

  return users.map((u) => toPublicUser(u as Parameters<typeof toPublicUser>[0]));
}

export async function getUserById(id: string) {
  if (!Types.ObjectId.isValid(id)) {
    throw new NotFoundError("User not found");
  }

  const user = await User.findById(id).populate("warehouseId", "name code").lean();
  if (!user) {
    throw new NotFoundError("User not found");
  }

  return toPublicUser(user as Parameters<typeof toPublicUser>[0]);
}

export async function createUser(input: CreateUserInput, createdBy: AuthUser) {
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
      const hasScoped = permissions.some((p) => p.warehouseId);
      if (!hasScoped) {
        if (input.warehouseId) {
          permissions = defaultWarehouseOperatorPermissions(input.warehouseId);
        } else {
          throw new BadRequestError(
            "Staff users need warehouse permissions (e.g. Stock in/out). Use the Full warehouse operator preset."
          );
        }
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
        ? warehouseId
        : undefined,
    permissions: permissions.map((p) => ({
      code: p.code,
      warehouseId: p.warehouseId,
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

  if (input.role !== undefined) {
    user.role = input.role;
  }

  if (input.warehouseId !== undefined) {
    user.warehouseId = input.warehouseId
      ? new Types.ObjectId(input.warehouseId)
      : undefined;
  }

  if (nextRole === UserRole.ADMIN) {
    user.warehouseId = undefined;
    user.permissions = [];
  } else if (input.permissions !== undefined) {
    const normalized = normalizePermissionGrants(
      input.permissions as PermissionGrant[]
    );
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
    if (!user.warehouseId) {
      const wh = normalized.find((p) => p.warehouseId)?.warehouseId;
      if (wh) user.warehouseId = new Types.ObjectId(wh);
    }
  }

  if (input.isActive !== undefined) user.isActive = input.isActive;

  if (input.password) {
    validatePasswordStrength(input.password);
    user.passwordHash = await hashPassword(input.password);
  }

  await user.save();

  const populated = await User.findById(user._id)
    .populate("warehouseId", "name code")
    .lean();

  return {
    user: toPublicUser(populated as Parameters<typeof toPublicUser>[0]),
    updatedBy: updatedBy.id,
  };
}
