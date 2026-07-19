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
  /**
   * Current billed/sold quantity for invoice edit UI and returns.
   * The historical `quantity` on DIRECT_SELLING rows is never rewritten when
   * an invoice qty is corrected — a separate correction movement is appended.
   */
  invoiceSoldQuantity?: number;
  /**
   * On-hand quantity at this warehouse+product immediately after this movement.
   * Immutable once written — movements are append-only logs.
   */
  balanceAfter?: number;
  dispatchType?: DispatchTypeValue;
  clientName?: string;
  invoiceNumber?: string;
  transferId?: Types.ObjectId;
  relatedSaleMovementId?: Types.ObjectId;
  destinationWarehouseId?: Types.ObjectId;
  notes?: string;
  invoiceModificationCount?: number;
  /** Atomically tracked client returns against this sale line. */
  clientReturnedQuantity?: number;
  createdBy: Types.ObjectId;
  createdAt: Date;
}

const stockMovementSchema = new Schema<IStockMovement>(
  {
    type: { type: String, required: true, enum: ["STOCK_IN", "STOCK_OUT"] },
    warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse", required: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    brandId: { type: Schema.Types.ObjectId, ref: "Brand", required: true },
    quantity: { type: Number, required: true, min: 0 },
    invoiceSoldQuantity: { type: Number, min: 0 },
    balanceAfter: { type: Number, min: 0 },
    dispatchType: { type: String, enum: ["TRANSFER", "DIRECT_SELLING"] },
    clientName: { type: String, trim: true },
    invoiceNumber: { type: String, trim: true },
    invoiceModificationCount: { type: Number, default: 0, min: 0 },
    clientReturnedQuantity: { type: Number, default: 0, min: 0 },
    transferId: { type: Schema.Types.ObjectId, ref: "Transfer" },
    relatedSaleMovementId: { type: Schema.Types.ObjectId, ref: "StockMovement" },
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
