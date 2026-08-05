import assert from "node:assert/strict";
import test from "node:test";
import {
  salesImportConfirmLineSchema,
  salesImportConfirmVoucherSchema,
} from "./imports.validation.js";

const validLine = {
  rowNumber: 4,
  productName: "Paper cup",
  brandName: "Acme",
  quantity: 10,
  warehouseId: "warehouse-id",
  brandAction: "create" as const,
  action: "create" as const,
};

test("sales import validation accepts intentionally ignored incomplete lines", () => {
  const parsed = salesImportConfirmLineSchema.parse({
    ...validLine,
    productName: "",
    brandName: "",
    quantity: 0,
    warehouseId: "",
    ignore: true,
  });
  assert.equal(parsed.ignore, true);
});

test("sales import validation keeps legacy payloads active by default", () => {
  const line = salesImportConfirmLineSchema.parse(validLine);
  const voucher = salesImportConfirmVoucherSchema.parse({
    voucherIndex: 1,
    headerRowNumber: 3,
    clientName: "Client",
    invoiceNumber: "INV-1",
    clientAction: "create",
    lines: [validLine],
  });

  assert.equal(line.ignore, false);
  assert.equal(voucher.ignore, false);
});

test("sales import validation still rejects incomplete active lines", () => {
  const parsed = salesImportConfirmLineSchema.safeParse({
    ...validLine,
    warehouseId: "",
  });
  assert.equal(parsed.success, false);
});

test("sales import validation accepts an ignored invoice without merge target", () => {
  const parsed = salesImportConfirmVoucherSchema.parse({
    voucherIndex: 1,
    headerRowNumber: 3,
    clientName: "Client",
    invoiceNumber: "INV-1",
    clientAction: "merge",
    ignore: true,
    lines: [{ ...validLine, ignore: true }],
  });
  assert.equal(parsed.ignore, true);
});

test("sales import validation accepts an ignored invoice with blank identifying fields", () => {
  const parsed = salesImportConfirmVoucherSchema.parse({
    voucherIndex: 2,
    headerRowNumber: 8,
    clientName: "",
    invoiceNumber: "",
    clientAction: "create",
    ignore: true,
    lines: [{ ...validLine, ignore: true }],
  });

  assert.equal(parsed.ignore, true);
  assert.equal(parsed.clientName, "");
  assert.equal(parsed.invoiceNumber, "");
});

test("sales import validation identifies blank fields on an active invoice", () => {
  const parsed = salesImportConfirmVoucherSchema.safeParse({
    voucherIndex: 2,
    headerRowNumber: 8,
    clientName: "   ",
    invoiceNumber: "",
    clientAction: "create",
    lines: [validLine],
  });

  assert.equal(parsed.success, false);
  if (parsed.success) return;
  assert.deepEqual(
    parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    [
      { path: ["clientName"], message: "Client name is required" },
      { path: ["invoiceNumber"], message: "Invoice number is required" },
    ]
  );
});
