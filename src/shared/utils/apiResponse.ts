import type { Response } from "express";

export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode = 200,
  meta?: Record<string, unknown>
): void {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const candidate = data as { id?: unknown; _id?: unknown };
    const id = candidate.id ?? candidate._id;
    if (typeof id === "string") {
      res.locals.auditResponseEntityId = id;
    }
  }
  res.status(statusCode).json({
    success: true,
    data,
    ...(meta && { meta }),
  });
}
