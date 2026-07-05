import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../../config/env.js";
import { ACCESS_TOKEN_TYPE } from "../constants/auth.js";
import type { AccessTokenPayload } from "../types/auth.js";
import { UnauthorizedError } from "../errors/AppError.js";

export function signAccessToken(payload: Omit<AccessTokenPayload, "type">): string {
  const options: SignOptions = {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as SignOptions["expiresIn"],
  };
  return jwt.sign({ ...payload, type: ACCESS_TOKEN_TYPE }, env.JWT_SECRET, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as AccessTokenPayload;
    if (payload.type !== ACCESS_TOKEN_TYPE) {
      throw new UnauthorizedError("Invalid token type");
    }
    return payload;
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    throw new UnauthorizedError("Invalid or expired access token");
  }
}

/** @deprecated Use signAccessToken */
export function signToken(payload: Omit<AccessTokenPayload, "type" | "sid"> & { sid?: string }): string {
  return signAccessToken({
    sub: payload.sub,
    sid: payload.sid ?? payload.sub,
    role: payload.role,
    warehouseId: payload.warehouseId,
    permissions: payload.permissions,
  });
}

/** @deprecated Use verifyAccessToken */
export function verifyToken(token: string): AccessTokenPayload {
  return verifyAccessToken(token);
}
