import { Router } from "express";
import { Permission } from "../../shared/constants/permissions.js";
import { BadRequestError } from "../../shared/errors/AppError.js";
import { authenticate } from "../../shared/middleware/authenticate.js";
import { requireAdminOrPermission } from "../../shared/middleware/requirePermission.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { sendSuccess } from "../../shared/utils/apiResponse.js";
import * as auditService from "./audit.service.js";
import { auditLogQuerySchema } from "./audit.validation.js";

const router = Router();

router.use(authenticate, requireAdminOrPermission(Permission.AUDIT_VIEW));

router.get(
  "/summary",
  asyncHandler(async (_req, res) => {
    const summary = await auditService.getAuditSummary();
    sendSuccess(res, summary);
  })
);

router.get(
  "/users",
  asyncHandler(async (_req, res) => {
    const users = await auditService.listAuditUsers();
    sendSuccess(res, users);
  })
);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = auditLogQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid query");
    }
    const { items, pagination } = await auditService.listAuditLogs(parsed.data);
    sendSuccess(res, items, 200, { pagination });
  })
);

export const auditRoutes = router;
