import { Router } from "express";
import { Permission } from "../../shared/constants/permissions.js";
import { BadRequestError, ForbiddenError } from "../../shared/errors/AppError.js";
import { authenticate } from "../../shared/middleware/authenticate.js";
import {
  requireAdminOrPermission,
  requireAnyPermission,
} from "../../shared/middleware/requirePermission.js";
import { hasPermission, isAdmin } from "../../shared/utils/permissions.js";
import { getStaffVisibleWarehouseIds } from "../../shared/utils/warehouseAccess.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { sendSuccess } from "../../shared/utils/apiResponse.js";
import * as warehousesService from "./warehouses.service.js";
import {
  createWarehouseSchema,
  updateWarehouseSchema,
} from "./warehouses.validation.js";

const router = Router();

router.get(
  "/",
  authenticate,
  requireAnyPermission([
    Permission.WAREHOUSES_VIEW,
    Permission.WAREHOUSES_MANAGE,
    Permission.STOCK_VIEW,
    Permission.STOCK_IN,
    Permission.STOCK_OUT,
    Permission.RETURNS_CLIENT,
    Permission.RETURNS_WAREHOUSE,
    Permission.INVENTORY_VIEW,
    Permission.INVENTORY_ADJUST,
    Permission.INVENTORY_DASHBOARD,
    Permission.TRANSFERS_VIEW,
    Permission.TRANSFERS_RECEIVE,
    Permission.TRANSFERS_MANAGE,
    Permission.REPORTS_VIEW,
    Permission.USERS_MANAGE,
    Permission.CHECKLISTS_MANAGE,
  ], { allowScopedWithoutWarehouseId: true }),
  asyncHandler(async (req, res) => {
    const canManage =
      isAdmin(req.user!) ||
      hasPermission(req.user!, Permission.WAREHOUSES_MANAGE);
    const includeInactive =
      canManage && req.query.includeInactive === "true";
    const scopeIds = isAdmin(req.user!)
      ? null
      : getStaffVisibleWarehouseIds(req.user!);
    const warehouses = await warehousesService.listWarehouses(
      includeInactive,
      scopeIds
    );
    sendSuccess(res, warehouses);
  })
);

router.get(
  "/:id",
  authenticate,
  requireAdminOrPermission(Permission.WAREHOUSES_VIEW),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!isAdmin(req.user!)) {
      const allowed = getStaffVisibleWarehouseIds(req.user!);
      if (!allowed.includes(id)) {
        throw new ForbiddenError("You do not have access to this warehouse");
      }
    }
    const warehouse = await warehousesService.getWarehouseById(id);
    sendSuccess(res, warehouse);
  })
);

router.post(
  "/",
  authenticate,
  requireAdminOrPermission(Permission.WAREHOUSES_MANAGE),
  asyncHandler(async (req, res) => {
    const parsed = createWarehouseSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid input");
    }
    const warehouse = await warehousesService.createWarehouse(parsed.data);
    sendSuccess(res, warehouse, 201);
  })
);

router.patch(
  "/:id",
  authenticate,
  requireAdminOrPermission(Permission.WAREHOUSES_MANAGE),
  asyncHandler(async (req, res) => {
    const parsed = updateWarehouseSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid input");
    }
    const warehouse = await warehousesService.updateWarehouse(
      String(req.params.id),
      parsed.data
    );
    sendSuccess(res, warehouse);
  })
);

export const warehousesRoutes = router;
