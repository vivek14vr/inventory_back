import assert from "node:assert/strict";
import test from "node:test";
import { TransferStatus } from "../../shared/constants/roles.js";
import { updateTransferStatusSchema } from "./transfers.validation.js";

test("pending transfer status updates do not accept RETURNED", () => {
  assert.equal(
    updateTransferStatusSchema.safeParse({ status: TransferStatus.RECEIVED }).success,
    true
  );
  assert.equal(
    updateTransferStatusSchema.safeParse({ status: TransferStatus.CANCELLED }).success,
    true
  );
  assert.equal(
    updateTransferStatusSchema.safeParse({ status: TransferStatus.RETURNED }).success,
    false
  );
});
