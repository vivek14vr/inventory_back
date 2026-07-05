import { Types } from "mongoose";
import * as XLSX from "xlsx";
import { Brand } from "../../models/Brand.js";
import { Product } from "../../models/Product.js";
import { StockMovement } from "../../models/StockMovement.js";
import { TallyImport, type ITallyImportRow } from "../../models/TallyImport.js";
import { Warehouse } from "../../models/Warehouse.js";
import { AuditLog } from "../../models/AuditLog.js";
import { StockMovementType } from "../../shared/constants/roles.js";
import {
  BadRequestError,
  NotFoundError,
} from "../../shared/errors/AppError.js";
import type { AuthUser } from "../../shared/types/auth.js";
import { dbSession, runInTransaction } from "../../shared/utils/mongoTransaction.js";
import {
  indexProductsByBrandAndLabel,
  productBrandKey,
} from "../../shared/utils/productLookup.js";
import * as inventoryService from "../stock/inventory.service.js";

type ParsedRow = {
  productName: string;
  brandName: string;
  quantity: number;
  rowNumber: number;
};

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseExcelBuffer(buffer: Buffer): ParsedRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new BadRequestError("Excel file has no sheets");
  }

  const sheet = workbook.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
  });

  if (raw.length === 0) {
    throw new BadRequestError("Excel file has no data rows");
  }

  const first = raw[0];
  const keys = Object.keys(first);

  const productKey = keys.find((k) =>
    ["product name", "product", "item", "item name"].includes(normalizeHeader(k))
  );
  const brandKey = keys.find((k) =>
    ["brand name", "brand"].includes(normalizeHeader(k))
  );
  const qtyKey = keys.find((k) =>
    ["quantity", "qty", "qnty", "sold", "sales qty"].includes(normalizeHeader(k))
  );

  if (!productKey || !brandKey || !qtyKey) {
    throw new BadRequestError(
      "Excel must have columns: Product Name, Brand Name, and Quantity"
    );
  }

  const rows: ParsedRow[] = [];

  raw.forEach((row, index) => {
    const productName = String(row[productKey] ?? "").trim();
    const brandName = String(row[brandKey] ?? "").trim();
    const quantity = Number(row[qtyKey]);

    if (!productName && !brandName && !quantity) return;

    rows.push({
      productName,
      brandName,
      quantity,
      rowNumber: index + 2,
    });
  });

  if (rows.length === 0) {
    throw new BadRequestError("No valid data rows found in Excel file");
  }

  return rows;
}

