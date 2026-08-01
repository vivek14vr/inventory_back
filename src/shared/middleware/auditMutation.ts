import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { Types } from "mongoose";
import { AuditLog } from "../../models/AuditLog.js";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SENSITIVE_FIELD = /(password|passcode|token|secret|authorization|cookie|session)/i;
const OBJECT_ID_SEGMENT = /^[a-f\d]{24}$/i;
const MAX_STRING_LENGTH = 200;
const MAX_BODY_FIELDS = 30;

const ENTITY_BY_MODULE: Record<string, string> = {
  auth: "Auth",
  brands: "Brand",
  checklists: "Checklist",
  clients: "Client",
  imports: "Import",
  inventory: "Inventory",
  notifications: "Notification",
  products: "Product",
  settings: "SystemSettings",
  stock: "StockMovement",
  transfers: "Transfer",
  users: "User",
  warehouses: "Warehouse",
};

function truncate(value: string, max = MAX_STRING_LENGTH): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function summarizeAuditValue(key: string, value: unknown, depth = 0): unknown {
  if (SENSITIVE_FIELD.test(key)) return "[REDACTED]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return truncate(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return `[${value.length} item${value.length === 1 ? "" : "s"}]`;
  if (typeof value === "object") {
    if (depth >= 1) return "[object]";
    return sanitizeAuditBody(value as Record<string, unknown>, depth + 1);
  }
  return String(value);
}

export function sanitizeAuditBody(
  body: Record<string, unknown> | undefined,
  depth = 0
): Record<string, unknown> {
  if (!body) return {};
  return Object.fromEntries(
    Object.entries(body)
      .slice(0, MAX_BODY_FIELDS)
      .map(([key, value]) => [key, summarizeAuditValue(key, value, depth)])
  );
}

function pathSegments(path: string): string[] {
  return path.split("?")[0].split("/").filter(Boolean);
}

export function canonicalAuditPath(path: string): string {
  return `/${pathSegments(path)
    .map((segment) => (OBJECT_ID_SEGMENT.test(segment) ? ":id" : segment))
    .join("/")}`;
}

export function inferAuditEntity(path: string): string {
  const segments = pathSegments(path);
  const moduleName = segments.find((segment) => segment in ENTITY_BY_MODULE) ?? "system";
  if (moduleName === "inventory" && segments.includes("movements")) {
    return "StockMovement";
  }
  return ENTITY_BY_MODULE[moduleName] ?? "System";
}

export function inferAuditEntityId(path: string): Types.ObjectId | undefined {
  const id = pathSegments(path).find((segment) => OBJECT_ID_SEGMENT.test(segment));
  return id ? new Types.ObjectId(id) : undefined;
}

function mutationOperation(method: string): "CREATE" | "UPDATE" | "DELETE" | "ACTION" {
  if (method === "DELETE") return "DELETE";
  if (method === "PATCH" || method === "PUT") return "UPDATE";
  if (method === "POST") return "CREATE";
  return "ACTION";
}

export function auditMutationTrail(req: Request, res: Response, next: NextFunction): void {
  if (!MUTATION_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }

  const startedAt = Date.now();
  const requestIdHeader = req.header("x-request-id");
  const requestId =
    requestIdHeader && requestIdHeader.length <= 100 ? requestIdHeader : randomUUID();
  req.auditRequestId = requestId;
  res.setHeader("x-request-id", requestId);

  res.once("finish", () => {
    const succeeded = res.statusCode >= 200 && res.statusCode < 400;
    const originalPath = req.originalUrl.split("?")[0];
    const body =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : undefined;
    const file = (req as Request & {
      file?: { originalname?: string; size?: number; mimetype?: string };
    }).file;
    const user = req.user;
    const pathEntityId = inferAuditEntityId(originalPath);
    const responseEntityId =
      typeof res.locals.auditResponseEntityId === "string" &&
      Types.ObjectId.isValid(res.locals.auditResponseEntityId)
        ? new Types.ObjectId(res.locals.auditResponseEntityId)
        : undefined;
    const entityId = pathEntityId ?? responseEntityId;

    void AuditLog.create({
      action: succeeded ? "SYSTEM_CHANGE" : "SYSTEM_CHANGE_FAILED",
      entity: inferAuditEntity(originalPath),
      entityId,
      userId: user?.id && Types.ObjectId.isValid(user.id) ? user.id : undefined,
      source: "API",
      outcome: succeeded ? "SUCCESS" : "FAILURE",
      requestId,
      metadata: {
        operation: mutationOperation(req.method.toUpperCase()),
        method: req.method.toUpperCase(),
        route: canonicalAuditPath(originalPath),
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        changedFields: body ? Object.keys(body).slice(0, MAX_BODY_FIELDS) : [],
        changes: sanitizeAuditBody(body),
        targetId: entityId?.toString(),
        actorName: user?.name,
        actorEmail: user?.email,
        actorRole: user?.role,
        ipAddress: req.ip,
        userAgent: truncate(req.get("user-agent") ?? "", 300) || undefined,
        file: file
          ? {
              name: file.originalname ? truncate(file.originalname) : undefined,
              size: file.size,
              type: file.mimetype,
            }
          : undefined,
        errorCode: res.locals.auditErrorCode,
        errorMessage: res.locals.auditErrorMessage,
      },
    }).catch((error) => {
      console.error("[audit] Failed to persist mutation audit", error);
    });
  });

  next();
}
