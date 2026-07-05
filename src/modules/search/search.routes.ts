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
import * as searchService from "./search.service.js";
import {
  invoiceSuggestionsQuerySchema,
  productSuggestionsQuerySchema,
} from "./search.validation.js";

const router = Router();

router.use(authenticate);

router.get(
  "/products",
  requireAnyPermission(
    [
      Permission.INVENTORY_VIEW,
      Permission.INVENTORY_DASHBOARD,
      Permission.STOCK_VIEW,
      Permission.PRODUCTS_VIEW,
      Permission.PRODUCTS_MANAGE,
    ],
    { warehouseIdFrom: "query", allowScopedWithoutWarehouseId: true }
  ),
  asyncHandler(async (req, res) => {
    const parsed = productSuggestionsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid query");
    }
    const data = await searchService.searchProductSuggestions(req.user!, parsed.data);
    sendSuccess(res, data);
  })
);

router.get(
  "/invoices",
  requireAdminOrPermission(Permission.INVENTORY_VIEW),
  asyncHandler(async (req, res) => {
    const parsed = invoiceSuggestionsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid query");
    }
    const data = await searchService.searchInvoiceSuggestions(req.user!, parsed.data);
    sendSuccess(res, data);
  })
);

export const searchRoutes = router;
