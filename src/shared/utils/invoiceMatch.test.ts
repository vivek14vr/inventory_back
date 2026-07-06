import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exactCaseInsensitiveRegex } from "./invoiceMatch.js";

describe("exactCaseInsensitiveRegex", () => {
  it("matches invoice numbers regardless of case", () => {
    const regex = exactCaseInsensitiveRegex("INV-001");
    assert.equal(regex.test("INV-001"), true);
    assert.equal(regex.test("inv-001"), true);
    assert.equal(regex.test("Inv-001"), true);
    assert.equal(regex.test("INV-002"), false);
  });

  it("trims surrounding whitespace before matching", () => {
    const regex = exactCaseInsensitiveRegex("  ABC-9  ");
    assert.equal(regex.test("ABC-9"), true);
    assert.equal(regex.test("abc-9"), true);
  });
});
