import { z } from "zod";
import { paginationQuerySchema } from "../../shared/pagination/pagination.validation.js";

export const stockFiltersSchema = z.object({
  warehouseId: z.string().optional(),
  brandId: z.string().optional(),
  productId: z.string().optional(),
  includeZero: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

export const stockQuerySchema = paginationQuerySchema.extend({
  warehouseId: z.string().optional(),
  brandId: z.string().optional(),
  productId: z.string().optional(),
  includeZero: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  sortBy: z
    .enum(["quantity", "productName", "brandName", "warehouseName", "updatedAt"])
    .optional()
    .default("updatedAt"),
});

export const movementsQuerySchema = paginationQuerySchema.extend({
  warehouseId: z.string().optional(),
  brandId: z.string().optional(),
  productId: z.string().optional(),
  type: z.enum(["STOCK_IN", "STOCK_OUT"]).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  sortBy: z.enum(["createdAt", "quantity", "type"]).optional().default("createdAt"),
});

export const lowStockQuerySchema = paginationQuerySchema.extend({
  warehouseId: z.string().optional(),
  brandId: z.string().optional(),
  sortBy: z
    .enum([
      "quantity",
      "totalQuantity",
      "productName",
      "brandName",
      "warehouseName",
      "lowStockThreshold",
    ])
    .optional()
    .default("quantity"),
});

export const updateLowStockThresholdSchema = z.object({
  warehouseId: z.string().min(1, "Warehouse is required"),
  productId: z.string().min(1, "Product is required"),
  lowStockThreshold: z.coerce.number().int().min(0).nullable(),
});

export type UpdateLowStockThresholdInput = z.infer<typeof updateLowStockThresholdSchema>;

export type StockFilters = z.infer<typeof stockFiltersSchema>;
export type StockQuery = z.infer<typeof stockQuerySchema>;
export type MovementsQuery = z.infer<typeof movementsQuerySchema>;
export type LowStockQuery = z.infer<typeof lowStockQuerySchema>;

export const adjustStockSchema = z.object({
  warehouseId: z.string().min(1, "Warehouse is required"),
  productId: z.string().min(1, "Product is required"),
  brandId: z.string().min(1, "Brand is required"),
  quantity: z.coerce.number().int().min(0, "Quantity must be 0 or greater"),
  reason: z
    .string()
    .trim()
    .max(500)
    .optional()
    .refine((value) => !value || value.length >= 3, {
      message: "Reason must be at least 3 characters when provided",
    }),
});

export type AdjustStockInput = z.infer<typeof adjustStockSchema>;

export const stockItemDetailQuerySchema = paginationQuerySchema.extend({
  warehouseId: z.string().min(1, "Warehouse is required"),
  productId: z.string().min(1, "Product is required"),
  type: z.enum(["STOCK_IN", "STOCK_OUT"]).optional(),
  sortBy: z.enum(["createdAt", "quantity", "type"]).optional().default("createdAt"),
});

export type StockItemDetailQuery = z.infer<typeof stockItemDetailQuerySchema>;

export const invoiceListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().optional(),
  sortBy: z
    .enum([
      "createdAt",
      "clientName",
      "invoiceNumber",
      "quantity",
      "type",
      "invoiceLastWorkedAt",
    ])
    .optional()
    .default("createdAt"),
});

export const invoiceLookupQuerySchema = invoiceListQuerySchema.refine(
  (data) => Boolean(data.search?.trim()),
  { message: "Enter an invoice number, client, or product to search" }
);

export const updateMovementInvoiceSchema = z.object({
  invoiceNumber: z.string().max(100).optional(),
  clientName: z.string().max(200).optional(),
  quantity: z.coerce.number().int().min(1).optional(),
  markLastWorked: z.boolean().optional(),
});

export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;
export type InvoiceLookupQuery = z.infer<typeof invoiceLookupQuerySchema>;
export type UpdateMovementInvoiceInput = z.infer<typeof updateMovementInvoiceSchema>;
