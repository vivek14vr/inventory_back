import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildLowStockTotals,
  isWarehouseLowStock,
  resolveLowStockThreshold,
  type LowStockStockRow,
} from "./lowStock.utils.js";

function row(
  overrides: Partial<LowStockStockRow> & Pick<LowStockStockRow, "productId" | "quantity">
): LowStockStockRow {
  return {
    productName: "Widget",
    brandId: "b1",
    brandName: "Acme",
    stockUnit: "carton",
    unitsPerStockUnit: 12,
    baseUnit: "piece",
    ...overrides,
  };
}

describe("resolveLowStockThreshold", () => {
  it("prefers warehouse override over product default", () => {
    assert.equal(resolveLowStockThreshold(30, 100), 30);
  });

  it("falls back to product default", () => {
    assert.equal(resolveLowStockThreshold(undefined, 100), 100);
    assert.equal(resolveLowStockThreshold(null, 100), 100);
  });

  it("returns undefined when neither is set", () => {
    assert.equal(resolveLowStockThreshold(undefined, undefined), undefined);
  });
});

describe("isWarehouseLowStock", () => {
  it("flags rows at or below threshold with stock on hand", () => {
    assert.equal(isWarehouseLowStock(row({ quantity: 40, lowStockThreshold: 50 })), true);
    assert.equal(isWarehouseLowStock(row({ quantity: 50, lowStockThreshold: 50 })), true);
  });

  it("ignores zero stock and missing thresholds", () => {
    assert.equal(isWarehouseLowStock(row({ quantity: 0, lowStockThreshold: 50 })), false);
    assert.equal(isWarehouseLowStock(row({ quantity: 10 })), false);
  });
});

describe("buildLowStockTotals", () => {
  it("sums quantities and thresholds across warehouses", () => {
    const totals = buildLowStockTotals([
      row({
        productId: "p1",
        quantity: 40,
        lowStockThreshold: 50,
      }),
      row({
        productId: "p1",
        quantity: 25,
        lowStockThreshold: 30,
      }),
    ]);

    assert.equal(totals.length, 1);
    assert.equal(totals[0]?.totalQuantity, 65);
    assert.equal(totals[0]?.totalLowStockThreshold, 80);
  });

  it("excludes products above combined threshold", () => {
    const totals = buildLowStockTotals([
      row({ productId: "p1", quantity: 60, lowStockThreshold: 50 }),
      row({
        productId: "p1",
        quantity: 30,
        lowStockThreshold: 30,
      }),
    ]);

    assert.equal(totals.length, 0);
  });

  it("ignores warehouses without a threshold in the total sum", () => {
    const totals = buildLowStockTotals([
      row({ productId: "p1", quantity: 20, lowStockThreshold: 50 }),
      row({ productId: "p1", quantity: 10 }),
    ]);

    assert.equal(totals.length, 1);
    assert.equal(totals[0]?.totalLowStockThreshold, 50);
    assert.equal(totals[0]?.totalQuantity, 30);
  });

  it("uses explicit product total threshold instead of summing warehouses", () => {
    const totals = buildLowStockTotals([
      row({
        productId: "p1",
        quantity: 40,
        lowStockThreshold: 10,
        productTotalLowStockThreshold: 50,
      }),
      row({
        productId: "p1",
        quantity: 5,
        lowStockThreshold: 30,
        productTotalLowStockThreshold: 50,
      }),
    ]);

    assert.equal(totals.length, 1);
    assert.equal(totals[0]?.totalQuantity, 45);
    assert.equal(totals[0]?.totalLowStockThreshold, 50);
  });

  it("does not flag total low stock when quantity exceeds explicit product total", () => {
    const totals = buildLowStockTotals([
      row({
        productId: "p1",
        quantity: 40,
        lowStockThreshold: 10,
        productTotalLowStockThreshold: 50,
      }),
      row({
        productId: "p1",
        quantity: 20,
        lowStockThreshold: 30,
        productTotalLowStockThreshold: 50,
      }),
    ]);

    assert.equal(totals.length, 0);
  });
});
