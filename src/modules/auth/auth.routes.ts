import { Router } from "express";
import { AuditLog } from "../../models/AuditLog.js";
import { REFRESH_TOKEN_COOKIE } from "../../shared/constants/auth.js";
import { authenticate } from "../../shared/middleware/authenticate.js";
import { BadRequestError } from "../../shared/errors/AppError.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { sendSuccess } from "../../shared/utils/apiResponse.js";
import {
  clearAuthCookies,
  setAccessTokenCookie,
  setRefreshTokenCookie,
} from "../../shared/utils/authCookies.js";
import * as authService from "./auth.service.js";
import { loginSchema, refreshSchema } from "./auth.validation.js";

const router = Router();

function readRefreshToken(req: {
  cookies?: Record<string, string>;
  body?: { refreshToken?: string };
}): string | undefined {
  return req.cookies?.[REFRESH_TOKEN_COOKIE] ?? req.body?.refreshToken;
}

function sendAuthTokens(
  res: Parameters<typeof setAccessTokenCookie>[0],
  result: {
    accessToken: string;
    accessTokenExpiresIn: number;
    refreshToken: string;
    refreshTokenExpiresIn: number;
    user: authService.LoginResult["user"];
  }
) {
  setAccessTokenCookie(res, result.accessToken);
  setRefreshTokenCookie(res, result.refreshToken);
  sendSuccess(res, {
    accessToken: result.accessToken,
    accessTokenExpiresIn: result.accessTokenExpiresIn,
    refreshToken: result.refreshToken,
    refreshTokenExpiresIn: result.refreshTokenExpiresIn,
    token: result.accessToken,
    user: result.user,
  });
}

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid input");
    }

    const result = await authService.login(parsed.data, req);

    await AuditLog.create({
      action: "LOGIN",
      entity: "User",
      entityId: result.user.id,
      userId: result.user.id,
      metadata: { email: result.user.email },
    });

    sendAuthTokens(res, result);
  })
);

router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const parsed = refreshSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid input");
    }

    const refreshToken = readRefreshToken(req);
    if (!refreshToken) {
      throw new BadRequestError("Refresh token is required");
    }

    const result = await authService.refresh(refreshToken, req);
    sendAuthTokens(res, result);
  })
);

router.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    sendSuccess(res, req.user);
  })
);

router.post(
  "/logout",
  authenticate,
  asyncHandler(async (req, res) => {
    const refreshToken = readRefreshToken(req);
    const sessionId = req.authSessionId;

    await authService.logout(refreshToken, sessionId);

    await AuditLog.create({
      action: "LOGOUT",
      entity: "User",
      entityId: req.user!.id,
      userId: req.user!.id,
    });

    clearAuthCookies(res);
    sendSuccess(res, { message: "Logged out successfully" });
  })
);

router.post(
  "/logout-all",
  authenticate,
  asyncHandler(async (req, res) => {
    const count = await authService.logoutAllDevices(req.user!.id);

    await AuditLog.create({
      action: "LOGOUT_ALL",
      entity: "User",
      entityId: req.user!.id,
      userId: req.user!.id,
      metadata: { sessionsRevoked: count },
    });

    clearAuthCookies(res);
    sendSuccess(res, { message: "Logged out from all devices", sessionsRevoked: count });
  })
);

export const authRoutes = router;
