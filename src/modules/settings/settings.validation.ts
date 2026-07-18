import { z } from "zod";
import {
  DEFAULT_BEFORE_OFFSETS_MIN,
  DEFAULT_CHECKLIST_REMINDER_SETTINGS,
} from "../../models/SystemSettings.js";

export const updateChecklistReminderSettingsSchema = z.object({
  enabled: z.boolean(),
  pendingEnabled: z.boolean(),
  beforeOffsetsMin: z
    .array(z.number().int().min(1).max(24 * 60))
    .min(1, "Pick at least one reminder time")
    .max(12, "Too many reminder times")
    .refine((arr) => new Set(arr).size === arr.length, {
      message: "Duplicate reminder minutes are not allowed",
    }),
  afterIntervalMin: z.number().int().min(1).max(240),
});

export type UpdateChecklistReminderSettingsInput = z.infer<
  typeof updateChecklistReminderSettingsSchema
>;

export function normalizeBeforeOffsets(offsets: number[]): number[] {
  return [...new Set(offsets)]
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 24 * 60)
    .sort((a, b) => b - a);
}

export {
  DEFAULT_BEFORE_OFFSETS_MIN,
  DEFAULT_CHECKLIST_REMINDER_SETTINGS,
};
