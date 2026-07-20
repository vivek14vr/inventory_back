import { Types } from "mongoose";
import { UserRole } from "../constants/roles.js";
import {
  ALL_PERMISSION_CODES,
  MANAGE_IMPLIES_VIEW,
  Permission,
  VIEW_IMPLIED_BY_MANAGE,
  isWarehouseScopedPermission,
  type PermissionCode,
  type PermissionGrant,
} from "../constants/permissions.js";
import type { AuthUser } from "../types/auth.js";
import { BadRequestError, ForbiddenError } from "../errors/AppError.js";

export function isAdmin(user: AuthUser): boolean {
  return user.role === UserRole.ADMIN;
}

/**
 * Warehouse-scoped permissions require an explicit warehouseId (fail closed).
 * Use {@link hasPermissionSomewhere} when checking "has this grant at any site".
 * Manage grants imply their matching View (products/brands/clients/warehouses).
 * Legacy imports.manage unlocks the split import permissions.
 */
export function hasPermission(
  user: AuthUser,
  code: PermissionCode | string,
  warehouseId?: string
): boolean {
  if (isAdmin(user)) return true;

  const grants = user.permissions ?? [];
  const hasLegacyImportsManage = grants.some(
    (g) => g.code === Permission.IMPORTS_MANAGE && !g.warehouseId
  );

  if (isWarehouseScopedPermission(code)) {
    if (!warehouseId) return false;
    if (
      code === Permission.IMPORTS_SALES &&
      (hasLegacyImportsManage ||
        grants.some(
          (g) =>
            g.code === Permission.IMPORTS_MANAGE &&
            g.warehouseId === warehouseId
        ))
    ) {
      return true;
    }
    return grants.some(
      (g) => g.code === code && g.warehouseId === warehouseId
    );
  }
  if (grants.some((g) => g.code === code)) return true;
  if (
    hasLegacyImportsManage &&
    (code === Permission.IMPORTS_PRODUCTS ||
      code === Permission.IMPORTS_CLIENTS)
  ) {
    return true;
  }
  const manageThatImplies = VIEW_IMPLIED_BY_MANAGE[code as PermissionCode];
  return Boolean(
    manageThatImplies && grants.some((g) => g.code === manageThatImplies)
  );
}

/** True if the user holds the permission at any warehouse (or globally). */
export function hasPermissionSomewhere(
  user: AuthUser,
  code: PermissionCode | string
): boolean {
  if (isAdmin(user)) return true;
  const grants = user.permissions ?? [];
  if (grants.some((g) => g.code === code)) return true;
  if (
    grants.some((g) => g.code === Permission.IMPORTS_MANAGE) &&
    (code === Permission.IMPORTS_PRODUCTS ||
      code === Permission.IMPORTS_CLIENTS ||
      code === Permission.IMPORTS_SALES)
  ) {
    return true;
  }
  const manageThatImplies = VIEW_IMPLIED_BY_MANAGE[code as PermissionCode];
  return Boolean(
    manageThatImplies && grants.some((g) => g.code === manageThatImplies)
  );
}

export function hasAnyPermission(
  user: AuthUser,
  codes: PermissionCode[],
  warehouseId?: string
): boolean {
  return codes.some((code) => hasPermission(user, code, warehouseId));
}

export function hasAnyPermissionSomewhere(
  user: AuthUser,
  codes: PermissionCode[]
): boolean {
  return codes.some((code) => hasPermissionSomewhere(user, code));
}

export function assertPermission(
  user: AuthUser,
  code: PermissionCode,
  warehouseId?: string
): void {
  if (!hasPermission(user, code, warehouseId)) {
    throw new ForbiddenError("You do not have permission to perform this action");
  }
}

export function getWarehouseIdsForPermission(
  user: AuthUser,
  code: PermissionCode
): string[] {
  if (isAdmin(user)) return [];
  const grants = user.permissions ?? [];
  return grants
    .filter((g) => g.code === code && g.warehouseId)
    .map((g) => g.warehouseId!);
}

export function resolveWarehouseIdForPermission(
  user: AuthUser,
  code: PermissionCode,
  requestedWarehouseId?: string
): string {
  if (isAdmin(user)) {
    if (!requestedWarehouseId || !Types.ObjectId.isValid(requestedWarehouseId)) {
      throw new BadRequestError("warehouseId is required");
    }
    return requestedWarehouseId;
  }

  const allowed = getWarehouseIdsForPermission(user, code);
  if (allowed.length === 0) {
    throw new ForbiddenError("You do not have permission for this warehouse");
  }

  if (requestedWarehouseId) {
    if (!Types.ObjectId.isValid(requestedWarehouseId)) {
      throw new BadRequestError("Invalid warehouse ID");
    }
    if (!allowed.includes(requestedWarehouseId)) {
      throw new ForbiddenError("You do not have access to this warehouse");
    }
    return requestedWarehouseId;
  }

  if (allowed.length === 1) {
    return allowed[0];
  }

  throw new BadRequestError("warehouseId is required");
}

