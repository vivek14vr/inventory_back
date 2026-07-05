import bcrypt from "bcryptjs";
import { BadRequestError } from "../errors/AppError.js";

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(
  password: string,
  passwordHash: string
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export function validatePasswordStrength(password: string): void {
  if (password.length < 8) {
    throw new BadRequestError("Password must be at least 8 characters");
  }
  if (!/[A-Z]/.test(password)) {
    throw new BadRequestError("Password must contain at least one uppercase letter");
  }
  if (!/[a-z]/.test(password)) {
    throw new BadRequestError("Password must contain at least one lowercase letter");
  }
  if (!/[0-9]/.test(password)) {
    throw new BadRequestError("Password must contain at least one number");
  }
}
