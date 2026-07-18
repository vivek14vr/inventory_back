import {
  CHECKLIST_REMINDER_SETTINGS_KEY,
  DEFAULT_CHECKLIST_REMINDER_SETTINGS,
  SystemSettings,
  type ChecklistReminderSettings,
} from "../../models/SystemSettings.js";
import type { UpdateChecklistReminderSettingsInput } from "./settings.validation.js";
import { normalizeBeforeOffsets } from "./settings.validation.js";

function toPublic(
  settings: ChecklistReminderSettings
): ChecklistReminderSettings {
  return {
    enabled: settings.enabled !== false,
    pendingEnabled: settings.pendingEnabled !== false,
    beforeOffsetsMin: normalizeBeforeOffsets(
      settings.beforeOffsetsMin?.length
        ? settings.beforeOffsetsMin
        : DEFAULT_CHECKLIST_REMINDER_SETTINGS.beforeOffsetsMin
    ),
    afterIntervalMin: Math.max(
      1,
      Math.min(240, settings.afterIntervalMin || 10)
    ),
  };
}

export async function getChecklistReminderSettings(): Promise<ChecklistReminderSettings> {
  const doc = await SystemSettings.findOne({
    key: CHECKLIST_REMINDER_SETTINGS_KEY,
  }).lean();

  if (!doc?.checklistReminders) {
    return { ...DEFAULT_CHECKLIST_REMINDER_SETTINGS };
  }

  return toPublic(doc.checklistReminders);
}

export async function updateChecklistReminderSettings(
  input: UpdateChecklistReminderSettingsInput
): Promise<ChecklistReminderSettings> {
  const next: ChecklistReminderSettings = {
    enabled: input.enabled,
    pendingEnabled: input.pendingEnabled,
    beforeOffsetsMin: normalizeBeforeOffsets(input.beforeOffsetsMin),
    afterIntervalMin: input.afterIntervalMin,
  };

  const doc = await SystemSettings.findOneAndUpdate(
    { key: CHECKLIST_REMINDER_SETTINGS_KEY },
    {
      $set: { checklistReminders: next },
      $setOnInsert: { key: CHECKLIST_REMINDER_SETTINGS_KEY },
    },
    { upsert: true, new: true }
  ).lean();

  return toPublic(doc!.checklistReminders);
}
