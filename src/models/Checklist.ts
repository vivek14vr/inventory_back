import mongoose, { Schema, type Document, type Model, type Types } from "mongoose";

export type ChecklistFrequency = "daily" | "weekly" | "monthly";

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
  /** How often this checklist is due. Missing/legacy docs behave as daily. */
  frequency: ChecklistFrequency;
  /** Weekly: JS getDay() values — 0=Sun … 6=Sat */
  weekdays?: number[];
  /** Monthly: 1–31 (short months clamp to last day) */
  dayOfMonth?: number;
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
    frequency: {
      type: String,
      enum: ["daily", "weekly", "monthly"],
      default: "daily",
    },
    weekdays: [{ type: Number, min: 0, max: 6 }],
    dayOfMonth: { type: Number, min: 1, max: 31 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Checklist: Model<IChecklist> =
  mongoose.models.Checklist ?? mongoose.model<IChecklist>("Checklist", checklistSchema);
