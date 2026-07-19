import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  effectiveInvoiceSoldQuantity,
  historicalSaleQuantityFromCorrections,
  parseSoldTransitionFromCorrectionNote,
  saleQuantityInventoryDelta,
} from "./saleReturn.utils.js";

describe("saleQuantityInventoryDelta", () => {
  it("credits full reduction when nothing was returned", () => {
    assert.equal(saleQuantityInventoryDelta(200, 0, 0), 200);
    assert.equal(saleQuantityInventoryDelta(10, 5, 0), 5);
  });

  it("does not double-credit stock already restored via returns", () => {
    assert.equal(saleQuantityInventoryDelta(10, 0, 3), 7);
    assert.equal(saleQuantityInventoryDelta(10, 5, 3), 5);
  });

  it("debits stock when sold quantity increases", () => {
    assert.equal(saleQuantityInventoryDelta(100, 150, 0), -50);
    assert.equal(saleQuantityInventoryDelta(5, 10, 3), -5);
  });

  it("returns zero when quantity is unchanged", () => {
    assert.equal(saleQuantityInventoryDelta(80, 80, 10), 0);
  });
});

describe("invoice qty correction parsing", () => {
  it("parses sold transitions from correction notes", () => {
    const parsed = parseSoldTransitionFromCorrectionNote(
      "Invoice quantity correction · Client · INV-1 · sold 15 → 10"
    );
    assert.deepEqual(parsed, { from: 15, to: 10 });
  });

  it("restores historical qty when the sale row was rewritten", () => {
    assert.equal(
      historicalSaleQuantityFromCorrections(
        10,
        "Invoice quantity correction · sold 15 → 10"
      ),
      15
    );
    assert.equal(
      historicalSaleQuantityFromCorrections(
        15,
        "Invoice quantity correction · sold 15 → 10"
      ),
      15
    );
  });

  it("prefers stored invoiceSoldQuantity over derived adjust", () => {
    assert.equal(
      effectiveInvoiceSoldQuantity({
        quantity: 15,
        invoiceSoldQuantity: 10,
        soldAdjustFromCorrections: 5,
      }),
      10
    );
    assert.equal(
      effectiveInvoiceSoldQuantity({
        quantity: 15,
        soldAdjustFromCorrections: 5,
      }),
      10
    );
  });
});
