import type { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { ZodError } from "zod";
import { AppError } from "../errors/AppError.js";
import { env } from "../../config/env.js";

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.locals.auditErrorCode = err.code;
    res.locals.auditErrorMessage = err.message;
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      code: err.code,
    });
    return;
  }

  if (err instanceof ZodError) {
    const message = err.issues[0]?.message ?? "Validation failed";
    res.locals.auditErrorCode = "VALIDATION_ERROR";
    res.locals.auditErrorMessage = message;
    res.status(400).json({
      success: false,
      message,
      code: "VALIDATION_ERROR",
    });
    return;
  }

  if (err instanceof mongoose.Error.ValidationError) {
    const message = Object.values(err.errors)[0]?.message ?? "Validation failed";
    res.locals.auditErrorCode = "VALIDATION_ERROR";
    res.locals.auditErrorMessage = message;
    res.status(400).json({
      success: false,
      message,
      code: "VALIDATION_ERROR",
    });
    return;
  }

  if (err instanceof mongoose.Error.CastError) {
    res.locals.auditErrorCode = "VALIDATION_ERROR";
    res.locals.auditErrorMessage = `Invalid ${err.path || "value"}`;
    res.status(400).json({
      success: false,
      message: `Invalid ${err.path || "value"}`,
      code: "VALIDATION_ERROR",
    });
    return;
  }

  if ((err as { code?: number }).code === 11000) {
    res.locals.auditErrorCode = "DUPLICATE";
    res.locals.auditErrorMessage = "Duplicate record — this value already exists";
    res.status(400).json({
      success: false,
      message: "Duplicate record — this value already exists",
      code: "DUPLICATE",
    });
    return;
  }

  if (err.name === "MulterError") {
    const multerErr = err as { code?: string };
    const message =
      multerErr.code === "LIMIT_FILE_SIZE"
        ? "File is too large (max 10MB)"
        : "File upload failed";
    res.locals.auditErrorCode = "UPLOAD_ERROR";
    res.locals.auditErrorMessage = message;
    res.status(400).json({
      success: false,
      message,
      code: "UPLOAD_ERROR",
    });
    return;
  }

  console.error(err);
  res.locals.auditErrorCode = "INTERNAL_ERROR";
  res.locals.auditErrorMessage =
    env.NODE_ENV === "production" ? "Internal server error" : err.message;
  res.status(500).json({
    success: false,
    message: env.NODE_ENV === "production" ? "Internal server error" : err.message,
    code: "INTERNAL_ERROR",
  });
}
