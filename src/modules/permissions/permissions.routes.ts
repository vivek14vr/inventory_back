import { Router } from "express";
import {
  ADMIN_ONLY_PERMISSIONS,
  PERMISSION_MODULES,
  Permission,
} from "../../shared/constants/permissions.js";
import { authenticate } from "../../shared/middleware/authenticate.js";
import { requireAdminOrPermission } from "../../shared/middleware/requirePermission.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { sendSuccess } from "../../shared/utils/apiResponse.js";

const router = Router();

router.get(
  "/catalog",
  authenticate,
  requireAdminOrPermission(Permission.USERS_MANAGE),
  asyncHandler(async (_req, res) => {
    sendSuccess(res, {
      modules: PERMISSION_MODULES,
      adminOnlyPermissions: ADMIN_ONLY_PERMISSIONS,
    });
  })
);

export const permissionsRoutes = router;
