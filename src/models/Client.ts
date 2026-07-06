import mongoose, { Schema, type Document, type Model } from "mongoose";

export interface IClient extends Document {
  name: string;
  secondaryName?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const clientSchema = new Schema<IClient>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    secondaryName: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Client: Model<IClient> =
  mongoose.models.Client ?? mongoose.model<IClient>("Client", clientSchema);
