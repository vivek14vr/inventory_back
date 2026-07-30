import { Types } from "mongoose";
import * as XLSX from "xlsx";
import { AuditLog } from "../../models/AuditLog.js";
import { Brand } from "../../models/Brand.js";
import { Client } from "../../models/Client.js";
import { Product } from "../../models/Product.js";
import { StockMovement } from "../../models/StockMovement.js";
import { Warehouse } from "../../models/Warehouse.js";
import { DispatchType, StockMovementType } from "../../shared/constants/roles.js";
import { exactCaseInsensitiveRegex } from "../../shared/utils/invoiceMatch.js";
import { assertImportRowCount } from "../../shared/constants/importLimits.js";
import { BadRequestError, NotFoundError } from "../../shared/errors/AppError.js";
import type { AuthUser } from "../../shared/types/auth.js";
import { findProductByBrandLabelOverlap, findProductByLabelOverlap } from "../../shared/utils/productLookup.js";
import { normalizeEntityName, normalizeProductName } from "../../shared/utils/productName.js";
import { assertPermission } from "../../shared/utils/permissions.js";
import { Permission } from "../../shared/constants/permissions.js";
import { createBrand } from "../brands/brands.service.js";
import { createClient } from "../clients/clients.service.js";
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
  /** Narration / warehouse hint column (F). Undefined when older sheets omit it. */
  colNarration?: number;
};

export type SalesWarehouseHint = "vasai" | "goregaon";

export type ParsedSalesLine = {
  rowNumber: number;
  productName: string;
  quantity: number;
  warehouseHint?: SalesWarehouseHint;
  narrationRaw: string;
  warehouseNarrationError?: string;
};

export type ParsedSalesVoucher = {
  voucherIndex: number;
  headerRowNumber: number;
  sellDate: string;
  clientName: string;
  invoiceNumber: string;
  /** Warehouse comes from Narration on the invoice/client header row. */
  narrationRaw: string;
  warehouseHint?: SalesWarehouseHint;
  warehouseNarrationError?: string;
  lines: ParsedSalesLine[];
};

export type SalesImportLinePreview = ParsedSalesLine & {
  brandName: string;
  brandCategory: "matched" | "new";
  category: "matched" | "unmatched";
  errors: string[];
  warehouseId?: string;
  warehouseName?: string;
  warehouseCode?: string;
  matchedBrand?: {
    id: string;
    name: string;
  };
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
  clientCategory: "matched" | "new";
  errors: string[];
  narrationRaw?: string;
  warehouseHint?: SalesWarehouseHint;
  warehouseId?: string;
  warehouseName?: string;
  warehouseCode?: string;
  matchedClient?: {
    id: string;
    name: string;
    secondaryName?: string;
  };
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
  warehouseId?: string;
  action?: "merge" | "create";
  brandAction?: "merge" | "create";
  mergeTargetBrandId?: string;
  mergeTargetProductId?: string;
  createBrandId?: string;
  productCreated?: boolean;
  brandCreated?: boolean;
  clientCreated?: boolean;
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
    const colNarration = findHeaderColumn(
      row,
      (label) => label === "narration" || label.includes("narration")
    );

    return {
      headerRowIndex: i,
      dataStartRowIndex: i + 1,
      colDate,
      colParticulars,
      colVoucherNo,
      colQuantity,
      colNarration,
    };
  }

  throw new BadRequestError(
    "Could not find sales register header row. Expected columns: Date, Particulars, Voucher No., and Quantity."
  );
}

/** Empty / goregaon → Goregaon. Contains "vasai" → Vasai (checked first). Anything else → invalid. */
export function parseWarehouseHintFromNarration(
  raw: string
): { hint: SalesWarehouseHint } | { error: string } {
  const trimmed = raw.trim();
  const normalized = trimmed.toLowerCase().replace(/\s+/g, " ");
  // Vasai wins if mentioned (even alongside other text)
  if (normalized.includes("vasai")) {
    return { hint: "vasai" };
  }
  // Blank, placeholders, or explicit Goregaon → Goregaon warehouse
  if (
    !normalized ||
    normalized === "-" ||
    normalized === "—" ||
    normalized === "." ||
    normalized === "n/a" ||
    normalized === "na" ||
    normalized === "none" ||
    normalized === "nil" ||
    normalized.includes("goregaon") ||
    normalized.includes("goregoan") // common misspelling
  ) {
    return { hint: "goregaon" };
  }
  return {
    error: `Narration must be empty (Goregaon) or contain "vasai" / "goregaon". Got "${trimmed}"`,
  };
}

