/**
 * Create or update the production admin user (no demo data).
 * Usage:
 *   npm run create-admin -w backend
 *   npm run create-admin -w backend -- admin@example.com 'YourSecurePass1'
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run create-admin -w backend
 */
import "dotenv/config";
import { connectDatabase, disconnectDatabase } from "../config/database.js";
import { User } from "../models/User.js";
import { UserRole } from "../shared/constants/roles.js";
import { hashPassword, validatePasswordStrength } from "../shared/utils/password.js";

const email = process.argv[2] ?? process.env.ADMIN_EMAIL ?? "admin@inventory.local";
const password = process.argv[3] ?? process.env.ADMIN_PASSWORD;

async function main() {
  if (!password) {
    console.error(
      "Provide a password via argument, ADMIN_PASSWORD env, or run:\n" +
        "  npm run create-admin -w backend -- admin@example.com 'YourSecurePass1'"
    );
    process.exit(1);
  }

  validatePasswordStrength(password);

  await connectDatabase();

  const passwordHash = await hashPassword(password);
  const user = await User.findOneAndUpdate(
    { email: email.toLowerCase() },
    {
      name: "System Admin",
      email: email.toLowerCase(),
      passwordHash,
      role: UserRole.ADMIN,
      permissions: [],
      isActive: true,
    },
    { upsert: true, new: true }
  );

  console.log(`Admin ready: ${user.email}`);
  await disconnectDatabase();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
