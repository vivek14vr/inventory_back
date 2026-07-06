import { Types } from "mongoose";
import * as XLSX from "xlsx";
import { AuditLog } from "../../models/AuditLog.js";
import { Brand } from "../../models/Brand.js";
import { Product } from "../../models/Product.js";
import { StockMovement } from "../../models/StockMovement.js";
import { Warehouse } from "../../models/Warehouse.js";
import { DispatchType, StockMovementType } from "../../shared/constants/roles.js";
import { BadRequestError, NotFoundError } from "../../shared/errors/AppError.js";
import type { AuthUser } from "../../shared/types/auth.js";
import { findProductByLabelOverlap } from "../../shared/utils/productLookup.js";
import { normalizeProductName } from "../../shared/utils/productName.js";
import { createProduct } from "../products/products.service.js";
import * as stockService from "../stock/stock.service.js";
import type { SalesImportConfirmInput } from "./imports.validation.js";

const DEFAULT_COL_VOUCHER = 4;
const DEFAULT_COL_QUANTITY = 5;

type SalesRegisterLayout = {
  headerRowIndex: number;
  dataStartRowIndex: number;
  colDate: number;
  colParticulars: number;
  colVoucherNo: number;
  colQuantity: number;
};

export type ParsedSalesLine = {
  rowNumber: number;
  productName: string;
  quantity: number;
};

export type ParsedSalesVoucher = {
  voucherIndex: number;
  headerRowNumber: number;
  sellDate: string;
  clientName: string;
  invoiceNumber: string;
  lines: ParsedSalesLine[];
};

export type SalesImportLinePreview = ParsedSalesLine & {
  category: "matched" | "unmatched";
  errors: string[];
  matchedProduct?: {
    id: string;
    name: string;
    secondaryName?: string;
    brandId: string;
    brandName: string;
  };
};

export type SalesImportVoucherPreview = {
  voucherIndex: number;
  headerRowNumber: number;
  sellDate: string;
  clientName: string;
  invoiceNumber: string;
  errors: string[];
  lines: SalesImportLinePreview[];
};

export type SalesImportResultLine = {
  rowNumber: number;
  voucherIndex: number;
  headerRowNumber: number;
  clientName: string;
  invoiceNumber: string;
  sellDate: string;
  productName: string;
  quantity: number;
  action?: "merge" | "create";
  mergeTargetProductId?: string;
  createBrandId?: string;
  productCreated?: boolean;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  message?: string;
};

export type SalesImportResultVoucher = {
  voucherIndex: number;
  headerRowNumber: number;
  clientName: string;
  invoiceNumber: string;
  sellDate: string;
  status: "SUCCESS" | "FAILED" | "PARTIAL";
  message?: string;
  movementCount?: number;
};

function cellString(value: unknown): string {
  return String(value ?? "").trim();
}

function parseQuantity(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return undefined;
    return Math.round(value);
  }
  const text = String(value).replace(/,/g, "").trim();
  const withUnit = text.match(/^([\d.]+)\s*(?:pcs|pc|kg|pkt|box|piece|pieces|unit|units)?$/i);
  if (withUnit) {
    const num = Number(withUnit[1]);
    if (Number.isFinite(num) && num > 0) return Math.round(num);
  }
  const num = Number(text);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  return Math.round(num);
}

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function formatSellDate(value: unknown): string {
  if (value == null || value === "") return "";
  if (value instanceof Date) {
    const months = MONTHS_SHORT;
    const day = value.getDate();
    const month = months[value.getMonth()] ?? "";
    const year = String(value.getFullYear()).slice(-2);
    return `${day}-${month}-${year}`;
  }
  if (typeof value === "number" && value > 0) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      const month = MONTHS_SHORT[parsed.m - 1] ?? String(parsed.m);
      return `${parsed.d}-${month}-${String(parsed.y).slice(-2)}`;
    }
  }
  return cellString(value);
}

function cellFormattedValue(
  sheet: XLSX.WorkSheet,
  rowIndex: number,
  colIndex: number,
  rawValue: unknown
): string {
  const addr = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
  const cell = sheet[addr];
  if (cell?.w && typeof cell.w === "string" && cell.w.trim()) {
    return cell.w.trim();
  }
  return formatSellDate(rawValue);
}

function cellLooksLikeDate(value: unknown): boolean {
  if (value == null || value === "") return false;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime());
  }
  if (typeof value === "number") {
    if (value >= 1 && value <= 60000) {
      const parsed = XLSX.SSF.parse_date_code(value);
      return Boolean(parsed && parsed.y >= 1990 && parsed.y <= 2100);
    }
    return false;
  }
  const text = cellString(value);
  if (!text) return false;
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(text)) return true;
  if (/^\d{1,2}-[A-Za-z]{3}-\d{2,4}$/.test(text)) return true;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed);
}

function isSummaryLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase();
  return (
    normalized === "total" ||
    normalized.startsWith("grand total") ||
    normalized.startsWith("sub total") ||
    normalized.startsWith("subtotal")
  );
}

function normalizeHeaderLabel(value: unknown): string {
  return cellString(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function findHeaderColumn(row: unknown[], matches: (label: string) => boolean): number | undefined {
  for (let col = 0; col < row.length; col++) {
    const label = normalizeHeaderLabel(row[col]);
    if (label && matches(label)) return col;
  }
  return undefined;
}

function isSalesRegisterHeaderRow(row: unknown[]): boolean {
  const dateCol = findHeaderColumn(row, (label) => label === "date");
  const particularsCol = findHeaderColumn(row, (label) =>
    label.includes("particular")
  );
  return dateCol != null && particularsCol != null;
}

function detectSalesRegisterLayout(matrix: unknown[][]): SalesRegisterLayout {
  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i] ?? [];
    if (!isSalesRegisterHeaderRow(row)) continue;

    const colDate = findHeaderColumn(row, (label) => label === "date")!;
    const colParticulars = findHeaderColumn(row, (label) => label.includes("particular"))!;
    const colVoucherNo =
      findHeaderColumn(row, (label) =>
        /voucher\s*no\.?$/i.test(label.replace(/\s+/g, " "))
      ) ??
      findHeaderColumn(row, (label) =>
        /^invoice\s*(no\.?|number)$/i.test(label.replace(/\s+/g, " "))
      ) ??
      DEFAULT_COL_VOUCHER;
    const colQuantity =
      findHeaderColumn(row, (label) => ["quantity", "qty", "qnty"].includes(label)) ??
      DEFAULT_COL_QUANTITY;

    return {
      headerRowIndex: i,
      dataStartRowIndex: i + 1,
      colDate,
      colParticulars,
      colVoucherNo,
      colQuantity,
    };
  }

  throw new BadRequestError(
    "Could not find sales register header row. Expected columns: Date, Particulars, Voucher No., and Quantity."
  );
}

function isCancelledClient(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized.includes("(cancelled") || normalized === "cancelled";
}

function rowIsBlank(row: unknown[]): boolean {
  return row.every((cell) => cellString(cell) === "");
}

/** Column map: A=date, B=particulars (client or product), C-D=ignored, E=voucher no., F=quantity (product rows only). */
function assertSalesRegisterFile(matrix: unknown[][]): void {
  for (let i = 0; i < Math.min(matrix.length, 6); i++) {
    const row = matrix[i] ?? [];
    const joined = row.map((cell) => cellString(cell).toLowerCase()).join("|");
    if (
      joined.includes("brand") &&
      (joined.includes("product primary") || joined.includes("product primary name"))
    ) {
      throw new BadRequestError(
        "This looks like a product catalog file. Use the Product catalog tab, or upload a Tally sales register export."
      );
    }
  }
}

export function parseSalesRegisterExcelBuffer(buffer: Buffer): ParsedSalesVoucher[] {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new BadRequestError("Excel file has no sheets");
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
  });

  assertSalesRegisterFile(matrix);

  const layout = detectSalesRegisterLayout(matrix);
  const {
    dataStartRowIndex,
    colDate,
    colParticulars,
    colVoucherNo,
    colQuantity,
  } = layout;

  if (matrix.length <= dataStartRowIndex) {
    throw new BadRequestError("Excel file has no sales data rows after the header");
  }

  const vouchers: ParsedSalesVoucher[] = [];
  let current: ParsedSalesVoucher | null = null;
  let voucherIndex = 0;

  for (let i = dataStartRowIndex; i < matrix.length; i++) {
    const row = matrix[i] ?? [];
    if (rowIsBlank(row)) continue;

    const excelRowNumber = i + 1;
    const dateCell = row[colDate];
    const clientName = cellString(row[colParticulars]);
    const invoiceNumber = cellString(row[colVoucherNo]);

    if (cellLooksLikeDate(dateCell)) {
      if (current && (current.lines.length > 0 || current.clientName || current.invoiceNumber)) {
        vouchers.push(current);
      }
      current = null;
      if (isCancelledClient(clientName)) {
        continue;
      }
      voucherIndex += 1;
      current = {
        voucherIndex,
        headerRowNumber: excelRowNumber,
        sellDate: cellFormattedValue(sheet, i, colDate, dateCell),
        clientName,
        invoiceNumber,
        lines: [],
      };
      continue;
    }

    if (!current) continue;

    const productName = cellString(row[colParticulars]);
    const quantity = parseQuantity(row[colQuantity]);

    if (!productName && quantity == null) continue;
    if (isSummaryLabel(productName)) continue;

    if (!productName) continue;

    current.lines.push({
      rowNumber: excelRowNumber,
      productName,
      quantity: quantity ?? 0,
    });
  }

  if (current && (current.lines.length > 0 || current.clientName || current.invoiceNumber)) {
    vouchers.push(current);
  }

  if (vouchers.length === 0) {
    throw new BadRequestError(
      "No sales vouchers found after the header row. Expected dated rows with client in Particulars and voucher no., then undated product rows below."
    );
  }

  return vouchers;
}

