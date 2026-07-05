import mongoose, { Types } from "mongoose";
import { InventoryBalance } from "../../models/InventoryBalance.js";
import { Product } from "../../models/Product.js";
import { BadRequestError, NotFoundError } from "../../shared/errors/AppError.js";

export async function getBalance(
  warehouseId: string,
  productId: string,
  session?: mongoose.ClientSession | null
): Promise<number> {
  const balance = await InventoryBalance.findOne({ warehouseId, productId }).session(
    session ?? null
  );
  return balance?.quantity ?? 0;
}

export async function adjustBalance(
  warehouseId: string,
  productId: string,
  delta: number,
  session?: mongoose.ClientSession | null
): Promise<number> {
  if (delta === 0) {
    return getBalance(warehouseId, productId, session);
  }

  // Guarded, atomic decrement: only succeeds when enough stock exists. This
  // prevents two concurrent stock-outs/transfers from both passing a separate
  // read-then-write check and overselling (important on standalone MongoDB
  // where multi-document transactions are unavailable).
  if (delta < 0) {
    const updated = await InventoryBalance.findOneAndUpdate(
      { warehouseId, productId, quantity: { $gte: -delta } },
      { $inc: { quantity: delta } },
      { new: true, ...(session ? { session } : {}) }
    );
    if (!updated) {
      const current = await getBalance(warehouseId, productId, session);
      throw new BadRequestError(
        `Insufficient stock. Available: ${current}, requested: ${Math.abs(delta)}`
      );
    }
    return updated.quantity;
  }

  // Atomic increment; creates the balance row if it does not exist yet.
  const updated = await InventoryBalance.findOneAndUpdate(
    { warehouseId, productId },
    { $inc: { quantity: delta } },
    { new: true, upsert: true, ...(session ? { session } : {}) }
  );
  return updated?.quantity ?? delta;
}

export async function setBalance(
  warehouseId: string,
  productId: string,
  quantity: number,
  session?: mongoose.ClientSession | null
): Promise<{ previous: number; next: number; delta: number }> {
  if (quantity < 0) {
    throw new BadRequestError("Quantity cannot be negative");
  }

  // Atomic absolute set; returns the pre-update document so we can report the
  // previous quantity and delta without a separate racy read.
  const previousDoc = await InventoryBalance.findOneAndUpdate(
    { warehouseId, productId },
    { $set: { quantity } },
    { new: false, upsert: true, ...(session ? { session } : {}) }
  );
  const previous = previousDoc?.quantity ?? 0;
  return { previous, next: quantity, delta: quantity - previous };
}

export async function assertSufficientStock(
  warehouseId: string,
  productId: string,
  quantity: number,
  session?: mongoose.ClientSession | null
): Promise<void> {
  const available = await getBalance(warehouseId, productId, session);
  if (available < quantity) {
    throw new BadRequestError(
      `Insufficient stock. Available: ${available}, requested: ${quantity}`
    );
  }
}

export async function validateProductForBrand(
  productId: string,
  brandId: string,
  session?: mongoose.ClientSession | null
): Promise<{ productId: Types.ObjectId; brandId: Types.ObjectId; name: string }> {
  if (!Types.ObjectId.isValid(productId) || !Types.ObjectId.isValid(brandId)) {
    throw new BadRequestError("Invalid product or brand");
  }

  const product = await Product.findOne({
    _id: productId,
    brandId,
    isActive: true,
  })
    .session(session ?? null)
    .populate<{ brandId: { _id: Types.ObjectId; name: string; isActive: boolean } }>(
      "brandId",
      "name isActive"
    );

  if (!product) {
    throw new NotFoundError("Product not found or does not belong to the selected brand");
  }

  const brand = product.brandId as { _id: Types.ObjectId; name: string; isActive: boolean };
  if (!brand?.isActive) {
    throw new BadRequestError("Selected brand is inactive");
  }

  return {
    productId: product._id,
    brandId: brand._id,
    name: product.name,
  };
}

export async function listBalances(warehouseId: string) {
  const balances = await InventoryBalance.find({ warehouseId, quantity: { $gt: 0 } })
    .populate<{ productId: { _id: Types.ObjectId; name: string; secondaryName?: string; stockUnit?: string; unitsPerStockUnit?: number; isActive?: boolean; brandId: Types.ObjectId } }>({
      path: "productId",
      select: "name secondaryName stockUnit unitsPerStockUnit baseUnit isActive brandId",
      populate: { path: "brandId", select: "name isActive" },
    })
    .sort({ updatedAt: -1 })
    .lean();

  return balances
    .filter((b) => b.productId && typeof b.productId === "object")
    .filter((b) => {
      const product = b.productId as unknown as {
        isActive?: boolean;
        brandId?: { isActive?: boolean };
      };
      return product.isActive !== false && product.brandId?.isActive !== false;
    })
    .map((b) => {
      const product = b.productId as unknown as {
        _id: Types.ObjectId;
        name: string;
        secondaryName?: string;
        stockUnit?: string;
        unitsPerStockUnit?: number;
        baseUnit?: string;
        brandId: { _id: Types.ObjectId; name: string };
      };
      return {
        productId: String(product._id),
        productName: product.name,
        secondaryProductName: product.secondaryName,
        brandId: String(product.brandId._id),
        brandName: product.brandId.name,
        stockUnit: product.stockUnit ?? "unit",
        unitsPerStockUnit: product.unitsPerStockUnit ?? 1,
        baseUnit: product.baseUnit ?? "piece",
        quantity: b.quantity,
        updatedAt: b.updatedAt,
      };
    });
}
