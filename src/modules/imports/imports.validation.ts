import { z } from "zod";

export const productImportConfirmRowSchema = z.object({
  rowNumber: z.number().int().min(1),
  brandName: z.string().min(1).max(200),
  primaryName: z.string().min(2).max(200),
  secondaryName: z.string().max(200).optional(),
  baseUnit: z.string().min(1).max(50),
  unitsPerStockUnit: z.coerce.number().int().min(1),
  lowStockThreshold: z.coerce.number().int().min(0).optional(),
  totalLowStockThreshold: z.coerce.number().int().min(0).optional(),
  warehouseLowStockThresholds: z
    .array(
      z.object({
        warehouseId: z.string().min(1),
        warehouseName: z.string().min(1).max(200),
        lowStockThreshold: z.coerce.number().int().min(0),
      })
    )
    .optional(),
  action: z.enum(["merge", "create"]),
  mergeTargetProductId: z.string().optional(),
  brandAction: z.enum(["merge", "create"]),
  mergeTargetBrandId: z.string().optional(),
});

export const productImportConfirmSchema = z.object({
  fileName: z.string().max(255).optional(),
  rows: z.array(productImportConfirmRowSchema).min(1),
});

export type ProductImportConfirmInput = z.infer<typeof productImportConfirmSchema>;
export type ProductImportConfirmRow = z.infer<typeof productImportConfirmRowSchema>;

export const salesImportConfirmLineSchema = z
  .object({
    rowNumber: z.number().int().min(1),
    productName: z.string().min(1).max(200),
    quantity: z.coerce.number().int().min(1),
    action: z.enum(["merge", "create"]),
    mergeTargetProductId: z.string().optional(),
    createBrandId: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.action === "merge") {
      if (!data.mergeTargetProductId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Select a product to merge into",
          path: ["mergeTargetProductId"],
        });
      }
    } else if (!data.createBrandId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select a brand for the new product",
        path: ["createBrandId"],
      });
    }
  });

export const salesImportConfirmVoucherSchema = z.object({
  voucherIndex: z.number().int().min(1),
  headerRowNumber: z.number().int().min(1),
  sellDate: z.string().max(50).optional(),
  clientName: z.string().min(1).max(200),
  invoiceNumber: z.string().min(1).max(100),
  lines: z.array(salesImportConfirmLineSchema).min(1),
});

export const salesImportConfirmSchema = z.object({
  fileName: z.string().max(255).optional(),
  warehouseId: z.string().min(1),
  vouchers: z.array(salesImportConfirmVoucherSchema).min(1),
});

export type SalesImportConfirmInput = z.infer<typeof salesImportConfirmSchema>;
export type SalesImportConfirmVoucher = z.infer<typeof salesImportConfirmVoucherSchema>;
export type SalesImportConfirmLine = z.infer<typeof salesImportConfirmLineSchema>;
