import { Router } from "express";
import { Permission } from "../../shared/constants/permissions.js";
import { BadRequestError } from "../../shared/errors/AppError.js";
import { authenticate } from "../../shared/middleware/authenticate.js";
import {
  requireAdminOrPermission,
  requireAnyPermission,
} from "../../shared/middleware/requirePermission.js";
import { hasPermission, isAdmin } from "../../shared/utils/permissions.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { sendSuccess } from "../../shared/utils/apiResponse.js";
import * as productsService from "./products.service.js";
import {
  createProductSchema,
  listProductsQuerySchema,
  updateProductSchema,
} from "./products.validation.js";

const router = Router();

router.get(
  "/",
  authenticate,
  requireAnyPermission([
    Permission.PRODUCTS_VIEW,
    Permission.PRODUCTS_MANAGE,
    Permission.STOCK_VIEW,
    Permission.STOCK_IN,
    Permission.STOCK_OUT,
    Permission.INVENTORY_VIEW,
    Permission.INVENTORY_ADJUST,
    Permission.INVENTORY_DASHBOARD,
    Permission.IMPORTS_MANAGE,
    Permission.REPORTS_VIEW,
  ], { allowScopedWithoutWarehouseId: true }),
  asyncHandler(async (req, res) => {
    const canManage =
      isAdmin(req.user!) ||
      hasPermission(req.user!, Permission.PRODUCTS_MANAGE);
    const includeInactive =
      canManage && req.query.includeInactive === "true";
    const parsed = listProductsQuerySchema.safeParse({
      ...req.query,
      includeInactive: includeInactive ? "true" : "false",
    });
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid query");
    }
    const { items, pagination } = await productsService.listProducts(parsed.data);
    sendSuccess(res, items, 200, { pagination });
  })
);

router.get(
  "/:id",
  authenticate,
  requireAdminOrPermission(Permission.PRODUCTS_VIEW),
  asyncHandler(async (req, res) => {
    const product = await productsService.getProductById(String(req.params.id));
    sendSuccess(res, product);
  })
);

router.post(
  "/",
  authenticate,
  requireAdminOrPermission(Permission.PRODUCTS_MANAGE),
  asyncHandler(async (req, res) => {
    const parsed = createProductSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid input");
    }
    const product = await productsService.createProduct(parsed.data);
    sendSuccess(res, product, 201);
  })
);

router.patch(
  "/:id",
  authenticate,
  requireAdminOrPermission(Permission.PRODUCTS_MANAGE),
  asyncHandler(async (req, res) => {
    const parsed = updateProductSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid input");
    }
    const product = await productsService.updateProduct(
      String(req.params.id),
      parsed.data
    );
    sendSuccess(res, product);
  })
);

export const productsRoutes = router;
