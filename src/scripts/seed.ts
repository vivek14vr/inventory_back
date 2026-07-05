import "dotenv/config";
import bcrypt from "bcryptjs";
import { connectDatabase, disconnectDatabase } from "../config/database.js";
import { Warehouse } from "../models/Warehouse.js";
import { Brand } from "../models/Brand.js";
import { Product } from "../models/Product.js";
import { User } from "../models/User.js";
import { defaultWarehouseOperatorPermissions } from "../shared/constants/permissions.js";
import { UserRole } from "../shared/constants/roles.js";
import {
  DEMO_BRANDS,
  logDemoSummary,
  seedDemoInventory,
  seedDemoMovements,
} from "./seed-demo-data.js";

async function upsertWarehouse(name: string, code: string) {
  return Warehouse.findOneAndUpdate(
    { code },
    { name, code, isActive: true },
    { upsert: true, new: true }
  );
}

async function upsertBrand(name: string) {
  return Brand.findOneAndUpdate(
    { name },
    { name, isActive: true },
    { upsert: true, new: true }
  );
}

async function upsertProduct(name: string, brandId: import("mongoose").Types.ObjectId) {
  return Product.findOneAndUpdate(
    { name, brandId },
    { name, brandId, isActive: true },
    { upsert: true, new: true }
  );
}

async function upsertUser(data: {
  email: string;
  name: string;
  password: string;
  role: (typeof UserRole)[keyof typeof UserRole];
  warehouseId?: import("mongoose").Types.ObjectId;
  permissions?: Array<{ code: string; warehouseId?: import("mongoose").Types.ObjectId }>;
}) {
  const passwordHash = await bcrypt.hash(data.password, 12);
  const permissions =
    data.role === UserRole.ADMIN
      ? []
      : (data.permissions ??
        (data.warehouseId
          ? defaultWarehouseOperatorPermissions(String(data.warehouseId)).map((p) => ({
              code: p.code,
              warehouseId: p.warehouseId,
            }))
          : []));

  return User.findOneAndUpdate(
    { email: data.email.toLowerCase() },
    {
      name: data.name,
      email: data.email.toLowerCase(),
      passwordHash,
      role: data.role,
      warehouseId: data.warehouseId,
      permissions,
      isActive: true,
    },
    { upsert: true, new: true }
  );
}

async function seed() {
  await connectDatabase();

  const vasai = await upsertWarehouse("Vasai Warehouse", "VASAI");
  const goregaon = await upsertWarehouse("Goregaon Warehouse", "GOREGAON");

  const brandIds = new Map<string, import("mongoose").Types.ObjectId>();
  for (const name of DEMO_BRANDS) {
    const brand = await upsertBrand(name);
    brandIds.set(name, brand._id);
  }

  const admin = await upsertUser({
    name: "System Admin",
    email: "admin@inventory.local",
    password: "Admin@123",
    role: UserRole.ADMIN,
  });

  const vasaiUser = await upsertUser({
    name: "Vasai User",
    email: "vasai@inventory.local",
    password: "Vasai@123",
    role: UserRole.WAREHOUSE_USER,
    warehouseId: vasai._id,
  });

  const goregaonUser = await upsertUser({
    name: "Goregaon User",
    email: "goregaon@inventory.local",
    password: "Goregaon@123",
    role: UserRole.WAREHOUSE_USER,
    warehouseId: goregaon._id,
  });

  const ctx = {
    brandIds,
    vasaiId: vasai._id,
    goregaonId: goregaon._id,
    vasaiUserId: vasaiUser._id,
    goregaonUserId: goregaonUser._id,
    adminUserId: admin._id,
  };

  const { productCount, balanceCount, productRefs } = await seedDemoInventory(
    ctx,
    upsertProduct
  );

  const movementResult = await seedDemoMovements(ctx, productRefs);

  const userCount = await User.countDocuments();

  console.log("Seed completed (safe to re-run).");
  console.log(`  Users: ${userCount}`);
  console.log(`  Demo products seeded: ${productCount}`);
  console.log(`  Inventory balance rows: ${balanceCount}`);
  if (movementResult.skipped) {
    console.log(
      `  Movements: skipped (${movementResult.existing} already in DB; delete movements to re-seed history)`
    );
  } else {
    console.log(`  Movements inserted: ${movementResult.movementsInserted}`);
    console.log(`  Total movements: ${movementResult.totalMovements}`);
    console.log(`  Transfers: ${movementResult.transfers}`);
  }
  console.log("  Login:");
  console.log("    Admin: admin@inventory.local / Admin@123");
  console.log("    Vasai: vasai@inventory.local / Vasai@123");
  console.log("    Goregaon: goregaon@inventory.local / Goregaon@123");

  await logDemoSummary();

  await disconnectDatabase();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
