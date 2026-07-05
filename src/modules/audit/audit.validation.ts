import { z } from "zod";
import { paginationQuerySchema } from "../../shared/pagination/pagination.validation.js";

export const auditLogQuerySchema = paginationQuerySchema.extend({
  action: z.string().optional(),
  entity: z.string().optional(),
  userId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  sortBy: z.enum(["createdAt", "action", "entity"]).optional().default("createdAt"),
});

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
