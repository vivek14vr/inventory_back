import { Router } from "express";
import mongoose from "mongoose";
import { sendSuccess } from "../../shared/utils/apiResponse.js";

const router = Router();

router.get("/", (_req, res) => {
  sendSuccess(res, {
    status: "ok",
    timestamp: new Date().toISOString(),
    database:
      mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  });
});

export const healthRoutes = router;
