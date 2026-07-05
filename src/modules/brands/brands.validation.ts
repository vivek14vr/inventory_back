import { z } from "zod";

export const createBrandSchema = z.object({
  name: z.string().min(2, "Brand name must be at least 2 characters").max(100),
  isActive: z.boolean().optional().default(true),
});

export const updateBrandSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  isActive: z.boolean().optional(),
});

export type CreateBrandInput = z.infer<typeof createBrandSchema>;
export type UpdateBrandInput = z.infer<typeof updateBrandSchema>;
