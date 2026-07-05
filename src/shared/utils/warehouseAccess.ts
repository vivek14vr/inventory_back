import { Types } from "mongoose";
import type { PermissionCode } from "../constants/permissions.js";
import { Permission } from "../constants/permissions.js";
import type { AuthUser } from "../types/auth.js";
import { BadRequestError } from "../errors/AppError.js";
import {
  getWarehouseIdsForPermission,
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
