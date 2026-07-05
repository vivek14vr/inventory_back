import mongoose, { Schema, type Document, type Model, type Types } from "mongoose";

export type NotificationType = "CHECKLIST_PENDING" | "CHECKLIST_REMINDER";

export interface INotification extends Document {
  userId: Types.ObjectId;
  type: NotificationType;
  title: string;
  message: string;
  checklistId: Types.ObjectId;
  taskId: Types.ObjectId;
  checklistTitle: string;
  taskTitle: string;
  /** Calendar date YYYY-MM-DD */
  date: string;
  /** Unique key per reminder slot: pending, before_60, after_10, etc. */
  reminderKey: string;
  dueTime?: string;
  read: boolean;
  readAt?: Date;
  resolved: boolean;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: ["CHECKLIST_PENDING", "CHECKLIST_REMINDER"],
      required: true,
    },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    checklistId: { type: Schema.Types.ObjectId, ref: "Checklist", required: true },
    taskId: { type: Schema.Types.ObjectId, required: true },
    checklistTitle: { type: String, required: true, trim: true },
    taskTitle: { type: String, required: true, trim: true },
    date: { type: String, required: true, trim: true },
    reminderKey: { type: String, required: true, trim: true },
    dueTime: { type: String, trim: true },
    read: { type: Boolean, default: false },
    readAt: { type: Date },
    resolved: { type: Boolean, default: false },
    resolvedAt: { type: Date },
  },
  { timestamps: true }
);

notificationSchema.index(
  { userId: 1, checklistId: 1, taskId: 1, date: 1, reminderKey: 1 },
  { unique: true }
);
notificationSchema.index({ userId: 1, resolved: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, read: 1, resolved: 1 });

export const Notification: Model<INotification> =
  mongoose.models.Notification ??
  mongoose.model<INotification>("Notification", notificationSchema);
