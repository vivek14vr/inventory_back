import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addInvoiceProductSchema, stockQuerySchema } from "./inventory.validation.js";

describe("stockQuerySchema includeZero", () => {
  it("defaults includeZero to true when the query param is omitted", () => {
    const parsed = stockQuerySchema.parse({ page: "1", limit: "20" });
    assert.equal(parsed.includeZero, true);
  });

  it("parses includeZero=false when explicitly requested", () => {
    const parsed = stockQuerySchema.parse({
      page: "1",
      limit: "20",
      includeZero: "false",
    });
    assert.equal(parsed.includeZero, false);
  });

  it("parses includeZero=true when explicitly requested", () => {
    const parsed = stockQuerySchema.parse({
      page: "1",
      limit: "20",
      includeZero: "true",
    });
    assert.equal(parsed.includeZero, true);
  });
});

describe("addInvoiceProductSchema", () => {
  it("accepts a product and positive whole-unit quantity", () => {
    const parsed = addInvoiceProductSchema.parse({
      productId: "507f1f77bcf86cd799439011",
      quantity: "25",
    });
    assert.equal(parsed.quantity, 25);
  });

  it("rejects zero, negative, and fractional quantities", () => {
    for (const quantity of [0, -1, 1.5]) {
      assert.equal(
        addInvoiceProductSchema.safeParse({
          productId: "507f1f77bcf86cd799439011",
          quantity,
        }).success,
        false
      );
    }
  });
});
