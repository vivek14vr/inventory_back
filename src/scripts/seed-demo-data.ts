import type { Types } from "mongoose";
import { InventoryBalance } from "../models/InventoryBalance.js";
import { StockMovement } from "../models/StockMovement.js";
import { Transfer } from "../models/Transfer.js";
import { Product } from "../models/Product.js";
import {
  DispatchType,
  StockMovementType,
  TransferStatus,
} from "../shared/constants/roles.js";

/** Disposal / food-service product catalog (Product + Brand per SOW) */
export const DEMO_BRANDS = [
  "EcoServe",
  "GreenPack",
  "PrimeWare",
  "FreshServe",
  "ClearCup",
  "BioDine",
  "MetroPack",
  "UrbanServe",
] as const;

export const DEMO_PRODUCTS: { brand: (typeof DEMO_BRANDS)[number]; name: string }[] = [
  { brand: "EcoServe", name: "Paper Cup 200ml" },
  { brand: "EcoServe", name: "Paper Cup 250ml" },
  { brand: "EcoServe", name: "Paper Cup 300ml" },
  { brand: "EcoServe", name: "Paper Bowl 500ml" },
  { brand: "EcoServe", name: "Paper Plate 9 inch" },
  { brand: "EcoServe", name: "Paper Plate 12 inch" },
  { brand: "EcoServe", name: "Kraft Lunch Box Small" },
  { brand: "GreenPack", name: "PLA Spoon White" },
  { brand: "GreenPack", name: "PLA Fork White" },
  { brand: "GreenPack", name: "PLA Knife White" },
  { brand: "GreenPack", name: "Wooden Spoon 160mm" },
  { brand: "GreenPack", name: "Wooden Fork 160mm" },
  { brand: "GreenPack", name: "Wooden Stirrer 140mm" },
  { brand: "GreenPack", name: "Bamboo Skewer 6 inch" },
  { brand: "PrimeWare", name: "Plastic Spoon Medium" },
  { brand: "PrimeWare", name: "Plastic Spoon Heavy" },
  { brand: "PrimeWare", name: "Plastic Fork Medium" },
  { brand: "PrimeWare", name: "Plastic Knife Medium" },
  { brand: "PrimeWare", name: "Plastic Straw 8mm" },
  { brand: "PrimeWare", name: "Plastic Straw 12mm" },
  { brand: "PrimeWare", name: "Sauce Cup 2oz" },
  { brand: "FreshServe", name: "Aluminium Foil Roll 72m" },
  { brand: "FreshServe", name: "Cling Film Roll 30cm" },
  { brand: "FreshServe", name: "Baking Paper Sheet Pack" },
  { brand: "FreshServe", name: "Greaseproof Sheet 12x12" },
  { brand: "FreshServe", name: "Napkin 1 Ply White" },
  { brand: "FreshServe", name: "Napkin 2 Ply White" },
  { brand: "FreshServe", name: "Tissue Box 100 pulls" },
  { brand: "ClearCup", name: "PET Cup 300ml" },
  { brand: "ClearCup", name: "PET Cup 400ml" },
  { brand: "ClearCup", name: "PET Cup 500ml" },
  { brand: "ClearCup", name: "PET Lid Flat 300ml" },
  { brand: "ClearCup", name: "PET Lid Dome 400ml" },
  { brand: "ClearCup", name: "PP Container 500ml" },
  { brand: "ClearCup", name: "PP Container 750ml" },
  { brand: "BioDine", name: "Bagasse Plate 10 inch" },
  { brand: "BioDine", name: "Bagasse Bowl 500ml" },
  { brand: "BioDine", name: "Bagasse Clamshell Medium" },
  { brand: "BioDine", name: "Bagasse Tray Large" },
  { brand: "BioDine", name: "Cornstarch Spoon" },
  { brand: "BioDine", name: "Cornstarch Fork" },
  { brand: "MetroPack", name: "Garbage Bag Small Black" },
  { brand: "MetroPack", name: "Garbage Bag Large Black" },
  { brand: "MetroPack", name: "Carry Bag HDPE Small" },
  { brand: "MetroPack", name: "Carry Bag HDPE Large" },
  { brand: "MetroPack", name: "Zip Lock Bag 6x8" },
  { brand: "MetroPack", name: "Zip Lock Bag 8x10" },
  { brand: "UrbanServe", name: "Thermal Paper Roll 80mm" },
  { brand: "UrbanServe", name: "Thermal Paper Roll 58mm" },
  { brand: "UrbanServe", name: "Label Sticker Roll 50x30" },
  { brand: "UrbanServe", name: "Gloves Nitrile M Box" },
  { brand: "UrbanServe", name: "Gloves Nitrile L Box" },
  { brand: "UrbanServe", name: "Hair Net Pack 100" },
  { brand: "UrbanServe", name: "Apron Disposable Pack" },
];

const DEMO_CLIENTS = [
  "Shree Catering",
  "Mumbai Biryani House",
  "Green Leaf Restaurant",
  "Office Pantry Solutions",
  "Railway Canteen Supplies",
  "Hospital Food Services",
  "School Meal Program",
  "Event Planners India",
];

function demoQuantity(productIndex: number, warehouseIndex: number): number {
  if (productIndex % 9 === 0) {
    return (productIndex % 7) + 3;
  }
  if (productIndex % 13 === 0) {
    return 0;
  }
  return ((productIndex * 37 + warehouseIndex * 53) % 480) + 12;
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(9 + (days % 8), (days * 11) % 60, 0, 0);
  return d;
}

type SeedContext = {
  brandIds: Map<string, Types.ObjectId>;
  vasaiId: Types.ObjectId;
  goregaonId: Types.ObjectId;
  vasaiUserId: Types.ObjectId;
  goregaonUserId: Types.ObjectId;
  adminUserId: Types.ObjectId;
};

