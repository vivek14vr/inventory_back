import { Router } from "express";
import { Permission } from "../../shared/constants/permissions.js";
import { BadRequestError } from "../../shared/errors/AppError.js";
import { authenticate } from "../../shared/middleware/authenticate.js";
import {
  requireAdminOrAllPermissions,
  requireAdminOrPermission,
  requireAnyPermission,
} from "../../shared/middleware/requirePermission.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { sendSuccess } from "../../shared/utils/apiResponse.js";
import { resolveCheckStockWarehouseScope } from "../../shared/utils/warehouseAccess.js";
import * as inventoryAdminService from "./inventory.service.js";
import {
  adjustStockSchema,
  invoiceListQuerySchema,
  invoiceLookupQuerySchema,
  lowStockQuerySchema,
  movementsQuerySchema,
  stockItemDetailQuerySchema,
  stockQuerySchema,
  updateMovementInvoiceSchema,
  updateLowStockThresholdSchema,
} from "./inventory.validation.js";

const router = Router();

router.use(authenticate);

const requireInventoryAdjust = requireAdminOrAllPermissions([
  Permission.INVENTORY_VIEW,
  Permission.INVENTORY_ADJUST,
]);

/** Company-wide inventory browse or one Check Stock tab. */
const requireCurrentStockRead = requireAnyPermission(
  [Permission.INVENTORY_VIEW, Permission.STOCK_VIEW],
  { allowScopedWithoutWarehouseId: true }
);
const requireMovementsRead = requireAnyPermission(
  [Permission.INVENTORY_VIEW, Permission.STOCK_MOVEMENTS],
  { allowScopedWithoutWarehouseId: true }
);
const requireLowStockRead = requireAnyPermission(
  [Permission.INVENTORY_VIEW, Permission.STOCK_LOW],
  { allowScopedWithoutWarehouseId: true }
);
/** Item History / detail — Current stock or Actions (staff History link). */
const requireStockItemDetailRead = requireAnyPermission(
  [
    Permission.INVENTORY_VIEW,
    Permission.STOCK_VIEW,
    Permission.STOCK_ACTIONS,
  ],
  { allowScopedWithoutWarehouseId: true }
);

router.get(
  "/dashboard",
  requireAdminOrPermission(Permission.INVENTORY_DASHBOARD),
  asyncHandler(async (_req, res) => {
    const data = await inventoryAdminService.getAdminDashboard();
    sendSuccess(res, data);
  })
);

router.get(
  "/stock",
  requireCurrentStockRead,
  asyncHandler(async (req, res) => {
    const parsed = stockQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid query");
    }
    const scope = resolveCheckStockWarehouseScope(
      req.user!,
      parsed.data.warehouseId,
      Permission.STOCK_VIEW
    );
    const { pagination, ...data } = await inventoryAdminService.listCurrentStock({
      ...parsed.data,
      ...scope,
    });
    sendSuccess(res, data, 200, { pagination });
  })
);

router.get(
  "/items/detail",
  requireStockItemDetailRead,
  asyncHandler(async (req, res) => {
    const parsed = stockItemDetailQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid query");
    }
    resolveCheckStockWarehouseScope(req.user!, parsed.data.warehouseId, [
      Permission.STOCK_VIEW,
      Permission.STOCK_ACTIONS,
    ]);
    const { pagination, ...data } = await inventoryAdminService.getStockItemDetail(
      parsed.data
    );
    sendSuccess(res, data, 200, { pagination });
  })
);

router.get(
  "/movements",
  requireMovementsRead,
  asyncHandler(async (req, res) => {
    const parsed = movementsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid query");
    }
    const scope = resolveCheckStockWarehouseScope(
      req.user!,
      parsed.data.warehouseId,
      Permission.STOCK_MOVEMENTS
    );
    const { items, pagination } = await inventoryAdminService.listMovementHistory({
      ...parsed.data,
      ...scope,
    });
    sendSuccess(res, items, 200, { pagination });
  })
);

router.get(
  "/movements/:movementId/updates",
  requireAdminOrPermission(Permission.INVENTORY_VIEW),
  asyncHandler(async (req, res) => {
    const data = await inventoryAdminService.listMovementInvoiceUpdates(
      String(req.params.movementId)
    );
    sendSuccess(res, data);
  })
);

/** Alias — same handler; avoids older proxies/deploys missing the nested path. */
router.get(
  "/invoice-updates/:movementId",
  requireAdminOrPermission(Permission.INVENTORY_VIEW),
  asyncHandler(async (req, res) => {
    const data = await inventoryAdminService.listMovementInvoiceUpdates(
      String(req.params.movementId)
    );
    sendSuccess(res, data);
  })
);

router.get(
  "/low-stock",
  requireLowStockRead,
  asyncHandler(async (req, res) => {
    const parsed = lowStockQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid query");
    }
    const scope = resolveCheckStockWarehouseScope(
      req.user!,
      parsed.data.warehouseId,
      Permission.STOCK_LOW
    );
    const { pagination, ...data } = await inventoryAdminService.listLowStock({
      ...parsed.data,
      ...scope,
    });
    sendSuccess(res, data, 200, { pagination });
  })
);

router.patch(
  "/stock/threshold",
  requireInventoryAdjust,
  asyncHandler(async (req, res) => {
    const parsed = updateLowStockThresholdSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid body");
    }
    const result = await inventoryAdminService.updateLowStockThreshold(
      parsed.data,
      req.user!
    );
    sendSuccess(res, result);
  })
);

router.patch(
  "/stock",
  requireInventoryAdjust,
  asyncHandler(async (req, res) => {
    const parsed = adjustStockSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid body");
    }
    const result = await inventoryAdminService.adjustStockBalance(
      parsed.data,
      req.user!
    );
    sendSuccess(res, result);
  })
);

router.get(
  "/invoices/grouped",
  requireAdminOrPermission(Permission.INVENTORY_VIEW),
  asyncHandler(async (req, res) => {
    const parsed = invoiceListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid query");
    }
    const { items, pagination } = await inventoryAdminService.listInvoiceGroups(parsed.data);
    sendSuccess(res, items, 200, { pagination });
  })
);

router.get(
  "/invoices",
  requireAdminOrPermission(Permission.INVENTORY_VIEW),
  asyncHandler(async (req, res) => {
    const parsed = invoiceListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid query");
    }
    const { items, pagination } = await inventoryAdminService.listInvoiceMovements(
      parsed.data
    );
    sendSuccess(res, items, 200, { pagination });
  })
);

router.get(
  "/invoices/search",
  requireAdminOrPermission(Permission.INVENTORY_VIEW),
  asyncHandler(async (req, res) => {
    const parsed = invoiceLookupQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid query");
    }
    const { items, pagination } = await inventoryAdminService.searchMovementsForInvoiceFix(
      parsed.data
    );
    sendSuccess(res, items, 200, { pagination });
  })
);

router.patch(
  "/movements/:movementId/invoice",
  requireInventoryAdjust,
  asyncHandler(async (req, res) => {
    const parsed = updateMovementInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid body");
    }
    const result = await inventoryAdminService.updateMovementInvoice(
      String(req.params.movementId),
      parsed.data,
      req.user!
    );
    sendSuccess(res, result);
  })
);

router.delete(
  "/movements/:movementId/invoice",
  requireInventoryAdjust,
  asyncHandler(async (req, res) => {
    const result = await inventoryAdminService.deleteSaleInvoice(
      String(req.params.movementId),
      req.user!
    );
    sendSuccess(res, result);
  })
);

export const inventoryRoutes = router;
