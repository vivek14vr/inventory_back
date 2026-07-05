import mongoose, { Schema, type Document, type Model, Types } from "mongoose";

export interface ITallyImportRow {
  productName: string;
  brandName: string;
  quantity: number;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  message?: string;
}

export interface ITallyImport extends Document {
  fileName: string;
  warehouseId: Types.ObjectId;
  importedBy: Types.ObjectId;
  totalRows: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  rows: ITallyImportRow[];
  createdAt: Date;
}

const tallyImportRowSchema = new Schema<ITallyImportRow>(
  {
    productName: { type: String, required: true },
    brandName: { type: String, required: true },
    quantity: { type: Number, required: true },
    status: { type: String, enum: ["SUCCESS", "FAILED", "SKIPPED"], required: true },
    message: { type: String },
  },
  { _id: false }
);

const tallyImportSchema = new Schema<ITallyImport>(
  {
    fileName: { type: String, required: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse", required: true },
    importedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    totalRows: { type: Number, required: true },
    successCount: { type: Number, required: true },
    failedCount: { type: Number, required: true },
    skippedCount: { type: Number, default: 0 },
    rows: [tallyImportRowSchema],
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const TallyImport: Model<ITallyImport> =
  mongoose.models.TallyImport ??
  mongoose.model<ITallyImport>("TallyImport", tallyImportSchema);
