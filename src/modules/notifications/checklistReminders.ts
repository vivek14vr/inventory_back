import { Types } from "mongoose";
import { Checklist } from "../../models/Checklist.js";
import { ChecklistCompletion } from "../../models/ChecklistCompletion.js";
import { Notification } from "../../models/Notification.js";
import type { AuthUser } from "../../shared/types/auth.js";

const BEFORE_OFFSETS_MIN = [60, 30, 15, 10, 5, 1] as const;

function isPastDueTime(dueTime?: string, at: Date = new Date()): boolean {
  if (!dueTime) return false;
  const [hours, minutes] = dueTime.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return false;
  const due = new Date(at);
  due.setHours(hours, minutes, 0, 0);
  return at > due;
}

function todayDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDueTime(dueTime: string): string {
  const [hours, minutes] = dueTime.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return dueTime;
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function dueDateTime(dueTime: string, at: Date = new Date()): Date {
  const [hours, minutes] = dueTime.split(":").map(Number);
  const due = new Date(at);
  due.setHours(hours, minutes, 0, 0);
  return due;
}

function buildReminderMessage(
  taskTitle: string,
  checklistTitle: string,
  dueTime: string | undefined,
  reminderKey: string
): { title: string; message: string; type: "CHECKLIST_PENDING" | "CHECKLIST_REMINDER" } {
  const formattedDue = dueTime ? formatDueTime(dueTime) : undefined;

  if (reminderKey === "pending") {
    return {
      type: "CHECKLIST_PENDING",
      title: "Checklist task pending",
      message: formattedDue
        ? `${taskTitle} (${checklistTitle}) — complete before ${formattedDue}`
        : `${taskTitle} (${checklistTitle}) is waiting to be done`,
    };
  }

  if (reminderKey.startsWith("before_")) {
    const mins = Number(reminderKey.replace("before_", ""));
    const label =
      mins === 60
        ? "1 hour"
        : mins === 1
          ? "1 minute"
          : `${mins} minutes`;
    return {
      type: "CHECKLIST_REMINDER",
      title: `${label} left`,
      message: formattedDue
        ? `Complete "${taskTitle}" before ${formattedDue}`
        : `Complete "${taskTitle}" soon`,
    };
  }

  if (reminderKey.startsWith("after_")) {
    const mins = Number(reminderKey.replace("after_", ""));
    return {
      type: "CHECKLIST_REMINDER",
      title: "Task overdue",
      message: formattedDue
        ? `"${taskTitle}" was due at ${formattedDue} (${mins} min ago). You can still complete it.`
        : `"${taskTitle}" is overdue (${mins} min). You can still complete it.`,
    };
  }

  return {
    type: "CHECKLIST_REMINDER",
    title: "Checklist reminder",
    message: `${taskTitle} — ${checklistTitle}`,
  };
}

function elapsedAfterBuckets(due: Date, now: Date): number[] {
  const msPast = now.getTime() - due.getTime();
  if (msPast < 10 * 60 * 1000) return [];
  const minutesPast = Math.floor(msPast / 60_000);
  const buckets: number[] = [];
  for (let m = 10; m <= minutesPast; m += 10) {
    buckets.push(m);
  }
  return buckets;
}

function reminderKeysForTask(
  dueTime: string | undefined,
  now: Date
): string[] {
  const keys: string[] = ["pending"];

  if (!dueTime) return keys;

  const due = dueDateTime(dueTime, now);

  for (const offset of BEFORE_OFFSETS_MIN) {
    const triggerAt = new Date(due.getTime() - offset * 60_000);
    if (now >= triggerAt) {
      keys.push(`before_${offset}`);
    }
  }

  if (now > due) {
    for (const bucket of elapsedAfterBuckets(due, now)) {
      keys.push(`after_${bucket}`);
    }
  }

  return keys;
}

export async function syncChecklistReminders(user: AuthUser, date?: string) {
  const day = date ?? todayDateString();
  const now = new Date();

  const checklists = await Checklist.find({
    isActive: true,
    assignedUserIds: new Types.ObjectId(user.id),
  }).lean();

  if (checklists.length === 0) {
    return { created: 0, notifications: [] as ReturnType<typeof mapNotification>[] };
  }

  const checklistIds = checklists.map((c) => c._id);
  const completions = await ChecklistCompletion.find({
    userId: user.id,
    date: day,
    checklistId: { $in: checklistIds },
  }).lean();

  const completedSet = new Set(
    completions.map((c) => `${c.checklistId}:${c.taskId}`)
  );

  const createdNotifications: NonNullable<Awaited<ReturnType<typeof upsertReminder>>>[] = [];

  for (const checklist of checklists) {
    for (const task of checklist.tasks) {
      const taskId = String(task._id);
      if (completedSet.has(`${checklist._id}:${taskId}`)) {
        continue;
      }

      const keys = reminderKeysForTask(task.dueTime, now);
      for (const reminderKey of keys) {
        const { title, message, type } = buildReminderMessage(
          task.title,
          checklist.title,
          task.dueTime,
          reminderKey
        );
        const doc = await upsertReminder({
          userId: user.id,
          type,
          title,
          message,
          checklistId: String(checklist._id),
          taskId,
          checklistTitle: checklist.title,
          taskTitle: task.title,
          date: day,
          reminderKey,
          dueTime: task.dueTime,
        });
        if (doc) createdNotifications.push(doc);
      }
    }
  }

  return {
    created: createdNotifications.length,
    notifications: createdNotifications.map(mapNotification),
  };
}

async function upsertReminder(input: {
  userId: string;
  type: "CHECKLIST_PENDING" | "CHECKLIST_REMINDER";
  title: string;
  message: string;
  checklistId: string;
  taskId: string;
  checklistTitle: string;
  taskTitle: string;
  date: string;
  reminderKey: string;
  dueTime?: string;
}) {
  const existing = await Notification.findOne({
    userId: input.userId,
    checklistId: input.checklistId,
    taskId: input.taskId,
    date: input.date,
    reminderKey: input.reminderKey,
  });

  if (existing) return null;

  const [doc] = await Notification.create([
    {
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      checklistId: input.checklistId,
      taskId: input.taskId,
      checklistTitle: input.checklistTitle,
      taskTitle: input.taskTitle,
      date: input.date,
      reminderKey: input.reminderKey,
      dueTime: input.dueTime,
      read: false,
      resolved: false,
    },
  ]);

  return doc;
}

export async function resolveTaskNotifications(
  userId: string,
  checklistId: string,
  taskId: string,
  date: string
) {
  await Notification.updateMany(
    {
      userId,
      checklistId,
      taskId,
      date,
      resolved: false,
    },
    {
      $set: {
        resolved: true,
        resolvedAt: new Date(),
        read: true,
        readAt: new Date(),
      },
    }
  );
}

export function mapNotification(doc: {
  _id: Types.ObjectId | string;
  type: string;
  title: string;
  message: string;
  checklistId: Types.ObjectId | string;
  taskId: Types.ObjectId | string;
  checklistTitle: string;
  taskTitle: string;
  date: string;
  reminderKey: string;
  dueTime?: string;
  read: boolean;
  readAt?: Date;
  resolved: boolean;
  resolvedAt?: Date;
  createdAt: Date;
}) {
  return {
    id: String(doc._id),
    type: doc.type,
    title: doc.title,
    message: doc.message,
    checklistId: String(doc.checklistId),
    taskId: String(doc.taskId),
    checklistTitle: doc.checklistTitle,
    taskTitle: doc.taskTitle,
    date: doc.date,
    reminderKey: doc.reminderKey,
    dueTime: doc.dueTime,
    read: doc.read,
    readAt: doc.readAt?.toISOString(),
    resolved: doc.resolved,
    resolvedAt: doc.resolvedAt?.toISOString(),
    createdAt: doc.createdAt.toISOString(),
    isPastDue: doc.dueTime ? isPastDueTime(doc.dueTime) : false,
  };
}
