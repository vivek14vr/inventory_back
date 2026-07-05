import mongoose, { Schema, type Document, type Model, type Types } from "mongoose";

export interface IChecklistTask {
  _id: Types.ObjectId;
  title: string;
  sortOrder: number;
  dueTime?: string;
}

export interface IChecklist extends Document {
  title: string;
  description?: string;
  assignedUserIds: Types.ObjectId[];
  tasks: IChecklistTask[];
  createdBy: Types.ObjectId;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const checklistTaskSchema = new Schema<IChecklistTask>(
  {
    title: { type: String, required: true, trim: true },
    sortOrder: { type: Number, default: 0 },
    dueTime: { type: String, trim: true },
  },
  { _id: true }
);

const checklistSchema = new Schema<IChecklist>(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    assignedUserIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
    tasks: [checklistTaskSchema],
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Checklist: Model<IChecklist> =
  mongoose.models.Checklist ?? mongoose.model<IChecklist>("Checklist", checklistSchema);
