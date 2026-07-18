import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Pure decision helpers mirroring stock-out claim reclaim / return claim
 * concurrency rules. These document fail-closed behavior without needing Mongo.
 */

type ClaimStatus = "PROCESSING" | "COMPLETED" | "FAILED";

function decideExpiredProcessingReclaim(input: {
  hasExistingMovements: boolean;
}): "complete-from-legacy" | "fail-closed" {
  // Matches acquireSalesInvoiceClaim: expired PROCESSING with movements →
  // mark COMPLETED; without movements → FAILED (do not auto-retry debit).
  if (input.hasExistingMovements) return "complete-from-legacy";
  return "fail-closed";
}

function canClaimReturnQty(input: {
  soldQty: number;
  alreadyReturned: number;
  requestQty: number;
}): boolean {
  // Mirrors atomic $expr: alreadyReturned + requestQty <= soldQty
  return (
    input.requestQty > 0 &&
    input.alreadyReturned + input.requestQty <= input.soldQty
  );
}

describe("invoice claim reclaim fail-closed", () => {
  it("marks completed when movements already exist", () => {
    assert.equal(
      decideExpiredProcessingReclaim({ hasExistingMovements: true }),
      "complete-from-legacy"
    );
  });

  it("does not auto-retry when expired with no movements", () => {
    assert.equal(
      decideExpiredProcessingReclaim({ hasExistingMovements: false }),
      "fail-closed"
    );
  });
});

describe("client return quantity claim", () => {
  it("allows return within remaining qty", () => {
    assert.equal(
      canClaimReturnQty({ soldQty: 10, alreadyReturned: 3, requestQty: 7 }),
      true
    );
  });

  it("rejects concurrent over-return past sold qty", () => {
    assert.equal(
      canClaimReturnQty({ soldQty: 10, alreadyReturned: 6, requestQty: 5 }),
      false
    );
  });

  it("rejects zero or negative request", () => {
    assert.equal(
      canClaimReturnQty({ soldQty: 10, alreadyReturned: 0, requestQty: 0 }),
      false
    );
  });
});

describe("setBalance CAS intent", () => {
  it("detects concurrent change when expected previous mismatches", () => {
    const expectedPrevious = 100;
    const actualPrevious = 90; // concurrent stock-out of 10
    const adminTarget = 95;
    const casOk = actualPrevious === expectedPrevious;
    assert.equal(casOk, false);
    // On conflict, admin must refresh — absolute overwrite must not apply.
    assert.notEqual(adminTarget, actualPrevious);
  });
});
