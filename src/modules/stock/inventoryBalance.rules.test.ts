import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Documents the non-negative stock invariant enforced by
 * `adjustBalance` (atomic `quantity: { $gte: requested }` on decrements).
 * Live balances must never go below 0.
 */

function canDecrement(available: number, requested: number): boolean {
  return (
    Number.isInteger(available) &&
    Number.isInteger(requested) &&
    available >= 0 &&
    requested > 0 &&
    available >= requested
  );
}

function balanceAfterDecrement(available: number, requested: number): number {
  if (!canDecrement(available, requested)) {
    throw new Error(
      `Insufficient stock. Available: ${available}, requested: ${requested}`
    );
  }
  return available - requested;
}

describe("stock never goes below zero", () => {
  it("allows exact deplete to zero", () => {
    assert.equal(balanceAfterDecrement(1000, 1000), 0);
  });

  it("rejects oversell past available", () => {
    assert.equal(canDecrement(1000, 1001), false);
    assert.throws(
      () => balanceAfterDecrement(1000, 1001),
      /Insufficient stock/
    );
  });

  it("rejects decrement when balance is already zero", () => {
    assert.equal(canDecrement(0, 1), false);
  });

  it("rejects selling when no balance row exists (treated as 0)", () => {
    assert.equal(canDecrement(0, 400), false);
  });
});
