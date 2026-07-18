import { z } from "zod";

const dueTimeSchema = z
  .string()
  .regex(/^\d{2}:\d{2}$/, "Use HH:MM format (e.g. 10:00)")
  .optional();

const taskSchema = z.object({
  title: z.string().min(1, "Task title is required").max(200),
  sortOrder: z.number().int().optional(),
  dueTime: dueTimeSchema,
});

const frequencySchema = z.enum(["daily", "weekly", "monthly"]);

const scheduleFields = {
  frequency: frequencySchema.default("daily"),
  weekdays: z.array(z.number().int().min(0).max(6)).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
};

function refineSchedule(
  data: {
    frequency?: "daily" | "weekly" | "monthly";
    weekdays?: number[];
    dayOfMonth?: number;
  },
  ctx: z.RefinementCtx
) {
  const frequency = data.frequency ?? "daily";
  if (frequency === "weekly") {
    if (!data.weekdays?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Pick at least one weekday for a weekly checklist",
        path: ["weekdays"],
      });
    }
  }
  if (frequency === "monthly") {
    if (data.dayOfMonth == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Pick a day of the month for a monthly checklist",
        path: ["dayOfMonth"],
      });
    }
  }
}

export const createChecklistSchema = z
  .object({
    title: z.string().min(1, "Title is required").max(200),
    description: z.string().max(500).optional(),
    assignedUserIds: z.array(z.string()).min(1, "Assign at least one user"),
    tasks: z.array(taskSchema).min(1, "Add at least one task"),
    ...scheduleFields,
  })
  .superRefine(refineSchedule);

export const updateChecklistSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(500).optional(),
    assignedUserIds: z.array(z.string()).min(1).optional(),
    tasks: z.array(taskSchema).min(1).optional(),
    isActive: z.boolean().optional(),
    frequency: frequencySchema.optional(),
    weekdays: z.array(z.number().int().min(0).max(6)).optional(),
    dayOfMonth: z.number().int().min(1).max(31).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.frequency !== undefined) {
      refineSchedule(data, ctx);
    }
  });

export const checklistProgressQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  userId: z.string().optional(),
});

export type CreateChecklistInput = z.infer<typeof createChecklistSchema>;
export type UpdateChecklistInput = z.infer<typeof updateChecklistSchema>;
