import { z } from "zod";
import { DispatchType } from "../../shared/constants/roles.js";
import { paginationQuerySchema } from "../../shared/pagination/pagination.validation.js";

export const balancesQuerySchema = paginationQuerySchema.extend({
  warehouseId: z.string().optional(),
  productId: z.string().optional(),
  sortBy: z.enum(["quantity", "productName", "brandName", "updatedAt"]).optional().default("updatedAt"),
});

export type BalancesQuery = z.infer<typeof balancesQuerySchema>;

export const stockInSchema = z.object({
  warehouseId: z.string().optional(),
  brandId: z.string().min(1, "Brand is required"),
  productId: z.string().min(1, "Product is required"),
  quantity: z.coerce.number().int().min(1, "Quantity must be at least 1"),
  transferId: z.string().optional(),
  clientName: z.string().max(200).optional(),
  invoiceNumber: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
});

export const stockOutSchema = z
  .object({
    warehouseId: z.string().optional(),
    brandId: z.string().min(1, "Brand is required"),
    productId: z.string().min(1, "Product is required"),
    quantity: z.coerce.number().int().min(1, "Quantity must be at least 1"),
    dispatchType: z.enum([DispatchType.TRANSFER, DispatchType.DIRECT_SELLING]),
    destinationWarehouseId: z.string().optional(),
    clientName: z.string().max(200).optional(),
    invoiceNumber: z.string().max(100).optional(),
    notes: z.string().max(500).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.dispatchType === DispatchType.TRANSFER && !data.destinationWarehouseId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Destination warehouse is required for transfers",
        path: ["destinationWarehouseId"],
      });
    }
    if (data.dispatchType === DispatchType.DIRECT_SELLING && !data.clientName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Client name is required for direct selling",
        path: ["clientName"],
      });
    }
  });

export type StockInInput = z.infer<typeof stockInSchema>;
export type StockOutInput = z.infer<typeof stockOutSchema>;
