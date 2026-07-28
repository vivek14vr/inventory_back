import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { describe, it } from "node:test";
import {
  parseSalesRegisterExcelBuffer,
  parseWarehouseHintFromNarration,
} from "./salesImport.service.js";

function buildWorkbookBuffer(rows: unknown[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Sales Register");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parseWarehouseHintFromNarration", () => {
  it("maps empty narration to goregaon", () => {
    assert.deepEqual(parseWarehouseHintFromNarration(""), { hint: "goregaon" });
    assert.deepEqual(parseWarehouseHintFromNarration("   "), { hint: "goregaon" });
    assert.deepEqual(parseWarehouseHintFromNarration("-"), { hint: "goregaon" });
    assert.deepEqual(parseWarehouseHintFromNarration("n/a"), { hint: "goregaon" });
  });

  it("maps narration containing vasai case-insensitively", () => {
    assert.deepEqual(parseWarehouseHintFromNarration("vasai"), { hint: "vasai" });
    assert.deepEqual(parseWarehouseHintFromNarration("VASAI Godown"), { hint: "vasai" });
    assert.deepEqual(parseWarehouseHintFromNarration("to Vasai"), { hint: "vasai" });
    assert.deepEqual(parseWarehouseHintFromNarration("Vasai / Goregaon"), {
      hint: "vasai",
    });
  });

  it("maps explicit goregaon narration to goregaon", () => {
    assert.deepEqual(parseWarehouseHintFromNarration("Goregaon"), { hint: "goregaon" });
    assert.deepEqual(parseWarehouseHintFromNarration("goregoan"), { hint: "goregaon" });
  });

  it("rejects other narration text", () => {
    const result = parseWarehouseHintFromNarration("mumbai");
    assert.ok("error" in result);
  });
});

describe("parseSalesRegisterExcelBuffer", () => {
  it("groups invoice headers and product lines from row 4", () => {
    const buffer = buildWorkbookBuffer([
      ["Company"],
      ["Sales Register"],
      ["Date", "Particulars", "Buyer", "Voucher Type", "Voucher No.", "Quantity"],
      ["25-Jun-25", "Acme Traders", "Acme Traders", "Sales", "INV-001", ""],
      ["", "11 inch plate", "", "", "", 800],
      ["", "7 inch plate", "", "", "", 400],
      ["26-Jun-25", "Beta Corp", "Beta Corp", "Sales", "INV-002", ""],
      ["", "11 inch plate", "", "", "", 100],
    ]);

    const vouchers = parseSalesRegisterExcelBuffer(buffer);

    assert.equal(vouchers.length, 2);
    assert.deepEqual(vouchers[0], {
      voucherIndex: 1,
      headerRowNumber: 4,
      sellDate: "25-Jun-25",
      clientName: "Acme Traders",
      invoiceNumber: "INV-001",
      narrationRaw: "",
      warehouseHint: "goregaon",
      lines: [
        {
          rowNumber: 5,
          productName: "11 inch plate",
          quantity: 800,
          narrationRaw: "",
          warehouseHint: "goregaon",
        },
        {
          rowNumber: 6,
          productName: "7 inch plate",
          quantity: 400,
          narrationRaw: "",
          warehouseHint: "goregaon",
        },
      ],
    });
    assert.deepEqual(vouchers[1], {
      voucherIndex: 2,
      headerRowNumber: 7,
      sellDate: "26-Jun-25",
      clientName: "Beta Corp",
      invoiceNumber: "INV-002",
      narrationRaw: "",
      warehouseHint: "goregaon",
      lines: [
        {
          rowNumber: 8,
          productName: "11 inch plate",
          quantity: 100,
          narrationRaw: "",
          warehouseHint: "goregaon",
        },
      ],
    });
  });

  it("skips cancelled vouchers", () => {
    const buffer = buildWorkbookBuffer([
      ["Sales Register"],
      ["Date", "Particulars", "Buyer", "Voucher Type", "Voucher No.", "Quantity"],
      ["01-Jul-26", "Acme Traders", "Acme Traders", "Sales", "1001", ""],
      ["", "11 inch plate", "", "", "", 100],
      ["01-Jul-26", "(cancelled )", "", "Sales", "1002", ""],
      ["01-Jul-26", "Beta Corp", "Beta Corp", "Sales", "1003", ""],
      ["", "7 inch plate", "", "", "", 50],
    ]);

    const vouchers = parseSalesRegisterExcelBuffer(buffer);
    assert.equal(vouchers.length, 2);
    assert.equal(vouchers[0].invoiceNumber, "1001");
    assert.equal(vouchers[1].invoiceNumber, "1003");
  });

  it("parses quantity strings with units", () => {
    const buffer = buildWorkbookBuffer([
      ["Date", "Particulars", "Buyer", "Voucher Type", "Voucher No.", "Quantity"],
      ["01-Jul-26", "Acme Traders", "Acme Traders", "Sales", "1001", ""],
      ["", "Paper Bag (Kg)", "", "", "", "30.00 kg"],
      ["", "Fuel Gel", "", "", "", "6 box"],
      ["", "Plates", "", "", "", "1000 pcs"],
    ]);

    const vouchers = parseSalesRegisterExcelBuffer(buffer);
    assert.equal(vouchers[0].lines.length, 3);
    assert.deepEqual(
      vouchers[0].lines.map((line) => line.quantity),
      [30, 6, 1000]
    );
  });

  it("skips summary rows and blank lines", () => {
    const buffer = buildWorkbookBuffer([
      ["Company"],
      ["Sales Register"],
      ["Date", "Particulars", "Buyer", "Voucher Type", "Voucher No.", "Quantity"],
      ["25-Jun-25", "Acme Traders", "Acme Traders", "Sales", "INV-003", ""],
      ["", "11 inch plate", "", "", "", 50],
      ["", "Total", "", "", "", 50],
      [],
    ]);

    const vouchers = parseSalesRegisterExcelBuffer(buffer);
    assert.equal(vouchers.length, 1);
    assert.equal(vouchers[0].lines.length, 1);
    assert.equal(vouchers[0].lines[0].productName, "11 inch plate");
  });

  it("throws when no vouchers are found", () => {
    const buffer = buildWorkbookBuffer([
      ["Company"],
      ["Sales Register"],
      ["Date", "Particulars", "", "", "Voucher No.", "Quantity"],
      ["", "", "", "", "", ""],
    ]);
    assert.throws(() => parseSalesRegisterExcelBuffer(buffer), /No sales vouchers/);
  });

  it("detects header row automatically regardless of preamble rows", () => {
    const buffer = buildWorkbookBuffer([
      ["GMPK 1.4.2026"],
      ["Sales Register"],
      ["For 1-Jun-26"],
      [
        "Date",
        "Particulars",
        "Buyer",
        "Voucher Type",
        "Voucher No.",
        "Quantity",
        "Gross Total",
        "SALES",
        "OUTPUT CGST",
        "OUTPUT SGST",
        "ROUND OFF",
      ],
      [
        "01-Jun-26",
        "Status Restaurant",
        "Status Restaurant",
        "Sales",
        "26-27/01327",
        "90.00 kg",
        9558,
        8100,
        729,
        729,
        "",
      ],
      ["", "Paper Bag (Kg)", "", "", "", 30],
    ]);

    const vouchers = parseSalesRegisterExcelBuffer(buffer);
    assert.equal(vouchers.length, 1);
    assert.equal(vouchers[0].clientName, "Status Restaurant");
    assert.equal(vouchers[0].invoiceNumber, "26-27/01327");
    assert.equal(vouchers[0].headerRowNumber, 5);
    assert.deepEqual(vouchers[0].lines, [
      {
        rowNumber: 6,
        productName: "Paper Bag (Kg)",
        quantity: 30,
        narrationRaw: "",
        warehouseHint: "goregaon",
      },
    ]);
  });

  it("reads warehouse from invoice header Narration and applies to all lines", () => {
    const buffer = buildWorkbookBuffer([
      [
        "Date",
        "Particulars",
        "Buyer",
        "Voucher Type",
        "Voucher No.",
        "Narration",
        "Quantity",
      ],
      ["01-Jul-26", "Acme Traders", "Acme Traders", "Sales", "INV-10", "vasai", ""],
      ["", "11 inch plate", "", "", "", "", 100],
      ["", "7 inch plate", "", "", "", "ignored on product rows", 50],
      ["02-Jul-26", "Beta Corp", "Beta Corp", "Sales", "INV-11", "", ""],
      ["", "Cup", "", "", "", "", 25],
      ["03-Jul-26", "Bad Co", "Bad Co", "Sales", "INV-12", "mumbai", ""],
      ["", "Bowl", "", "", "", "", 10],
    ]);

    const vouchers = parseSalesRegisterExcelBuffer(buffer);
    assert.equal(vouchers.length, 3);

    assert.equal(vouchers[0].warehouseHint, "vasai");
    assert.equal(vouchers[0].narrationRaw, "vasai");
    assert.deepEqual(
      vouchers[0].lines.map((line) => ({
        productName: line.productName,
        warehouseHint: line.warehouseHint,
        narrationRaw: line.narrationRaw,
      })),
      [
        { productName: "11 inch plate", warehouseHint: "vasai", narrationRaw: "vasai" },
        { productName: "7 inch plate", warehouseHint: "vasai", narrationRaw: "vasai" },
      ]
    );

    assert.equal(vouchers[1].warehouseHint, "goregaon");
    assert.equal(vouchers[1].narrationRaw, "");
    assert.equal(vouchers[1].lines[0]?.warehouseHint, "goregaon");

    assert.equal(vouchers[2].warehouseHint, undefined);
    assert.ok(vouchers[2].warehouseNarrationError?.includes("mumbai"));
    assert.ok(vouchers[2].lines[0]?.warehouseNarrationError?.includes("mumbai"));
  });

  it("throws when header row is missing", () => {
    const buffer = buildWorkbookBuffer([
      ["Company"],
      ["Random", "Columns"],
      ["01-Jun-26", "Acme Traders", "", "", "1001", 100],
    ]);
    assert.throws(() => parseSalesRegisterExcelBuffer(buffer), /Could not find sales register header/i);
  });

  it("rejects product catalog files with a helpful message", () => {
    const buffer = buildWorkbookBuffer([
      ["BRAND", "PRODUCT PRIMARY NAME", "UNIT", "UNITS IN A CARTOON"],
      ["Cream Bell", "11 inch plate", "pieces", 800],
    ]);
    assert.throws(
      () => parseSalesRegisterExcelBuffer(buffer),
      /product catalog file/i
    );
  });
});
