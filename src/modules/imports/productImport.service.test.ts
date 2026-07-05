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
  it("converts low stock cartons to base units when pack size > 1", () => {
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

    assert.equal(rows.length, 1);
    assert.equal(rows[0].unitsPerStockUnit, 800);
    assert.equal(rows[0].lowStockThreshold, 3200);
    assert.equal(rows[0].stockUnit, "carton");
  });

  it("keeps low stock in base units when pack size is 1", () => {
    const rows = parseProductExcelBuffer(
      buildWorkbook([
        {
          brand: "MetroPack",
          "product primary name": "Zip Lock Bag",
          unit: "piece",
          "units per pack": 1,
          "low stock": 50,
        },
      ])
    );

    assert.equal(rows[0].lowStockThreshold, 50);
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
          "low stock box": 2,
        },
      ])
    );

    assert.equal(rows[0].unitsPerStockUnit, 100);
    assert.equal(rows[0].lowStockThreshold, 200);
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