export async function seedDemoInventory(
  ctx: SeedContext,
  upsertProduct: (
    name: string,
    brandId: Types.ObjectId
  ) => Promise<{ _id: Types.ObjectId }>
) {
  const productRefs: {
    productId: Types.ObjectId;
    brandId: Types.ObjectId;
    name: string;
  }[] = [];

  for (const item of DEMO_PRODUCTS) {
    const brandId = ctx.brandIds.get(item.brand);
    if (!brandId) continue;
    const product = await upsertProduct(item.name, brandId);
    productRefs.push({
      productId: product._id,
      brandId,
      name: item.name,
    });
  }

  let balanceCount = 0;
  let zeroSkipped = 0;

  for (let i = 0; i < productRefs.length; i++) {
    const ref = productRefs[i];
    for (const [whIndex, warehouseId] of [
      [0, ctx.vasaiId],
      [1, ctx.goregaonId],
    ] as const) {
      const qty = demoQuantity(i, whIndex);
      if (qty <= 0) {
        zeroSkipped++;
        continue;
      }
      await InventoryBalance.findOneAndUpdate(
        { warehouseId, productId: ref.productId },
        { $set: { quantity: qty } },
        { upsert: true }
      );
      balanceCount++;
    }
  }

  return {
    productCount: productRefs.length,
    balanceCount,
    zeroSkipped,
    productRefs,
  };
}

export async function seedDemoMovements(
  ctx: SeedContext,
  productRefs: {
    productId: Types.ObjectId;
    brandId: Types.ObjectId;
    name: string;
  }[]
) {
  const existing = await StockMovement.countDocuments();
  if (existing >= 50) {
    return { skipped: true, existing };
  }

  const movements: Record<string, unknown>[] = [];

  for (let i = 0; i < 65; i++) {
    const ref = productRefs[i % productRefs.length];
    const isVasai = i % 2 === 0;
    const warehouseId = isVasai ? ctx.vasaiId : ctx.goregaonId;
    const userId = isVasai ? ctx.vasaiUserId : ctx.goregaonUserId;
    const isStockIn = i % 3 !== 0;
    const qty = 10 + (i % 45);
    const createdAt = daysAgo(Math.floor(i / 3));

    if (isStockIn) {
      movements.push({
        type: StockMovementType.STOCK_IN,
        warehouseId,
        productId: ref.productId,
        brandId: ref.brandId,
        quantity: qty,
        notes: i % 5 === 0 ? "Seed: purchase receipt" : undefined,
        createdBy: userId,
        createdAt,
      });
    } else if (i % 5 === 0) {
      movements.push({
        type: StockMovementType.STOCK_OUT,
        warehouseId,
        productId: ref.productId,
        brandId: ref.brandId,
        quantity: Math.min(qty, 25),
        dispatchType: DispatchType.DIRECT_SELLING,
        clientName: DEMO_CLIENTS[i % DEMO_CLIENTS.length],
        invoiceNumber: `INV-${2026}-${1000 + i}`,
        createdBy: userId,
        createdAt,
      });
    } else {
      movements.push({
        type: StockMovementType.STOCK_OUT,
        warehouseId: ctx.vasaiId,
        productId: ref.productId,
        brandId: ref.brandId,
        quantity: Math.min(qty, 30),
        dispatchType: DispatchType.TRANSFER,
        destinationWarehouseId: ctx.goregaonId,
        notes: "Seed: inter-warehouse transfer",
        createdBy: ctx.vasaiUserId,
        createdAt,
      });
    }
  }

  await StockMovement.insertMany(movements);

  const transferExisting = await Transfer.countDocuments();
  if (transferExisting < 5) {
    const transferMovements = await StockMovement.find({
      dispatchType: DispatchType.TRANSFER,
    })
      .sort({ createdAt: -1 })
      .limit(12)
      .lean();

    const transfers = [];
    for (let t = 0; t < transferMovements.length; t++) {
      const m = transferMovements[t];
      const received = t % 3 !== 0;
      transfers.push({
        sourceWarehouseId: m.warehouseId,
        destinationWarehouseId: m.destinationWarehouseId!,
        productId: m.productId,
        brandId: m.brandId,
        quantity: m.quantity,
        status: received ? TransferStatus.RECEIVED : TransferStatus.PENDING,
        stockOutMovementId: m._id,
        createdBy: m.createdBy,
        ...(received
          ? {
              receivedBy: ctx.goregaonUserId,
              receivedAt: daysAgo(t % 5),
            }
          : {}),
        createdAt: m.createdAt,
      });
    }
    if (transfers.length > 0) {
      await Transfer.insertMany(transfers);
    }
  }

  return {
    skipped: false,
    movementsInserted: movements.length,
    totalMovements: await StockMovement.countDocuments(),
    transfers: await Transfer.countDocuments(),
  };
}

export async function logDemoSummary() {
  const [products, brands, balances, movements, transfers, lowStock] =
    await Promise.all([
      Product.countDocuments({ isActive: true }),
      import("../models/Brand.js").then((m) => m.Brand.countDocuments({ isActive: true })),
      InventoryBalance.countDocuments({ quantity: { $gt: 0 } }),
      StockMovement.countDocuments(),
      Transfer.countDocuments(),
      InventoryBalance.countDocuments({ quantity: { $gt: 0, $lte: 10 } }),
    ]);

  console.log("  Demo data summary:");
  console.log(`    Brands: ${brands}`);
  console.log(`    Products: ${products}`);
  console.log(`    Stock rows (qty > 0): ${balances}`);
  console.log(`    Low-stock rows (≤10): ${lowStock}`);
  console.log(`    Stock movements: ${movements}`);
  console.log(`    Transfers: ${transfers}`);
}
