import type { Request, Response, NextFunction } from "express";
import type { UserRoleType } from "../constants/roles.js";
import { ForbiddenError, UnauthorizedError } from "../errors/AppError.js";

export function authorize(...roles: UserRoleType[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }

    if (!roles.includes(req.user.role)) {
      next(new ForbiddenError("You do not have permission to access this resource"));
      return;
    }

    next();
  };
}
