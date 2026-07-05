import { z } from "zod";
import { TransferStatus } from "../../shared/constants/roles.js";

export const reportFilterSchema = z.object({
  warehouseId: z.string().optional(),
  brandId: z.string().optional(),
  productId: z.string().optional(),
  clientName: z.string().optional(),
  invoiceNumber: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional().default(1000),
});

export const stockReportSchema = reportFilterSchema.extend({
  groupBy: z.enum(["detail", "warehouse", "brand", "product"]).optional().default("detail"),
});

export const movementReportSchema = reportFilterSchema.extend({
  type: z.enum(["STOCK_IN", "STOCK_OUT"]).optional(),
});

export const transferReportSchema = reportFilterSchema.extend({
  status: z
    .enum([
      TransferStatus.PENDING,
      TransferStatus.RECEIVED,
      TransferStatus.CANCELLED,
    ])
    .optional(),
});

export type ReportFilter = z.infer<typeof reportFilterSchema>;
export type StockReportQuery = z.infer<typeof stockReportSchema>;
export type MovementReportQuery = z.infer<typeof movementReportSchema>;
export type TransferReportQuery = z.infer<typeof transferReportSchema>;
