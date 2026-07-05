import { z } from "zod";

export const productSuggestionsQuerySchema = z.object({
  search: z.string().trim().min(1, "Enter a search term"),
  limit: z.coerce.number().int().min(1).max(20).optional().default(8),
  brandId: z.string().optional(),
  warehouseId: z.string().optional(),
  includeInactive: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

export const invoiceSuggestionsQuerySchema = z.object({
  search: z.string().trim().min(1, "Enter a search term"),
  limit: z.coerce.number().int().min(1).max(20).optional().default(8),
});

export type ProductSuggestionsQuery = z.infer<typeof productSuggestionsQuerySchema>;
export type InvoiceSuggestionsQuery = z.infer<typeof invoiceSuggestionsQuerySchema>;
