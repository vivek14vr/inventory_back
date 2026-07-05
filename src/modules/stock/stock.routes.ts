import { Router } from "express";
import { Permission } from "../../shared/constants/permissions.js";
import { BadRequestError } from "../../shared/errors/AppError.js";
import { authenticate } from "../../shared/middleware/authenticate.js";
import {
  requireAnyPermission,
  requirePermission,
} from "../../shared/middleware/requirePermission.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { sendSuccess } from "../../shared/utils/apiResponse.js";
import * as stockService from "./stock.service.js";
import { balancesQuerySchema, stockInSchema, stockOutSchema } from "./stock.validation.js";

const router = Router();

router.use(authenticate);

router.get(
  "/balances",
  requirePermission(Permission.STOCK_VIEW, {
    warehouseIdFrom: "query",
    allowScopedWithoutWarehouseId: true,
  }),
  asyncHandler(async (req, res) => {
    const parsed = balancesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid query");
    }
    const { items, pagination } = await stockService.listBalancesForUser(
      req.user!,
      parsed.data
    );
    sendSuccess(res, items, 200, { pagination });
  })
);

router.get(
  "/movements",
  requirePermission(Permission.STOCK_VIEW, {
    warehouseIdFrom: "query",
    allowScopedWithoutWarehouseId: true,
  }),
  asyncHandler(async (req, res) => {
    const limit =
      typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 50;
    const movements = await stockService.listMovements(req.user!, limit);
    sendSuccess(res, movements);
  })
);

router.post(
  "/in",
  requireAnyPermission([Permission.STOCK_IN, Permission.TRANSFERS_RECEIVE], {
    warehouseIdFrom: "body",
  }),
  asyncHandler(async (req, res) => {
    const parsed = stockInSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid input");
    }
    const result = await stockService.stockIn(parsed.data, req.user!);
    sendSuccess(res, result, 201);
  })
);

router.post(
  "/out",
  requirePermission(Permission.STOCK_OUT, { warehouseIdFrom: "body" }),
  asyncHandler(async (req, res) => {
    const parsed = stockOutSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid input");
    }
    const result = await stockService.stockOut(parsed.data, req.user!);
    sendSuccess(res, result, 201);
  })
);

export const stockRoutes = router;
