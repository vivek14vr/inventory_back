import mongoose, { Schema, type Document, type Model, Types } from "mongoose";
import type { TransferStatusValue } from "../shared/constants/roles.js";

export interface ITransfer extends Document {
  sourceWarehouseId: Types.ObjectId;
  destinationWarehouseId: Types.ObjectId;
  productId: Types.ObjectId;
  brandId: Types.ObjectId;
  quantity: number;
  status: TransferStatusValue;
  stockOutMovementId: Types.ObjectId;
  stockInMovementId?: Types.ObjectId;
  createdBy: Types.ObjectId;
  receivedBy?: Types.ObjectId;
  receivedAt?: Date;
  returnedBy?: Types.ObjectId;
  returnedAt?: Date;
  stockReturnOutMovementId?: Types.ObjectId;
  stockReturnInMovementId?: Types.ObjectId;
  returnNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const transferSchema = new Schema<ITransfer>(
  {
    sourceWarehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse", required: true },
    destinationWarehouseId: {
      type: Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true,
    },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    brandId: { type: Schema.Types.ObjectId, ref: "Brand", required: true },
    quantity: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ["PENDING", "RECEIVED", "CANCELLED", "RETURNED"],
      default: "PENDING",
    },
    stockOutMovementId: { type: Schema.Types.ObjectId, ref: "StockMovement", required: true },
    stockInMovementId: { type: Schema.Types.ObjectId, ref: "StockMovement" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    receivedBy: { type: Schema.Types.ObjectId, ref: "User" },
    receivedAt: { type: Date },
    returnedBy: { type: Schema.Types.ObjectId, ref: "User" },
    returnedAt: { type: Date },
    stockReturnOutMovementId: { type: Schema.Types.ObjectId, ref: "StockMovement" },
    stockReturnInMovementId: { type: Schema.Types.ObjectId, ref: "StockMovement" },
    returnNotes: { type: String, trim: true },
  },
  { timestamps: true }
);

transferSchema.index({ destinationWarehouseId: 1, status: 1 });

export const Transfer: Model<ITransfer> =
  mongoose.models.Transfer ?? mongoose.model<ITransfer>("Transfer", transferSchema);
