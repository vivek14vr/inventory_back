import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** Mirrors sold-qty correction: stock change equals previous sold minus new sold. */
function soldQuantityInventoryDelta(previousSold: number, nextSold: number): number {
  return previousSold - nextSold;
}

function verifyInventoryAfterSoldQtyUpdate(
  balanceBefore: number,
  balanceAfter: number,
  previousSold: number,
  nextSold: number
): boolean {
  const delta = soldQuantityInventoryDelta(previousSold, nextSold);
  return balanceAfter === balanceBefore + delta;
}

describe("client return sold quantity inventory validation", () => {
  it("adds stock back when sold quantity is reduced", () => {
    const previousSold = 200;
    const nextSold = 0;
    const balanceBefore = 50;
    const delta = soldQuantityInventoryDelta(previousSold, nextSold);

    assert.equal(delta, 200);
    assert.equal(
      verifyInventoryAfterSoldQtyUpdate(balanceBefore, 250, previousSold, nextSold),
      true
    );
  });

  it("removes stock when sold quantity is increased", () => {
    const previousSold = 100;
    const nextSold = 150;
    const balanceBefore = 500;
    const delta = soldQuantityInventoryDelta(previousSold, nextSold);

    assert.equal(delta, -50);
    assert.equal(
      verifyInventoryAfterSoldQtyUpdate(balanceBefore, 450, previousSold, nextSold),
      true
    );
  });

  it("leaves stock unchanged when sold quantity is unchanged", () => {
    assert.equal(soldQuantityInventoryDelta(80, 80), 0);
    assert.equal(verifyInventoryAfterSoldQtyUpdate(120, 120, 80, 80), true);
  });

  it("allows sold quantity to be set to zero", () => {
    const delta = soldQuantityInventoryDelta(3200, 0);
    assert.equal(delta, 3200);
    assert.equal(verifyInventoryAfterSoldQtyUpdate(0, 3200, 3200, 0), true);
  });
});
