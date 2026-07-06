import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { describe, it } from "node:test";
import { MAX_IMPORT_ROWS } from "../../shared/constants/importLimits.js";
import { parseTallyExcelBuffer } from "./imports.service.js";

function buildWorkbook(rows: Record<string, unknown>[]) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Sheet1");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parseTallyExcelBuffer", () => {
  it("parses product, brand, and quantity columns", () => {
    const rows = parseTallyExcelBuffer(
      buildWorkbook([
        { "Product Name": "11 inch plate", "Brand Name": "Cream Bell", Quantity: 50 },
      ])
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].productName, "11 inch plate");
    assert.equal(rows[0].brandName, "Cream Bell");
    assert.equal(rows[0].quantity, 50);
  });

  it("rejects files above the row limit", () => {
    const data = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, index) => ({
      "Product Name": `Item ${index}`,
      "Brand Name": "Brand",
      Quantity: 1,
    }));

    assert.throws(
      () => parseTallyExcelBuffer(buildWorkbook(data)),
      (err: Error) => {
        assert.match(err.message, /maximum allowed/);
        return true;
      }
    );
  });
});
