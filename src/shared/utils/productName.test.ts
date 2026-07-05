import assert from "node:assert/strict";
import { test } from "node:test";
import { formatProductDisplayName, normalizeProductName } from "./productName.js";

test("normalizeProductName lowercases and trims", () => {
  assert.equal(normalizeProductName("  Cornstarch Spoon  "), "cornstarch spoon");
  assert.equal(normalizeProductName("BIODINE"), "biodine");
});

test("formatProductDisplayName appends secondary name when present", () => {
  assert.equal(
    formatProductDisplayName("gw plate 11 inches", "Green cap"),
    "gw plate 11 inches (Green cap)"
  );
});

test("formatProductDisplayName ignores blank secondary name", () => {
  assert.equal(formatProductDisplayName("Paper Bowl 500ml", "   "), "Paper Bowl 500ml");
  assert.equal(formatProductDisplayName("Paper Bowl 500ml"), "Paper Bowl 500ml");
});

test("formatProductDisplayName trims surrounding whitespace", () => {
  assert.equal(formatProductDisplayName("  Fork  ", "  Small  "), "Fork (Small)");
});