/** Resolve an accessible warehouse where the user holds ANY of the given permissions. */
export function resolveWarehouseIdForAnyPermission(
  user: AuthUser,
  codes: PermissionCode[],
  requestedWarehouseId?: string
): string {
  if (isAdmin(user)) {
    if (!requestedWarehouseId || !Types.ObjectId.isValid(requestedWarehouseId)) {
      throw new BadRequestError("warehouseId is required");
    }
    return requestedWarehouseId;
  }

  const allowed = Array.from(
    new Set(codes.flatMap((code) => getWarehouseIdsForPermission(user, code)))
  );
  if (allowed.length === 0) {
    throw new ForbiddenError("You do not have permission for this warehouse");
  }

  if (requestedWarehouseId) {
    if (!Types.ObjectId.isValid(requestedWarehouseId)) {
      throw new BadRequestError("Invalid warehouse ID");
    }
    if (!allowed.includes(requestedWarehouseId)) {
      throw new ForbiddenError("You do not have access to this warehouse");
    }
    return requestedWarehouseId;
  }

  if (allowed.length === 1) {
    return allowed[0];
  }

  throw new BadRequestError("warehouseId is required");
}

/** Encode grants for JWT: `code` or `code:warehouseId` */
export function encodePermissionsForJwt(grants: PermissionGrant[]): string[] {
  return grants.map((g) =>
    g.warehouseId ? `${g.code}:${g.warehouseId}` : g.code
  );
}

export function decodePermissionsFromJwt(encoded: string[]): PermissionGrant[] {
  const grants: PermissionGrant[] = [];
  for (const entry of encoded) {
    const colon = entry.indexOf(":");
    if (colon === -1) {
      grants.push({ code: entry as PermissionCode });
    } else {
      grants.push({
        code: entry.slice(0, colon) as PermissionCode,
        warehouseId: entry.slice(colon + 1),
      });
    }
  }
  return grants;
}

export function normalizePermissionGrants(
  grants: PermissionGrant[] | undefined
): PermissionGrant[] {
  if (!grants?.length) return [];

  const seen = new Set<string>();
  const normalized: PermissionGrant[] = [];

  function pushGrant(code: PermissionCode, warehouseId?: string) {
    if (!ALL_PERMISSION_CODES.includes(code)) {
      throw new BadRequestError(`Unknown permission: ${code}`);
    }
    if (isWarehouseScopedPermission(code) && !warehouseId) {
      throw new BadRequestError(`Permission ${code} requires a warehouse`);
    }
    if (!isWarehouseScopedPermission(code) && warehouseId) {
      throw new BadRequestError(
        `Permission ${code} cannot be scoped to a warehouse`
      );
    }
    if (warehouseId && !Types.ObjectId.isValid(warehouseId)) {
      throw new BadRequestError(`Invalid warehouse ID for ${code}`);
    }

    const key = warehouseId ? `${code}:${warehouseId}` : code;
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push({
      code,
      ...(warehouseId ? { warehouseId } : {}),
    });
  }

  for (const grant of grants) {
    // Legacy returns.warehouse → Transfer History manage at the same warehouse.
    if (grant.code === Permission.RETURNS_WAREHOUSE) {
      pushGrant(Permission.TRANSFERS_MANAGE, grant.warehouseId);
      continue;
    }
    // Legacy imports.manage → products + clients (+ sales if scoped).
    if (grant.code === Permission.IMPORTS_MANAGE) {
      pushGrant(Permission.IMPORTS_PRODUCTS);
      pushGrant(Permission.IMPORTS_CLIENTS);
      if (grant.warehouseId) {
        pushGrant(Permission.IMPORTS_SALES, grant.warehouseId);
      }
      continue;
    }

    pushGrant(grant.code as PermissionCode, grant.warehouseId);
  }

  // Manage always stores the matching View grant too.
  for (const grant of [...normalized]) {
    const impliedView = MANAGE_IMPLIES_VIEW[grant.code];
    if (!impliedView || grant.warehouseId) continue;
    pushGrant(impliedView);
  }

  return normalized;
}