function validateVoucher(voucher: ParsedSalesVoucher): string[] {
  const errors: string[] = [];
  if (!voucher.clientName) errors.push("Client name is required");
  if (!voucher.invoiceNumber) errors.push("Invoice number is required");
  if (voucher.lines.length === 0) errors.push("No product lines found for this invoice");
  return errors;
}

/** Line-level errors only — do not attach voucher-level errors to every product row. */
function validateLineOnly(line: ParsedSalesLine): string[] {
  const errors: string[] = [];
  if (!line.productName) errors.push("Product name is required");
  if (!Number.isFinite(line.quantity) || line.quantity < 1) {
    errors.push("Quantity must be a positive whole number (units)");
  }
  return errors;
}

async function loadSalesImportContext() {
  const products = await Product.find({ isActive: true }).lean();
  const allProducts = await Product.find().lean();
  const brands = await Brand.find({ isActive: true }).sort({ name: 1 }).lean();
  const brandIdToName = new Map(brands.map((brand) => [String(brand._id), brand.name]));

  return {
    products,
    allProducts,
    brandIdToName,
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
      isActive: product.isActive !== false,
    })),
  };
}

export async function previewSalesImport(fileBuffer: Buffer) {
  const parsedVouchers = parseSalesRegisterExcelBuffer(fileBuffer);
  const { allProducts, brandIdToName, existingProducts, existingBrands } =
    await loadSalesImportContext();

  const vouchers: SalesImportVoucherPreview[] = parsedVouchers.map((voucher) => {
    const voucherErrors = validateVoucher(voucher);
    const lines: SalesImportLinePreview[] = voucher.lines.map((line) => {
      const lineErrors = validateLineOnly(line);
      let matchedProduct: SalesImportLinePreview["matchedProduct"];

      if (lineErrors.length === 0) {
        try {
          const match = findProductByLabelOverlap(allProducts, line.productName);
          if (match) {
            matchedProduct = {
              id: String(match._id),
              name: match.name,
              secondaryName: match.secondaryName,
              brandId: String(match.brandId),
              brandName: brandIdToName.get(String(match.brandId)) ?? "Unknown",
            };
          }
        } catch (err) {
          lineErrors.push(err instanceof Error ? err.message : "Ambiguous product match");
        }
      }

      return {
        ...line,
        category: matchedProduct ? "matched" : "unmatched",
        errors: lineErrors,
        matchedProduct,
      };
    });

    return {
      voucherIndex: voucher.voucherIndex,
      headerRowNumber: voucher.headerRowNumber,
      sellDate: voucher.sellDate,
      clientName: voucher.clientName,
      invoiceNumber: voucher.invoiceNumber,
      errors: voucherErrors,
      lines,
    };
  });

  const allLines = vouchers.flatMap((voucher) => voucher.lines);
  return {
    totalVouchers: vouchers.length,
    totalLines: allLines.length,
    matchedCount: allLines.filter((line) => line.category === "matched").length,
    unmatchedCount: allLines.filter((line) => line.category === "unmatched").length,
    errorCount: allLines.filter((line) => line.errors.length > 0).length,
    vouchers,
    existingBrands,
    existingProducts,
  };
}

function productCreateCacheKey(brandId: string, productName: string): string {
  return `${brandId}|${normalizeProductName(productName)}`;
}

