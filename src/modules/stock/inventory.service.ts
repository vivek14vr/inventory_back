import mongoose, { Types } from "mongoose";
import { InventoryBalance } from "../../models/InventoryBalance.js";
import { Product } from "../../models/Product.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../../shared/errors/AppError.js";
import {
  assertNonNegativeIntegerQuantity,
  assertPositiveIntegerQuantity,
} from "../../shared/validation/quantity.js";

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

  if (delta < 0) {
    assertPositiveIntegerQuantity(Math.abs(delta), "Stock change");
  } else {
    assertPositiveIntegerQuantity(delta, "Stock change");
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
    assertNonNegativeIntegerQuantity(updated.quantity, "Stock balance");
    return updated.quantity;
  }

  // Atomic increment; creates the balance row if it does not exist yet.
  const updated = await InventoryBalance.findOneAndUpdate(
    { warehouseId, productId },
    { $inc: { quantity: delta } },
    { new: true, upsert: true, ...(session ? { session } : {}) }
  );
  const next = updated?.quantity ?? delta;
  assertNonNegativeIntegerQuantity(next, "Stock balance");
  return next;
}

/**
 * Absolute set with compare-and-swap on `expectedPrevious`. If concurrent
 * stock-out/$inc changed the row, fails with Conflict so the caller can refresh.
 */
export async function setBalance(
  warehouseId: string,
  productId: string,
  quantity: number,
  session?: mongoose.ClientSession | null,
  expectedPrevious?: number
): Promise<{ previous: number; next: number; delta: number }> {
  assertNonNegativeIntegerQuantity(quantity, "Quantity");

  const previous =
    expectedPrevious ?? (await getBalance(warehouseId, productId, session));

  if (previous === quantity) {
    return { previous, next: quantity, delta: 0 };
  }

  const updated = await InventoryBalance.findOneAndUpdate(
    { warehouseId, productId, quantity: previous },
    { $set: { quantity } },
    { new: true, ...(session ? { session } : {}) }
  );

  if (updated) {
    return { previous, next: quantity, delta: quantity - previous };
  }

  // No row yet and we expected zero — create it.
  if (previous === 0) {
    try {
      await InventoryBalance.create(
        [{ warehouseId, productId, quantity }],
        session ? { session } : undefined
      );
      return { previous: 0, next: quantity, delta: quantity };
    } catch (err: unknown) {
      if ((err as { code?: number }).code !== 11000) throw err;
    }
  }

  throw new ConflictError(
    "Stock changed while adjusting. Refresh the balance and try again."
  );
}

export async function assertSufficientStock(
  warehouseId: string,
  productId: string,
  quantity: number,
  session?: mongoose.ClientSession | null
): Promise<void> {
  assertPositiveIntegerQuantity(quantity, "Requested quantity");
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
  const [products, balances] = await Promise.all([
    Product.find({ isActive: true })
      .populate<{ brandId: { _id: Types.ObjectId; name: string; isActive?: boolean } }>(
        "brandId",
        "name isActive"
      )
      .sort({ name: 1 })
      .lean(),
    InventoryBalance.find({ warehouseId }).lean(),
  ]);

  const balanceByProductId = new Map(
    balances.map((balance) => [String(balance.productId), balance])
  );

  return products
    .filter((product) => {
      const brand = product.brandId as { isActive?: boolean } | null;
      return brand?.isActive !== false;
    })
    .map((product) => {
      const brand = product.brandId as { _id: Types.ObjectId; name: string };
      const balance = balanceByProductId.get(String(product._id));

      return {
        productId: String(product._id),
        productName: product.name,
        secondaryProductName: product.secondaryName,
        brandId: String(brand._id),
        brandName: brand.name,
        stockUnit: product.stockUnit ?? "unit",
        unitsPerStockUnit: product.unitsPerStockUnit ?? 1,
        baseUnit: product.baseUnit ?? "piece",
        quantity: balance?.quantity ?? 0,
        updatedAt: balance?.updatedAt ?? product.updatedAt,
      };
    });
}
