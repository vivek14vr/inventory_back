import { Permission } from "../../shared/constants/permissions.js";
import type { AuthUser } from "../../shared/types/auth.js";
import { hasPermission, isAdmin } from "../../shared/utils/permissions.js";

export function importReportOwnerFilter(user: AuthUser): string | undefined {
  return isAdmin(user) || hasPermission(user, Permission.AUDIT_VIEW)
    ? undefined
    : user.id;
}
