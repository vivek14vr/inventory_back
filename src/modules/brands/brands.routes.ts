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
import * as brandsService from "./brands.service.js";
import { createBrandSchema, updateBrandSchema } from "./brands.validation.js";
import { AuditLog } from "../../models/AuditLog.js";

const router = Router();

router.get(
  "/",
  authenticate,
  requireAnyPermission([
    Permission.BRANDS_VIEW,
    Permission.BRANDS_MANAGE,
    Permission.PRODUCTS_VIEW,
    Permission.PRODUCTS_MANAGE,
    Permission.STOCK_VIEW,
    Permission.STOCK_MOVEMENTS,
    Permission.STOCK_LOW,
    Permission.STOCK_IN,
    Permission.STOCK_OUT,
    Permission.INVENTORY_VIEW,
    Permission.INVENTORY_ADJUST,
    Permission.INVENTORY_DASHBOARD,
    Permission.IMPORTS_MANAGE,
    Permission.IMPORTS_PRODUCTS,
    Permission.IMPORTS_SALES,
    Permission.REPORTS_VIEW,
  ], { allowScopedWithoutWarehouseId: true }),
  asyncHandler(async (req, res) => {
    const canManage =
      isAdmin(req.user!) || hasPermission(req.user!, Permission.BRANDS_MANAGE);
    const includeInactive =
      canManage && req.query.includeInactive === "true";
    const brands = await brandsService.listBrands(includeInactive);
    sendSuccess(res, brands);
  })
);

router.get(
  "/:id",
  authenticate,
  requireAdminOrPermission(Permission.BRANDS_VIEW),
  asyncHandler(async (req, res) => {
    const brand = await brandsService.getBrandById(String(req.params.id));
    sendSuccess(res, brand);
  })
);

router.post(
  "/",
  authenticate,
  requireAdminOrPermission(Permission.BRANDS_MANAGE),
  asyncHandler(async (req, res) => {
    const parsed = createBrandSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid input");
    }
    const brand = await brandsService.createBrand(parsed.data);
    sendSuccess(res, brand, 201);
  })
);

router.patch(
  "/:id",
  authenticate,
  requireAdminOrPermission(Permission.BRANDS_MANAGE),
  asyncHandler(async (req, res) => {
    const parsed = updateBrandSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid input");
    }
    const brand = await brandsService.updateBrand(
      String(req.params.id),
      parsed.data
    );
    sendSuccess(res, brand);
  })
);

router.delete(
  "/:id",
  authenticate,
  requireAdminOrPermission(Permission.BRANDS_MANAGE),
  asyncHandler(async (req, res) => {
    const brand = await brandsService.deleteBrandPermanently(String(req.params.id));
    await AuditLog.create({
      action: "BRAND_DELETED",
      entity: "Brand",
      entityId: brand.id,
      userId: req.user!.id,
      requestId: req.auditRequestId,
      metadata: {
        name: brand.name,
        isActive: brand.isActive,
        permanent: true,
      },
    });
    sendSuccess(res, { deleted: true, id: brand.id, name: brand.name });
  })
);

export const brandsRoutes = router;
