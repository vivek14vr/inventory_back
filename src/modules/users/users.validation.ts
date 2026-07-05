import { z } from "zod";
import { ALL_PERMISSION_CODES } from "../../shared/constants/permissions.js";
import { UserRole } from "../../shared/constants/roles.js";

const roleEnum = z.enum([UserRole.ADMIN, UserRole.WAREHOUSE_USER]);

const permissionGrantSchema = z.object({
  code: z.enum(ALL_PERMISSION_CODES as [string, ...string[]]),
  warehouseId: z.string().optional(),
});

export const createUserSchema = z
  .object({
    name: z.string().min(2, "Name must be at least 2 characters").max(100),
    email: z.string().email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    role: roleEnum,
    warehouseId: z.string().optional(),
    permissions: z.array(permissionGrantSchema).optional().default([]),
    isActive: z.boolean().optional().default(true),
  })
  .superRefine((data, ctx) => {
    if (data.role === UserRole.ADMIN) {
      if (data.warehouseId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Admin users cannot be assigned to a warehouse",
          path: ["warehouseId"],
        });
      }
      if (data.permissions.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Admin users have full access; do not assign permissions",
          path: ["permissions"],
        });
      }
    }
    if (data.role === UserRole.WAREHOUSE_USER && data.permissions.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Assign at least one module permission",
        path: ["permissions"],
      });
    }
  });

export const updateUserSchema = z
  .object({
    name: z.string().min(2).max(100).optional(),
    email: z.string().email().optional(),
    password: z.string().min(8).optional(),
    role: roleEnum.optional(),
    warehouseId: z.string().nullable().optional(),
    permissions: z.array(permissionGrantSchema).optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role === UserRole.ADMIN && data.permissions && data.permissions.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Admin users have full access; do not assign permissions",
        path: ["permissions"],
      });
    }
  });

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
