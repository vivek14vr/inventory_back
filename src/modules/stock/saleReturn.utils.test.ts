import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { saleQuantityInventoryDelta } from "./saleReturn.utils.js";

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