async function resolveSalesImportLineProduct(
  line: SalesImportConfirmInput["vouchers"][number]["lines"][number],
  createdCache: Map<string, string>,
  productById: Map<string, { _id: Types.ObjectId; brandId: Types.ObjectId; isActive?: boolean }>
): Promise<{ productId: string; brandId: string; created: boolean }> {
  if (line.action === "merge") {
    const product = productById.get(line.mergeTargetProductId!);
    if (!product || product.isActive === false) {
      throw new BadRequestError("Selected product not found or inactive");
    }
    return {
      productId: String(product._id),
      brandId: String(product.brandId),
      created: false,
    };
  }

  const brandId = line.createBrandId!;
  if (!Types.ObjectId.isValid(brandId)) {
    throw new BadRequestError("Invalid brand selected for new product");
  }

  const cacheKey = productCreateCacheKey(brandId, line.productName);
  const cachedId = createdCache.get(cacheKey);
  if (cachedId) {
    const product = productById.get(cachedId);
    if (!product) {
      throw new BadRequestError("Cached product not found after create");
    }
    return {
      productId: cachedId,
      brandId: String(product.brandId),
      created: false,
    };
  }

  const created = await createProduct({
    name: line.productName.trim(),
    brandId,
    baseUnit: "piece",
    stockUnit: "piece",
    unitsPerStockUnit: 1,
    isActive: true,
  });

  createdCache.set(cacheKey, created.id);
  productById.set(created.id, {
    _id: new Types.ObjectId(created.id),
    brandId: new Types.ObjectId(brandId),
    isActive: true,
  });

  return {
    productId: created.id,
    brandId,
    created: true,
  };
}

function mergeBatchItems(
  lines: Array<{
    productId: string;
    brandId: string;
    quantity: number;
  }>
) {
  const merged = new Map<string, { productId: string; brandId: string; quantity: number }>();
  for (const line of lines) {
    const existing = merged.get(line.productId);
    if (existing) {
      existing.quantity += line.quantity;
    } else {
      merged.set(line.productId, { ...line });
    }
  }
  return Array.from(merged.values());
}

