import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { describe, it } from "node:test";
import { parseProductExcelBuffer } from "./productImport.service.js";

function buildWorkbook(rows: Record<string, unknown>[]) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Sheet1");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parseProductExcelBuffer", () => {
  it("converts total low stock cartons to base units when pack size > 1", () => {
    const rows = parseProductExcelBuffer(
      buildWorkbook([
        {
          brand: "Brand B",
          "product primary name": "mini tray 5 cp",
          unit: "piece",
          "units in a cartoon": 800,
          "total low quantity cartoon": 4,
        },
      ])
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].unitsPerStockUnit, 800);
    assert.equal(rows[0].totalLowStockThreshold, 3200);
    assert.equal(rows[0].lowStockThreshold, undefined);
    assert.equal(rows[0].stockUnit, "carton");
  });

  it("accepts total low stock in base units", () => {
    const rows = parseProductExcelBuffer(
      buildWorkbook([
        {
          brand: "Brand B",
          "product primary name": "mini tray 5 cp",
          unit: "piece",
          "units in a cartoon": 800,
          "total low quantity unit": 3200,
        },
      ])
    );

    assert.equal(rows[0].totalLowStockThreshold, 3200);
  });

  it("prefers total low stock units when both unit and carton columns are filled", () => {
    const rows = parseProductExcelBuffer(
      buildWorkbook([
        {
          brand: "Brand B",
          "product primary name": "mini tray 5 cp",
          unit: "piece",
          "units in a cartoon": 800,
          "total low quantity unit": 1000,
          "total low quantity cartoon": 4,
        },
      ])
    );

    assert.equal(rows[0].totalLowStockThreshold, 1000);
  });

  it("keeps legacy low quantity cartoon column as per-warehouse default fallback", () => {
    const rows = parseProductExcelBuffer(
      buildWorkbook([
        {
          brand: "Brand B",
          "product primary name": "mini tray 5 cp",
          unit: "piece",
          "units in a cartoon": 800,
          "low quantity cartoon": 4,
        },
      ])
    );

    assert.equal(rows[0].lowStockThreshold, 3200);
  });

  it("keeps low stock in base units when pack size is 1", () => {
    const rows = parseProductExcelBuffer(
      buildWorkbook([
        {
          brand: "MetroPack",
          "product primary name": "Zip Lock Bag",
          unit: "piece",
          "units per pack": 1,
          "total low quantity unit": 50,
        },
      ])
    );

    assert.equal(rows[0].totalLowStockThreshold, 50);
    assert.equal(rows[0].stockUnit, "piece");
  });

  it("accepts box column aliases", () => {
    const rows = parseProductExcelBuffer(
      buildWorkbook([
        {
          brand: "Brand A",
          "product primary name": "Test item",
          unit: "piece",
          "units in a box": 100,
          "total low quantity cartoon": 2,
        },
      ])
    );

    assert.equal(rows[0].unitsPerStockUnit, 100);
    assert.equal(rows[0].totalLowStockThreshold, 200);
  });

  it("stores total low stock separately from warehouse thresholds", () => {
    const rows = parseProductExcelBuffer(
      buildWorkbook([
        {
          brand: "Brand A",
          "product primary name": "Plate",
          unit: "piece",
          "units in a cartoon": 800,
          "total low quantity unit": 50,
          "low quantity unit in Goregaon": 10,
          "low quantity unit in Vasai": 30,
        },
      ])
    );

    assert.equal(rows[0].totalLowStockThreshold, 50);
    assert.equal(rows[0].warehouseLowStockThresholds?.[0].lowStockThreshold, 10);
    assert.equal(rows[0].warehouseLowStockThresholds?.[1].lowStockThreshold, 30);
  });

  it("parses warehouse low stock from carton columns", () => {
    const rows = parseProductExcelBuffer(
      buildWorkbook([
        {
          brand: "Brand A",
          "product primary name": "Plate",
          unit: "piece",
          "units in a cartoon": 800,
          "total low quantity cartoon": 5,
          "low quantity cartoon in Goregaon": 3,
          "low quantity cartoon in Vasai": 4,
        },
      ])
    );

    assert.equal(rows[0].warehouseLowStockThresholds?.length, 2);
    assert.deepEqual(rows[0].warehouseLowStockThresholds?.[0], {
      warehouseName: "Goregaon",
      lowStockThreshold: 2400,
    });
    assert.deepEqual(rows[0].warehouseLowStockThresholds?.[1], {
      warehouseName: "Vasai",
      lowStockThreshold: 3200,
    });
  });

  it("parses warehouse low stock from unit columns", () => {
    const rows = parseProductExcelBuffer(
      buildWorkbook([
        {
          brand: "Brand A",
          "product primary name": "Plate",
          unit: "piece",
          "units in a cartoon": 800,
          "low quantity unit in Goregaon": 1500,
          "low quantity unit in Vasai": 2000,
        },
      ])
    );

    assert.deepEqual(rows[0].warehouseLowStockThresholds, [
      { warehouseName: "Goregaon", lowStockThreshold: 1500 },
      { warehouseName: "Vasai", lowStockThreshold: 2000 },
    ]);
  });

  it("prefers warehouse unit value when both unit and carton columns are filled", () => {
    const rows = parseProductExcelBuffer(
      buildWorkbook([
        {
          brand: "Brand A",
          "product primary name": "Plate",
          unit: "piece",
          "units in a cartoon": 800,
          "low quantity unit in Vasai": 1200,
          "low quantity cartoon in Vasai": 5,
        },
      ])
    );

    assert.equal(rows[0].warehouseLowStockThresholds?.[0].warehouseName, "Vasai");
    assert.equal(rows[0].warehouseLowStockThresholds?.[0].lowStockThreshold, 1200);
  });

  it("ignores blank rows", () => {
    const rows = parseProductExcelBuffer(
      buildWorkbook([
        {
          brand: "Brand A",
          "product primary name": "Widget",
          unit: "piece",
          "units in a carton": 1,
        },
        {
          brand: "",
          "product primary name": "",
          unit: "",
          "units in a carton": "",
        },
      ])
    );

    assert.equal(rows.length, 1);
  });
});
