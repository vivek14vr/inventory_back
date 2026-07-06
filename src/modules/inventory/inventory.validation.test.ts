import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stockQuerySchema } from "./inventory.validation.js";

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
