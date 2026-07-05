import type { ACCESS_TOKEN_TYPE } from "../constants/auth.js";
import type { PermissionGrant } from "../constants/permissions.js";
import type { UserRoleType } from "../constants/roles.js";

/** Short-lived access token claims (JWT). */
export type AccessTokenPayload = {
  sub: string;
  sid: string;
  type: typeof ACCESS_TOKEN_TYPE;
  role: UserRoleType;
  warehouseId?: string;
  permissions?: string[];
};

/** @deprecated Use AccessTokenPayload */
export type JwtPayload = AccessTokenPayload;

export type AuthTokens = {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresIn: number;
};

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: UserRoleType;
  warehouseId?: string;
  warehouse?: { id: string; name: string; code: string };
  permissions?: PermissionGrant[];
  isActive: boolean;
};
