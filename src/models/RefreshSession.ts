import mongoose, { Schema, type Document, type Model, Types } from "mongoose";

export interface IRefreshSession extends Document {
  userId: Types.ObjectId;
  familyId: Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  revokedAt?: Date;
  replacedBy?: Types.ObjectId;
  userAgent?: string;
  ipAddress?: string;
  createdAt: Date;
  updatedAt: Date;
}

const refreshSessionSchema = new Schema<IRefreshSession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    familyId: { type: Schema.Types.ObjectId, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: true },
    revokedAt: { type: Date },
    replacedBy: { type: Schema.Types.ObjectId, ref: "RefreshSession" },
    userAgent: { type: String, maxlength: 512 },
    ipAddress: { type: String, maxlength: 64 },
  },
  { timestamps: true }
);

refreshSessionSchema.index({ userId: 1, revokedAt: 1 });

export const RefreshSession: Model<IRefreshSession> =
  mongoose.models.RefreshSession ??
  mongoose.model<IRefreshSession>("RefreshSession", refreshSessionSchema);
