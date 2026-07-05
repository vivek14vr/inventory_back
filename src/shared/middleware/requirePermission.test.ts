import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import { Permission } from "../constants/permissions.js";
import { UserRole } from "../constants/roles.js";
import { BadRequestError } from "../errors/AppError.js";
import { requirePermission } from "./requirePermission.js";

function requestWithUser(query: Record<string, string> = {}): Request {
  return {
    query,
    body: {},
    user: {
      id: "user-1",
      name: "Staff",
      email: "staff@example.com",
      role: UserRole.WAREHOUSE_USER,
      permissions: [{ code: Permission.STOCK_VIEW, warehouseId: "warehouse-1" }],
      isActive: true,
    },
  } as unknown as Request;
}

function run(
  middleware: ReturnType<typeof requirePermission>,
  request: Request
): unknown {
  let nextArg: unknown;
  const next: NextFunction = (arg?: unknown) => {
    nextArg = arg;
  };
  middleware(request, {} as Response, next);
  return nextArg;
}

test("warehouse-scoped permission requires warehouse id by default", () => {
  const err = run(
    requirePermission(Permission.STOCK_VIEW, { warehouseIdFrom: "query" }),
    requestWithUser()
  );

  assert.ok(err instanceof BadRequestError);
  assert.equal(err.message, "warehouseId is required");
});

test("warehouse-scoped permission can intentionally allow service-level scoping", () => {
  const err = run(
    requirePermission(Permission.STOCK_VIEW, {
      warehouseIdFrom: "query",
      allowScopedWithoutWarehouseId: true,
    }),
    requestWithUser()
  );

  assert.equal(err, undefined);
});

test("warehouse-scoped permission validates explicit warehouse access", () => {
  assert.throws(
    () =>
      run(
        requirePermission(Permission.STOCK_VIEW, { warehouseIdFrom: "query" }),
        requestWithUser({ warehouseId: "warehouse-2" })
      ),
    /You do not have permission to perform this action/
  );
});
