import mongoose, { Schema, type Document, type Model, type Types } from "mongoose";

export interface IChecklistCompletion extends Document {
  checklistId: Types.ObjectId;
  taskId: Types.ObjectId;
  userId: Types.ObjectId;
  /** Calendar date in YYYY-MM-DD (local business day) */
  date: string;
  completedAt: Date;
}

const checklistCompletionSchema = new Schema<IChecklistCompletion>(
  {
    checklistId: { type: Schema.Types.ObjectId, ref: "Checklist", required: true },
    taskId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    date: { type: String, required: true, trim: true },
    completedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

checklistCompletionSchema.index(
  { checklistId: 1, taskId: 1, userId: 1, date: 1 },
  { unique: true }
);
checklistCompletionSchema.index({ userId: 1, date: 1 });

export const ChecklistCompletion: Model<IChecklistCompletion> =
  mongoose.models.ChecklistCompletion ??
  mongoose.model<IChecklistCompletion>("ChecklistCompletion", checklistCompletionSchema);
