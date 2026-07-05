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

export const createChecklistSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(500).optional(),
  assignedUserIds: z.array(z.string()).min(1, "Assign at least one user"),
  tasks: z.array(taskSchema).min(1, "Add at least one task"),
});

export const updateChecklistSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  assignedUserIds: z.array(z.string()).min(1).optional(),
  tasks: z.array(taskSchema).min(1).optional(),
  isActive: z.boolean().optional(),
});

export const checklistProgressQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  userId: z.string().optional(),
});

export type CreateChecklistInput = z.infer<typeof createChecklistSchema>;
export type UpdateChecklistInput = z.infer<typeof updateChecklistSchema>;
