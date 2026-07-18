import { Router } from "express";
import { Permission } from "../../shared/constants/permissions.js";
import { BadRequestError } from "../../shared/errors/AppError.js";
import { authenticate } from "../../shared/middleware/authenticate.js";
import { requireAdminOrPermission } from "../../shared/middleware/requirePermission.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { sendSuccess } from "../../shared/utils/apiResponse.js";
import * as settingsService from "./settings.service.js";
import { updateChecklistReminderSettingsSchema } from "./settings.validation.js";

const router = Router();

router.use(authenticate);

router.get(
  "/checklist-reminders",
  requireAdminOrPermission(Permission.CHECKLISTS_MANAGE),
  asyncHandler(async (_req, res) => {
    const settings = await settingsService.getChecklistReminderSettings();
    sendSuccess(res, settings);
  })
);

router.put(
  "/checklist-reminders",
  requireAdminOrPermission(Permission.CHECKLISTS_MANAGE),
  asyncHandler(async (req, res) => {
    const parsed = updateChecklistReminderSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid input");
    }
    const settings = await settingsService.updateChecklistReminderSettings(
      parsed.data
    );
    sendSuccess(res, settings);
  })
);

export const settingsRoutes = router;
