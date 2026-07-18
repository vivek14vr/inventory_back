import { Router } from "express";
import { Permission, STOCK_BALANCE_READ_PERMISSIONS } from "../../shared/constants/permissions.js";
import { BadRequestError } from "../../shared/errors/AppError.js";
import { authenticate } from "../../shared/middleware/authenticate.js";
import {
  requireAnyPermission,
  requirePermission,
} from "../../shared/middleware/requirePermission.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { sendSuccess } from "../../shared/utils/apiResponse.js";
import * as stockService from "./stock.service.js";
import * as clientReturnService from "./clientReturn.service.js";
import {
  balancesQuerySchema,
  clientReturnInvoiceQuerySchema,
  clientReturnListQuerySchema,
  clientReturnSubmitSchema,
  productAvailabilityQuerySchema,
  stockInSchema,
  stockOutBatchSchema,
  stockOutSchema,
} from "./stock.validation.js";

const router = Router();

router.use(authenticate);

router.get(
  "/balances",
  requireAnyPermission(STOCK_BALANCE_READ_PERMISSIONS, {
      warehouseIdFrom: "query",
      allowScopedWithoutWarehouseId: true,
    }
  ),
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
  "/availability",
  requireAnyPermission(STOCK_BALANCE_READ_PERMISSIONS, {
      warehouseIdFrom: "query",
      allowScopedWithoutWarehouseId: true,
    }
  ),
  asyncHandler(async (req, res) => {
    const parsed = productAvailabilityQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid query");
    }
    const items = await stockService.listProductAvailability(req.user!, parsed.data);
    sendSuccess(res, items);
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

router.post(
  "/out/batch",
  requirePermission(Permission.STOCK_OUT, { warehouseIdFrom: "body" }),
  asyncHandler(async (req, res) => {
    const parsed = stockOutBatchSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid input");
    }
    const result = await stockService.stockOutBatch(parsed.data, req.user!);
    sendSuccess(res, result, 201);
  })
);

router.get(
  "/client-returns/invoices",
  requireAnyPermission([Permission.RETURNS_CLIENT], {
    warehouseIdFrom: "query",
    allowScopedWithoutWarehouseId: true,
  }),
  asyncHandler(async (req, res) => {
    const parsed = clientReturnListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid query");
    }
    const { items, pagination } = await clientReturnService.listClientReturnInvoices(
      parsed.data,
      req.user!
    );
    sendSuccess(res, items, 200, { pagination });
  })
);

router.get(
  "/client-returns/invoice",
  requireAnyPermission([Permission.RETURNS_CLIENT], {
    warehouseIdFrom: "query",
    allowScopedWithoutWarehouseId: true,
  }),
  asyncHandler(async (req, res) => {
    const parsed = clientReturnInvoiceQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid query");
    }
    const invoice = await clientReturnService.getClientReturnInvoice(
      parsed.data,
      req.user!
    );
    sendSuccess(res, invoice);
  })
);

router.post(
  "/client-returns",
  requireAnyPermission([Permission.RETURNS_CLIENT], {
    warehouseIdFrom: "body",
    allowScopedWithoutWarehouseId: true,
  }),
  asyncHandler(async (req, res) => {
    const parsed = clientReturnSubmitSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid input");
    }
    const result = await clientReturnService.submitClientReturn(parsed.data, req.user!);
    sendSuccess(res, result, 201);
  })
);

export const stockRoutes = router;
