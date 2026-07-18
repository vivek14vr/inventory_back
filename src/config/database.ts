import mongoose from "mongoose";
import { env } from "./env.js";

async function backfillProductNameNormalized(): Promise<void> {
  const { Product } = await import("../models/Product.js");
  const missing = await Product.find({
    $or: [{ nameNormalized: { $exists: false } }, { nameNormalized: "" }],
  }).select("name");

  if (missing.length === 0) return;

  const ops = missing.map((doc) => ({
    updateOne: {
      filter: { _id: doc._id },
      update: { $set: { nameNormalized: doc.name.trim().toLowerCase() } },
    },
  }));

  await Product.bulkWrite(ops);
  console.log(`Backfilled nameNormalized on ${missing.length} product(s)`);
}

async function removeInvalidInvoiceMovementIndex(): Promise<void> {
  const { StockMovement } = await import("../models/StockMovement.js");
  try {
    await StockMovement.collection.dropIndex(
      "uniq_direct_sell_invoice_client"
    );
    console.log("Removed invalid movement-level invoice uniqueness index");
  } catch (err: unknown) {
    const mongoError = err as { code?: number; codeName?: string };
    // 26 = collection missing (fresh/empty Atlas DB); 27 = index missing
    if (
      mongoError.code !== 26 &&
      mongoError.code !== 27 &&
      mongoError.codeName !== "NamespaceNotFound" &&
      mongoError.codeName !== "IndexNotFound"
    ) {
      throw err;
    }
  }
}

/**
 * Undo mistaken sell-date backfill: restore createdAt from ObjectId insert time
 * so movements match audit STOCK_OUT timestamps again.
 */
async function restoreSalesImportCreatedAtFromObjectId(): Promise<void> {
  const { StockMovement } = await import("../models/StockMovement.js");

  const candidates = await StockMovement.find({
    notes: { $regex: /^Sales import/i },
    dispatchType: "DIRECT_SELLING",
  })
    .select("createdAt")
    .lean();

  const ops: Array<{
    updateOne: {
      filter: { _id: (typeof candidates)[number]["_id"] };
      update: { $set: { createdAt: Date } };
    };
  }> = [];

  for (const doc of candidates) {
    const insertTime = doc._id.getTimestamp();
    const current =
      doc.createdAt instanceof Date ? doc.createdAt : new Date(doc.createdAt);
    if (Math.abs(current.getTime() - insertTime.getTime()) < 2000) continue;
    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { createdAt: insertTime } },
      },
    });
  }

  if (ops.length === 0) return;
  const result = await StockMovement.collection.bulkWrite(ops);
  console.log(
    `Restored createdAt from ObjectId on ${result.modifiedCount} sales-import movement(s)`
  );
}

async function updateNotificationIndexes(): Promise<void> {
  const { Notification } = await import("../models/Notification.js");
  try {
    // Old unique index blocked admin-sent reminders (null checklist/task ids).
    await Notification.collection.dropIndex(
      "userId_1_checklistId_1_taskId_1_date_1_reminderKey_1"
    );
    console.log("Dropped legacy notification uniqueness index");
  } catch (err: unknown) {
    const mongoError = err as { code?: number; codeName?: string };
    if (
      mongoError.code !== 26 &&
      mongoError.code !== 27 &&
      mongoError.codeName !== "NamespaceNotFound" &&
      mongoError.codeName !== "IndexNotFound"
    ) {
      throw err;
    }
  }
  await Notification.syncIndexes();
}

export async function connectDatabase(): Promise<void> {
  mongoose.set("strictQuery", true);

  await mongoose.connect(env.MONGODB_URI);
  console.log("MongoDB connected");
  await removeInvalidInvoiceMovementIndex();
  await updateNotificationIndexes();
  await backfillProductNameNormalized();
  await restoreSalesImportCreatedAtFromObjectId();
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  console.log("MongoDB disconnected");
}
