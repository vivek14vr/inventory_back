import mongoose, { Schema, type Document, type Model, Types } from "mongoose";

export type ImportLogKind = "products" | "sales" | "clients";

export interface IImportLog extends Document {
  kind: ImportLogKind;
  fileName: string;
  importedBy: Types.ObjectId;
  totalRows: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  createdProductCount: number;
  createdBrandCount: number;
  createdClientCount: number;
  result: Record<string, unknown>;
  reportFile?: Buffer;
  reportFileName?: string;
  reportMimeType?: string;
  createdAt: Date;
}

const importLogSchema = new Schema<IImportLog>(
  {
    kind: {
      type: String,
      enum: ["products", "sales", "clients"],
      required: true,
      index: true,
    },
    fileName: { type: String, required: true },
    importedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    totalRows: { type: Number, required: true, min: 0 },
    successCount: { type: Number, required: true, min: 0 },
    failedCount: { type: Number, required: true, min: 0 },
    skippedCount: { type: Number, default: 0, min: 0 },
    createdProductCount: { type: Number, default: 0, min: 0 },
    createdBrandCount: { type: Number, default: 0, min: 0 },
    createdClientCount: { type: Number, default: 0, min: 0 },
    result: { type: Schema.Types.Mixed, required: true },
    reportFile: { type: Buffer },
    reportFileName: { type: String, trim: true },
    reportMimeType: { type: String, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

importLogSchema.index({ createdAt: -1 });

export const ImportLog: Model<IImportLog> =
  mongoose.models.ImportLog ?? mongoose.model<IImportLog>("ImportLog", importLogSchema);
