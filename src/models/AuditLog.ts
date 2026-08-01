import mongoose, { Schema, type Document, type Model, Types } from "mongoose";

export interface IAuditLog extends Document {
  action: string;
  entity: string;
  entityId?: Types.ObjectId;
  userId?: Types.ObjectId;
  source: "APPLICATION" | "API" | "SYSTEM";
  outcome: "SUCCESS" | "FAILURE";
  requestId?: string;
  metadata?: Record<string, unknown>;
  revertedAt?: Date;
  revertStartedAt?: Date;
  revertedBy?: Types.ObjectId;
  revertAuditLogId?: Types.ObjectId;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    action: { type: String, required: true },
    entity: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    source: {
      type: String,
      enum: ["APPLICATION", "API", "SYSTEM"],
      default: "APPLICATION",
    },
    outcome: {
      type: String,
      enum: ["SUCCESS", "FAILURE"],
      default: "SUCCESS",
    },
    requestId: { type: String, trim: true },
    metadata: { type: Schema.Types.Mixed },
    revertedAt: { type: Date },
    revertStartedAt: { type: Date },
    revertedBy: { type: Schema.Types.ObjectId, ref: "User" },
    revertAuditLogId: { type: Schema.Types.ObjectId, ref: "AuditLog" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ entity: 1, entityId: 1 });
auditLogSchema.index({ requestId: 1 }, { sparse: true });

export const AuditLog: Model<IAuditLog> =
  mongoose.models.AuditLog ?? mongoose.model<IAuditLog>("AuditLog", auditLogSchema);
