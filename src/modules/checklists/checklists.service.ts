import { Types } from "mongoose";
import { AuditLog } from "../../models/AuditLog.js";
import { Checklist, type IChecklist } from "../../models/Checklist.js";
import { ChecklistCompletion } from "../../models/ChecklistCompletion.js";
import { User } from "../../models/User.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../shared/errors/AppError.js";
import type { AuthUser } from "../../shared/types/auth.js";
import { buildChecklistAuditMetadata } from "../../shared/utils/auditMetadata.js";
import { isAdmin } from "../../shared/utils/permissions.js";
import type { CreateChecklistInput, UpdateChecklistInput } from "./checklists.validation.js";
import { resolveTaskNotifications } from "../notifications/checklistReminders.js";

function todayDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isPastDueTime(dueTime?: string, at: Date = new Date()): boolean {
  if (!dueTime) return false;
  const [hours, minutes] = dueTime.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return false;
  const due = new Date(at);
  due.setHours(hours, minutes, 0, 0);
  return at > due;
}

function mapChecklist(doc: IChecklist) {
  return {
    id: String(doc._id),
    title: doc.title,
    description: doc.description,
    assignedUserIds: doc.assignedUserIds.map(String),
    tasks: doc.tasks
      .map((t) => ({
        id: String(t._id),
        title: t.title,
        sortOrder: t.sortOrder,
        dueTime: t.dueTime,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder),
    createdBy: String(doc.createdBy),
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function assertUsersExist(userIds: string[]) {
  const valid = userIds.filter((id) => Types.ObjectId.isValid(id));
  if (valid.length !== userIds.length) {
    throw new BadRequestError("Invalid user ID in assignment list");
  }
  const count = await User.countDocuments({ _id: { $in: valid }, isActive: true });
  if (count !== valid.length) {
    throw new BadRequestError("One or more assigned users were not found");
  }
}

export async function listChecklists(user: AuthUser) {
  const filter: Record<string, unknown> = { isActive: true };
  if (!isAdmin(user)) {
    filter.assignedUserIds = new Types.ObjectId(user.id);
  }

  const checklists = await Checklist.find(filter).sort({ title: 1 }).lean();
  return checklists.map((c) => mapChecklist(c as unknown as IChecklist));
}

export async function listAllChecklistsAdmin() {
  const checklists = await Checklist.find().sort({ updatedAt: -1 }).lean();
  return checklists.map((c) => mapChecklist(c as unknown as IChecklist));
}

export async function createChecklist(input: CreateChecklistInput, user: AuthUser) {
  await assertUsersExist(input.assignedUserIds);

  const tasks = input.tasks.map((t, i) => ({
    title: t.title.trim(),
    sortOrder: t.sortOrder ?? i,
    dueTime: t.dueTime,
  }));

  const [checklist] = await Checklist.create([
    {
      title: input.title.trim(),
      description: input.description?.trim(),
      assignedUserIds: input.assignedUserIds,
      tasks,
      createdBy: user.id,
      isActive: true,
    },
  ]);

  await AuditLog.create({
    action: "CHECKLIST_CREATED",
    entity: "Checklist",
    entityId: checklist._id,
    userId: user.id,
    metadata: {
      title: checklist.title,
      assignedUserCount: input.assignedUserIds.length,
      taskCount: tasks.length,
    },
  });

  return mapChecklist(checklist);
}

export async function updateChecklist(
  id: string,
  input: UpdateChecklistInput,
  user: AuthUser
) {
  if (!Types.ObjectId.isValid(id)) {
    throw new BadRequestError("Invalid checklist ID");
  }

  const checklist = await Checklist.findById(id);
  if (!checklist) {
    throw new NotFoundError("Checklist not found");
  }

  if (input.assignedUserIds) {
    await assertUsersExist(input.assignedUserIds);
    checklist.assignedUserIds = input.assignedUserIds.map((uid) => new Types.ObjectId(uid));
  }
  if (input.title !== undefined) checklist.title = input.title.trim();
  if (input.description !== undefined) checklist.description = input.description?.trim();
  if (input.isActive !== undefined) checklist.isActive = input.isActive;
  if (input.tasks) {
    checklist.tasks = input.tasks.map((t, i) => ({
      _id: new Types.ObjectId(),
      title: t.title.trim(),
      sortOrder: t.sortOrder ?? i,
      dueTime: t.dueTime,
    })) as IChecklist["tasks"];
  }

  await checklist.save();

  await AuditLog.create({
    action: "CHECKLIST_UPDATED",
    entity: "Checklist",
    entityId: checklist._id,
    userId: user.id,
    metadata: {
      title: checklist.title,
      changes: Object.keys(input),
    },
  });

  return mapChecklist(checklist);
}

export async function getTodayChecklists(user: AuthUser, date?: string) {
  const day = date ?? todayDateString();
  const filter: Record<string, unknown> = {
    isActive: true,
    assignedUserIds: new Types.ObjectId(user.id),
  };

  const checklists = await Checklist.find(filter).sort({ title: 1 }).lean();
  const checklistIds = checklists.map((c) => c._id);

  const completions = await ChecklistCompletion.find({
    userId: user.id,
    date: day,
    checklistId: { $in: checklistIds },
  }).lean();

  const completedSet = new Set(
    completions.map((c) => `${c.checklistId}:${c.taskId}`)
  );

  return checklists.map((c) => {
    const mapped = mapChecklist(c as unknown as IChecklist);
    const now = new Date();
    const tasksWithStatus = mapped.tasks.map((t) => {
      const completed = completedSet.has(`${c._id}:${t.id}`);
      const completedAt = completions.find(
        (comp) =>
          String(comp.checklistId) === String(c._id) &&
          String(comp.taskId) === t.id
      )?.completedAt;
      const pastDue = !completed && isPastDueTime(t.dueTime, now);
      return {
        ...t,
        completed,
        completedAt,
        isPastDue: pastDue,
      };
    });
    const hasOverdue = tasksWithStatus.some((t) => t.isPastDue);
    return {
      ...mapped,
      date: day,
      isPastDue: hasOverdue,
      tasks: tasksWithStatus,
      completedCount: tasksWithStatus.filter((t) => t.completed).length,
      totalCount: tasksWithStatus.length,
    };
  });
}

export async function completeTask(
  checklistId: string,
  taskId: string,
  user: AuthUser,
  date?: string
) {
  if (!Types.ObjectId.isValid(checklistId) || !Types.ObjectId.isValid(taskId)) {
    throw new BadRequestError("Invalid checklist or task ID");
  }

  const day = date ?? todayDateString();
  const checklist = await Checklist.findById(checklistId);
  if (!checklist || !checklist.isActive) {
    throw new NotFoundError("Checklist not found");
  }

  const assigned = checklist.assignedUserIds.some((uid) => String(uid) === user.id);
  if (!isAdmin(user) && !assigned) {
    throw new ForbiddenError("This checklist is not assigned to you");
  }

  const task = checklist.tasks.find((t) => String(t._id) === taskId);
  if (!task) {
    throw new NotFoundError("Task not found on this checklist");
  }

  const existing = await ChecklistCompletion.findOne({
    checklistId,
    taskId,
    userId: user.id,
    date: day,
  });

  if (existing) {
    return { completed: true, completedAt: existing.completedAt };
  }

  const [completion] = await ChecklistCompletion.create([
    {
      checklistId,
      taskId,
      userId: user.id,
      date: day,
      completedAt: new Date(),
    },
  ]);

  const completedLate = isPastDueTime(task.dueTime, completion.completedAt);

  await resolveTaskNotifications(user.id, checklistId, taskId, day);

  await AuditLog.create({
    action: "CHECKLIST_TASK_COMPLETED",
    entity: "ChecklistCompletion",
    entityId: completion._id,
    userId: user.id,
    metadata: buildChecklistAuditMetadata({
      checklistId,
      checklistTitle: checklist.title,
      taskId,
      taskTitle: task.title,
      date: day,
      dueTime: task.dueTime,
      completedLate,
      userName: user.name,
    }),
  });

  return {
    completed: true,
    completedAt: completion.completedAt,
    completedLate,
  };
}

export async function uncompleteTask(
  checklistId: string,
  taskId: string,
  user: AuthUser,
  date?: string
) {
  if (!Types.ObjectId.isValid(checklistId) || !Types.ObjectId.isValid(taskId)) {
    throw new BadRequestError("Invalid checklist or task ID");
  }

  const day = date ?? todayDateString();
  const checklist = await Checklist.findById(checklistId);
  if (!checklist) {
    throw new NotFoundError("Checklist not found");
  }

  const assigned = checklist.assignedUserIds.some((uid) => String(uid) === user.id);
  if (!isAdmin(user) && !assigned) {
    throw new ForbiddenError("This checklist is not assigned to you");
  }

  const task = checklist.tasks.find((t) => String(t._id) === taskId);
  if (!task) {
    throw new NotFoundError("Task not found on this checklist");
  }

  const removed = await ChecklistCompletion.findOneAndDelete({
    checklistId,
    taskId,
    userId: user.id,
    date: day,
  });

  if (removed) {
    await AuditLog.create({
      action: "CHECKLIST_TASK_UNCOMPLETED",
      entity: "ChecklistCompletion",
      entityId: removed._id,
      userId: user.id,
      metadata: buildChecklistAuditMetadata({
        checklistId,
        checklistTitle: checklist.title,
        taskId,
        taskTitle: task.title,
        date: day,
        dueTime: task.dueTime,
        userName: user.name,
      }),
    });
  }

  return { completed: false };
}

export async function getChecklistProgress(
  checklistId: string,
  date: string,
  userId?: string
) {
  if (!Types.ObjectId.isValid(checklistId)) {
    throw new BadRequestError("Invalid checklist ID");
  }

  const checklist = await Checklist.findById(checklistId).lean();
  if (!checklist) {
    throw new NotFoundError("Checklist not found");
  }

  const mapped = mapChecklist(checklist as unknown as IChecklist);
  const targetUserIds = userId
    ? [userId]
    : mapped.assignedUserIds;

  const users = await User.find({ _id: { $in: targetUserIds } })
    .select("name email role warehouseId")
    .populate("warehouseId", "name code")
    .lean();

  const completions = await ChecklistCompletion.find({
    checklistId,
    date,
    userId: { $in: targetUserIds },
  }).lean();

  const now = new Date();

  return {
    checklist: mapped,
    date,
    isPastDue: mapped.tasks.some(
      (t) => isPastDueTime(t.dueTime, now)
    ),
    users: users.map((u) => {
      const uid = String(u._id);
      const userCompletions = completions.filter((c) => String(c.userId) === uid);
      const completedSet = new Set(userCompletions.map((c) => String(c.taskId)));
      const warehouse = u.warehouseId as
        | { name: string; code: string }
        | null
        | undefined;

      const tasks = mapped.tasks.map((t) => {
        const completed = completedSet.has(t.id);
        const completedAt = userCompletions.find((c) => String(c.taskId) === t.id)
          ?.completedAt;
        const pastDue = !completed && isPastDueTime(t.dueTime, now);
        return {
          ...t,
          completed,
          completedAt,
          isPastDue: pastDue,
          completedLate:
            completed && completedAt
              ? isPastDueTime(t.dueTime, completedAt)
              : false,
        };
      });

      const pendingTasks = tasks
        .filter((t) => !t.completed)
        .map((t) => ({
          title: t.title,
          dueTime: t.dueTime,
          isPastDue: t.isPastDue,
        }));
      const completedTasks = tasks
        .filter((t) => t.completed)
        .map((t) => ({
          title: t.title,
          dueTime: t.dueTime,
          completedAt: t.completedAt,
          completedLate: t.completedLate,
        }));

      const allDone = tasks.every((t) => t.completed);
      const hasOverdue = tasks.some((t) => t.isPastDue);

      return {
        id: uid,
        name: u.name,
        email: u.email,
        role: u.role,
        warehouse: warehouse ? { name: warehouse.name, code: warehouse.code } : undefined,
        tasks,
        pendingTasks,
        completedTasks,
        completedCount: tasks.filter((t) => t.completed).length,
        totalCount: tasks.length,
        status: allDone ? "completed" : hasOverdue ? "overdue" : "pending",
      };
    }),
  };
}
