import mongoose, { Schema, type Document, type Model } from "mongoose";

export interface IWarehouse extends Document {
  name: string;
  code: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const warehouseSchema = new Schema<IWarehouse>(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Warehouse: Model<IWarehouse> =
  mongoose.models.Warehouse ?? mongoose.model<IWarehouse>("Warehouse", warehouseSchema);
