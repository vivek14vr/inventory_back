import assert from "node:assert/strict";
import { test } from "node:test";
import { formatProductDisplayName, normalizeProductName } from "./productName.js";

test("normalizeProductName lowercases, trims, and removes spaces", () => {
  assert.equal(normalizeProductName("  Cornstarch Spoon  "), "cornstarchspoon");
  assert.equal(normalizeProductName("BIODINE"), "biodine");
  assert.equal(normalizeProductName("11 inch plate"), "11inchplate");
  assert.equal(normalizeProductName("11  inch  plate"), "11inchplate");
  assert.equal(normalizeProductName("11 Inch Plate"), "11inchplate");
  assert.equal(
    normalizeProductName("ECOINFINITY 11 INCH 4 CP ROUND PLATE (800pc)"),
    normalizeProductName("ECOINFINITY  11 INCH 4 CP ROUND PLATE (800pc)")
  );
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
