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
import type { ProductImportConfirmInput } from "./imports.validation.js";

export type ParsedProductImportRow = {
  rowNumber: number;
  brandName: string;
  primaryName: string;
  secondaryName?: string;
  baseUnit: string;
  unitsPerStockUnit: number;
  lowStockThreshold?: number;
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
    "pieces per carton",
  ]);
  const lowPackKey = findColumnKey(keys, [
    "low quantity cartoon",
    "low quantity carton",
    "low stock carton",
    "low stock",
    "low quantity",
  ]);

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
    const rawLowPack = lowPackKey ? String(row[lowPackKey] ?? "").trim() : "";

    if (
      !brandName &&
      !primaryName &&
      !secondaryName &&
      !rawUnit &&
      !rawUnitsPerPack &&
      !rawLowPack
    ) {
      return;
    }

    const baseUnit = rawUnit || "piece";
    const unitsPerStockUnit = Number(rawUnitsPerPack);
    const lowPackQty = rawLowPack === "" ? undefined : Number(rawLowPack);

    const stockUnit = unitsPerStockUnit > 1 ? "carton" : baseUnit;
    const lowStockThreshold =
      lowPackQty != null && Number.isFinite(lowPackQty) && lowPackQty >= 0
        ? unitsPerStockUnit > 1
          ? Math.round(lowPackQty * unitsPerStockUnit)
          : Math.round(lowPackQty)
        : undefined;

    rows.push({
      rowNumber: index + 2,
      brandName,
      primaryName,
      secondaryName,
      baseUnit,
      unitsPerStockUnit: Number.isFinite(unitsPerStockUnit) && unitsPerStockUnit > 0
        ? Math.round(unitsPerStockUnit)
        : 1,
      lowStockThreshold,
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

  const previewRows: ProductImportPreviewRow[] = parsedRows.map((row) => {
    const errors = validateParsedRow(row);
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
    lowStockThreshold: row.lowStockThreshold,
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
    brandAction: row.brandAction,
    mergeTargetBrandId: row.mergeTargetBrandId,
    mergeTargetProductId: row.mergeTargetProductId,
  };
}

export async function confirmProductImport(
  input: ProductImportConfirmInput,
  user: AuthUser
) {
  if (!Types.ObjectId.isValid(input.warehouseId)) {
    throw new BadRequestError("Invalid warehouse ID");
  }
  const warehouse = await Warehouse.findOne({
    _id: input.warehouseId,
    isActive: true,
  }).lean();
  if (!warehouse) {
    throw new NotFoundError("Warehouse not found or inactive");
  }

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
          lowStockThreshold: payload.lowStockThreshold ?? null,
          secondaryName: nextSecondary,
          ...(wasInactive ? { isActive: true } : {}),
        });

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
      warehouseId: input.warehouseId,
      warehouseName: warehouse.name,
      warehouseCode: warehouse.code,
      warehouseRole: "Audit trail only; product catalog imports do not create stock.",
      totalRows: input.rows.length,
      successCount,
      failedCount,
    },
  });

  return {
    fileName: input.fileName,
    warehouse: {
      id: String(warehouse._id),
      name: warehouse.name,
      code: warehouse.code,
    },
    totalRows: input.rows.length,
    successCount,
    failedCount,
    rows: results,
  };
}
