import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildLowStockTotals,
  groupLowStockByProduct,
  isTotalLowStock,
  isWarehouseLowStock,
  resolveLowStockThreshold,
  type LowStockStockRow,
  type LowStockWarehouseRow,
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

function warehouseRow(
  overrides: Partial<LowStockWarehouseRow> & Pick<LowStockWarehouseRow, "productId" | "quantity">
): LowStockWarehouseRow {
  return {
    productName: "Widget",
    brandId: "b1",
    brandName: "Acme",
    stockUnit: "carton",
    unitsPerStockUnit: 12,
    baseUnit: "piece",
    warehouseId: "w1",
    warehouseName: "Goregaon",
    warehouseCode: "GOREGAON",
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

  it("flags zero stock when a positive threshold is set", () => {
    assert.equal(isWarehouseLowStock(row({ quantity: 0, lowStockThreshold: 50 })), true);
  });

  it("ignores missing or zero thresholds", () => {
    assert.equal(isWarehouseLowStock(row({ quantity: 0, lowStockThreshold: 0 })), false);
    assert.equal(isWarehouseLowStock(row({ quantity: 10 })), false);
  });
});

describe("isTotalLowStock", () => {
  it("uses only the overall product threshold", () => {
    assert.equal(isTotalLowStock(40, 50), true);
    assert.equal(isTotalLowStock(60, 50), false);
    assert.equal(isTotalLowStock(40, undefined), false);
    assert.equal(isTotalLowStock(0, 50), true);
  });
});

describe("buildLowStockTotals", () => {
  it("does not derive overall low stock from warehouse thresholds", () => {
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

    assert.equal(totals.length, 0);
  });

  it("flags overall low stock only when product total threshold is set", () => {
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

  it("flags zero total quantity when overall threshold is set", () => {
    const totals = buildLowStockTotals([
      row({
        productId: "p1",
        quantity: 0,
        lowStockThreshold: 10,
        productTotalLowStockThreshold: 50,
      }),
    ]);

    assert.equal(totals.length, 1);
    assert.equal(totals[0]?.totalQuantity, 0);
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

describe("groupLowStockByProduct", () => {
  it("groups warehouse lows independently from the overall threshold", () => {
    const lowItems = [
      warehouseRow({
        productId: "p1",
        warehouseId: "w2",
        warehouseName: "Vasai",
        warehouseCode: "VASAI",
        quantity: 80,
        lowStockThreshold: 5000,
      }),
    ];
    const allRows = [
      warehouseRow({
        productId: "p1",
        warehouseId: "w1",
        quantity: 3200300,
        lowStockThreshold: 70000,
        warehouseLowStockThreshold: 70000,
        productTotalLowStockThreshold: 75000,
      }),
      ...lowItems,
    ];

    const grouped = groupLowStockByProduct(allRows, {
      warehouseLowItems: lowItems,
      totalLowProductIds: new Set(),
    });

    assert.equal(grouped.length, 1);
    assert.equal(grouped[0]?.totalQuantity, 3200380);
    assert.equal(grouped[0]?.totalLowStockThreshold, 75000);
    assert.equal(grouped[0]?.isTotalLow, false);
    assert.equal(grouped[0]?.warehouseLow.w2, 80);
    assert.equal(grouped[0]?.warehouseThreshold.w1, 70000);
    assert.equal(grouped[0]?.warehouseThreshold.w2, 5000);
  });

  it("includes products that are only overall low", () => {
    const allRows = [
      warehouseRow({
        productId: "p1",
        quantity: 40,
        lowStockThreshold: 10,
        productTotalLowStockThreshold: 50,
      }),
      warehouseRow({
        productId: "p1",
        warehouseId: "w2",
        warehouseName: "Vasai",
        warehouseCode: "VASAI",
        quantity: 5,
        lowStockThreshold: 30,
        productTotalLowStockThreshold: 50,
      }),
    ];

    const grouped = groupLowStockByProduct(allRows, {
      warehouseLowItems: [],
      totalLowProductIds: new Set(["p1"]),
    });

    assert.equal(grouped.length, 1);
    assert.equal(grouped[0]?.isTotalLow, true);
    assert.equal(grouped[0]?.totalLowStockThreshold, 50);
    assert.deepEqual(grouped[0]?.warehouseLow, {});
  });
});
