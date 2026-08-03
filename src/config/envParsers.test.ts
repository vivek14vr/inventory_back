import assert from "node:assert/strict";
import test from "node:test";
import { parseBooleanEnvironmentValue } from "./envParsers.js";

test("parseBooleanEnvironmentValue parses explicit boolean strings", () => {
  assert.equal(parseBooleanEnvironmentValue("true"), true);
  assert.equal(parseBooleanEnvironmentValue(" TRUE "), true);
  assert.equal(parseBooleanEnvironmentValue("false"), false);
  assert.equal(parseBooleanEnvironmentValue(" False "), false);
});

test("parseBooleanEnvironmentValue leaves invalid values for schema rejection", () => {
  assert.equal(parseBooleanEnvironmentValue("0"), "0");
  assert.equal(parseBooleanEnvironmentValue("yes"), "yes");
  assert.equal(parseBooleanEnvironmentValue(undefined), undefined);
});
