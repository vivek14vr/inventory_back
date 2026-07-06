import test from "node:test";
import assert from "node:assert/strict";
import { BadRequestError } from "../errors/AppError.js";
import {
  assertNonNegativeIntegerQuantity,
  assertPositiveIntegerQuantity,
} from "./quantity.js";

test("assertNonNegativeIntegerQuantity rejects negative values", () => {
  assert.throws(() => assertNonNegativeIntegerQuantity(-1), BadRequestError);
  assert.throws(() => assertNonNegativeIntegerQuantity(1.5), BadRequestError);
  assert.doesNotThrow(() => assertNonNegativeIntegerQuantity(0));
  assert.doesNotThrow(() => assertNonNegativeIntegerQuantity(10));
});

test("assertPositiveIntegerQuantity requires at least 1", () => {
  assert.throws(() => assertPositiveIntegerQuantity(0), BadRequestError);
  assert.throws(() => assertPositiveIntegerQuantity(-3), BadRequestError);
  assert.doesNotThrow(() => assertPositiveIntegerQuantity(1));
});
