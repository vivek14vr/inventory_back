import { Types } from "mongoose";
import * as XLSX from "xlsx";
import { AuditLog } from "../../models/AuditLog.js";
import { Brand } from "../../models/Brand.js";
import { Product } from "../../models/Product.js";
import { Warehouse } from "../../models/Warehouse.js";
import { BadRequestError, NotFoundError } from "../../shared/errors/AppError.js";
import type { AuthUser } from "../../shared/types/auth.js";
import { normalizeProductName } from "../../shared/utils/productName.js";
import { findProductByBrandLabelOverlap } from "../../shared/utils/productLookup.js";
import { createBrand } from "../brands/brands.service.js";
import { createProduct, updateProduct } from "../products/products.service.js";
import {
  ensureProductBalancesForAllWarehouses,
  updateProductWarehouseThresholds,
} from "../inventory/inventory.service.js";
import {
  defaultLowStockThresholdBase,
  resolveLowStockThresholdWithDefault,
} from "../../shared/constants/lowStockDefaults.js";
import type { ProductImportConfirmInput } from "./imports.validation.js";

export type WarehouseLowStockImportEntry = {
  warehouseName: string;
  warehouseId?: string;
  lowStockThreshold: number;
};

export type ParsedProductImportRow = {
  rowNumber: number;
  brandName: string;
  primaryName: string;
  secondaryName?: string;
  baseUnit: string;
  unitsPerStockUnit: number;
  /** @deprecated Per-warehouse product fallback — no longer set from Excel. */
  lowStockThreshold?: number;
  /** Overall low-stock alert across all warehouses (independent of warehouse values). */
  totalLowStockThreshold?: number;
  warehouseLowStockThresholds?: WarehouseLowStockImportEntry[];
  stockUnit: string;
};

export type ProductImportPreviewRow = ParsedProductImportRow & {
  category: "matched" | "new";
  brandCategory: "matched" | "new";
  brandExists: boolean;
  brandId?: string;
  errors: string[];
  matchedBrand?: {
    id: string;
    name: string;
  };
  reactivatesBrand?: {
    id: string;
    name: string;
  };
  matchedProduct?: {
    id: string;
    name: string;
    secondaryName?: string;
    baseUnit: string;
    stockUnit: string;
    unitsPerStockUnit: number;
    lowStockThreshold?: number;
  };
  reactivatesProduct?: {
    id: string;
    name: string;
  };
};

export type ProductImportResultRow = {
  rowNumber: number;
  brandName: string;
  primaryName: string;
  secondaryName?: string;
  baseUnit?: string;
  unitsPerStockUnit?: number;
  lowStockThreshold?: number;
  warehouseLowStockThresholds?: WarehouseLowStockImportEntry[];
  brandAction?: "merge" | "create";
  mergeTargetBrandId?: string;
  status: "SUCCESS" | "FAILED";
  action: "merge" | "create";
  mergeTargetProductId?: string;
  message?: string;
  productId?: string;
};

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function findColumnKey(keys: string[], aliases: string[]): string | undefined {
  return keys.find((key) => aliases.includes(normalizeHeader(key)));
}

function parseNumericCell(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return value;
}

function resolveLowStockValue(
  unitQty: number | undefined,
  packQty: number | undefined,
  unitsPerStockUnit: number
): number | undefined {
  if (unitQty != null) {
    return Math.round(unitQty);
  }
  if (packQty != null) {
    return unitsPerStockUnit > 1
      ? Math.round(packQty * unitsPerStockUnit)
      : Math.round(packQty);
  }
  return undefined;
}

type WarehouseLowStockColumnGroup = {
  warehouseLabel: string;
  unitKey?: string;
  packKey?: string;
};

function warehouseLabelFromColumn(key: string, kind: "pack" | "unit"): string | null {
  const pattern =
    kind === "pack"
      ? /^low quantity (?:cartoon|carton|box) in (.+)$/i
      : /^low quantity (?:unit|units) in (.+)$/i;
  const match = key.trim().match(pattern);
  return match ? match[1].trim() : null;
}

