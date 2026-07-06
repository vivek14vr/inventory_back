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

export const clientImportConfirmRowSchema = z
  .object({
    rowNumber: z.number().int().min(1),
    primaryName: z.string().min(1).max(200),
    secondaryName: z.string().max(200).optional(),
    action: z.enum(["merge", "create"]),
    mergeTargetClientId: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.action === "merge" && !data.mergeTargetClientId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select a client to merge into",
        path: ["mergeTargetClientId"],
      });
    }
  });

export const clientImportConfirmSchema = z.object({
  fileName: z.string().max(255).optional(),
  rows: z.array(clientImportConfirmRowSchema).min(1),
});

export type ClientImportConfirmInput = z.infer<typeof clientImportConfirmSchema>;
export type ClientImportConfirmRow = z.infer<typeof clientImportConfirmRowSchema>;

export const salesImportConfirmLineSchema = z
  .object({
    rowNumber: z.number().int().min(1),
    productName: z.string().min(1).max(200),
    brandName: z.string().min(1).max(200),
    quantity: z.coerce.number().int().min(1),
    brandAction: z.enum(["merge", "create"]),
    mergeTargetBrandId: z.string().optional(),
    action: z.enum(["merge", "create"]),
    mergeTargetProductId: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.brandAction === "merge" && !data.mergeTargetBrandId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select a brand to merge into",
        path: ["mergeTargetBrandId"],
      });
    }
    if (data.action === "merge" && !data.mergeTargetProductId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select a product to merge into",
        path: ["mergeTargetProductId"],
      });
    }
  });

export const salesImportConfirmVoucherSchema = z
  .object({
    voucherIndex: z.number().int().min(1),
    headerRowNumber: z.number().int().min(1),
    sellDate: z.string().max(50).optional(),
    clientName: z.string().min(1).max(200),
    clientSecondaryName: z.string().max(200).optional(),
    invoiceNumber: z.string().min(1).max(100),
    clientAction: z.enum(["merge", "create"]),
    mergeTargetClientId: z.string().optional(),
    lines: z.array(salesImportConfirmLineSchema).min(1),
  })
  .superRefine((data, ctx) => {
    if (data.clientAction === "merge" && !data.mergeTargetClientId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select a client to merge into",
        path: ["mergeTargetClientId"],
      });
    }
  });

export const salesImportConfirmSchema = z.object({
  fileName: z.string().max(255).optional(),
  warehouseId: z.string().min(1),
  vouchers: z.array(salesImportConfirmVoucherSchema).min(1),
});

export type SalesImportConfirmInput = z.infer<typeof salesImportConfirmSchema>;
export type SalesImportConfirmVoucher = z.infer<typeof salesImportConfirmVoucherSchema>;
export type SalesImportConfirmLine = z.infer<typeof salesImportConfirmLineSchema>;
