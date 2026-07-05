import type { Response } from "express";
import { env } from "../../config/env.js";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from "../constants/auth.js";
import { parseDurationToSeconds } from "./duration.js";

function cookieBaseOptions() {
  const secure = env.NODE_ENV === "production" || env.AUTH_COOKIE_SECURE;
  return {
    secure,
    sameSite: env.AUTH_COOKIE_SAME_SITE,
    path: "/",
  } as const;
}

export function setAccessTokenCookie(res: Response, accessToken: string): void {
  const maxAge = parseDurationToSeconds(env.JWT_ACCESS_EXPIRES_IN) * 1000;
  res.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
    ...cookieBaseOptions(),
    httpOnly: false,
    maxAge,
  });
}

export function setRefreshTokenCookie(res: Response, refreshToken: string): void {
  const maxAge = parseDurationToSeconds(env.JWT_REFRESH_EXPIRES_IN) * 1000;
  res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
    ...cookieBaseOptions(),
    httpOnly: true,
    maxAge,
  });
}

export function clearAuthCookies(res: Response): void {
  const opts = cookieBaseOptions();
  res.clearCookie(ACCESS_TOKEN_COOKIE, opts);
  res.clearCookie(REFRESH_TOKEN_COOKIE, opts);
}