function detectWarehouseLowStockColumns(keys: string[]): WarehouseLowStockColumnGroup[] {
  const byWarehouse = new Map<string, WarehouseLowStockColumnGroup>();

  for (const key of keys) {
    const packLabel = warehouseLabelFromColumn(key, "pack");
    const unitLabel = warehouseLabelFromColumn(key, "unit");

    if (packLabel) {
      const mapKey = packLabel.toLowerCase();
      const group = byWarehouse.get(mapKey) ?? { warehouseLabel: packLabel };
      group.packKey = key;
      byWarehouse.set(mapKey, group);
    } else if (unitLabel) {
      const mapKey = unitLabel.toLowerCase();
      const group = byWarehouse.get(mapKey) ?? { warehouseLabel: unitLabel };
      group.unitKey = key;
      byWarehouse.set(mapKey, group);
    }
  }

  return Array.from(byWarehouse.values());
}

function parseWarehouseLowStockThresholds(
  row: Record<string, unknown>,
  groups: WarehouseLowStockColumnGroup[],
  unitsPerStockUnit: number
): WarehouseLowStockImportEntry[] {
  const entries: WarehouseLowStockImportEntry[] = [];

  for (const group of groups) {
    const unitRaw = group.unitKey ? String(row[group.unitKey] ?? "").trim() : "";
    const packRaw = group.packKey ? String(row[group.packKey] ?? "").trim() : "";
    if (!unitRaw && !packRaw) continue;

    const threshold = resolveLowStockValue(
      parseNumericCell(unitRaw),
      parseNumericCell(packRaw),
      unitsPerStockUnit
    );
    if (threshold == null) continue;

    entries.push({
      warehouseName: group.warehouseLabel,
      lowStockThreshold: threshold,
    });
  }

  return entries;
}

function rowHasAnyValue(row: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => String(row[key] ?? "").trim() !== "");
}

