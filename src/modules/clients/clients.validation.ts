import { z } from "zod";

const optionalSecondaryName = z
  .string()
  .max(200)
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  });

export const createClientSchema = z.object({
  name: z.string().min(2, "Primary name must be at least 2 characters").max(200),
  secondaryName: optionalSecondaryName,
  isActive: z.boolean().optional().default(true),
});

export const updateClientSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  secondaryName: z.union([z.string().max(200), z.null()]).optional(),
  isActive: z.boolean().optional(),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
