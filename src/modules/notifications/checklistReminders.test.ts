import { describe, expect, it } from "vitest";
import { reminderKeysForTask } from "./checklistReminders.js";

function atTime(hours: number, minutes: number, seconds = 0): Date {
  return new Date(2026, 6, 18, hours, minutes, seconds, 0);
}

describe("reminderKeysForTask", () => {
  it("only fires the tightest before_* window (not every coarser one)", () => {
    const keys = reminderKeysForTask("20:20", atTime(20, 12));
    expect(keys).toEqual(["pending", "before_10"]);
  });

  it("uses before_15 when between 10 and 15 minutes remain", () => {
    const keys = reminderKeysForTask("20:25", atTime(20, 12));
    expect(keys).toEqual(["pending", "before_15"]);
  });

  it("uses before_60 when under an hour but over 30 minutes remain", () => {
    const keys = reminderKeysForTask("21:00", atTime(20, 20));
    expect(keys).toEqual(["pending", "before_60"]);
  });

  it("does not fire before_* when more than 60 minutes remain", () => {
    const keys = reminderKeysForTask("22:00", atTime(20, 0));
    expect(keys).toEqual(["pending"]);
  });

  it("only fires the current after_* bucket when overdue", () => {
    const keys = reminderKeysForTask("20:00", atTime(20, 45));
    expect(keys).toEqual(["pending", "after_40"]);
  });

  it("returns pending only when no due time", () => {
    expect(reminderKeysForTask(undefined, atTime(20, 0))).toEqual(["pending"]);
  });

  it("respects custom before offsets", () => {
    const keys = reminderKeysForTask("20:20", atTime(20, 12), {
      beforeOffsetsMin: [20, 5],
    });
    expect(keys).toEqual(["pending", "before_20"]);
  });

  it("can disable pending notification", () => {
    const keys = reminderKeysForTask("20:20", atTime(20, 12), {
      pendingEnabled: false,
      beforeOffsetsMin: [10],
    });
    expect(keys).toEqual(["before_10"]);
  });

  it("respects custom overdue interval", () => {
    const keys = reminderKeysForTask("20:00", atTime(20, 35), {
      afterIntervalMin: 15,
    });
    expect(keys).toEqual(["pending", "after_30"]);
  });
});