export function parseProductExcelBuffer(buffer: Buffer): ParsedProductImportRow[] {
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

  const keys = Object.keys(raw[0]);
  const brandKey = findColumnKey(keys, ["brand", "brand name"]);
  const primaryKey = findColumnKey(keys, [
    "product primary",
    "product primary name",
    "primary name",
    "primary",
    "product name",
    "product",
  ]);
  const secondaryKey = findColumnKey(keys, [
    "product secondary name",
    "secondary name",
    "secondary",
    "product secondary",
  ]);
  const unitKey = findColumnKey(keys, ["unit", "base unit", "units"]);
  const unitsPerPackKey = findColumnKey(keys, [
    "units in a cartoon",
    "units in a carton",
    "units in carton",
    "units per carton",
    "units per pack",
    "units in a box",
    "units per box",
    "pieces per carton",
  ]);
  const explicitTotalLowPackKey = findColumnKey(keys, [
    "total low quantity cartoon",
    "total low quantity carton",
    "totallow quantity cartoon",
    "totallow quantity carton",
    "total low stock cartoon",
    "total low stock carton",
  ]);
  const explicitTotalLowUnitKey = findColumnKey(keys, [
    "total low quantity unit",
    "total low quantity units",
    "totallow quantity unit",
    "totallow quantity units",
    "total low stock unit",
    "total low stock units",
  ]);
  const legacyTotalLowPackKey = findColumnKey(keys, [
    "low quantity cartoon",
    "low quantity carton",
    "low stock carton",
    "low quantity box",
    "low stock box",
    "low stock",
    "low quantity",
  ]);
  const legacyTotalLowUnitKey = findColumnKey(keys, [
    "low quantity unit",
    "low quantity units",
    "low stock unit",
    "low stock units",
  ]);
  const warehouseLowStockGroups = detectWarehouseLowStockColumns(keys);
  const trackedKeys = new Set(
    [
      brandKey,
      primaryKey,
      secondaryKey,
      unitKey,
      unitsPerPackKey,
      explicitTotalLowPackKey,
      explicitTotalLowUnitKey,
      legacyTotalLowPackKey,
      legacyTotalLowUnitKey,
      ...warehouseLowStockGroups.flatMap((g) => [g.unitKey, g.packKey]),
    ].filter((key): key is string => Boolean(key))
  );

  if (!brandKey || !primaryKey || !unitKey || !unitsPerPackKey) {
    throw new BadRequestError(
      "Excel must have columns: brand, product primary name, unit, and units in a carton"
    );
  }

  const rows: ParsedProductImportRow[] = [];

  raw.forEach((row, index) => {
    const brandName = String(row[brandKey] ?? "").trim();
    const primaryName = String(row[primaryKey] ?? "").trim();
    const secondaryName = secondaryKey
      ? String(row[secondaryKey] ?? "").trim() || undefined
      : undefined;
    const rawUnit = String(row[unitKey] ?? "").trim();
    const rawUnitsPerPack = String(row[unitsPerPackKey] ?? "").trim();
    const rawTotalLowUnit = explicitTotalLowUnitKey
      ? String(row[explicitTotalLowUnitKey] ?? "").trim()
      : "";
    const rawTotalLowPack = explicitTotalLowPackKey
      ? String(row[explicitTotalLowPackKey] ?? "").trim()
      : "";
    const rawLegacyTotalLowPack = legacyTotalLowPackKey
      ? String(row[legacyTotalLowPackKey] ?? "").trim()
      : "";
    const rawLegacyTotalLowUnit = legacyTotalLowUnitKey
      ? String(row[legacyTotalLowUnitKey] ?? "").trim()
      : "";

    if (
      !brandName &&
      !primaryName &&
      !secondaryName &&
      !rawUnit &&
      !rawUnitsPerPack &&
      !rawTotalLowUnit &&
      !rawTotalLowPack &&
      !rawLegacyTotalLowPack &&
      !rawLegacyTotalLowUnit &&
      !rowHasAnyValue(row, Array.from(trackedKeys))
    ) {
      return;
    }

    const baseUnit = rawUnit || "piece";
    const unitsPerStockUnit = Number(rawUnitsPerPack);
    const per =
      Number.isFinite(unitsPerStockUnit) && unitsPerStockUnit > 0
        ? Math.round(unitsPerStockUnit)
        : 1;
    const totalLowStockThreshold =
      resolveLowStockValue(
        parseNumericCell(rawTotalLowUnit),
        parseNumericCell(rawTotalLowPack),
        per
      ) ??
      resolveLowStockValue(
        parseNumericCell(rawLegacyTotalLowUnit),
        parseNumericCell(rawLegacyTotalLowPack),
        per
      );
    const warehouseLowStockThresholds = parseWarehouseLowStockThresholds(
      row,
      warehouseLowStockGroups,
      per
    );

    const stockUnit = per > 1 ? "carton" : baseUnit;

    rows.push({
      rowNumber: index + 2,
      brandName,
      primaryName,
      secondaryName,
      baseUnit,
      unitsPerStockUnit: per,
      totalLowStockThreshold,
      warehouseLowStockThresholds:
        warehouseLowStockThresholds.length > 0 ? warehouseLowStockThresholds : undefined,
      stockUnit,
    });
  });

  if (rows.length === 0) {
    throw new BadRequestError("No valid product rows found in Excel file");
  }

  return rows;
}

function validateParsedRow(row: ParsedProductImportRow): string[] {
  const errors: string[] = [];
  if (!row.brandName) errors.push("Brand is required");
  if (!row.primaryName || row.primaryName.length < 2) {
    errors.push("Product primary name must be at least 2 characters");
  }
  if (!row.baseUnit) errors.push("Unit is required");
  if (!Number.isFinite(row.unitsPerStockUnit) || row.unitsPerStockUnit < 1) {
    errors.push("Units in a carton must be at least 1");
  }
  if (
    row.secondaryName &&
    normalizeProductName(row.secondaryName) === normalizeProductName(row.primaryName)
  ) {
    errors.push("Primary and secondary names must be different");
  }
  return errors;
}

