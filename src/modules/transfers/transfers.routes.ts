import { Router } from "express";
import { Permission } from "../../shared/constants/permissions.js";
import { BadRequestError } from "../../shared/errors/AppError.js";
import { authenticate } from "../../shared/middleware/authenticate.js";
import {
  requireAdminOrPermission,
  requireAnyPermission,
} from "../../shared/middleware/requirePermission.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { sendSuccess } from "../../shared/utils/apiResponse.js";
import * as transfersService from "./transfers.service.js";
import {
  returnTransferSchema,
  transferActivityQuerySchema,
  transferHistoryQuerySchema,
  updateTransferStatusSchema,
} from "./transfers.validation.js";

const router = Router();

router.get(
  "/pending",
  authenticate,
  requireAnyPermission(
    [Permission.TRANSFERS_VIEW, Permission.TRANSFERS_RECEIVE, Permission.TRANSFERS_MANAGE],
    { warehouseIdFrom: "query", allowScopedWithoutWarehouseId: true }
  ),
  asyncHandler(async (req, res) => {
    const warehouseId =
      typeof req.query.warehouseId === "string" ? req.query.warehouseId : undefined;
    const transfers = await transfersService.listPendingTransfers(
      req.user!,
      warehouseId
    );
    sendSuccess(res, transfers);
  })
);

router.get(
  "/activity",
  authenticate,
  requireAdminOrPermission(Permission.INVENTORY_DASHBOARD),
  asyncHandler(async (req, res) => {
    const parsed = transferActivityQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid query");
    }
    const data = await transfersService.listTransferActivity(parsed.data);
    sendSuccess(res, data);
  })
);

router.get(
  "/history",
  authenticate,
  requireAnyPermission([
    Permission.TRANSFERS_VIEW,
    Permission.TRANSFERS_RECEIVE,
    Permission.TRANSFERS_MANAGE,
  ], { allowScopedWithoutWarehouseId: true }),
  asyncHandler(async (req, res) => {
    const parsed = transferHistoryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid query");
    }
    const { items, pagination } = await transfersService.listTransferHistory(
      parsed.data,
      req.user!
    );
    sendSuccess(res, items, 200, { pagination });
  })
);

router.patch(
  "/:id/status",
  authenticate,
  requireAdminOrPermission(Permission.TRANSFERS_MANAGE),
  asyncHandler(async (req, res) => {
    const parsed = updateTransferStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid body");
    }
    const transfer = await transfersService.updateTransferStatus(
      String(req.params.id),
      parsed.data,
      req.user!
    );
    sendSuccess(res, transfer);
  })
);

router.post(
  "/:id/return",
  authenticate,
  requireAnyPermission([
    Permission.TRANSFERS_MANAGE,
    Permission.TRANSFERS_RECEIVE,
    Permission.STOCK_IN,
  ], { allowScopedWithoutWarehouseId: true }),
  asyncHandler(async (req, res) => {
    const parsed = returnTransferSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid body");
    }
    const transfer = await transfersService.returnTransfer(
      String(req.params.id),
      parsed.data,
      req.user!
    );
    sendSuccess(res, transfer);
  })
);

export const transfersRoutes = router;
