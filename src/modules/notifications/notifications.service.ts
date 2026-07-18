import { Types } from "mongoose";
import { Notification } from "../../models/Notification.js";
import { User } from "../../models/User.js";
import { BadRequestError, NotFoundError } from "../../shared/errors/AppError.js";
import type { AuthUser } from "../../shared/types/auth.js";
import {
  mapNotification,
  resolveTaskNotifications,
  syncChecklistReminders,
} from "./checklistReminders.js";
import type { SendAdminReminderInput } from "./notifications.validation.js";

export { resolveTaskNotifications, syncChecklistReminders };

function todayDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function listNotifications(
  user: AuthUser,
  options: { resolved?: boolean; page?: number; limit?: number }
) {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(100, Math.max(1, options.limit ?? 30));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = { userId: user.id };
  if (options.resolved === false) {
    filter.resolved = false;
  } else if (options.resolved === true) {
    filter.resolved = true;
  }

  const [items, total] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments(filter),
  ]);

  return {
    items: items.map((doc) =>
      mapNotification(doc as Parameters<typeof mapNotification>[0])
    ),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export async function getUnreadCount(user: AuthUser) {
  const count = await Notification.countDocuments({
    userId: user.id,
    resolved: false,
    read: false,
  });
  return { count };
}

export async function markNotificationRead(user: AuthUser, id: string) {
  if (!Types.ObjectId.isValid(id)) {
    throw new BadRequestError("Invalid notification ID");
  }

  const doc = await Notification.findOneAndUpdate(
    { _id: id, userId: user.id },
    { $set: { read: true, readAt: new Date() } },
    { new: true }
  ).lean();

  if (!doc) {
    throw new NotFoundError("Notification not found");
  }

  return mapNotification(doc as Parameters<typeof mapNotification>[0]);
}

export async function markAllNotificationsRead(user: AuthUser) {
  const result = await Notification.updateMany(
    { userId: user.id, resolved: false, read: false },
    { $set: { read: true, readAt: new Date() } }
  );
  return { updated: result.modifiedCount };
}

export async function sendAdminReminder(
  actor: AuthUser,
  input: SendAdminReminderInput
) {
  if (!Types.ObjectId.isValid(input.userId)) {
    throw new BadRequestError("Invalid user ID");
  }

  const target = await User.findById(input.userId).lean();
  if (!target || target.isActive === false) {
    throw new NotFoundError("User not found");
  }

  const [doc] = await Notification.create([
    {
      userId: target._id,
      type: "ADMIN_REMINDER",
      title: input.title,
      message: input.message,
      checklistTitle: "Admin reminder",
      taskTitle: actor.name || "Administrator",
      date: todayDateString(),
      reminderKey: `admin_${new Types.ObjectId().toString()}`,
      read: false,
      resolved: false,
    },
  ]);

  return mapNotification(doc.toObject() as Parameters<typeof mapNotification>[0]);
}

export async function pollNotifications(user: AuthUser) {
  const [syncResult, listResult, countResult] = await Promise.all([
    syncChecklistReminders(user),
    listNotifications(user, { resolved: false, limit: 50 }),
    getUnreadCount(user),
  ]);

  return {
    sync: syncResult,
    items: listResult.items,
    unreadCount: countResult.count,
  };
}
