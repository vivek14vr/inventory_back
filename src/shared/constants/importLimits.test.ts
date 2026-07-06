import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_IMPORT_ROWS,
  assertImportRowCount,
} from "./importLimits.js";

describe("assertImportRowCount", () => {
  it("allows rows at the limit", () => {
    assert.doesNotThrow(() => assertImportRowCount(MAX_IMPORT_ROWS));
  });

  it("rejects rows above the limit", () => {
    assert.throws(
      () => assertImportRowCount(MAX_IMPORT_ROWS + 1, "Tally file"),
      (err: Error) => {
        assert.match(err.message, /Tally file/);
        assert.match(err.message, /maximum allowed/);
        return true;
      }
    );
  });
});
