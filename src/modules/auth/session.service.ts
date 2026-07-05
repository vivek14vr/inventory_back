import crypto from "node:crypto";
import { Types } from "mongoose";
import { RefreshSession } from "../../models/RefreshSession.js";
import { UnauthorizedError } from "../../shared/errors/AppError.js";
import { UserRole } from "../../shared/constants/roles.js";
import { encodePermissionsForJwt } from "../../shared/utils/permissions.js";
import { parseDurationToSeconds } from "../../shared/utils/duration.js";
import { signAccessToken } from "../../shared/utils/jwt.js";
import { env } from "../../config/env.js";
import type { AuthTokens, AuthUser } from "../../shared/types/auth.js";
import { buildAuthUser } from "../../shared/middleware/authenticate.js";

export type SessionMeta = {
  userAgent?: string;
  ipAddress?: string;
};

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString("base64url");
}

function refreshExpiresAt(): Date {
  const seconds = parseDurationToSeconds(env.JWT_REFRESH_EXPIRES_IN);
  return new Date(Date.now() + seconds * 1000);
}

function accessExpiresInSeconds(): number {
  return parseDurationToSeconds(env.JWT_ACCESS_EXPIRES_IN);
}

export async function createSession(
  userId: string,
  meta: SessionMeta = {}
): Promise<{ tokens: AuthTokens; user: AuthUser; sessionId: string }> {
  const authUser = await buildAuthUser(userId);
  if (!authUser) {
    throw new UnauthorizedError("User not found or inactive");
  }

  const familyId = new Types.ObjectId();
  const refreshToken = generateRefreshToken();
  const expiresAt = refreshExpiresAt();

  const session = await RefreshSession.create({
    userId: new Types.ObjectId(userId),
    familyId,
    tokenHash: hashToken(refreshToken),
    expiresAt,
    userAgent: meta.userAgent,
    ipAddress: meta.ipAddress,
  });

  const accessToken = signAccessToken({
    sub: authUser.id,
    sid: String(session._id),
    role: authUser.role,
    warehouseId: authUser.warehouseId,
    permissions:
      authUser.role === UserRole.ADMIN
        ? undefined
        : encodePermissionsForJwt(authUser.permissions ?? []),
  });

  return {
    sessionId: String(session._id),
    user: authUser,
    tokens: {
      accessToken,
      accessTokenExpiresIn: accessExpiresInSeconds(),
      refreshToken,
      refreshTokenExpiresIn: parseDurationToSeconds(env.JWT_REFRESH_EXPIRES_IN),
    },
  };
}

export async function rotateRefreshToken(
  refreshToken: string,
  meta: SessionMeta = {}
): Promise<{ tokens: AuthTokens; user: AuthUser }> {
  const tokenHash = hashToken(refreshToken);
  const session = await RefreshSession.findOne({ tokenHash });

  if (!session) {
    throw new UnauthorizedError("Invalid refresh token");
  }

  if (session.revokedAt) {
    await RefreshSession.updateMany(
      { familyId: session.familyId, revokedAt: { $exists: false } },
      { revokedAt: new Date() }
    );
    throw new UnauthorizedError("Refresh token reuse detected — session revoked");
  }

  if (session.expiresAt.getTime() < Date.now()) {
    session.revokedAt = new Date();
    await session.save();
    throw new UnauthorizedError("Refresh token expired");
  }

  const authUser = await buildAuthUser(String(session.userId));
  if (!authUser) {
    session.revokedAt = new Date();
    await session.save();
    throw new UnauthorizedError("User not found or inactive");
  }

  const newRefreshToken = generateRefreshToken();
  const newSession = await RefreshSession.create({
    userId: session.userId,
    familyId: session.familyId,
    tokenHash: hashToken(newRefreshToken),
    expiresAt: refreshExpiresAt(),
    userAgent: meta.userAgent ?? session.userAgent,
    ipAddress: meta.ipAddress ?? session.ipAddress,
  });

  session.revokedAt = new Date();
  session.replacedBy = newSession._id;
  await session.save();

  const accessToken = signAccessToken({
    sub: authUser.id,
    sid: String(newSession._id),
    role: authUser.role,
    warehouseId: authUser.warehouseId,
    permissions:
      authUser.role === UserRole.ADMIN
        ? undefined
        : encodePermissionsForJwt(authUser.permissions ?? []),
  });

  return {
    user: authUser,
    tokens: {
      accessToken,
      accessTokenExpiresIn: accessExpiresInSeconds(),
      refreshToken: newRefreshToken,
      refreshTokenExpiresIn: parseDurationToSeconds(env.JWT_REFRESH_EXPIRES_IN),
    },
  };
}

export async function revokeSessionById(sessionId: string): Promise<void> {
  if (!Types.ObjectId.isValid(sessionId)) return;
  await RefreshSession.findByIdAndUpdate(sessionId, { revokedAt: new Date() });
}

export async function revokeSessionByRefreshToken(refreshToken: string): Promise<void> {
  const tokenHash = hashToken(refreshToken);
  await RefreshSession.findOneAndUpdate(
    { tokenHash },
    { revokedAt: new Date() }
  );
}

export async function revokeAllUserSessions(userId: string): Promise<number> {
  const result = await RefreshSession.updateMany(
    { userId: new Types.ObjectId(userId), revokedAt: { $exists: false } },
    { revokedAt: new Date() }
  );
  return result.modifiedCount;
}

export async function assertSessionActive(sessionId: string): Promise<void> {
  if (!Types.ObjectId.isValid(sessionId)) {
    throw new UnauthorizedError("Invalid session");
  }
  const session = await RefreshSession.findById(sessionId).lean();
  if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
    throw new UnauthorizedError("Session expired or revoked");
  }
}
