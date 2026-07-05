import { z } from "zod";
import { paginationQuerySchema } from "../../shared/pagination/pagination.validation.js";

export const listProductsQuerySchema = paginationQuerySchema.extend({
  includeInactive: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  brandId: z.string().optional(),
  sortBy: z.enum(["name", "brand", "createdAt", "lowStockThreshold"]).optional().default("name"),
});

export const createProductSchema = z.object({
  name: z.string().min(2, "Product name must be at least 2 characters").max(200),
  secondaryName: z.string().max(200).optional(),
  brandId: z.string().min(1, "Brand is required"),
  baseUnit: z.string().min(1).max(50).optional().default("piece"),
  stockUnit: z.string().min(1).max(50).optional().default("unit"),
  unitsPerStockUnit: z.coerce
    .number()
    .int()
    .min(1, "Base units per pack must be at least 1")
    .optional()
    .default(1),
  lowStockThreshold: z.coerce.number().int().min(0).optional(),
  isActive: z.boolean().optional().default(true),
});

export const updateProductSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  secondaryName: z.string().max(200).nullable().optional(),
  brandId: z.string().optional(),
  baseUnit: z.string().min(1).max(50).optional(),
  stockUnit: z.string().min(1).max(50).optional(),
  unitsPerStockUnit: z.coerce.number().int().min(1).optional(),
  lowStockThreshold: z.coerce.number().int().min(0).nullable().optional(),
  isActive: z.boolean().optional(),
});

export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
