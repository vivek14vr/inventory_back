import { Router } from "express";
import { Warehouse } from "../../models/Warehouse.js";
import { AuditLog } from "../../models/AuditLog.js";
import { Permission } from "../../shared/constants/permissions.js";
import { BadRequestError } from "../../shared/errors/AppError.js";
import { authenticate } from "../../shared/middleware/authenticate.js";
import { requireAdminOrPermission } from "../../shared/middleware/requirePermission.js";
import {
  diffPermissionGrants,
  formatPermissionGrantsList,
} from "../../shared/utils/permissionLabels.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { sendSuccess } from "../../shared/utils/apiResponse.js";
import * as usersService from "./users.service.js";
import { createUserSchema, updateUserSchema } from "./users.validation.js";

const router = Router();

router.use(authenticate, requireAdminOrPermission(Permission.USERS_MANAGE));

async function warehouseNameMap(): Promise<Map<string, string>> {
  const rows = await Warehouse.find({}).select("name").lean();
  return new Map(rows.map((w) => [String(w._id), w.name]));
}

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const users = await usersService.listUsers();
    sendSuccess(res, users);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const user = await usersService.getUserById(id);
    sendSuccess(res, user);
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid input");
    }

    const result = await usersService.createUser(parsed.data, req.user!);
    const whNames = await warehouseNameMap();

    await AuditLog.create({
      action: "USER_CREATED",
      entity: "User",
      entityId: result.user.id,
      userId: req.user!.id,
      metadata: {
        email: result.user.email,
        name: result.user.name,
        role: result.user.role,
        permissionsGranted:
          result.user.role === "WAREHOUSE_USER"
            ? formatPermissionGrantsList(result.user.permissions ?? [], whNames)
            : ["Full admin access"],
      },
    });

    sendSuccess(res, result.user, 201);
  })
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid input");
    }

    const id = String(req.params.id);
    const permissionsChanging = parsed.data.permissions !== undefined;
    const beforeUser = permissionsChanging
      ? await usersService.getUserById(id)
      : null;

    const result = await usersService.updateUser(id, parsed.data, req.user!);
    const whNames = await warehouseNameMap();

    if (permissionsChanging && beforeUser) {
      const before = beforeUser.permissions ?? [];
      const after = result.user.permissions ?? [];
      const { added, removed } = diffPermissionGrants(before, after);

      await AuditLog.create({
        action: "USER_PERMISSIONS_UPDATED",
        entity: "User",
        entityId: result.user.id,
        userId: req.user!.id,
        metadata: {
          targetUserName: result.user.name,
          targetUserEmail: result.user.email,
          granted: formatPermissionGrantsList(added, whNames),
          revoked: formatPermissionGrantsList(removed, whNames),
          totalGrants: after.length,
        },
      });
    } else {
      const changes = Object.keys(parsed.data).filter((k) => k !== "permissions");
      if (changes.length > 0) {
        await AuditLog.create({
          action: "USER_UPDATED",
          entity: "User",
          entityId: result.user.id,
          userId: req.user!.id,
          metadata: {
            targetUserName: result.user.name,
            targetUserEmail: result.user.email,
            changes,
            ...(parsed.data.isActive !== undefined
              ? { isActive: parsed.data.isActive }
              : {}),
          },
        });
      }
    }

    sendSuccess(res, result.user);
  })
);

export const usersRoutes = router;
