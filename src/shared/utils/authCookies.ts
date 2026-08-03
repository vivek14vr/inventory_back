import type { Response } from "express";
import { env } from "../../config/env.js";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from "../constants/auth.js";
import { resolveAuthCookieBaseOptions } from "./authCookieOptions.js";
import { parseDurationToSeconds } from "./duration.js";

function cookieBaseOptions() {
  return resolveAuthCookieBaseOptions(env);
}

export function setAccessTokenCookie(res: Response, accessToken: string): void {
  // Cookie must outlive the JWT so Next.js middleware can still see an expired
  // access token and let the client refresh instead of forcing logout.
  const maxAge = parseDurationToSeconds(env.JWT_REFRESH_EXPIRES_IN) * 1000;
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
