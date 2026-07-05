import mongoose, { Schema, type Document, type Model, Types } from "mongoose";

export interface IProduct extends Document {
  name: string;
  /** Case-insensitive duplicate check key for primary name within a brand. */
  nameNormalized: string;
  secondaryName?: string;
  brandId: Types.ObjectId;
  /** Smallest inventory unit label, e.g. piece, kg. */
  baseUnit: string;
  /** Label for the stocking/pack unit, e.g. Carton, Box. */
  stockUnit: string;
  /** How many base units are in one stock unit. */
  unitsPerStockUnit: number;
  /** Default low-stock alert per warehouse when no warehouse-specific threshold is set. */
  lowStockThreshold?: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<IProduct>(
  {
    name: { type: String, required: true, trim: true },
    nameNormalized: { type: String, trim: true, lowercase: true },
    secondaryName: { type: String, trim: true },
    brandId: { type: Schema.Types.ObjectId, ref: "Brand", required: true },
    baseUnit: { type: String, trim: true, default: "piece" },
    stockUnit: { type: String, trim: true, default: "unit" },
    unitsPerStockUnit: { type: Number, min: 1, default: 1 },
    lowStockThreshold: { type: Number, min: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

productSchema.index({ brandId: 1, nameNormalized: 1 }, { unique: true });

productSchema.pre("validate", function () {
  if (this.name) {
    this.nameNormalized = this.name.trim().toLowerCase();
  }
});

export const Product: Model<IProduct> =
  mongoose.models.Product ?? mongoose.model<IProduct>("Product", productSchema);
