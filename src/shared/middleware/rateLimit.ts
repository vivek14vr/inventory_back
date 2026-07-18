import type { NextFunction, Request, Response } from "express";
import { env } from "../../config/env.js";
import { AppError } from "../errors/AppError.js";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Periodically drop expired buckets so the map cannot grow without bound. */
const CLEANUP_INTERVAL_MS = 60_000;
let lastCleanup = Date.now();

function cleanupExpired(now: number): void {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitOptions = {
  windowMs: number;
  max: number;
  /** Prefix to isolate limiters that share the same key space. */
  name: string;
  keyFn?: (req: Request) => string;
};

function defaultKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function createRateLimiter(options: RateLimitOptions) {
  return function rateLimit(req: Request, _res: Response, next: NextFunction): void {
    if (env.RATE_LIMIT_DISABLED) {
      next();
      return;
    }

    const now = Date.now();
    cleanupExpired(now);

    const identity = (options.keyFn ?? defaultKey)(req);
    const key = `${options.name}:${identity}`;
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    if (bucket.count > options.max) {
      next(
        new AppError(
          429,
          "Too many requests. Please try again later.",
          "RATE_LIMITED"
        )
      );
      return;
    }

    next();
  };
}

/** Login / refresh — keyed by IP with a stricter login budget. */
export const authRateLimiter = createRateLimiter({
  name: "auth",
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_LOGIN,
});

const apiLimiterInner = createRateLimiter({
  name: "api",
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_AUTHENTICATED,
});

/** General API traffic — keyed by IP (user is not available until authenticate). */
export function apiRateLimiter(req: Request, res: Response, next: NextFunction): void {
  // Health probes must not consume or trip the general budget.
  if (req.path === "/health" || req.path.endsWith("/health")) {
    next();
    return;
  }
  apiLimiterInner(req, res, next);
}
