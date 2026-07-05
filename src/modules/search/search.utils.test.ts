import test from "node:test";
import assert from "node:assert/strict";
import { escapeRegex } from "./search.utils.js";

test("escapeRegex escapes special characters", () => {
  assert.equal(escapeRegex("a+b"), "a\\+b");
  assert.equal(escapeRegex("foo.bar"), "foo\\.bar");
});
