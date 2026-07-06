import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { saleQuantityInventoryDelta } from "./saleReturn.utils.js";

function verifyInventoryAfterSoldQtyUpdate(
  balanceBefore: number,
  balanceAfter: number,
  previousSold: number,
  nextSold: number,
  returnedSold: number
): boolean {
  const delta = saleQuantityInventoryDelta(previousSold, nextSold, returnedSold);
  return balanceAfter === balanceBefore + delta;
}

describe("client return sold quantity inventory validation", () => {
  it("adds stock back when sold quantity is reduced", () => {
    const previousSold = 200;
    const nextSold = 0;
    const balanceBefore = 50;
    const delta = saleQuantityInventoryDelta(previousSold, nextSold, 0);

    assert.equal(delta, 200);
    assert.equal(
      verifyInventoryAfterSoldQtyUpdate(balanceBefore, 250, previousSold, nextSold, 0),
      true
    );
  });

  it("accounts for prior returns when sold quantity is zeroed", () => {
    const previousSold = 10;
    const nextSold = 0;
    const returnedSold = 3;
    const balanceBefore = 93;
    const delta = saleQuantityInventoryDelta(previousSold, nextSold, returnedSold);

    assert.equal(delta, 7);
    assert.equal(
      verifyInventoryAfterSoldQtyUpdate(
        balanceBefore,
        100,
        previousSold,
        nextSold,
        returnedSold
      ),
      true
    );
  });

  it("removes stock when sold quantity is increased", () => {
    const previousSold = 100;
    const nextSold = 150;
    const balanceBefore = 500;
    const delta = saleQuantityInventoryDelta(previousSold, nextSold, 0);

    assert.equal(delta, -50);
    assert.equal(
      verifyInventoryAfterSoldQtyUpdate(balanceBefore, 450, previousSold, nextSold, 0),
      true
    );
  });

  it("leaves stock unchanged when sold quantity is unchanged", () => {
    assert.equal(saleQuantityInventoryDelta(80, 80, 0), 0);
    assert.equal(verifyInventoryAfterSoldQtyUpdate(120, 120, 80, 80, 0), true);
  });
});
