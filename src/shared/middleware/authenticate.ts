import type { Request, Response, NextFunction } from "express";
import { User } from "../../models/User.js";
import { Warehouse } from "../../models/Warehouse.js";
import { UnauthorizedError } from "../errors/AppError.js";
import { defaultWarehouseOperatorPermissions } from "../constants/permissions.js";
import { UserRole } from "../constants/roles.js";
import type { AuthUser } from "../types/auth.js";
import { verifyAccessToken } from "../utils/jwt.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { assertSessionActive } from "../../modules/auth/session.service.js";

export async function buildAuthUser(userId: string): Promise<AuthUser | null> {
  const user = await User.findById(userId)
    .populate<{ warehouseId: { _id: string; name: string; code: string } | null }>(
      "warehouseId",
      "name code"
    )
    .lean();

  if (!user || !user.isActive) return null;

  let warehouse = user.warehouseId as
    | { _id: string; name: string; code: string }
    | null
    | undefined;

  let permissions = (user.permissions ?? []).map((p) => ({
    code: p.code,
    warehouseId: p.warehouseId ? String(p.warehouseId) : undefined,
  }));

  if (
    user.role === UserRole.WAREHOUSE_USER &&
    permissions.length === 0 &&
    warehouse
  ) {
    permissions = defaultWarehouseOperatorPermissions(String(warehouse._id)).map(
      (p) => ({
        code: p.code,
        warehouseId: p.warehouseId,
      })
    );
  }

  if (!warehouse) {
    const scopedWarehouseId = permissions.find((p) => p.warehouseId)?.warehouseId;
    if (scopedWarehouseId) {
      const wh = await Warehouse.findById(scopedWarehouseId).select("name code").lean();
      if (wh) {
        warehouse = { _id: String(wh._id), name: wh.name, code: wh.code };
      }
    }
  }

  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    warehouseId: warehouse ? String(warehouse._id) : undefined,
    warehouse: warehouse
      ? { id: String(warehouse._id), name: warehouse.name, code: warehouse.code }
      : undefined,
    permissions,
    isActive: user.isActive,
  };
}

export const authenticate = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedError("Authentication required");
    }

    const token = header.slice(7);
    const payload = verifyAccessToken(token);

    await assertSessionActive(payload.sid);

    const user = await buildAuthUser(payload.sub);
    if (!user) {
      throw new UnauthorizedError("User not found or inactive");
    }

    req.user = user;
    req.authSessionId = payload.sid;
    next();
  }
);
