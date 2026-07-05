import { Types } from "mongoose";
import { UserRole } from "../constants/roles.js";
import {
  ALL_PERMISSION_CODES,
  isWarehouseScopedPermission,
  type PermissionCode,
  type PermissionGrant,
} from "../constants/permissions.js";
import type { AuthUser } from "../types/auth.js";
import { BadRequestError, ForbiddenError } from "../errors/AppError.js";

export function isAdmin(user: AuthUser): boolean {
  return user.role === UserRole.ADMIN;
}

export function hasPermission(
  user: AuthUser,
  code: PermissionCode | string,
  warehouseId?: string
): boolean {
  if (isAdmin(user)) return true;

  const grants = user.permissions ?? [];
  return grants.some((g) => {
    if (g.code !== code) return false;
    if (!isWarehouseScopedPermission(code)) return true;
    if (!warehouseId) return true;
    return g.warehouseId === warehouseId;
  });
}

export function hasAnyPermission(
  user: AuthUser,
  codes: PermissionCode[],
  warehouseId?: string
): boolean {
  return codes.some((code) => hasPermission(user, code, warehouseId));
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

  for (const grant of grants) {
    if (!ALL_PERMISSION_CODES.includes(grant.code as PermissionCode)) {
      throw new BadRequestError(`Unknown permission: ${grant.code}`);
    }
    if (isWarehouseScopedPermission(grant.code) && !grant.warehouseId) {
      throw new BadRequestError(
        `Permission ${grant.code} requires a warehouse`
      );
    }
    if (!isWarehouseScopedPermission(grant.code) && grant.warehouseId) {
      throw new BadRequestError(
        `Permission ${grant.code} cannot be scoped to a warehouse`
      );
    }
    if (grant.warehouseId && !Types.ObjectId.isValid(grant.warehouseId)) {
      throw new BadRequestError(`Invalid warehouse ID for ${grant.code}`);
    }

    const key = grant.warehouseId
      ? `${grant.code}:${grant.warehouseId}`
      : grant.code;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      code: grant.code,
      ...(grant.warehouseId ? { warehouseId: grant.warehouseId } : {}),
    });
  }

  return normalized;
}
