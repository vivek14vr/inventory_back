import "dotenv/config";
import mongoose from "mongoose";
import { User } from "../models/User.js";

async function main() {
  const uri = process.env.MONGODB_URI ?? "(not set)";
  console.log("MONGODB_URI:", uri);

  await mongoose.connect(process.env.MONGODB_URI!);
  console.log("Connected DB name:", mongoose.connection.db?.databaseName);

  const users = await User.find().select("email role isActive name").lean();
  console.log("Users count:", users.length);
  console.log(JSON.stringify(users, null, 2));

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