export async function confirmSalesImport(input: SalesImportConfirmInput, user: AuthUser) {
  const warehouseId = input.warehouseId.trim();
  if (!Types.ObjectId.isValid(warehouseId)) {
    throw new BadRequestError("Invalid warehouse ID");
  }

  const warehouse = await Warehouse.findOne({ _id: warehouseId, isActive: true }).lean();
  if (!warehouse) {
    throw new NotFoundError("Warehouse not found or inactive");
  }

  const { allProducts } = await loadSalesImportContext();
  const productById = new Map(allProducts.map((product) => [String(product._id), product]));
  const createdProductCache = new Map<string, string>();

  const lineResults: SalesImportResultLine[] = [];
  const voucherResults: SalesImportResultVoucher[] = [];
  let successCount = 0;
  let failedCount = 0;
  let createdProductCount = 0;

  for (const voucher of input.vouchers) {
    const baseVoucher = {
      voucherIndex: voucher.voucherIndex,
      headerRowNumber: voucher.headerRowNumber,
      clientName: voucher.clientName.trim(),
      invoiceNumber: voucher.invoiceNumber.trim(),
      sellDate: voucher.sellDate?.trim() ?? "",
    };

    const voucherErrors: string[] = [];
    if (!baseVoucher.clientName) voucherErrors.push("Client name is required");
    if (!baseVoucher.invoiceNumber) voucherErrors.push("Invoice number is required");
    if (voucher.lines.length === 0) voucherErrors.push("No product lines to import");

    const batchItems: Array<{ productId: string; brandId: string; quantity: number }> = [];
    let voucherFailedLines = 0;

    for (const line of voucher.lines) {
      const baseLine = {
        rowNumber: line.rowNumber,
        ...baseVoucher,
        productName: line.productName.trim(),
        quantity: line.quantity,
        action: line.action,
        mergeTargetProductId: line.mergeTargetProductId,
        createBrandId: line.createBrandId,
      };

      const lineErrors = [...voucherErrors];
      if (!baseLine.productName) lineErrors.push("Product name is required");
      if (!Number.isFinite(baseLine.quantity) || baseLine.quantity < 1) {
        lineErrors.push("Quantity must be at least 1 unit");
      }
      if (line.action === "merge" && !line.mergeTargetProductId) {
        lineErrors.push("Select a product to merge into");
      }
      if (line.action === "create" && !line.createBrandId) {
        lineErrors.push("Select a brand for the new product");
      }

      if (lineErrors.length > 0) {
        lineResults.push({
          ...baseLine,
          status: "FAILED",
          message: lineErrors.join("; "),
        });
        failedCount++;
        voucherFailedLines++;
        continue;
      }

      let resolvedProduct: { productId: string; brandId: string; created: boolean };
      try {
        resolvedProduct = await resolveSalesImportLineProduct(
          line,
          createdProductCache,
          productById
        );
        if (resolvedProduct.created) {
          createdProductCount++;
          await AuditLog.create({
            action: "PRODUCT_CREATED",
            entity: "Product",
            entityId: resolvedProduct.productId,
            userId: user.id,
            metadata: {
              name: baseLine.productName,
              brandId: resolvedProduct.brandId,
              source: "sales_import",
            },
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not resolve product";
        lineResults.push({
          ...baseLine,
          status: "FAILED",
          message,
        });
        failedCount++;
        voucherFailedLines++;
        continue;
      }

      batchItems.push({
        productId: resolvedProduct.productId,
        brandId: resolvedProduct.brandId,
        quantity: baseLine.quantity,
      });

      lineResults.push({
        ...baseLine,
        productCreated: resolvedProduct.created,
        status: "SKIPPED",
        message: resolvedProduct.created
          ? "Pending voucher import (new product created)"
          : "Pending voucher import",
      });
    }

    if (voucherErrors.length > 0 || batchItems.length === 0) {
      voucherResults.push({
        ...baseVoucher,
        status: "FAILED",
        message:
          voucherErrors.join("; ") ||
          (batchItems.length === 0 ? "No valid product lines for this invoice" : undefined),
      });
      continue;
    }

    const duplicateInvoice = await StockMovement.exists({
      type: StockMovementType.STOCK_OUT,
      dispatchType: DispatchType.DIRECT_SELLING,
      warehouseId: new Types.ObjectId(warehouseId),
      invoiceNumber: baseVoucher.invoiceNumber,
      clientName: baseVoucher.clientName,
    });
    if (duplicateInvoice) {
      voucherResults.push({
        ...baseVoucher,
        status: "FAILED",
        message: `Invoice ${baseVoucher.invoiceNumber} for ${baseVoucher.clientName} was already imported at this warehouse`,
      });
      for (const lineResult of lineResults) {
        if (
          lineResult.voucherIndex === baseVoucher.voucherIndex &&
          lineResult.status === "SKIPPED"
        ) {
          lineResult.status = "FAILED";
          lineResult.message = "Duplicate invoice — skipped";
          failedCount++;
        }
      }
      continue;
    }

    const mergedItems = mergeBatchItems(batchItems);
    const notes = baseVoucher.sellDate
      ? `Sales import${input.fileName ? `: ${input.fileName}` : ""} (${baseVoucher.sellDate})`
      : input.fileName
        ? `Sales import: ${input.fileName}`
        : "Sales import";

    try {
      const batchResult = await stockService.stockOutBatch(
        {
          warehouseId,
          clientName: baseVoucher.clientName,
          invoiceNumber: baseVoucher.invoiceNumber,
          notes,
          allowInsufficientStock: true,
          items: mergedItems.map((item) => ({
            brandId: item.brandId,
            productId: item.productId,
            quantity: item.quantity,
          })),
        },
        user
      );

      for (const lineResult of lineResults) {
        if (
          lineResult.voucherIndex === baseVoucher.voucherIndex &&
          lineResult.status === "SKIPPED" &&
          lineResult.message?.startsWith("Pending voucher import")
        ) {
          lineResult.status = "SUCCESS";
          lineResult.message = `Stock out recorded (${batchResult.clientName})`;
          successCount++;
        }
      }

      voucherResults.push({
        ...baseVoucher,
        status: voucherFailedLines > 0 ? "PARTIAL" : "SUCCESS",
        movementCount: batchResult.movements.length,
        message:
          voucherFailedLines > 0
            ? `${voucherFailedLines} line(s) failed; remaining lines imported`
            : undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Stock out failed";
      for (const lineResult of lineResults) {
        if (
          lineResult.voucherIndex === baseVoucher.voucherIndex &&
          lineResult.status === "SKIPPED"
        ) {
          lineResult.status = "FAILED";
          lineResult.message = message;
          failedCount++;
        }
      }
      voucherResults.push({
        ...baseVoucher,
        status: "FAILED",
        message,
      });
    }
  }

  await AuditLog.create({
    action: "SALES_IMPORT",
    entity: "StockMovement",
    userId: user.id,
    metadata: {
      fileName: input.fileName,
      warehouseId,
      warehouseName: warehouse.name,
      voucherCount: input.vouchers.length,
      successCount,
      failedCount,
      createdProductCount,
    },
  });

  return {
    fileName: input.fileName,
    warehouse: {
      id: String(warehouse._id),
      name: warehouse.name,
      code: warehouse.code,
    },
    totalVouchers: input.vouchers.length,
    totalLines: lineResults.length,
    successCount,
    failedCount,
    createdProductCount,
    vouchers: voucherResults,
    rows: lineResults,
  };
}
