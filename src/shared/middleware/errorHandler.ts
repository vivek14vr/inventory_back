import type { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { AppError } from "../errors/AppError.js";
import { env } from "../../config/env.js";

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      code: err.code,
    });
    return;
  }

  if (err instanceof mongoose.Error.ValidationError) {
    const message = Object.values(err.errors)[0]?.message ?? "Validation failed";
    res.status(400).json({
      success: false,
      message,
      code: "VALIDATION_ERROR",
    });
    return;
  }

  if ((err as { code?: number }).code === 11000) {
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
    res.status(400).json({
      success: false,
      message,
      code: "UPLOAD_ERROR",
    });
    return;
  }

  console.error(err);
  res.status(500).json({
    success: false,
    message: env.NODE_ENV === "production" ? "Internal server error" : err.message,
    code: "INTERNAL_ERROR",
  });
}
