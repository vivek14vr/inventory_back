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

/** Accept ObjectId, hex string, or populated `{ _id }` — never `String(doc)` → "[object Object]". */
function asIdString(
  value: Types.ObjectId | { _id: Types.ObjectId } | string | null | undefined,
  label: string
): string {
  if (value == null || value === "") {
    throw new BadRequestError(`Invalid ${label}`);
  }
  if (typeof value === "object" && "_id" in value && value._id != null) {
    const id = String(value._id);
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestError(`Invalid ${label}`);
    }
    return id;
  }
  if (value instanceof Types.ObjectId) {
    return String(value);
  }
  const id = String(value);
  if (!Types.ObjectId.isValid(id) || id === "[object Object]") {
    throw new BadRequestError(`Invalid ${label}`);
  }
  return id;
}

export async function getBalance(
  warehouseId: string | Types.ObjectId | { _id: Types.ObjectId },
  productId: string | Types.ObjectId | { _id: Types.ObjectId },
  session?: mongoose.ClientSession | null
): Promise<number> {
  const warehouse = asIdString(warehouseId, "warehouse");
  const product = asIdString(productId, "product");
  const balance = await InventoryBalance.findOne({
    warehouseId: warehouse,
    productId: product,
  }).session(session ?? null);
  return balance?.quantity ?? 0;
}

export async function adjustBalance(
  warehouseId: string | Types.ObjectId | { _id: Types.ObjectId },
  productId: string | Types.ObjectId | { _id: Types.ObjectId },
  delta: number,
  session?: mongoose.ClientSession | null
): Promise<number> {
  const warehouse = asIdString(warehouseId, "warehouse");
  const product = asIdString(productId, "product");

  if (delta === 0) {
    return getBalance(warehouse, product, session);
  }

  if (delta < 0) {
    assertPositiveIntegerQuantity(Math.abs(delta), "Stock change");
  } else {
    assertPositiveIntegerQuantity(delta, "Stock change");
  }

  // Guarded, atomic decrement: only succeeds when enough stock exists.
  // Filter `quantity: { $gte: -delta }` is the hard floor at 0 — concurrent
  // stock-outs cannot both pass a separate read then oversell (important on
  // standalone MongoDB where multi-document transactions are unavailable).
  if (delta < 0) {
    const need = -delta;
    const updated = await InventoryBalance.findOneAndUpdate(
      { warehouseId: warehouse, productId: product, quantity: { $gte: need } },
      { $inc: { quantity: delta } },
      { new: true, ...(session ? { session } : {}) }
    );
    if (!updated) {
      const current = await getBalance(warehouse, product, session);
      throw new BadRequestError(
        `Insufficient stock. Available: ${current}, requested: ${need}`
      );
    }
    if (updated.quantity < 0) {
      // Should be unreachable given the $gte filter; fail closed if it happens.
      throw new BadRequestError(
        `Stock balance cannot go below zero (got ${updated.quantity})`
      );
    }
    assertNonNegativeIntegerQuantity(updated.quantity, "Stock balance");
    return updated.quantity;
  }

  // Atomic increment; creates the balance row if it does not exist yet.
  const updated = await InventoryBalance.findOneAndUpdate(
    { warehouseId: warehouse, productId: product },
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
  warehouseId: string | Types.ObjectId | { _id: Types.ObjectId },
  productId: string | Types.ObjectId | { _id: Types.ObjectId },
  quantity: number,
  session?: mongoose.ClientSession | null,
  expectedPrevious?: number
): Promise<{ previous: number; next: number; delta: number }> {
  assertNonNegativeIntegerQuantity(quantity, "Quantity");
  const warehouse = asIdString(warehouseId, "warehouse");
  const product = asIdString(productId, "product");

  const previous =
    expectedPrevious ?? (await getBalance(warehouse, product, session));

  if (previous === quantity) {
    return { previous, next: quantity, delta: 0 };
  }

  const updated = await InventoryBalance.findOneAndUpdate(
    { warehouseId: warehouse, productId: product, quantity: previous },
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
        [{ warehouseId: warehouse, productId: product, quantity }],
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
  warehouseId: string | Types.ObjectId | { _id: Types.ObjectId },
  productId: string | Types.ObjectId | { _id: Types.ObjectId },
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
