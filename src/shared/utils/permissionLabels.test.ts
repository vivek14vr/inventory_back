import assert from "node:assert/strict";
import { test } from "node:test";
import {
  diffPermissionGrants,
  formatPermissionGrantLabel,
} from "./permissionLabels.js";
import { Permission } from "../constants/permissions.js";

test("formatPermissionGrantLabel shows readable label for known code", () => {
  const label = formatPermissionGrantLabel({ code: Permission.STOCK_IN });
  assert.notEqual(label, Permission.STOCK_IN);
  assert.ok(label.length > 0);
});

test("formatPermissionGrantLabel appends warehouse name when scoped", () => {
  const names = new Map([["wh-123456", "Goregaon"]]);
  const label = formatPermissionGrantLabel(
    { code: Permission.STOCK_IN, warehouseId: "wh-123456" },
    names
  );
  assert.match(label, / · Goregaon$/);
});

test("formatPermissionGrantLabel falls back to id suffix without name map", () => {
  const label = formatPermissionGrantLabel({
    code: Permission.STOCK_IN,
    warehouseId: "abcdef123456",
  });
  assert.match(label, / · 123456$/);
});

test("diffPermissionGrants detects added and removed grants by code+warehouse", () => {
  const before = [
    { code: Permission.STOCK_IN, warehouseId: "w1" },
    { code: Permission.STOCK_VIEW },
  ];
  const after = [
    { code: Permission.STOCK_VIEW },
    { code: Permission.STOCK_OUT, warehouseId: "w1" },
  ];

  const { added, removed } = diffPermissionGrants(before, after);
  assert.equal(added.length, 1);
  assert.equal(added[0].code, Permission.STOCK_OUT);
  assert.equal(removed.length, 1);
  assert.equal(removed[0].code, Permission.STOCK_IN);
});

test("diffPermissionGrants treats same code at different warehouses as distinct", () => {
  const before = [{ code: Permission.STOCK_IN, warehouseId: "w1" }];
  const after = [{ code: Permission.STOCK_IN, warehouseId: "w2" }];

  const { added, removed } = diffPermissionGrants(before, after);
  assert.equal(added.length, 1);
  assert.equal(added[0].warehouseId, "w2");
  assert.equal(removed.length, 1);
  assert.equal(removed[0].warehouseId, "w1");
});
