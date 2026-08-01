import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalAuditPath,
  inferAuditEntity,
  inferAuditEntityId,
  sanitizeAuditBody,
} from "./auditMutation.js";

describe("mutation audit metadata", () => {
  it("redacts credentials while retaining changed field names", () => {
    assert.deepEqual(
      sanitizeAuditBody({
        name: "Updated user",
        password: "never-store-this",
        refreshToken: "never-store-this-either",
        isActive: false,
      }),
      {
        name: "Updated user",
        password: "[REDACTED]",
        refreshToken: "[REDACTED]",
        isActive: false,
      }
    );
  });

  it("summarizes arrays and nested payloads to prevent oversized audit rows", () => {
    assert.deepEqual(
      sanitizeAuditBody({
        lineUpdates: [{ movementId: "one", quantity: 10 }],
        settings: { enabled: true, nested: { value: "hidden" } },
      }),
      {
        lineUpdates: "[1 item]",
        settings: { enabled: true, nested: "[object]" },
      }
    );
  });

  it("infers entities and canonicalizes object ids for API routes", () => {
    const id = "507f1f77bcf86cd799439011";
    assert.equal(inferAuditEntity(`/api/v1/clients/${id}`), "Client");
    assert.equal(
      inferAuditEntity(`/api/v1/inventory/movements/${id}/invoice`),
      "StockMovement"
    );
    assert.equal(canonicalAuditPath(`/api/v1/clients/${id}`), "/api/v1/clients/:id");
    assert.equal(String(inferAuditEntityId(`/api/v1/clients/${id}`)), id);
  });
});