function resolveWarehouseImportEntries(
  entries: WarehouseLowStockImportEntry[] | undefined,
  warehouses: Array<{ _id: Types.ObjectId; name: string; code: string }>
): { resolved: WarehouseLowStockImportEntry[]; errors: string[] } {
  if (!entries?.length) {
    return { resolved: [], errors: [] };
  }

  const resolved: WarehouseLowStockImportEntry[] = [];
  const errors: string[] = [];

  for (const entry of entries) {
    const needle = entry.warehouseName.trim().toLowerCase();
    const warehouse = warehouses.find(
      (wh) =>
        wh.name.trim().toLowerCase() === needle ||
        wh.code.trim().toLowerCase() === needle
    );
    if (!warehouse) {
      errors.push(`Unknown warehouse "${entry.warehouseName}" in low-stock columns`);
      continue;
    }
    resolved.push({
      warehouseName: warehouse.name,
      warehouseId: String(warehouse._id),
      lowStockThreshold: entry.lowStockThreshold,
    });
  }

  return { resolved, errors };
}

async function applyImportedWarehouseThresholds(
  productId: string,
  thresholds: WarehouseLowStockImportEntry[],
  unitsPerStockUnit: number,
  user: AuthUser
) {
  if (thresholds.length === 0) return;

  await updateProductWarehouseThresholds(
    productId,
    thresholds.map((entry) => ({
      warehouseId: entry.warehouseId!,
      lowStockThreshold: resolveLowStockThresholdWithDefault(
        entry.lowStockThreshold,
        unitsPerStockUnit
      ),
    })),
    user
  );
}

function buildWarehouseThresholdsWithDefaults(
  parsed: ParsedProductImportRow,
  warehouses: Array<{ _id: Types.ObjectId; name: string; code: string }>
): WarehouseLowStockImportEntry[] {
  const importedByKey = new Map<string, number>();
  for (const entry of parsed.warehouseLowStockThresholds ?? []) {
    importedByKey.set(entry.warehouseName.trim().toLowerCase(), entry.lowStockThreshold);
  }

  return warehouses.map((warehouse) => {
    const nameKey = warehouse.name.trim().toLowerCase();
    const codeKey = warehouse.code.trim().toLowerCase();
    const imported =
      importedByKey.get(nameKey) ?? importedByKey.get(codeKey);
    return {
      warehouseName: warehouse.name,
      warehouseId: String(warehouse._id),
      lowStockThreshold: resolveLowStockThresholdWithDefault(
        imported,
        parsed.unitsPerStockUnit
      ),
    };
  });
}

async function finalizeImportedProduct(
  productId: string,
  parsed: ParsedProductImportRow,
  user: AuthUser
) {
  await ensureProductBalancesForAllWarehouses(productId);

  const warehouses = await Warehouse.find({ isActive: true }).select("name code").lean();
  const warehouseThresholds = buildWarehouseThresholdsWithDefaults(parsed, warehouses);
  await applyImportedWarehouseThresholds(
    productId,
    warehouseThresholds,
    parsed.unitsPerStockUnit,
    user
  );
}

async function loadImportContext() {
  const brands = await Brand.find({ isActive: true }).lean();
  const brandByName = new Map(
    brands.map((brand) => [brand.name.trim().toLowerCase(), brand])
  );
  const allBrands = await Brand.find().lean();
  const allBrandByName = new Map(
    allBrands.map((brand) => [brand.name.trim().toLowerCase(), brand])
  );

  const products = await Product.find({ isActive: true }).lean();
  const allProducts = await Product.find().lean();

  return {
    brands,
    brandByName,
    allBrandByName,
    brandIdToName: new Map(allBrands.map((b) => [String(b._id), b.name])),
    products,
    allProducts,
  };
}

