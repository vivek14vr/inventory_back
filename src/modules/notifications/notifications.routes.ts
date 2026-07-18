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
import * as notificationsService from "./notifications.service.js";
import {
  notificationListQuerySchema,
  sendAdminReminderSchema,
} from "./notifications.validation.js";

const router = Router();

router.use(authenticate);

router.post(
  "/send",
  requireAdminOrPermission(Permission.CHECKLISTS_MANAGE),
  asyncHandler(async (req, res) => {
    const parsed = sendAdminReminderSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid input");
    }
    const item = await notificationsService.sendAdminReminder(
      req.user!,
      parsed.data
    );
    sendSuccess(res, item, 201);
  })
);

router.use(
  requireAnyPermission([
    Permission.CHECKLISTS_COMPLETE,
    Permission.CHECKLISTS_MANAGE,
  ])
);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = notificationListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid query");
    }
    const result = await notificationsService.listNotifications(
      req.user!,
      parsed.data
    );
    sendSuccess(res, result.items, 200, { pagination: result.pagination });
  })
);

router.get(
  "/poll",
  asyncHandler(async (req, res) => {
    const result = await notificationsService.pollNotifications(req.user!);
    sendSuccess(res, result);
  })
);

router.get(
  "/unread-count",
  asyncHandler(async (req, res) => {
    const result = await notificationsService.getUnreadCount(req.user!);
    sendSuccess(res, result);
  })
);

router.post(
  "/sync",
  asyncHandler(async (req, res) => {
    const date = typeof req.body?.date === "string" ? req.body.date : undefined;
    const result = await notificationsService.syncChecklistReminders(
      req.user!,
      date
    );
    sendSuccess(res, result);
  })
);

router.patch(
  "/:id/read",
  asyncHandler(async (req, res) => {
    const item = await notificationsService.markNotificationRead(
      req.user!,
      String(req.params.id)
    );
    sendSuccess(res, item);
  })
);

router.post(
  "/read-all",
  asyncHandler(async (req, res) => {
    const result = await notificationsService.markAllNotificationsRead(
      req.user!
    );
    sendSuccess(res, result);
  })
);

export const notificationsRoutes = router;
