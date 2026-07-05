import { z } from "zod";

export const productImportConfirmRowSchema = z.object({
  rowNumber: z.number().int().min(1),
  brandName: z.string().min(1).max(200),
  primaryName: z.string().min(2).max(200),
  secondaryName: z.string().max(200).optional(),
  baseUnit: z.string().min(1).max(50),
  unitsPerStockUnit: z.coerce.number().int().min(1),
  lowStockThreshold: z.coerce.number().int().min(0).optional(),
  action: z.enum(["merge", "create"]),
  mergeTargetProductId: z.string().optional(),
  brandAction: z.enum(["merge", "create"]),
  mergeTargetBrandId: z.string().optional(),
});

export const productImportConfirmSchema = z.object({
  fileName: z.string().max(255).optional(),
  warehouseId: z.string().min(1, "Warehouse is required"),
  rows: z.array(productImportConfirmRowSchema).min(1),
});

export type ProductImportConfirmInput = z.infer<typeof productImportConfirmSchema>;
export type ProductImportConfirmRow = z.infer<typeof productImportConfirmRowSchema>;
