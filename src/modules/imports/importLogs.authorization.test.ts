import assert from "node:assert/strict";
import test from "node:test";
import { Permission } from "../../shared/constants/permissions.js";
import { UserRole } from "../../shared/constants/roles.js";
import type { AuthUser } from "../../shared/types/auth.js";
import { importReportOwnerFilter } from "./importLogs.authorization.js";

function user(overrides: Partial<AuthUser>): AuthUser {
  return {
    id: "user-1",
    name: "User",
    email: "user@example.com",
    role: UserRole.WAREHOUSE_USER,
    isActive: true,
    ...overrides,
  };
}

test("admin and audit users retain access to all import reports", () => {
  assert.equal(
    importReportOwnerFilter(user({ role: UserRole.ADMIN })),
    undefined
  );
  assert.equal(
    importReportOwnerFilter(
      user({ permissions: [{ code: Permission.AUDIT_VIEW }] })
    ),
    undefined
  );
});

test("warehouse importers are restricted to their own reports", () => {
  assert.equal(
    importReportOwnerFilter(
      user({
        permissions: [
          { code: Permission.IMPORTS_SALES, warehouseId: "warehouse-1" },
        ],
      })
    ),
    "user-1"
  );
});
