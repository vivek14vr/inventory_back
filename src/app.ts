import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import { createApiRouter } from "./routes/index.js";
import { notFoundHandler } from "./shared/middleware/notFound.js";
import { errorHandler } from "./shared/middleware/errorHandler.js";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) {
          callback(null, true);
          return;
        }
        if (env.NODE_ENV === "development") {
          const allowed =
            origin === env.CORS_ORIGIN ||
            /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
            /^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin) ||
            /^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin);
          callback(null, allowed);
          return;
        }
        callback(null, origin === env.CORS_ORIGIN);
      },
      credentials: true,
    })
  );
  app.use(morgan(env.NODE_ENV === "development" ? "dev" : "combined"));
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 500,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  app.get("/", (_req, res) => {
    res.json({
      name: "Inventory Management API",
      version: "1.0.0",
      docs: `${env.API_PREFIX}/health`,
    });
  });

  app.use(env.API_PREFIX, createApiRouter());
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
