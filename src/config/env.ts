import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(4000),
  API_PREFIX: z.string().default("/api/v1"),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  /** @deprecated Use JWT_ACCESS_EXPIRES_IN */
  JWT_EXPIRES_IN: z.string().optional(),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("30d"),
  AUTH_COOKIE_SECURE: z.coerce.boolean().default(false),
  AUTH_COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  /** Rate limit window in ms (default 15 minutes). */
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(60_000).default(900_000),
  /** Max requests per window for authenticated users (JWT). */
  RATE_LIMIT_MAX_AUTHENTICATED: z.coerce.number().int().min(100).default(20_000),
  /** Max requests per window per IP for login / unauthenticated traffic. */
  RATE_LIMIT_MAX_ANONYMOUS: z.coerce.number().int().min(50).default(1_000),
  /** Set to "true" to disable API rate limiting (not recommended in production). */
  RATE_LIMIT_DISABLED: z.coerce.boolean().default(false),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse({
    ...process.env,
    JWT_ACCESS_EXPIRES_IN:
      process.env.JWT_ACCESS_EXPIRES_IN ?? process.env.JWT_EXPIRES_IN ?? "15m",
  });
  if (!parsed.success) {
    console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