async function resolveBrandForRow(
  row: {
    brandName: string;
    brandAction: "merge" | "create";
    mergeTargetBrandId?: string;
  },
  user: AuthUser,
  brands: Array<{ _id: Types.ObjectId; name: string; isActive?: boolean }>
) {
  if (row.brandAction === "merge") {
    const targetId = row.mergeTargetBrandId;
    if (!targetId || !Types.ObjectId.isValid(targetId)) {
      throw new BadRequestError("Select an existing brand to merge into");
    }
    let brand = brands.find((item) => String(item._id) === targetId);
    if (!brand) {
      const loaded = await Brand.findOne({ _id: targetId, isActive: true }).lean();
      if (loaded) {
        brand = loaded;
        brands.push(loaded);
      }
    }
    if (!brand) {
      throw new NotFoundError("Brand not found");
    }
    return brand;
  }

  const trimmed = row.brandName.trim();
  const nameKey = trimmed.toLowerCase();

  let brand = brands.find((item) => item.name.trim().toLowerCase() === nameKey);
  if (!brand) {
    const loaded = await Brand.findOne({
      name: {
        $regex: new RegExp(`^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
      },
    }).lean();
    if (loaded) {
      if (loaded.isActive === false) {
        await Brand.updateOne({ _id: loaded._id }, { $set: { isActive: true } });
        loaded.isActive = true;
        brand = loaded;
        brands.push(loaded);
      } else {
        throw new BadRequestError(
          `Brand "${trimmed}" already exists. Use "Use existing brand" to merge into it instead.`
        );
      }
    }
  } else {
    throw new BadRequestError(
      `Brand "${trimmed}" already exists. Use "Use existing brand" to merge into it instead.`
    );
  }
  if (brand) {
    return brand;
  }

  const created = await createBrand({ name: trimmed, isActive: true });
  const brandDoc = await Brand.findById(created.id).lean();
  if (!brandDoc) {
    throw new NotFoundError("Brand not found after create");
  }
  brands.push(brandDoc);
  await AuditLog.create({
    action: "BRAND_CREATED",
    entity: "Brand",
    entityId: brandDoc._id,
    userId: user.id,
    metadata: { name: trimmed, source: "product_import" },
  });
  return brandDoc;
}

export async function previewProductImport(fileBuffer: Buffer) {
  const parsedRows = parseProductExcelBuffer(fileBuffer);
  const { brands, brandByName, allBrandByName, brandIdToName, allProducts } =
    await loadImportContext();
  const warehouses = await Warehouse.find({ isActive: true })
    .select("name code")
    .lean();

  const previewRows: ProductImportPreviewRow[] = parsedRows.map((row) => {
    const errors = validateParsedRow(row);
    const warehouseResolution = resolveWarehouseImportEntries(
      row.warehouseLowStockThresholds,
      warehouses
    );
    errors.push(...warehouseResolution.errors);
    const brand = brandByName.get(row.brandName.trim().toLowerCase());
    const brandCategory = brand ? "matched" : "new";
    const brandExists = Boolean(brand);
    const brandId = brand ? String(brand._id) : undefined;
    const matchedBrand = brand
      ? { id: String(brand._id), name: brand.name }
      : undefined;
    const inactiveBrand = !brand
      ? allBrandByName.get(row.brandName.trim().toLowerCase())
      : undefined;
    const reactivatesBrand =
      inactiveBrand && inactiveBrand.isActive === false
        ? { id: String(inactiveBrand._id), name: inactiveBrand.name }
        : undefined;

    let matchedProduct: ProductImportPreviewRow["matchedProduct"];
    let reactivatesProduct: ProductImportPreviewRow["reactivatesProduct"];
    if (brand && errors.length === 0) {
      const match = findProductByBrandLabelOverlap(
        allProducts,
        String(brand._id),
        row.primaryName,
        row.secondaryName,
        (product) => String(product.brandId)
      );
      if (match) {
        matchedProduct = {
          id: String(match._id),
          name: match.name,
          secondaryName: match.secondaryName,
          baseUnit: match.baseUnit ?? "piece",
          stockUnit: match.stockUnit ?? "unit",
          unitsPerStockUnit: match.unitsPerStockUnit ?? 1,
          lowStockThreshold: match.lowStockThreshold,
        };
        if (match.isActive === false) {
          reactivatesProduct = {
            id: String(match._id),
            name: match.name,
          };
        }
      }
    }

    return {
      ...row,
      warehouseLowStockThresholds:
        warehouseResolution.resolved.length > 0 ? warehouseResolution.resolved : undefined,
      category: matchedProduct ? "matched" : "new",
      brandCategory,
      brandExists,
      brandId,
      matchedBrand,
      reactivatesBrand,
      reactivatesProduct,
      errors,
      matchedProduct,
    };
  });

  return {
    totalRows: previewRows.length,
    matchedCount: previewRows.filter((row) => row.category === "matched").length,
    newCount: previewRows.filter((row) => row.category === "new").length,
    errorCount: previewRows.filter((row) => row.errors.length > 0).length,
    rows: previewRows,
    existingBrands: brands.map((brand) => ({
      id: String(brand._id),
      name: brand.name,
    })),
    existingProducts: allProducts.map((product) => ({
      id: String(product._id),
      name: product.name,
      secondaryName: product.secondaryName,
      brandId: String(product.brandId),
      brandName: brandIdToName.get(String(product.brandId)) ?? "Unknown",
      baseUnit: product.baseUnit ?? "piece",
      stockUnit: product.stockUnit ?? "unit",
      unitsPerStockUnit: product.unitsPerStockUnit ?? 1,
    })),
  };
}

function productPayloadFromRow(row: ParsedProductImportRow, brandId: string) {
  const per = row.unitsPerStockUnit;
  const baseUnit = row.baseUnit.trim() || "piece";
  return {
    name: row.primaryName.trim(),
    secondaryName: row.secondaryName?.trim() || undefined,
    brandId,
    baseUnit,
    stockUnit: per > 1 ? row.stockUnit || "carton" : baseUnit,
    unitsPerStockUnit: per,
    totalLowStockThreshold: resolveLowStockThresholdWithDefault(
      row.totalLowStockThreshold,
      per
    ),
    isActive: true,
  };
}

function resultRowFromInput(row: ProductImportConfirmInput["rows"][number]) {
  return {
    rowNumber: row.rowNumber,
    brandName: row.brandName,
    primaryName: row.primaryName,
    secondaryName: row.secondaryName,
    action: row.action,
    baseUnit: row.baseUnit,
    unitsPerStockUnit: row.unitsPerStockUnit,
    lowStockThreshold: row.lowStockThreshold,
    totalLowStockThreshold: row.totalLowStockThreshold,
    warehouseLowStockThresholds: row.warehouseLowStockThresholds,
    brandAction: row.brandAction,
    mergeTargetBrandId: row.mergeTargetBrandId,
    mergeTargetProductId: row.mergeTargetProductId,
  };
}

export async function confirmProductImport(
  input: ProductImportConfirmInput,
  user: AuthUser
) {
  const warehouses = await Warehouse.find({ isActive: true }).select("name code").lean();

  const { brands, products, allProducts } = await loadImportContext();
  const results: ProductImportResultRow[] = [];
  let successCount = 0;
  let failedCount = 0;

  for (const row of input.rows) {
    const base = resultRowFromInput(row);

    const parsed: ParsedProductImportRow = {
      rowNumber: row.rowNumber,
      brandName: row.brandName,
      primaryName: row.primaryName,
      secondaryName: row.secondaryName,
      baseUnit: row.baseUnit,
      unitsPerStockUnit: row.unitsPerStockUnit,
      lowStockThreshold: row.lowStockThreshold,
      totalLowStockThreshold: row.totalLowStockThreshold,
      warehouseLowStockThresholds: row.warehouseLowStockThresholds,
      stockUnit: row.unitsPerStockUnit > 1 ? "carton" : row.baseUnit,
    };

    const errors = validateParsedRow(parsed);
    if (errors.length > 0) {
      results.push({ ...base, status: "FAILED", message: errors.join("; ") });
      failedCount++;
      continue;
    }

    try {
      const brand = await resolveBrandForRow(
        {
          brandName: row.brandName,
          brandAction: row.brandAction,
          mergeTargetBrandId: row.mergeTargetBrandId,
        },
        user,
        brands
      );
      const brandId = String(brand._id);

      if (row.action === "merge") {
        const targetId = row.mergeTargetProductId;
        let targetProduct =
          targetId && Types.ObjectId.isValid(targetId)
            ? allProducts.find((product) => String(product._id) === targetId)
            : undefined;

        if (!targetProduct && targetId && Types.ObjectId.isValid(targetId)) {
          const loaded = await Product.findById(targetId).lean();
          if (loaded) {
            targetProduct = loaded;
          }
        }

        if (targetProduct && String(targetProduct.brandId) !== brandId) {
          results.push({
            ...base,
            status: "FAILED",
            message:
              "Selected product belongs to a different brand. Pick a product under the chosen brand.",
          });
          failedCount++;
          continue;
        }

        if (!targetProduct) {
          targetProduct = findProductByBrandLabelOverlap(
            allProducts,
            brandId,
            row.primaryName,
            row.secondaryName,
            (product) => String(product.brandId)
          );
        }

        if (!targetProduct) {
          results.push({
            ...base,
            status: "FAILED",
            message: "No matching product found to merge into",
          });
          failedCount++;
          continue;
        }

        const wasInactive = targetProduct.isActive === false;
        const payload = productPayloadFromRow(parsed, brandId);
        const nextName = payload.name;
        const nextSecondary =
          payload.secondaryName &&
          normalizeProductName(payload.secondaryName) !==
            normalizeProductName(nextName)
            ? payload.secondaryName
            : targetProduct.secondaryName;
        await updateProduct(String(targetProduct._id), {
          name: nextName,
          baseUnit: payload.baseUnit,
          stockUnit: payload.stockUnit,
          unitsPerStockUnit: payload.unitsPerStockUnit,
          totalLowStockThreshold: payload.totalLowStockThreshold,
          secondaryName: nextSecondary,
          ...(wasInactive ? { isActive: true } : {}),
        });
        await finalizeImportedProduct(String(targetProduct._id), parsed, user);

        if (wasInactive) {
          const idx = allProducts.findIndex(
            (product) => String(product._id) === String(targetProduct!._id)
          );
          if (idx >= 0) {
            allProducts[idx] = { ...allProducts[idx], isActive: true };
          }
        }

        results.push({
          ...base,
          status: "SUCCESS",
          message: wasInactive
            ? `Reactivated and merged into "${targetProduct.name}"`
            : `Merged into "${targetProduct.name}"`,
          productId: String(targetProduct._id),
        });
        successCount++;
        continue;
      }

      const created = await createProduct(productPayloadFromRow(parsed, brandId));
      await finalizeImportedProduct(created.id, parsed, user);
      const fresh = await Product.findById(created.id).lean();
      if (fresh) products.push(fresh);

      results.push({
        ...base,
        status: "SUCCESS",
        message: "Created new product",
        productId: created.id,
      });
      successCount++;
    } catch (err) {
      results.push({
        ...base,
        status: "FAILED",
        message: err instanceof Error ? err.message : "Import failed",
      });
      failedCount++;
    }
  }

  await AuditLog.create({
    action: "PRODUCT_IMPORT",
    entity: "Product",
    userId: user.id,
    metadata: {
      fileName: input.fileName,
      warehouses: warehouses.map((wh) => ({
        id: String(wh._id),
        name: wh.name,
        code: wh.code,
      })),
      listedInAllWarehouses: true,
      totalRows: input.rows.length,
      successCount,
      failedCount,
    },
  });

  return {
    fileName: input.fileName,
    warehouses: warehouses.map((wh) => ({
      id: String(wh._id),
      name: wh.name,
      code: wh.code,
    })),
    totalRows: input.rows.length,
    successCount,
    failedCount,
    rows: results,
  };
}
