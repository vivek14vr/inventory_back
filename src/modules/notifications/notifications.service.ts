import { Types } from "mongoose";
import { Notification } from "../../models/Notification.js";
import { BadRequestError, NotFoundError } from "../../shared/errors/AppError.js";
import type { AuthUser } from "../../shared/types/auth.js";
import {
  mapNotification,
  resolveTaskNotifications,
  syncChecklistReminders,
} from "./checklistReminders.js";

export { resolveTaskNotifications, syncChecklistReminders };

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
    items: items.map((doc) => mapNotification(doc as Parameters<typeof mapNotification>[0])),
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
