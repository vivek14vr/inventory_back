import { z } from "zod";

export const notificationListQuerySchema = z.object({
  resolved: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const sendAdminReminderSchema = z.object({
  userId: z.string().min(1, "Select a user"),
  title: z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(120, "Title is too long"),
  message: z
    .string()
    .trim()
    .min(1, "Message is required")
    .max(500, "Message is too long"),
});

export type SendAdminReminderInput = z.infer<typeof sendAdminReminderSchema>;
