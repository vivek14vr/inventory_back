import { Types } from "mongoose";
import type { PermissionCode } from "../constants/permissions.js";
import { Permission } from "../constants/permissions.js";
import type { AuthUser } from "../types/auth.js";
import { BadRequestError, ForbiddenError } from "../errors/AppError.js";
import {
  getWarehouseIdsForPermission,
  hasPermissionSomewhere,
  isAdmin,
  resolveWarehouseIdForPermission,
} from "./permissions.js";

/** @deprecated Use resolveWarehouseIdForPermission with a specific permission code */
export function getUserWarehouseId(user: AuthUser): string {
  return resolveWarehouseIdForPermission(user, Permission.STOCK_VIEW);
}

export function resolveWarehouseId(
  user: AuthUser,
  requestedWarehouseId?: string,
  permission: PermissionCode = Permission.STOCK_VIEW
): string {
  return resolveWarehouseIdForPermission(user, permission, requestedWarehouseId);
}

export function assertWarehouseAccess(
  user: AuthUser,
  warehouseId: string,
  permission: PermissionCode
): void {
  if (!Types.ObjectId.isValid(warehouseId)) {
    throw new BadRequestError("Invalid warehouse ID");
  }
  if (isAdmin(user)) return;
  resolveWarehouseIdForPermission(user, permission, warehouseId);
}

export function getAccessibleWarehouseIds(
  user: AuthUser,
  permission: PermissionCode
): string[] | null {
  if (isAdmin(user)) return null;
  return getWarehouseIdsForPermission(user, permission);
}

/** Union of home warehouse + every warehouseId on the user's grants. */
export function getStaffVisibleWarehouseIds(user: AuthUser): string[] {
  const ids = new Set<string>();
  if (user.warehouseId) ids.add(user.warehouseId);
  for (const grant of user.permissions ?? []) {
    if (grant.warehouseId) ids.add(grant.warehouseId);
  }
  return Array.from(ids);
}

/**
 * Scope Check Stock / inventory browse queries.
 * Company-wide (INVENTORY_VIEW / admin): optional single warehouse filter.
 * Warehouse staff (STOCK_VIEW): always limited to granted warehouses.
 */
export function resolveCheckStockWarehouseScope(
  user: AuthUser,
  requestedWarehouseId?: string
): { warehouseId?: string; warehouseIds?: string[] } {
  const requested = requestedWarehouseId?.trim() || undefined;

  if (isAdmin(user) || hasPermissionSomewhere(user, Permission.INVENTORY_VIEW)) {
    return requested ? { warehouseId: requested } : {};
  }

  const allowed = getWarehouseIdsForPermission(user, Permission.STOCK_VIEW);
  if (allowed.length === 0) {
    throw new ForbiddenError("You do not have permission to view stock");
  }

  if (requested) {
    if (!allowed.includes(requested)) {
      throw new ForbiddenError("You do not have access to this warehouse");
    }
    return { warehouseId: requested };
  }

  return { warehouseIds: allowed };
}
