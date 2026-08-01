import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { revertCapability } from "./revert.service.js";

describe("revertCapability", () => {
  it("allows actions with a guarded revert implementation", () => {
    assert.deepEqual(revertCapability({
      action: "STOCK_ADJUSTED",
      metadata: {
        warehouseId: "507f1f77bcf86cd799439011",
        productId: "507f1f77bcf86cd799439012",
        previous: 10,
        next: 20,
      },
    }), {
      canRevert: true,
    });
    assert.deepEqual(revertCapability({
      action: "INVOICE_UPDATED",
      entityId: "507f1f77bcf86cd799439013",
      metadata: { previousQuantity: 10, quantity: 12 },
    }), {
      canRevert: true,
    });
    assert.deepEqual(revertCapability({
      action: "CLIENT_DELETED",
      entityId: "507f1f77bcf86cd799439014",
      metadata: { name: "Acme Traders" },
    }), {
      canRevert: true,
    });
    assert.deepEqual(revertCapability({
      action: "STOCK_IN",
      entityId: "507f1f77bcf86cd799439015",
      metadata: { quantity: 25 },
    }), {
      canRevert: true,
    });
  });

  it("blocks unsupported and already reverted actions", () => {
    assert.equal(revertCapability({ action: "LOGIN" }).canRevert, false);
    assert.deepEqual(
      revertCapability({ action: "CLIENT_UPDATED", revertedAt: new Date() }),
      { canRevert: false, reason: "Already reverted" }
    );
    assert.equal(revertCapability({
      action: "STOCK_OUT",
      entityId: "507f1f77bcf86cd799439016",
      metadata: { transferId: "507f1f77bcf86cd799439017" },
    }).canRevert, false);
  });
});
