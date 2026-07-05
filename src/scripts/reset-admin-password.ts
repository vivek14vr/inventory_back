/**
 * Reset admin@inventory.local password (default: Admin@123).
 * Usage: npm run reset-admin -w backend
 */
import "dotenv/config";
import { connectDatabase, disconnectDatabase } from "../config/database.js";
import { User } from "../models/User.js";
import { hashPassword } from "../shared/utils/password.js";

const email = process.argv[2] ?? "admin@inventory.local";
const password = process.argv[3] ?? "Admin@123";

async function main() {
  await connectDatabase();
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    console.error(`No user found for ${email}`);
    process.exit(1);
  }
  user.passwordHash = await hashPassword(password);
  user.isActive = true;
  await user.save();
  console.log(`Password reset for ${email}`);
  await disconnectDatabase();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
