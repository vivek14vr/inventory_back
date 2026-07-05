import mongoose, { Schema, type Document, type Model, Types } from "mongoose";
import type { PermissionCode } from "../shared/constants/permissions.js";
import type { UserRoleType } from "../shared/constants/roles.js";

export type UserPermissionGrant = {
  code: PermissionCode;
  warehouseId?: Types.ObjectId;
};

export interface IUser extends Document {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRoleType;
  warehouseId?: Types.ObjectId;
  permissions: UserPermissionGrant[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, required: true, enum: ["ADMIN", "WAREHOUSE_USER"] },
    warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse" },
    permissions: {
      type: [
        {
          code: { type: String, required: true },
          warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse" },
        },
      ],
      default: [],
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const User: Model<IUser> =
  mongoose.models.User ?? mongoose.model<IUser>("User", userSchema);
