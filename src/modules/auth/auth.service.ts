import { User } from "../../models/User.js";
import { UnauthorizedError } from "../../shared/errors/AppError.js";
import type { AuthUser } from "../../shared/types/auth.js";
import { comparePassword } from "../../shared/utils/password.js";
import { buildAuthUser } from "../../shared/middleware/authenticate.js";
import type { LoginInput } from "./auth.validation.js";
import * as sessionService from "./session.service.js";
import type { SessionMeta } from "./session.service.js";

export type LoginResult = {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresIn: number;
  user: AuthUser;
  /** @deprecated Use accessToken */
  token: string;
};

export type RefreshResult = {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresIn: number;
  user: AuthUser;
};

function sessionMetaFromRequest(req?: {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}): SessionMeta {
  const ua = req?.headers?.["user-agent"];
  return {
    userAgent: typeof ua === "string" ? ua.slice(0, 512) : undefined,
    ipAddress: req?.ip ?? req?.socket?.remoteAddress,
  };
}

export async function login(
  input: LoginInput,
  req?: Parameters<typeof sessionMetaFromRequest>[0]
): Promise<LoginResult> {
  const user = await User.findOne({ email: input.email.toLowerCase() });

  if (!user || !user.isActive) {
    throw new UnauthorizedError("Invalid email or password");
  }

  const valid = await comparePassword(input.password, user.passwordHash);
  if (!valid) {
    throw new UnauthorizedError("Invalid email or password");
  }

  const { tokens, user: authUser } = await sessionService.createSession(
    String(user._id),
    sessionMetaFromRequest(req)
  );

  return {
    accessToken: tokens.accessToken,
    accessTokenExpiresIn: tokens.accessTokenExpiresIn,
    refreshToken: tokens.refreshToken,
    refreshTokenExpiresIn: tokens.refreshTokenExpiresIn,
    token: tokens.accessToken,
    user: authUser,
  };
}

export async function refresh(
  refreshToken: string,
  req?: Parameters<typeof sessionMetaFromRequest>[0]
): Promise<RefreshResult> {
  const { tokens, user } = await sessionService.rotateRefreshToken(
    refreshToken,
    sessionMetaFromRequest(req)
  );
  return {
    accessToken: tokens.accessToken,
    accessTokenExpiresIn: tokens.accessTokenExpiresIn,
    refreshToken: tokens.refreshToken,
    refreshTokenExpiresIn: tokens.refreshTokenExpiresIn,
    user,
  };
}

export async function logout(refreshToken?: string, sessionId?: string): Promise<void> {
  if (refreshToken) {
    await sessionService.revokeSessionByRefreshToken(refreshToken);
  }
  if (sessionId) {
    await sessionService.revokeSessionById(sessionId);
  }
}

export async function logoutAllDevices(userId: string): Promise<number> {
  return sessionService.revokeAllUserSessions(userId);
}

export async function getMe(userId: string): Promise<AuthUser> {
  const user = await buildAuthUser(userId);
  if (!user) {
    throw new UnauthorizedError("User not found or inactive");
  }
  return user;
}
