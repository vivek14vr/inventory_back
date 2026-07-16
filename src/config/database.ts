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
    if (mongoError.code !== 27 && mongoError.codeName !== "IndexNotFound") {
      throw err;
    }
  }
}

export async function connectDatabase(): Promise<void> {
  mongoose.set("strictQuery", true);

  await mongoose.connect(env.MONGODB_URI);
  console.log("MongoDB connected");
  await removeInvalidInvoiceMovementIndex();
  await backfillProductNameNormalized();
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  console.log("MongoDB disconnected");
}
