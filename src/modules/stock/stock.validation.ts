import { z } from "zod";
import { DispatchType } from "../../shared/constants/roles.js";
import { paginationQuerySchema } from "../../shared/pagination/pagination.validation.js";

export const balancesQuerySchema = paginationQuerySchema.extend({
  warehouseId: z.string().optional(),
  brandId: z.string().optional(),
  productId: z.string().optional(),
  sortBy: z
    .enum(["quantity", "productName", "brandName", "updatedAt"])
    .optional()
    .default("productName"),
});

export type BalancesQuery = z.infer<typeof balancesQuerySchema>;

export const productAvailabilityQuerySchema = z.object({
  warehouseId: z.string().min(1, "warehouseId is required"),
  brandId: z.string().min(1, "brandId is required"),
});

export type ProductAvailabilityQuery = z.infer<typeof productAvailabilityQuerySchema>;

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

export const stockOutBatchSchema = z
  .object({
    warehouseId: z.string().optional(),
    clientName: z.string().min(1, "Client name is required").max(200),
    invoiceNumber: z.string().max(100).optional(),
    notes: z.string().max(500).optional(),
    /** When true, records stock out even if warehouse balance is insufficient (historical import). */
    allowInsufficientStock: z.boolean().optional(),
    items: z
      .array(
        z.object({
          brandId: z.string().min(1, "Brand is required"),
          productId: z.string().min(1, "Product is required"),
          quantity: z.coerce.number().int().min(1, "Quantity must be at least 1"),
        })
      )
      .min(1, "Add at least one product"),
  })
  .superRefine((data, ctx) => {
    const seen = new Set<string>();
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      if (seen.has(item.productId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Each product can only appear once per sale",
          path: ["items", i, "productId"],
        });
      }
      seen.add(item.productId);
    }
  });

export type StockInInput = z.infer<typeof stockInSchema>;
export type StockOutInput = z.infer<typeof stockOutSchema>;
export type StockOutBatchInput = z.infer<typeof stockOutBatchSchema>;
