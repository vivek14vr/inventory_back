import assert from "node:assert/strict";
import test from "node:test";
import {
  Permission,
  defaultWarehouseOperatorPermissions,
  isWarehouseScopedPermission,
} from "./permissions.js";

test("default warehouse operator grants scope only warehouse-scoped permissions", () => {
  const grants = defaultWarehouseOperatorPermissions("warehouse-1");

  for (const grant of grants) {
    if (isWarehouseScopedPermission(grant.code)) {
      assert.equal(grant.warehouseId, "warehouse-1");
    } else {
      assert.equal(grant.warehouseId, undefined);
    }
  }

  assert.deepEqual(
    grants.map((grant) => grant.code),
    [
      Permission.DASHBOARD_VIEW,
      Permission.STOCK_VIEW,
      Permission.STOCK_IN,
      Permission.STOCK_OUT,
      Permission.TRANSFERS_VIEW,
      Permission.TRANSFERS_RECEIVE,
      Permission.CHECKLISTS_COMPLETE,
    ]
  );
});
