import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Permission } from "../constants/permissions.js";
import { UserRole } from "../constants/roles.js";
import type { AuthUser } from "../types/auth.js";
import {
  hasPermission,
  hasPermissionSomewhere,
} from "./permissions.js";

function staff(grants: AuthUser["permissions"]): AuthUser {
  return {
    id: "u1",
    name: "Staff",
    email: "staff@example.com",
    role: UserRole.WAREHOUSE_USER,
    permissions: grants,
    isActive: true,
  };
}

describe("hasPermission warehouse scoping", () => {
  it("fails closed for scoped permissions without warehouseId", () => {
    const user = staff([
      { code: Permission.STOCK_OUT, warehouseId: "wh-1" },
    ]);
    assert.equal(hasPermission(user, Permission.STOCK_OUT), false);
    assert.equal(hasPermission(user, Permission.STOCK_OUT, "wh-2"), false);
    assert.equal(hasPermission(user, Permission.STOCK_OUT, "wh-1"), true);
  });

  it("hasPermissionSomewhere allows any-warehouse checks", () => {
    const user = staff([
      { code: Permission.STOCK_VIEW, warehouseId: "wh-1" },
    ]);
    assert.equal(hasPermissionSomewhere(user, Permission.STOCK_VIEW), true);
    assert.equal(hasPermissionSomewhere(user, Permission.STOCK_OUT), false);
  });

  it("global permissions ignore warehouseId", () => {
    const user = staff([{ code: Permission.REPORTS_VIEW }]);
    assert.equal(hasPermission(user, Permission.REPORTS_VIEW), true);
    assert.equal(hasPermission(user, Permission.REPORTS_VIEW, "wh-1"), true);
  });
});