function findWarehouseByHint(
  warehouses: Array<{ _id: Types.ObjectId; name: string; code: string }>,
  hint: SalesWarehouseHint
): { _id: Types.ObjectId; name: string; code: string } | undefined {
  const needle = hint.toLowerCase().replace(/\s+/g, "");
  return warehouses.find((warehouse) => {
    const name = normalizeEntityName(warehouse.name);
    const code = normalizeEntityName(warehouse.code);
    return (
      name === needle ||
      code === needle ||
      name.includes(needle) ||
      code.includes(needle)
    );
  });
}

function isCancelledClient(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized.includes("(cancelled") || normalized === "cancelled";
}

function rowIsBlank(row: unknown[]): boolean {
  return row.every((cell) => cellString(cell) === "");
}

/** Column map: A=date, B=particulars, E=voucher no., F=narration (warehouse), G=quantity. */
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
    colNarration,
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
      // Warehouse is on the invoice/client header row (Narration), not product lines.
      const narrationRaw =
        colNarration != null ? cellString(row[colNarration]) : "";
      const warehouseParsed = parseWarehouseHintFromNarration(narrationRaw);
      voucherIndex += 1;
      current = {
        voucherIndex,
        headerRowNumber: excelRowNumber,
        sellDate: cellFormattedValue(sheet, i, colDate, dateCell),
        clientName,
        invoiceNumber,
        narrationRaw,
        ...("hint" in warehouseParsed
          ? { warehouseHint: warehouseParsed.hint }
          : { warehouseNarrationError: warehouseParsed.error }),
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
    if (quantity == null || quantity < 1) continue;

    // One invoice → one warehouse; inherit from the header row.
    current.lines.push({
      rowNumber: excelRowNumber,
      productName,
      quantity,
      narrationRaw: current.narrationRaw,
      ...(current.warehouseHint
        ? { warehouseHint: current.warehouseHint }
        : current.warehouseNarrationError
          ? { warehouseNarrationError: current.warehouseNarrationError }
          : { warehouseHint: "goregaon" as const }),
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

  const lineCount = vouchers.reduce((sum, voucher) => sum + voucher.lines.length, 0);
  assertImportRowCount(lineCount, "Sales register file");
  return vouchers;
}

function validateVoucher(voucher: ParsedSalesVoucher): string[] {
  const errors: string[] = [];
  if (!voucher.clientName) errors.push("Client name is required");
  if (!voucher.invoiceNumber) errors.push("Invoice number is required");
  if (voucher.lines.length === 0) errors.push("No product lines found for this invoice");
  if (voucher.warehouseNarrationError) {
    errors.push(voucher.warehouseNarrationError);
  }
  return errors;
}

/** Line-level errors only — do not attach voucher-level errors to every product row. */
function validateLineOnly(line: ParsedSalesLine): string[] {
  const errors: string[] = [];
  if (!line.productName) errors.push("Product name is required");
  if (!Number.isFinite(line.quantity) || line.quantity < 1) {
    errors.push("Quantity must be a positive whole number (units)");
  }
  if (line.warehouseNarrationError) {
    errors.push(line.warehouseNarrationError);
  }
  return errors;
}

async function loadSalesImportContext() {
  const products = await Product.find({ isActive: true }).lean();
  const allProducts = await Product.find().lean();
  const brands = await Brand.find({ isActive: true }).sort({ name: 1 }).lean();
  const allBrands = await Brand.find().lean();
  const clients = await Client.find({ isActive: true }).sort({ name: 1 }).lean();
  const brandIdToName = new Map(brands.map((brand) => [String(brand._id), brand.name]));
  const brandByName = new Map(
    brands.map((brand) => [normalizeEntityName(brand.name), brand])
  );

  return {
    products,
    allProducts,
    brands,
    allBrands,
    brandByName,
    brandIdToName,
    existingBrands: brands.map((brand) => ({
      id: String(brand._id),
      name: brand.name,
    })),
    existingClients: clients.map((client) => ({
      id: String(client._id),
      name: client.name,
      secondaryName: client.secondaryName,
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

/** Qty / pack markers like "(800pc)" must not become brand names. */
function isLikelyQuantityToken(token: string): boolean {
  const t = token.trim().toLowerCase();
  if (!t) return true;
  if (/^\(?\d+[\d.,]*\s*(pcs?|pieces?|pkts?|boxes?|kg|g|ml|l|units?)\)?$/i.test(t)) {
    return true;
  }
  if (/^\(\d+.*\)$/.test(t)) return true;
  return false;
}

function inferBrandNameForSalesLine(
  productName: string,
  brandByName: Map<string, { _id: Types.ObjectId; name: string }>,
  matchedProduct?: SalesImportLinePreview["matchedProduct"]
): string {
  if (matchedProduct?.brandName) return matchedProduct.brandName;

  const trimmed = productName.trim();
  if (!trimmed) return "";

  const sortedBrands = Array.from(brandByName.values()).sort(
    (a, b) => b.name.length - a.name.length
  );
  const haystack = normalizeEntityName(trimmed);
  for (const brand of sortedBrands) {
    const needle = normalizeEntityName(brand.name);
    if (!needle || needle.length < 2) continue;
    // Prefer brand as a prefix (common in Tally particulars), then suffix.
    if (haystack.startsWith(needle) || haystack.endsWith(needle)) {
      return brand.name;
    }
  }

  const parts = trimmed.split(/\s+/).filter((part) => !isLikelyQuantityToken(part));
  if (parts.length === 0) return "";
  // First token is usually the brand in sales-register particulars.
  return parts[0]!;
}

export async function previewSalesImport(fileBuffer: Buffer) {
  const parsedVouchers = parseSalesRegisterExcelBuffer(fileBuffer);
  const {
    products: activeProducts,
    brandByName,
    brandIdToName,
    existingProducts,
    existingBrands,
    existingClients,
  } = await loadSalesImportContext();

  const warehouses = await Warehouse.find({ isActive: true })
    .select("name code")
    .lean();

  const clientByName = new Map(
    existingClients.map((client) => [normalizeEntityName(client.name), client])
  );

  const vouchers: SalesImportVoucherPreview[] = parsedVouchers.map((voucher) => {
    const voucherErrors = validateVoucher(voucher);
    const matchedClient = clientByName.get(normalizeEntityName(voucher.clientName));

    let warehouseId: string | undefined;
    let warehouseName: string | undefined;
    let warehouseCode: string | undefined;
    if (voucher.warehouseHint) {
      const warehouse = findWarehouseByHint(warehouses, voucher.warehouseHint);
      if (!warehouse) {
        voucherErrors.push(
          `Warehouse "${voucher.warehouseHint}" not found or inactive. Import cannot continue until Vasai and Goregaon warehouses exist.`
        );
      } else {
        warehouseId = String(warehouse._id);
        warehouseName = warehouse.name;
        warehouseCode = warehouse.code;
      }
    } else if (!voucher.warehouseNarrationError) {
      voucherErrors.push("Warehouse could not be resolved from invoice Narration");
    }

    const lines: SalesImportLinePreview[] = voucher.lines.map((line) => {
      const lineErrors = validateLineOnly(line);
      let matchedProduct: SalesImportLinePreview["matchedProduct"];

      if (lineErrors.length === 0) {
        try {
          const match = findProductByLabelOverlap(activeProducts, line.productName);
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

      const brandName = inferBrandNameForSalesLine(
        line.productName,
        brandByName,
        matchedProduct
      );
      const matchedBrandRecord = brandName
        ? brandByName.get(normalizeEntityName(brandName))
        : undefined;
      const matchedBrand = matchedBrandRecord
        ? { id: String(matchedBrandRecord._id), name: matchedBrandRecord.name }
        : undefined;

      return {
        ...line,
        brandName,
        brandCategory: matchedBrand ? "matched" : "new",
        category: matchedProduct ? "matched" : "unmatched",
        errors: lineErrors,
        warehouseId,
        warehouseName,
        warehouseCode,
        matchedBrand,
        matchedProduct,
      };
    });

    return {
      voucherIndex: voucher.voucherIndex,
      headerRowNumber: voucher.headerRowNumber,
      sellDate: voucher.sellDate,
      clientName: voucher.clientName,
      invoiceNumber: voucher.invoiceNumber,
      clientCategory: matchedClient ? "matched" : "new",
      errors: voucherErrors,
      narrationRaw: voucher.narrationRaw,
      warehouseHint: voucher.warehouseHint,
      warehouseId,
      warehouseName,
      warehouseCode,
      matchedClient,
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
    existingClients,
  };
}

function productCreateCacheKey(brandId: string, productName: string): string {
  return `${brandId}|${normalizeProductName(productName)}`;
}

async function resolveBrandForSalesLine(
  line: {
    brandName: string;
    brandAction: "merge" | "create";
    mergeTargetBrandId?: string;
  },
  user: AuthUser,
  brands: Array<{ _id: Types.ObjectId; name: string; isActive?: boolean }>
): Promise<{ brandId: string; created: boolean }> {
  if (line.brandAction === "merge") {
    const targetId = line.mergeTargetBrandId;
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
    return { brandId: String(brand._id), created: false };
  }

  const trimmed = line.brandName.trim();
  if (!trimmed) {
    throw new BadRequestError("Brand name is required to create a new brand");
  }
  const nameKey = normalizeEntityName(trimmed);

  // Find-or-create by space-insensitive name so "Eco Infinity" / "Eco  Infinity"
  // and repeated create actions in the same (or later) confirm reuse one brand.
  const existingActive = brands.find(
    (item) => item.isActive !== false && normalizeEntityName(item.name) === nameKey
  );
  if (existingActive) {
    return { brandId: String(existingActive._id), created: false };
  }

  const inactive = brands.find(
    (item) => item.isActive === false && normalizeEntityName(item.name) === nameKey
  );
  if (inactive) {
    await Brand.updateOne({ _id: inactive._id }, { $set: { isActive: true } });
    inactive.isActive = true;
    return { brandId: String(inactive._id), created: false };
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
    metadata: { name: trimmed, source: "sales_import" },
  });
  return { brandId: created.id, created: true };
}

async function resolveClientForVoucher(
  voucher: {
    clientName: string;
    clientAction: "merge" | "create";
    mergeTargetClientId?: string;
    clientSecondaryName?: string;
  },
  user: AuthUser,
  clients: Array<{ _id: Types.ObjectId; name: string; secondaryName?: string }>
): Promise<{ clientName: string; created: boolean; clientId?: string }> {
  if (voucher.clientAction === "merge") {
    const targetId = voucher.mergeTargetClientId;
    if (!targetId || !Types.ObjectId.isValid(targetId)) {
      throw new BadRequestError("Select an existing client to merge into");
    }
    let client = clients.find((item) => String(item._id) === targetId);
    if (!client) {
      const loaded = await Client.findOne({ _id: targetId, isActive: true }).lean();
      if (loaded) {
        client = loaded;
        clients.push(loaded);
      }
    }
    if (!client) {
      throw new NotFoundError("Client not found");
    }
    return { clientName: client.name, created: false, clientId: String(client._id) };
  }

  const trimmed = voucher.clientName.trim();
  if (!trimmed) {
    throw new BadRequestError("Client name is required to create a new client");
  }

  const nameKey = normalizeEntityName(trimmed);
  const existingFromCache = clients.find(
    (item) => normalizeEntityName(item.name) === nameKey
  );
  if (existingFromCache) {
    throw new BadRequestError(
      `Client "${trimmed}" already exists. Use "Use existing client" to merge into it instead.`
    );
  }

  const existingCandidates = await Client.find().lean();
  const existing = existingCandidates.find(
    (item) => normalizeEntityName(item.name) === nameKey
  );
  if (existing) {
    if (existing.isActive === false) {
      await Client.updateOne(
        { _id: existing._id },
        {
          $set: {
            isActive: true,
            ...(voucher.clientSecondaryName?.trim()
              ? { secondaryName: voucher.clientSecondaryName.trim() }
              : {}),
          },
        }
      );
      return { clientName: existing.name, created: false, clientId: String(existing._id) };
    }
    throw new BadRequestError(
      `Client "${trimmed}" already exists. Use "Use existing client" to merge into it instead.`
    );
  }

  const created = await createClient({
    name: trimmed,
    secondaryName: voucher.clientSecondaryName?.trim() || undefined,
    isActive: true,
  });
  clients.push({
    _id: new Types.ObjectId(created.id),
    name: created.name,
    secondaryName: created.secondaryName,
  });
  await AuditLog.create({
    action: "CLIENT_CREATED",
    entity: "Client",
    entityId: new Types.ObjectId(created.id),
    userId: new Types.ObjectId(user.id),
    metadata: { name: trimmed, source: "sales_import" },
  });
  return { clientName: created.name, created: true, clientId: created.id };
}

async function resolveSalesImportLineProduct(
  line: SalesImportConfirmInput["vouchers"][number]["lines"][number],
  brandId: string,
  createdCache: Map<string, string>,
  productById: Map<string, { _id: Types.ObjectId; brandId: Types.ObjectId; isActive?: boolean; name?: string; secondaryName?: string }>
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

  if (!Types.ObjectId.isValid(brandId)) {
    throw new BadRequestError("Invalid brand for new product");
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

  // Same flow as preview: stripped import label vs primary AND secondary (any brand).
  const candidates = [...productById.values()].filter(
    (
      product
    ): product is {
      _id: Types.ObjectId;
      brandId: Types.ObjectId;
      name: string;
      secondaryName?: string;
      isActive?: boolean;
    } => product.isActive !== false && Boolean(product.name)
  );
  const existing =
    findProductByLabelOverlap(candidates, line.productName.trim()) ??
    findProductByBrandLabelOverlap(
      candidates,
      brandId,
      line.productName.trim(),
      undefined,
      (product) => String(product.brandId)
    );
  if (existing) {
    const productId = String(existing._id);
    createdCache.set(cacheKey, productId);
    createdCache.set(
      productCreateCacheKey(String(existing.brandId), line.productName),
      productId
    );
    return {
      productId,
      brandId: String(existing.brandId),
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
    name: line.productName.trim(),
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

async function deactivateImportedProducts(productIds: string[]): Promise<void> {
  const ids = productIds.filter((id) => Types.ObjectId.isValid(id));
  if (ids.length === 0) return;
  await Product.updateMany(
    { _id: { $in: ids.map((id) => new Types.ObjectId(id)) } },
    { $set: { isActive: false } }
  );
}

async function deactivateImportedBrands(brandIds: string[]): Promise<void> {
  const ids = brandIds.filter((id) => Types.ObjectId.isValid(id));
  if (ids.length === 0) return;
  await Brand.updateMany(
    { _id: { $in: ids.map((id) => new Types.ObjectId(id)) } },
    { $set: { isActive: false } }
  );
}

async function deactivateImportedClients(clientIds: string[]): Promise<void> {
  const ids = clientIds.filter((id) => Types.ObjectId.isValid(id));
  if (ids.length === 0) return;
  await Client.updateMany(
    { _id: { $in: ids.map((id) => new Types.ObjectId(id)) } },
    { $set: { isActive: false } }
  );
}

async function rollbackSalesImportCreates(input: {
  productIds?: string[];
  brandIds?: string[];
  clientIds?: string[];
}): Promise<void> {
  await Promise.all([
    deactivateImportedProducts(input.productIds ?? []),
    deactivateImportedBrands(input.brandIds ?? []),
    deactivateImportedClients(input.clientIds ?? []),
  ]);
}

type SalesImportVoucherLineValidation = {
  baseLine: {
    rowNumber: number;
    voucherIndex: number;
    headerRowNumber: number;
    clientName: string;
    invoiceNumber: string;
    sellDate: string;
    productName: string;
    quantity: number;
    brandName: string;
    brandAction: "merge" | "create";
    mergeTargetBrandId?: string;
    action: "merge" | "create";
    mergeTargetProductId?: string;
    warehouseId: string;
  };
  line: SalesImportConfirmInput["vouchers"][number]["lines"][number];
  lineErrors: string[];
  ignored: boolean;
};

function rejectEntireVoucher(
  baseVoucher: {
    voucherIndex: number;
    headerRowNumber: number;
    clientName: string;
    invoiceNumber: string;
    sellDate: string;
  },
  validations: SalesImportVoucherLineValidation[],
  invoiceMessage: string,
  lineResults: SalesImportResultLine[],
  voucherResults: SalesImportResultVoucher[]
): number {
  const active = validations.filter((entry) => !entry.ignored);
  const lineFailures = active
    .filter((entry) => entry.lineErrors.length > 0)
    .map(
      (entry) => `Row ${entry.baseLine.rowNumber}: ${entry.lineErrors.join("; ")}`
    );
  const summary =
    invoiceMessage ||
    (lineFailures.length > 0
      ? `One or more products failed — entire invoice rejected. ${lineFailures.join(" · ")}`
      : "Entire invoice rejected — no stock out recorded");

  let failed = 0;
  for (const entry of validations) {
    if (entry.ignored) {
      lineResults.push({
        ...entry.baseLine,
        status: "SKIPPED",
        message: "Ignored by user",
      });
      continue;
    }
    const message =
      entry.lineErrors.length > 0
        ? entry.lineErrors.join("; ")
        : `Invoice rejected — entire stock out skipped. ${summary}`;
    lineResults.push({
      ...entry.baseLine,
      status: "FAILED",
      message,
    });
    failed++;
  }

  voucherResults.push({
    ...baseVoucher,
    status: "FAILED",
    message: summary,
  });

  return failed;
}

export async function confirmSalesImport(input: SalesImportConfirmInput, user: AuthUser) {
  const lineCount = input.vouchers.reduce((sum, voucher) => sum + voucher.lines.length, 0);
  assertImportRowCount(lineCount, "Sales import confirm");

  const warehouseIds = [
    ...new Set(
      input.vouchers.flatMap((voucher) =>
        voucher.lines.filter((line) => !line.ignore).map((line) => line.warehouseId.trim())
      )
    ),
  ];
  if (warehouseIds.length === 0) {
    throw new BadRequestError("No product lines to import (all lines ignored)");
  }

  for (const warehouseId of warehouseIds) {
    if (!Types.ObjectId.isValid(warehouseId)) {
      throw new BadRequestError(`Invalid warehouse ID: ${warehouseId}`);
    }
    assertPermission(user, Permission.IMPORTS_SALES, warehouseId);
  }

  const warehouseDocs = await Warehouse.find({
    _id: { $in: warehouseIds.map((id) => new Types.ObjectId(id)) },
    isActive: true,
  }).lean();
  const warehouseById = new Map(
    warehouseDocs.map((warehouse) => [String(warehouse._id), warehouse])
  );
  for (const warehouseId of warehouseIds) {
    if (!warehouseById.has(warehouseId)) {
      throw new NotFoundError(`Warehouse not found or inactive: ${warehouseId}`);
    }
  }

  const { allProducts, allBrands } = await loadSalesImportContext();
  const productById = new Map(allProducts.map((product) => [String(product._id), product]));
  const createdProductCache = new Map<string, string>();
  const brandDocs: Array<{ _id: Types.ObjectId; name: string; isActive?: boolean }> = [
    ...allBrands,
  ];
  const clientDocs: Array<{ _id: Types.ObjectId; name: string; secondaryName?: string }> = [];

  const lineResults: SalesImportResultLine[] = [];
  const voucherResults: SalesImportResultVoucher[] = [];
  let successCount = 0;
  let failedCount = 0;
  let createdProductCount = 0;
  let createdBrandCount = 0;
  let createdClientCount = 0;
  const usedWarehouseIds = new Set<string>();

  for (const voucher of input.vouchers) {
    const draftVoucher = {
      voucherIndex: voucher.voucherIndex,
      headerRowNumber: voucher.headerRowNumber,
      clientName: voucher.clientName.trim(),
      clientSecondaryName: voucher.clientSecondaryName?.trim(),
      invoiceNumber: voucher.invoiceNumber.trim(),
      sellDate: voucher.sellDate?.trim() ?? "",
      clientAction: voucher.clientAction,
      mergeTargetClientId: voucher.mergeTargetClientId,
    };

    const voucherErrors: string[] = [];
    if (!draftVoucher.clientName) voucherErrors.push("Client name is required");
    if (!draftVoucher.invoiceNumber) voucherErrors.push("Invoice number is required");
    if (voucher.lines.length === 0) voucherErrors.push("No product lines to import");
    if (draftVoucher.clientAction === "merge" && !draftVoucher.mergeTargetClientId) {
      voucherErrors.push("Select a client to merge into");
    }

    let resolvedClientName = draftVoucher.clientName;
    let voucherCreatedClientId: string | undefined;

    const activeLines = voucher.lines.filter((line) => !line.ignore);
    if (activeLines.length === 0) {
      for (const line of voucher.lines) {
        lineResults.push({
          rowNumber: line.rowNumber,
          voucherIndex: draftVoucher.voucherIndex,
          headerRowNumber: draftVoucher.headerRowNumber,
          clientName: draftVoucher.clientName,
          invoiceNumber: draftVoucher.invoiceNumber,
          sellDate: draftVoucher.sellDate,
          productName: line.productName.trim(),
          quantity: line.quantity,
          warehouseId: line.warehouseId.trim(),
          status: "SKIPPED",
          message: "Ignored by user",
        });
      }
      voucherResults.push({
        voucherIndex: draftVoucher.voucherIndex,
        headerRowNumber: draftVoucher.headerRowNumber,
        clientName: draftVoucher.clientName,
        invoiceNumber: draftVoucher.invoiceNumber,
        sellDate: draftVoucher.sellDate,
        status: "SUCCESS",
        message: "All product lines ignored — nothing imported",
        movementCount: 0,
      });
      continue;
    }

    if (voucherErrors.length === 0) {
      try {
        const resolvedClient = await resolveClientForVoucher(draftVoucher, user, clientDocs);
        resolvedClientName = resolvedClient.clientName;
        if (resolvedClient.created) {
          createdClientCount++;
          voucherCreatedClientId = resolvedClient.clientId;
        }
      } catch (err) {
        voucherErrors.push(err instanceof Error ? err.message : "Client resolution failed");
      }
    }

    const baseVoucher = {
      voucherIndex: draftVoucher.voucherIndex,
      headerRowNumber: draftVoucher.headerRowNumber,
      clientName: resolvedClientName,
      invoiceNumber: draftVoucher.invoiceNumber,
      sellDate: draftVoucher.sellDate,
    };

    const lineValidations: SalesImportVoucherLineValidation[] = voucher.lines.map((line) => {
      const warehouseId = line.warehouseId.trim();
      const ignored = Boolean(line.ignore);
      const baseLine = {
        rowNumber: line.rowNumber,
        ...baseVoucher,
        productName: line.productName.trim(),
        quantity: line.quantity,
        brandName: line.brandName.trim(),
        brandAction: line.brandAction,
        mergeTargetBrandId: line.mergeTargetBrandId,
        action: line.action,
        mergeTargetProductId: line.mergeTargetProductId,
        warehouseId,
      };

      const lineErrors = ignored ? [] : [...voucherErrors];
      if (!ignored) {
        if (!baseLine.productName) lineErrors.push("Product name is required");
        if (!baseLine.brandName) lineErrors.push("Brand name is required");
        if (!Number.isFinite(baseLine.quantity) || baseLine.quantity < 1) {
          lineErrors.push("Quantity must be at least 1 unit");
        }
        if (!Types.ObjectId.isValid(warehouseId) || !warehouseById.has(warehouseId)) {
          lineErrors.push("Warehouse not found or inactive");
        }
        if (line.brandAction === "merge" && !line.mergeTargetBrandId) {
          lineErrors.push("Select a brand to merge into");
        }
        if (line.action === "merge" && !line.mergeTargetProductId) {
          lineErrors.push("Select a product to merge into");
        }
      }

      return { baseLine, line, lineErrors, ignored };
    });

    const hasValidationFailure = lineValidations.some(
      (entry) => !entry.ignored && entry.lineErrors.length > 0
    );
    if (hasValidationFailure) {
      await rollbackSalesImportCreates({
        clientIds: voucherCreatedClientId ? [voucherCreatedClientId] : [],
      });
      failedCount += rejectEntireVoucher(
        baseVoucher,
        lineValidations,
        "",
        lineResults,
        voucherResults
      );
      continue;
    }

    const warehouseGroups = new Map<string, SalesImportVoucherLineValidation[]>();
    for (const entry of lineValidations) {
      if (entry.ignored) continue;
      const group = warehouseGroups.get(entry.baseLine.warehouseId) ?? [];
      group.push(entry);
      warehouseGroups.set(entry.baseLine.warehouseId, group);
    }

    let duplicateMessage = "";
    for (const [warehouseId] of warehouseGroups) {
      const duplicateInvoice = await StockMovement.exists({
        type: StockMovementType.STOCK_OUT,
        dispatchType: DispatchType.DIRECT_SELLING,
        warehouseId: new Types.ObjectId(warehouseId),
        invoiceNumber: exactCaseInsensitiveRegex(baseVoucher.invoiceNumber),
        clientName: exactCaseInsensitiveRegex(baseVoucher.clientName),
      });
      if (duplicateInvoice) {
        const warehouse = warehouseById.get(warehouseId)!;
        duplicateMessage = `Invoice ${baseVoucher.invoiceNumber} for ${baseVoucher.clientName} was already imported at ${warehouse.name}`;
        break;
      }
    }
    if (duplicateMessage) {
      await rollbackSalesImportCreates({
        clientIds: voucherCreatedClientId ? [voucherCreatedClientId] : [],
      });
      failedCount += rejectEntireVoucher(
        baseVoucher,
        lineValidations,
        duplicateMessage,
        lineResults,
        voucherResults
      );
      continue;
    }

    const notes = baseVoucher.sellDate
      ? `Sales import${input.fileName ? `: ${input.fileName}` : ""} (${baseVoucher.sellDate})`
      : input.fileName
        ? `Sales import: ${input.fileName}`
        : "Sales import";

    const voucherCreatedProductIds: string[] = [];
    const voucherCreatedBrandIds: string[] = [];

    try {
      const resolvedByWarehouse = new Map<
        string,
        Array<{ productId: string; brandId: string; quantity: number }>
      >();

      for (const [warehouseId, group] of warehouseGroups) {
        const batchItems: Array<{ productId: string; brandId: string; quantity: number }> = [];
        for (const { baseLine, line } of group) {
          const resolvedBrand = await resolveBrandForSalesLine(
            {
              brandName: baseLine.brandName,
              brandAction: line.brandAction,
              mergeTargetBrandId: line.mergeTargetBrandId,
            },
            user,
            brandDocs
          );
          if (resolvedBrand.created) {
            createdBrandCount++;
            voucherCreatedBrandIds.push(resolvedBrand.brandId);
          }

          const resolvedProduct = await resolveSalesImportLineProduct(
            line,
            resolvedBrand.brandId,
            createdProductCache,
            productById
          );
          if (resolvedProduct.created) {
            createdProductCount++;
            voucherCreatedProductIds.push(resolvedProduct.productId);
            await AuditLog.create({
              action: "PRODUCT_CREATED",
              entity: "Product",
              entityId: new Types.ObjectId(resolvedProduct.productId),
              userId: new Types.ObjectId(user.id),
              metadata: {
                name: baseLine.productName,
                brandId: resolvedProduct.brandId,
                source: "sales_import",
              },
            });
          }

          batchItems.push({
            productId: resolvedProduct.productId,
            brandId: resolvedProduct.brandId,
            quantity: baseLine.quantity,
          });
        }
        resolvedByWarehouse.set(warehouseId, mergeBatchItems(batchItems));
      }

      let movementCount = 0;
      let lastClientName = baseVoucher.clientName;
      for (const [warehouseId, items] of resolvedByWarehouse) {
        const batchResult = await stockService.stockOutBatch(
          {
            warehouseId,
            clientName: baseVoucher.clientName,
            invoiceNumber: baseVoucher.invoiceNumber,
            notes,
            items: items.map((item) => ({
              brandId: item.brandId,
              productId: item.productId,
              quantity: item.quantity,
            })),
          },
          user,
          { warehousePermission: Permission.IMPORTS_SALES }
        );
        movementCount += batchResult.movements.length;
        lastClientName = batchResult.clientName;
        usedWarehouseIds.add(warehouseId);
      }

      for (const entry of lineValidations) {
        if (entry.ignored) {
          lineResults.push({
            ...entry.baseLine,
            status: "SKIPPED",
            message: "Ignored by user",
          });
          continue;
        }
        const warehouse = warehouseById.get(entry.baseLine.warehouseId);
        lineResults.push({
          ...entry.baseLine,
          status: "SUCCESS",
          message: `Stock out recorded at ${warehouse?.name ?? "warehouse"} (${lastClientName})`,
        });
        successCount++;
      }

      voucherResults.push({
        ...baseVoucher,
        status: "SUCCESS",
        movementCount,
      });
    } catch (err) {
      await rollbackSalesImportCreates({
        productIds: voucherCreatedProductIds,
        brandIds: voucherCreatedBrandIds,
        clientIds: voucherCreatedClientId ? [voucherCreatedClientId] : [],
      });
      const message = err instanceof Error ? err.message : "Stock out failed";
      failedCount += rejectEntireVoucher(
        baseVoucher,
        lineValidations,
        message,
        lineResults,
        voucherResults
      );
    }
  }

  const warehousesUsed = [...usedWarehouseIds]
    .map((id) => warehouseById.get(id))
    .filter((warehouse): warehouse is NonNullable<typeof warehouse> => Boolean(warehouse))
    .map((warehouse) => ({
      id: String(warehouse._id),
      name: warehouse.name,
      code: warehouse.code,
    }));

  // Prefer warehouses touched by successful stock-outs; fall back to all requested.
  const warehouses =
    warehousesUsed.length > 0
      ? warehousesUsed
      : warehouseIds.map((id) => {
          const warehouse = warehouseById.get(id)!;
          return {
            id: String(warehouse._id),
            name: warehouse.name,
            code: warehouse.code,
          };
        });

  await AuditLog.create({
    action: "SALES_IMPORT",
    entity: "StockMovement",
    userId: user.id,
    metadata: {
      fileName: input.fileName,
      warehouseIds,
      warehouseNames: warehouses.map((warehouse) => warehouse.name),
      voucherCount: input.vouchers.length,
      successCount,
      failedCount,
      createdProductCount,
      createdBrandCount,
      createdClientCount,
    },
  });

  return {
    fileName: input.fileName,
    warehouse: warehouses[0]!,
    warehouses,
    totalVouchers: input.vouchers.length,
    totalLines: lineResults.length,
    successCount,
    failedCount,
    createdProductCount,
    createdBrandCount,
    createdClientCount,
    vouchers: voucherResults,
    rows: lineResults,
  };
}
