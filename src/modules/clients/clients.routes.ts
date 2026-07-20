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
import * as clientsService from "./clients.service.js";
import { createClientSchema, updateClientSchema } from "./clients.validation.js";

const router = Router();

router.get(
  "/",
  authenticate,
  requireAnyPermission(
    [
      Permission.CLIENTS_VIEW,
      Permission.CLIENTS_MANAGE,
      Permission.IMPORTS_MANAGE,
      Permission.IMPORTS_CLIENTS,
      Permission.IMPORTS_SALES,
      Permission.STOCK_OUT,
      Permission.RETURNS_CLIENT,
      Permission.INVENTORY_VIEW,
      Permission.INVENTORY_ADJUST,
      Permission.REPORTS_VIEW,
    ],
    { allowScopedWithoutWarehouseId: true }
  ),
  asyncHandler(async (req, res) => {
    const canManage =
      isAdmin(req.user!) || hasPermission(req.user!, Permission.CLIENTS_MANAGE);
    const includeInactive = canManage && req.query.includeInactive === "true";
    const clients = await clientsService.listClients(includeInactive);
    sendSuccess(res, clients);
  })
);

router.get(
  "/:id",
  authenticate,
  requireAdminOrPermission(Permission.CLIENTS_VIEW),
  asyncHandler(async (req, res) => {
    const client = await clientsService.getClientById(String(req.params.id));
    sendSuccess(res, client);
  })
);

router.post(
  "/",
  authenticate,
  requireAdminOrPermission(Permission.CLIENTS_MANAGE),
  asyncHandler(async (req, res) => {
    const parsed = createClientSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid input");
    }
    const client = await clientsService.createClient(parsed.data);
    sendSuccess(res, client, 201);
  })
);

router.patch(
  "/:id",
  authenticate,
  requireAdminOrPermission(Permission.CLIENTS_MANAGE),
  asyncHandler(async (req, res) => {
    const parsed = updateClientSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid input");
    }
    const client = await clientsService.updateClient(String(req.params.id), parsed.data);
    sendSuccess(res, client);
  })
);

export const clientsRoutes = router;
