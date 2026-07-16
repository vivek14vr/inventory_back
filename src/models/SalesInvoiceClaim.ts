import mongoose, { Schema, type Document, type Model, Types } from "mongoose";

export type SalesInvoiceClaimStatus = "PROCESSING" | "COMPLETED" | "FAILED";

export interface ISalesInvoiceClaim extends Document {
  warehouseId: Types.ObjectId;
  invoiceNumber: string;
  invoiceNormalized: string;
  clientName: string;
  clientNormalized: string;
  status: SalesInvoiceClaimStatus;
  claimToken: string;
  movementIds: Types.ObjectId[];
  failureMessage?: string;
  processingExpiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const salesInvoiceClaimSchema = new Schema<ISalesInvoiceClaim>(
  {
    warehouseId: {
      type: Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true,
    },
    invoiceNumber: { type: String, required: true, trim: true },
    invoiceNormalized: { type: String, required: true },
    clientName: { type: String, required: true, trim: true },
    clientNormalized: { type: String, required: true },
    status: {
      type: String,
      required: true,
      enum: ["PROCESSING", "COMPLETED", "FAILED"],
    },
    claimToken: { type: String, required: true },
    movementIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "StockMovement" }],
      default: [],
    },
    failureMessage: { type: String },
    processingExpiresAt: { type: Date },
  },
  { timestamps: true }
);

salesInvoiceClaimSchema.index(
  { warehouseId: 1, invoiceNormalized: 1, clientNormalized: 1 },
  { unique: true, name: "uniq_sales_invoice_claim" }
);

export const SalesInvoiceClaim: Model<ISalesInvoiceClaim> =
  mongoose.models.SalesInvoiceClaim ??
  mongoose.model<ISalesInvoiceClaim>(
    "SalesInvoiceClaim",
    salesInvoiceClaimSchema
  );
