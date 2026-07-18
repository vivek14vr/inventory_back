import mongoose, { Schema, type Document, type Model } from "mongoose";

export const CHECKLIST_REMINDER_SETTINGS_KEY = "checklist_reminders";

export const DEFAULT_BEFORE_OFFSETS_MIN = [60, 30, 15, 10, 5, 1] as const;

export type ChecklistReminderSettings = {
  /** Master switch — when false, no new checklist notifications are created. */
  enabled: boolean;
  /** Create the base “task pending” notification. */
  pendingEnabled: boolean;
  /** Minutes before due time to notify (tightest matching window fires). */
  beforeOffsetsMin: number[];
  /** Overdue reminder bucket size in minutes (e.g. 10 → after_10, after_20…). */
  afterIntervalMin: number;
};

export const DEFAULT_CHECKLIST_REMINDER_SETTINGS: ChecklistReminderSettings = {
  enabled: true,
  pendingEnabled: true,
  beforeOffsetsMin: [...DEFAULT_BEFORE_OFFSETS_MIN],
  afterIntervalMin: 10,
};

export interface ISystemSettings extends Document {
  key: string;
  checklistReminders: ChecklistReminderSettings;
  createdAt: Date;
  updatedAt: Date;
}

const checklistReminderSettingsSchema = new Schema<ChecklistReminderSettings>(
  {
    enabled: { type: Boolean, default: true },
    pendingEnabled: { type: Boolean, default: true },
    beforeOffsetsMin: {
      type: [Number],
      default: () => [...DEFAULT_BEFORE_OFFSETS_MIN],
    },
    afterIntervalMin: { type: Number, default: 10, min: 1, max: 240 },
  },
  { _id: false }
);

const systemSettingsSchema = new Schema<ISystemSettings>(
  {
    key: { type: String, required: true, unique: true, trim: true },
    checklistReminders: {
      type: checklistReminderSettingsSchema,
      default: () => ({ ...DEFAULT_CHECKLIST_REMINDER_SETTINGS }),
    },
  },
  { timestamps: true }
);

export const SystemSettings: Model<ISystemSettings> =
  mongoose.models.SystemSettings ??
  mongoose.model<ISystemSettings>("SystemSettings", systemSettingsSchema);