export async function processTallyImport(
  fileBuffer: Buffer,
  fileName: string,
  warehouseId: string,
  user: AuthUser
) {
  if (!Types.ObjectId.isValid(warehouseId)) {
    throw new BadRequestError("Invalid warehouse ID");
  }

  const warehouse = await Warehouse.findOne({ _id: warehouseId, isActive: true });
  if (!warehouse) {
    throw new NotFoundError("Warehouse not found or inactive");
  }

  const parsedRows = parseExcelBuffer(fileBuffer);
  const seen = new Set<string>();
  const results: ITallyImportRow[] = [];

  const brands = await Brand.find({ isActive: true }).lean();
  const brandByName = new Map(
    brands.map((b) => [b.name.trim().toLowerCase(), b])
  );

  const products = await Product.find({ isActive: true })
    .populate("brandId", "name")
    .lean();

  const productByKey = indexProductsByBrandAndLabel(products, (p) => {
    const brand = p.brandId as unknown as { name: string };
    return brand?.name ?? "";
  });

  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const row of parsedRows) {
    const base = {
      productName: row.productName,
      brandName: row.brandName,
      quantity: row.quantity,
    };

    if (!row.productName || !row.brandName) {
      results.push({
        ...base,
        quantity: row.quantity || 0,
        status: "FAILED",
        message: "Product name and brand name are required",
      });
      failedCount++;
      continue;
    }

    if (!Number.isFinite(row.quantity) || row.quantity <= 0) {
      results.push({
        ...base,
        status: "FAILED",
        message: "Quantity must be a positive number",
      });
      failedCount++;
      continue;
    }

    const dupKey = productBrandKey(row.brandName, row.productName);
    if (seen.has(dupKey)) {
      results.push({
        ...base,
        status: "SKIPPED",
        message: "Duplicate row in file (same product + brand)",
      });
      skippedCount++;
      continue;
    }
    seen.add(dupKey);

    const brand = brandByName.get(row.brandName.trim().toLowerCase());
    if (!brand) {
      results.push({
        ...base,
        status: "FAILED",
        message: `Brand not found: "${row.brandName}"`,
      });
      failedCount++;
      continue;
    }

    const product = productByKey.get(productBrandKey(brand.name, row.productName));
    if (!product) {
      results.push({
        ...base,
        status: "FAILED",
        message: `Product not found for brand "${row.brandName}" (use primary or secondary name): "${row.productName}"`,
      });
      failedCount++;
      continue;
    }

    try {
      await runInTransaction(async (session) => {
        await inventoryService.assertSufficientStock(
          warehouseId,
          String(product._id),
          row.quantity,
          session
        );

        await inventoryService.adjustBalance(
          warehouseId,
          String(product._id),
          -row.quantity,
          session
        );

        await StockMovement.create(
          [
            {
              type: StockMovementType.STOCK_OUT,
              warehouseId,
              productId: product._id,
              brandId: brand._id,
              quantity: row.quantity,
              notes: `Tally import: ${fileName}`,
              createdBy: user.id,
            },
          ],
          dbSession(session)
        );
      });

      results.push({
        ...base,
        status: "SUCCESS",
        message: `Deducted ${row.quantity} units`,
      });
      successCount++;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed";
      results.push({
        ...base,
        status: "FAILED",
        message,
      });
      failedCount++;
    }
  }

  const tallyImport = await TallyImport.create({
    fileName,
    warehouseId,
    importedBy: user.id,
    totalRows: parsedRows.length,
    successCount,
    failedCount,
    skippedCount,
    rows: results,
  });

  await AuditLog.create({
    action: "TALLY_IMPORT",
    entity: "TallyImport",
    entityId: tallyImport._id,
    userId: user.id,
    metadata: {
      fileName,
      warehouseId,
      successCount,
      failedCount,
      skippedCount,
    },
  });

  return formatImport(tallyImport.toObject());
}

function formatImport(doc: {
  _id: Types.ObjectId;
  fileName: string;
  warehouseId: Types.ObjectId | { _id: Types.ObjectId; name: string; code: string };
  importedBy: Types.ObjectId | { _id: Types.ObjectId; name: string };
  totalRows: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  rows: ITallyImportRow[];
  createdAt: Date;
}) {
  const warehouse = doc.warehouseId as { _id: Types.ObjectId; name: string; code: string };
  const importedBy = doc.importedBy as { _id: Types.ObjectId; name: string };

  return {
    id: String(doc._id),
    fileName: doc.fileName,
    warehouse: {
      id: String(warehouse._id ?? doc.warehouseId),
      name: warehouse.name,
      code: warehouse.code,
    },
    importedBy: {
      id: String(importedBy._id ?? doc.importedBy),
      name: importedBy.name,
    },
    totalRows: doc.totalRows,
    successCount: doc.successCount,
    failedCount: doc.failedCount,
    skippedCount: doc.skippedCount,
    rows: doc.rows,
    createdAt: doc.createdAt,
  };
}

export async function listImports(limit = 50) {
  const imports = await TallyImport.find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("warehouseId", "name code")
    .populate("importedBy", "name")
    .lean();

  return imports.map((doc) => formatImport(doc as Parameters<typeof formatImport>[0]));
}

export async function getImportById(id: string) {
  if (!Types.ObjectId.isValid(id)) {
    throw new NotFoundError("Import not found");
  }

  const doc = await TallyImport.findById(id)
    .populate("warehouseId", "name code")
    .populate("importedBy", "name")
    .lean();

  if (!doc) {
    throw new NotFoundError("Import not found");
  }

  return formatImport(doc as Parameters<typeof formatImport>[0]);
}
