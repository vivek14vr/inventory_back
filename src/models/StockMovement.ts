import mongoose, { Schema, type Document, type Model, Types } from "mongoose";
import type {
  DispatchTypeValue,
  StockMovementTypeValue,
} from "../shared/constants/roles.js";

export interface IStockMovement extends Document {
  type: StockMovementTypeValue;
  warehouseId: Types.ObjectId;
  productId: Types.ObjectId;
  brandId: Types.ObjectId;
  quantity: number;
  dispatchType?: DispatchTypeValue;
  clientName?: string;
  invoiceNumber?: string;
  transferId?: Types.ObjectId;
  destinationWarehouseId?: Types.ObjectId;
  notes?: string;
  invoiceLastWorkedAt?: Date;
  createdBy: Types.ObjectId;
  createdAt: Date;
}

const stockMovementSchema = new Schema<IStockMovement>(
  {
    type: { type: String, required: true, enum: ["STOCK_IN", "STOCK_OUT"] },
    warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse", required: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    brandId: { type: Schema.Types.ObjectId, ref: "Brand", required: true },
    quantity: { type: Number, required: true, min: 1 },
    dispatchType: { type: String, enum: ["TRANSFER", "DIRECT_SELLING"] },
    clientName: { type: String, trim: true },
    invoiceNumber: { type: String, trim: true },
    invoiceLastWorkedAt: { type: Date },
    transferId: { type: Schema.Types.ObjectId, ref: "Transfer" },
    destinationWarehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse" },
    notes: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

stockMovementSchema.index({ warehouseId: 1, createdAt: -1 });
stockMovementSchema.index({ productId: 1, createdAt: -1 });

export const StockMovement: Model<IStockMovement> =
  mongoose.models.StockMovement ??
  mongoose.model<IStockMovement>("StockMovement", stockMovementSchema);
