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
import * as checklistsService from "./checklists.service.js";
import {
  checklistProgressQuerySchema,
  createChecklistSchema,
  updateChecklistSchema,
} from "./checklists.validation.js";

const router = Router();

router.use(authenticate);

router.get(
  "/today",
  requireAnyPermission([Permission.CHECKLISTS_COMPLETE, Permission.CHECKLISTS_MANAGE]),
  asyncHandler(async (req, res) => {
    const date =
      typeof req.query.date === "string" ? req.query.date : undefined;
    const items = await checklistsService.getTodayChecklists(req.user!, date);
    sendSuccess(res, items);
  })
);

router.get(
  "/",
  requireAnyPermission([Permission.CHECKLISTS_COMPLETE, Permission.CHECKLISTS_MANAGE]),
  asyncHandler(async (req, res) => {
    const items = await checklistsService.listChecklists(req.user!);
    sendSuccess(res, items);
  })
);

router.get(
  "/admin/all",
  requireAdminOrPermission(Permission.CHECKLISTS_MANAGE),
  asyncHandler(async (_req, res) => {
    const items = await checklistsService.listAllChecklistsAdmin();
    sendSuccess(res, items);
  })
);

router.get(
  "/:id/progress",
  requireAdminOrPermission(Permission.CHECKLISTS_MANAGE),
  asyncHandler(async (req, res) => {
    const parsed = checklistProgressQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid query");
    }
    const date = parsed.data.date ?? new Date().toISOString().slice(0, 10);
    const progress = await checklistsService.getChecklistProgress(
      String(req.params.id),
      date,
      parsed.data.userId
    );
    sendSuccess(res, progress);
  })
);

router.post(
  "/",
  requireAdminOrPermission(Permission.CHECKLISTS_MANAGE),
  asyncHandler(async (req, res) => {
    const parsed = createChecklistSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid input");
    }
    const checklist = await checklistsService.createChecklist(parsed.data, req.user!);
    sendSuccess(res, checklist, 201);
  })
);

router.patch(
  "/:id",
  requireAdminOrPermission(Permission.CHECKLISTS_MANAGE),
  asyncHandler(async (req, res) => {
    const parsed = updateChecklistSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid input");
    }
    const checklist = await checklistsService.updateChecklist(
      String(req.params.id),
      parsed.data,
      req.user!
    );
    sendSuccess(res, checklist);
  })
);

router.post(
  "/:id/tasks/:taskId/complete",
  requireAnyPermission([Permission.CHECKLISTS_COMPLETE, Permission.CHECKLISTS_MANAGE]),
  asyncHandler(async (req, res) => {
    const date = typeof req.body?.date === "string" ? req.body.date : undefined;
    const result = await checklistsService.completeTask(
      String(req.params.id),
      String(req.params.taskId),
      req.user!,
      date
    );
    sendSuccess(res, result);
  })
);

router.post(
  "/:id/tasks/:taskId/uncomplete",
  requireAnyPermission([Permission.CHECKLISTS_COMPLETE, Permission.CHECKLISTS_MANAGE]),
  asyncHandler(async (req, res) => {
    const date = typeof req.body?.date === "string" ? req.body.date : undefined;
    const result = await checklistsService.uncompleteTask(
      String(req.params.id),
      String(req.params.taskId),
      req.user!,
      date
    );
    sendSuccess(res, result);
  })
);

export const checklistsRoutes = router;
