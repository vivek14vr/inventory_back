import type { ChecklistFrequency } from "../../models/Checklist.js";

export type ChecklistScheduleFields = {
  frequency?: ChecklistFrequency | string | null;
  weekdays?: number[] | null;
  dayOfMonth?: number | null;
};

/** Parse YYYY-MM-DD as a local calendar date (no UTC shift). */
export function parseLocalDateString(day: string): {
  year: number;
  month: number;
  date: number;
  weekday: number;
} | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(date) ||
    month < 1 ||
    month > 12 ||
    date < 1 ||
    date > 31
  ) {
    return null;
  }
  const d = new Date(year, month - 1, date);
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== date
  ) {
    return null;
  }
  return { year, month, date, weekday: d.getDay() };
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Whether a checklist is scheduled on the given business day (YYYY-MM-DD).
 * Missing/legacy frequency behaves as daily.
 */
export function isChecklistScheduledOn(
  checklist: ChecklistScheduleFields,
  day: string
): boolean {
  const parts = parseLocalDateString(day);
  if (!parts) return false;

  const frequency = (checklist.frequency ?? "daily") as ChecklistFrequency;

  if (frequency === "daily") return true;

  if (frequency === "weekly") {
    const weekdays = checklist.weekdays ?? [];
    return weekdays.includes(parts.weekday);
  }

  if (frequency === "monthly") {
    const target = checklist.dayOfMonth;
    if (target == null || target < 1 || target > 31) return false;
    const last = lastDayOfMonth(parts.year, parts.month);
    const dueDay = Math.min(target, last);
    return parts.date === dueDay;
  }

  return true;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Short human label for admin lists. */
export function formatChecklistSchedule(
  checklist: ChecklistScheduleFields
): string {
  const frequency = (checklist.frequency ?? "daily") as ChecklistFrequency;
  if (frequency === "daily") return "Daily";
  if (frequency === "weekly") {
    const days = [...(checklist.weekdays ?? [])]
      .filter((d) => d >= 0 && d <= 6)
      .sort((a, b) => a - b)
      .map((d) => WEEKDAY_LABELS[d]);
    return days.length ? `Weekly · ${days.join(", ")}` : "Weekly";
  }
  if (frequency === "monthly") {
    const d = checklist.dayOfMonth;
    return d != null ? `Monthly · day ${d}` : "Monthly";
  }
  return "Daily";
}
