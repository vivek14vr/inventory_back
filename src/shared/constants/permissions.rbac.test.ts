import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLIENT_RETURN_PERMISSIONS,
  Permission,
  STOCK_BALANCE_READ_PERMISSIONS,
  WAREHOUSE_RETURN_PERMISSIONS,
} from "./permissions.js";

/**
 * Guards against the class of RBAC bug where one module’s actions
 * (e.g. stock.in) were aliased into another module (e.g. Returns / Check Stock UI).
 *
 * STOCK_BALANCE_READ may include stock.in/out for *API dependency* reads during
 * stock ops — it must not be used to unlock the Returns module or master-data pages.
 */
describe("RBAC permission aliases stay module-strict", () => {
  it("client returns require returns.client only — not stock in/out", () => {
    assert.deepEqual(CLIENT_RETURN_PERMISSIONS, [Permission.RETURNS_CLIENT]);
    assert.ok(!CLIENT_RETURN_PERMISSIONS.includes(Permission.STOCK_IN));
    assert.ok(!CLIENT_RETURN_PERMISSIONS.includes(Permission.STOCK_OUT));
    assert.ok(!CLIENT_RETURN_PERMISSIONS.includes(Permission.STOCK_VIEW));
  });

  it("warehouse / transfer returns require transfers.manage — not stock aliases", () => {
    assert.deepEqual(WAREHOUSE_RETURN_PERMISSIONS, [
      Permission.TRANSFERS_MANAGE,
    ]);
    assert.ok(!WAREHOUSE_RETURN_PERMISSIONS.includes(Permission.STOCK_IN));
    assert.ok(!WAREHOUSE_RETURN_PERMISSIONS.includes(Permission.STOCK_OUT));
    assert.ok(
      !WAREHOUSE_RETURN_PERMISSIONS.includes(Permission.TRANSFERS_RECEIVE)
    );
    assert.ok(
      !WAREHOUSE_RETURN_PERMISSIONS.includes(Permission.RETURNS_WAREHOUSE)
    );
  });

  it("stock balance read alias does not include returns or inventory modules", () => {
    assert.ok(STOCK_BALANCE_READ_PERMISSIONS.includes(Permission.STOCK_VIEW));
    assert.ok(!STOCK_BALANCE_READ_PERMISSIONS.includes(Permission.RETURNS_CLIENT));
    assert.ok(
      !STOCK_BALANCE_READ_PERMISSIONS.includes(Permission.RETURNS_WAREHOUSE)
    );
    assert.ok(
      !STOCK_BALANCE_READ_PERMISSIONS.includes(Permission.INVENTORY_VIEW)
    );
    assert.ok(
      !STOCK_BALANCE_READ_PERMISSIONS.includes(Permission.INVENTORY_ADJUST)
    );
  });
});
