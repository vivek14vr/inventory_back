import { Types } from "mongoose";
import type { ClientSession } from "mongoose";
import { AuditLog } from "../../models/AuditLog.js";
import { Brand } from "../../models/Brand.js";
import { Client } from "../../models/Client.js";
import { InventoryBalance } from "../../models/InventoryBalance.js";
import { Product } from "../../models/Product.js";
import { StockMovement } from "../../models/StockMovement.js";
import { Transfer } from "../../models/Transfer.js";
import { Warehouse } from "../../models/Warehouse.js";
import { BadRequestError, NotFoundError } from "../../shared/errors/AppError.js";
import type { AuthUser } from "../../shared/types/auth.js";
import { dbSession, runInTransaction } from "../../shared/utils/mongoTransaction.js";
import * as balanceService from "../stock/inventory.service.js";
import {
  INVOICE_QTY_CORRECTION_NOTE_PREFIX,
  saleQuantityInventoryDelta,
  sumReturnedQuantityForSale,
} from "../stock/saleReturn.utils.js";
import { exactCaseInsensitiveRegex } from "../../shared/utils/invoiceMatch.js";
import {
  DispatchType,
  StockMovementType,
  TransferStatus,
} from "../../shared/constants/roles.js";
import {
  buildPaginationMeta,
  filterBySearch,
  getPaginationParams,
  mongoSort,
  paginateArray,
  sortRows,
} from "../../shared/pagination/pagination.js";
import type {
  AdjustStockInput,
  InvoiceListQuery,
  LowStockQuery,
  MovementsQuery,
  StockFilters,
  StockItemDetailQuery,
  StockQuery,
  UpdateMovementInvoiceInput,
  UpdateLowStockThresholdInput,
} from "./inventory.validation.js";
import {
  buildLowStockTotals,
  extractWarehouseColumns,
  groupLowStockByProduct,
  isWarehouseLowStock,
  resolveLowStockThreshold,
  type LowStockTotalRow,
} from "./lowStock.utils.js";
import {
  defaultLowStockThresholdBase,
} from "../../shared/constants/lowStockDefaults.js";

export type { LowStockTotalRow };

export type StockRow = {
  warehouseId: string;
  warehouseName: string;
  warehouseCode: string;
  productId: string;
  productName: string;
  secondaryProductName?: string;
  brandId: string;
  brandName: string;
  quantity: number;
  stockUnit: string;
  unitsPerStockUnit: number;
  baseUnit: string;
  lowStockThreshold?: number;
  /** Set when threshold comes from the warehouse balance override. */
  warehouseLowStockThreshold?: number;
  /** Product-wide fallback threshold (base units). */
  productLowStockThreshold?: number;
  /** Combined low-stock threshold across all warehouses (base units). */
  productTotalLowStockThreshold?: number;
  updatedAt: Date;
};

async function fetchStockRows(query: StockFilters): Promise<StockRow[]> {
  const includeZero = query.includeZero !== false;

  const productFilter: Record<string, unknown> = { isActive: true };
  if (query.brandId && Types.ObjectId.isValid(query.brandId)) {
    productFilter.brandId = query.brandId;
  }
  if (query.productId && Types.ObjectId.isValid(query.productId)) {
    productFilter._id = query.productId;
  }

  const warehouseFilter: Record<string, unknown> = { isActive: true };
  if (query.warehouseId && Types.ObjectId.isValid(query.warehouseId)) {
    warehouseFilter._id = query.warehouseId;
  }

  const [products, warehouses, balances] = await Promise.all([
    Product.find(productFilter)
      .populate<{ brandId: { _id: Types.ObjectId; name: string; isActive?: boolean } }>(
        "brandId",
        "name isActive"
      )
      .lean(),
    Warehouse.find(warehouseFilter).select("name code isActive").lean(),
    InventoryBalance.find({
      ...(query.warehouseId && Types.ObjectId.isValid(query.warehouseId)
        ? { warehouseId: query.warehouseId }
        : {}),
      ...(query.productId && Types.ObjectId.isValid(query.productId)
        ? { productId: query.productId }
        : {}),
    }).lean(),
  ]);

  const balanceByKey = new Map<string, (typeof balances)[number]>();
  for (const balance of balances) {
    balanceByKey.set(
      `${String(balance.warehouseId)}-${String(balance.productId)}`,
      balance
    );
  }

  const rows: StockRow[] = [];

  for (const product of products) {
    const brand = product.brandId as {
      _id: Types.ObjectId;
      name: string;
      isActive?: boolean;
    };
    if (!brand || brand.isActive === false) continue;

    for (const warehouse of warehouses) {
      if (warehouse.isActive === false) continue;

      const key = `${String(warehouse._id)}-${String(product._id)}`;
      const balance = balanceByKey.get(key);
      const quantity = balance?.quantity ?? 0;

      if (!includeZero && quantity === 0) continue;

      const balanceThreshold = balance?.lowStockThreshold ?? undefined;
      const effectiveThreshold = resolveLowStockThreshold(
        balanceThreshold,
        product.lowStockThreshold
      );

      rows.push({
        warehouseId: String(warehouse._id),
        warehouseName: warehouse.name,
        warehouseCode: warehouse.code,
        productId: String(product._id),
        productName: product.name,
        secondaryProductName: product.secondaryName,
        brandId: String(brand._id),
        brandName: brand.name,
        quantity,
        stockUnit: product.stockUnit ?? "unit",
        unitsPerStockUnit: product.unitsPerStockUnit ?? 1,
        baseUnit: product.baseUnit ?? "piece",
        lowStockThreshold: effectiveThreshold,
        warehouseLowStockThreshold: balanceThreshold,
        productLowStockThreshold: product.lowStockThreshold,
        productTotalLowStockThreshold: product.totalLowStockThreshold,
        updatedAt: balance?.updatedAt ?? product.updatedAt,
      });
    }
  }

  return rows;
}


export type StockLocationLastChange = {
  type: "STOCK_IN" | "STOCK_OUT";
  quantity: number;
  createdAt: Date;
};

export type StockProductLocation = {
  warehouseId: string;
  warehouseName: string;
  warehouseCode: string;
  quantity: number;
  lowStockThreshold?: number;
  warehouseLowStockThreshold?: number;
  updatedAt: Date;
  lastChange: StockLocationLastChange | null;
};

export type StockProductRow = {
  productId: string;
  productName: string;
  secondaryProductName?: string;
  brandId: string;
  brandName: string;
  stockUnit: string;
  unitsPerStockUnit: number;
  baseUnit: string;
  locations: StockProductLocation[];
  totalQuantity: number;
  totalLowStockThreshold: number;
  productLowStockThreshold?: number;
  productTotalLowStockThreshold?: number;
};

function groupStockByProduct(rows: StockRow[]): StockProductRow[] {
  const map = new Map<string, StockProductRow>();
  const order: string[] = [];

  for (const r of rows) {
    if (!map.has(r.productId)) {
      order.push(r.productId);
      map.set(r.productId, {
        productId: r.productId,
        productName: r.productName,
        secondaryProductName: r.secondaryProductName,
        brandId: r.brandId,
        brandName: r.brandName,
        stockUnit: r.stockUnit,
        unitsPerStockUnit: r.unitsPerStockUnit,
        baseUnit: r.baseUnit,
        locations: [],
        totalQuantity: 0,
        totalLowStockThreshold: 0,
        productLowStockThreshold: r.productLowStockThreshold,
        productTotalLowStockThreshold: r.productTotalLowStockThreshold,
      });
    }
    const entry = map.get(r.productId)!;
    entry.locations.push({
      warehouseId: r.warehouseId,
      warehouseName: r.warehouseName,
      warehouseCode: r.warehouseCode,
      quantity: r.quantity,
      lowStockThreshold: r.lowStockThreshold,
      warehouseLowStockThreshold: r.warehouseLowStockThreshold,
      updatedAt: r.updatedAt,
      lastChange: null,
    });
    entry.totalQuantity += r.quantity;
    if (r.quantity > 0 && r.lowStockThreshold != null) {
      entry.totalLowStockThreshold += r.lowStockThreshold;
    }
  }

  return order.map((id) => map.get(id)!);
}

async function attachLastChanges(products: StockProductRow[]): Promise<void> {
  if (products.length === 0) return;

  const productIds = products
    .map((p) => p.productId)
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));

  if (productIds.length === 0) return;

  const latest = await StockMovement.aggregate<{
    _id: { productId: Types.ObjectId; warehouseId: Types.ObjectId };
    type: "STOCK_IN" | "STOCK_OUT";
    quantity: number;
    createdAt: Date;
  }>([
    { $match: { productId: { $in: productIds } } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: { productId: "$productId", warehouseId: "$warehouseId" },
        type: { $first: "$type" },
        quantity: { $first: "$quantity" },
        createdAt: { $first: "$createdAt" },
      },
    },
  ]);

  const lastChangeByKey = new Map<string, StockLocationLastChange>();
  for (const entry of latest) {
    const key = `${String(entry._id.productId)}-${String(entry._id.warehouseId)}`;
    lastChangeByKey.set(key, {
      type: entry.type,
      quantity: entry.quantity,
      createdAt: entry.createdAt,
    });
  }

  for (const product of products) {
    for (const loc of product.locations) {
      const key = `${product.productId}-${loc.warehouseId}`;
      loc.lastChange = lastChangeByKey.get(key) ?? null;
    }
  }
}

const PRODUCT_SORT_FIELDS = {
  quantity: (p: StockProductRow) => p.totalQuantity,
  productName: (p: StockProductRow) => p.productName,
  brandName: (p: StockProductRow) => p.brandName,
  warehouseName: (p: StockProductRow) =>
    p.locations
      .map((l) => l.warehouseName)
      .sort((a, b) => a.localeCompare(b))[0] ?? "",
  updatedAt: (p: StockProductRow) =>
    Math.max(...p.locations.map((l) => l.updatedAt.getTime()), 0),
} as const;

export async function listCurrentStock(query: StockQuery) {
  let rows = await fetchStockRows(query);
  rows = filterBySearch(rows, query.search, [
    (r) => r.productName,
    (r) => r.secondaryProductName ?? "",
    (r) => r.brandName,
    (r) => r.warehouseName,
    (r) => r.warehouseCode,
  ]);

  const warehouses = new Map<
    string,
    { warehouseId: string; name: string; code: string; totalUnits: number; skuCount: number }
  >();
  const byBrand = new Map<
    string,
    { brandId: string; name: string; totalUnits: number; skuCount: number }
  >();
  const byProduct = new Map<
    string,
    {
      productId: string;
      productName: string;
      brandId: string;
      brandName: string;
      stockUnit: string;
      unitsPerStockUnit: number;
      baseUnit: string;
      totalUnits: number;
    }
  >();

  let totalUnits = 0;

  for (const r of rows) {
    totalUnits += r.quantity;

    const wh = warehouses.get(r.warehouseId) ?? {
      warehouseId: r.warehouseId,
      name: r.warehouseName,
      code: r.warehouseCode,
      totalUnits: 0,
      skuCount: 0,
    };
    wh.totalUnits += r.quantity;
    if (r.quantity > 0) {
      wh.skuCount += 1;
    }
    warehouses.set(r.warehouseId, wh);

    const br = byBrand.get(r.brandId) ?? {
      brandId: r.brandId,
      name: r.brandName,
      totalUnits: 0,
      skuCount: 0,
    };
    br.totalUnits += r.quantity;
    if (r.quantity > 0) {
      br.skuCount += 1;
    }
    byBrand.set(r.brandId, br);

    const key = `${r.productId}-${r.warehouseId}`;
    byProduct.set(key, {
      productId: r.productId,
      productName: r.productName,
      brandId: r.brandId,
      brandName: r.brandName,
      stockUnit: r.stockUnit,
      unitsPerStockUnit: r.unitsPerStockUnit,
      baseUnit: r.baseUnit,
      totalUnits: r.quantity,
    });
  }

  let productRows = groupStockByProduct(rows);
  productRows = sortRows(
    productRows,
    query.sortBy ?? "productName",
    query.sortOrder ?? "asc",
    PRODUCT_SORT_FIELDS as Record<string, (row: StockProductRow) => string | number>
  );

  const { items: pagedProducts, pagination } = paginateArray(productRows, query);

  await attachLastChanges(pagedProducts);

  const warehouseList = Array.from(warehouses.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const flatItems: StockRow[] = pagedProducts.flatMap((p) =>
    p.locations.map((loc) => ({
      warehouseId: loc.warehouseId,
      warehouseName: loc.warehouseName,
      warehouseCode: loc.warehouseCode,
      productId: p.productId,
      productName: p.productName,
      secondaryProductName: p.secondaryProductName,
      brandId: p.brandId,
      brandName: p.brandName,
      stockUnit: p.stockUnit,
      unitsPerStockUnit: p.unitsPerStockUnit,
      baseUnit: p.baseUnit,
      quantity: loc.quantity,
      lowStockThreshold: loc.lowStockThreshold,
      warehouseLowStockThreshold: loc.warehouseLowStockThreshold,
      productLowStockThreshold: p.productLowStockThreshold,
      productTotalLowStockThreshold: p.productTotalLowStockThreshold,
      updatedAt: loc.updatedAt,
    }))
  );

  return {
    products: pagedProducts,
    warehouses: warehouseList.map((w) => ({
      warehouseId: w.warehouseId,
      name: w.name,
      code: w.code,
    })),
    items: flatItems,
    summary: {
      totalUnits,
      totalSkus: new Set(rows.filter((r) => r.quantity > 0).map((r) => r.productId)).size,
      byWarehouse: warehouseList,
      byBrand: Array.from(byBrand.values()).sort((a, b) => a.name.localeCompare(b.name)),
      byProduct: Array.from(byProduct.values()).sort((a, b) =>
        a.productName.localeCompare(b.productName)
      ),
    },
    pagination,
  };
}

type MovementDoc = {
  _id: Types.ObjectId;
  type: string;
  quantity: number;
  dispatchType?: string;
  clientName?: string;
  invoiceNumber?: string;
  notes?: string;
  transferId?: Types.ObjectId;
  relatedSaleMovementId?: Types.ObjectId;
  invoiceModificationCount?: number;
  createdAt: Date;
  productId?: unknown;
  brandId?: unknown;
  warehouseId?: unknown;
  destinationWarehouseId?: unknown;
  createdBy?: unknown;
};

function mapMovementRow(m: MovementDoc) {
  const product = m.productId as {
    _id: Types.ObjectId;
    name: string;
    secondaryName?: string;
    stockUnit?: string;
    unitsPerStockUnit?: number;
    baseUnit?: string;
  };
  const brand = m.brandId as { _id: Types.ObjectId; name: string };
  const warehouse = m.warehouseId as {
    _id: Types.ObjectId;
    name: string;
    code: string;
  };
  const dest = m.destinationWarehouseId as
    | { _id: Types.ObjectId; name: string; code: string }
    | undefined;
  const createdBy = m.createdBy as { _id: Types.ObjectId; name: string } | undefined;

  return {
    id: String(m._id),
    type: m.type as "STOCK_IN" | "STOCK_OUT",
    quantity: m.quantity,
    dispatchType: m.dispatchType,
    clientName: m.clientName,
    invoiceNumber: m.invoiceNumber,
    notes: m.notes,
    relatedSaleMovementId: m.relatedSaleMovementId
      ? String(m.relatedSaleMovementId)
      : undefined,
    invoiceModificationCount: m.invoiceModificationCount ?? 0,
    transferId: m.transferId ? String(m.transferId) : undefined,
    product: {
      id: String(product._id),
      name: product.name,
      secondaryName: product.secondaryName,
      stockUnit: product.stockUnit,
      unitsPerStockUnit: product.unitsPerStockUnit,
      baseUnit: product.baseUnit,
    },
    brand: { id: String(brand._id), name: brand.name },
    warehouse: {
      id: String(warehouse._id),
      name: warehouse.name,
      code: warehouse.code,
    },
    destinationWarehouse: dest
      ? { id: String(dest._id), name: dest.name, code: dest.code }
      : undefined,
    createdBy: createdBy
      ? { id: String(createdBy._id), name: createdBy.name }
      : undefined,
    createdAt: m.createdAt,
  };
}

function describeMovement(m: {
  type: string;
  dispatchType?: string;
  clientName?: string;
  invoiceNumber?: string;
  notes?: string;
  relatedSaleMovementId?: string;
  destinationWarehouse?: { code: string; name: string };
}): string {
  const notes = m.notes?.trim() ?? "";
  if (notes.toLowerCase().startsWith(INVOICE_QTY_CORRECTION_NOTE_PREFIX.toLowerCase())) {
    return notes;
  }
  if (m.type === StockMovementType.STOCK_IN) {
    if (m.relatedSaleMovementId || notes.toLowerCase().includes("client return")) {
      const client = m.clientName?.trim() || "Client";
      const inv = m.invoiceNumber?.trim();
      return inv ? `Return from ${client} · Invoice ${inv}` : `Return from ${client}`;
    }
    if (notes.toLowerCase().includes("transfer")) {
      return "Transfer received";
    }
    if (notes.toLowerCase().includes("adjustment")) {
      return "Admin adjustment (increase)";
    }
    return notes || "Stock in";
  }

  if (m.dispatchType === DispatchType.TRANSFER && m.destinationWarehouse) {
    return `Transfer to ${m.destinationWarehouse.name} (${m.destinationWarehouse.code})`;
  }
  if (m.dispatchType === DispatchType.DIRECT_SELLING) {
    const client = m.clientName?.trim() || "Client";
    const inv = m.invoiceNumber?.trim();
    return inv ? `Sale to ${client} · Invoice ${inv}` : `Sale to ${client}`;
  }
  if (notes.toLowerCase().includes("adjustment")) {
    return "Admin adjustment (decrease)";
  }
  if (notes.toLowerCase().includes("tally")) {
    return "Tally import deduction";
  }
  return notes || "Stock out";
}

function applyRunningBalances(
  currentQuantity: number,
  movements: MovementDoc[]
): Array<
  ReturnType<typeof mapMovementRow> & {
    direction: "in" | "out";
    change: number;
    balanceAfter: number;
    description: string;
  }
> {
  let running = currentQuantity;

  return movements.map((m) => {
    const row = mapMovementRow(m);
    const balanceAfter = running;
    const direction = m.type === StockMovementType.STOCK_IN ? ("in" as const) : ("out" as const);
    const change = m.type === StockMovementType.STOCK_IN ? m.quantity : -m.quantity;

    if (m.type === StockMovementType.STOCK_IN) {
      running -= m.quantity;
    } else {
      running += m.quantity;
    }

    return {
      ...row,
      direction,
      change,
      balanceAfter,
      description: describeMovement({
        type: m.type,
        dispatchType: m.dispatchType,
        clientName: m.clientName,
        invoiceNumber: m.invoiceNumber,
        notes: m.notes,
        relatedSaleMovementId: m.relatedSaleMovementId
          ? String(m.relatedSaleMovementId)
          : undefined,
        destinationWarehouse: row.destinationWarehouse,
      }),
    };
  });
}

export async function getStockItemDetail(query: StockItemDetailQuery) {
  if (
    !Types.ObjectId.isValid(query.warehouseId) ||
    !Types.ObjectId.isValid(query.productId)
  ) {
    throw new BadRequestError("Invalid warehouse or product");
  }

  const [balance, product] = await Promise.all([
    InventoryBalance.findOne({
      warehouseId: query.warehouseId,
      productId: query.productId,
    })
      .populate<{ productId: { _id: Types.ObjectId; name: string; brandId: Types.ObjectId } }>(
        "productId",
        "name brandId"
      )
      .populate<{ warehouseId: { _id: Types.ObjectId; name: string; code: string } }>(
        "warehouseId",
        "name code"
      )
      .lean(),
    Product.findById(query.productId)
      .populate<{ brandId: { _id: Types.ObjectId; name: string } }>("brandId", "name")
      .lean(),
  ]);

  if (!product) {
    throw new NotFoundError("Product not found");
  }

  const brand = product.brandId as { _id: Types.ObjectId; name: string };
  const balanceWarehouse = balance?.warehouseId as
    | { _id: Types.ObjectId; name: string; code: string }
    | undefined;

  let whDoc: { name: string; code: string };
  if (balanceWarehouse) {
    whDoc = balanceWarehouse;
  } else {
    const wh = await Warehouse.findById(query.warehouseId).lean();
    if (!wh) {
      throw new NotFoundError("Warehouse not found");
    }
    whDoc = { name: wh.name, code: wh.code };
  }
  const currentQuantity = balance?.quantity ?? 0;

  const movementFilter: Record<string, unknown> = {
    warehouseId: query.warehouseId,
    productId: query.productId,
  };
  if (query.type) {
    movementFilter.type = query.type;
  }

  const allMovements = (await StockMovement.find(movementFilter)
    .sort({ createdAt: -1 })
    .populate("productId", "name secondaryName")
    .populate("brandId", "name")
    .populate("warehouseId", "name code")
    .populate("destinationWarehouseId", "name code")
    .populate("createdBy", "name")
    .lean()) as MovementDoc[];

  const totalsByType = await StockMovement.aggregate([
    { $match: movementFilter },
    {
      $group: {
        _id: "$type",
        total: { $sum: "$quantity" },
      },
    },
  ]);

  let totalStockIn = 0;
  let totalStockOut = 0;
  for (const t of totalsByType) {
    if (t._id === StockMovementType.STOCK_IN) totalStockIn = t.total;
    if (t._id === StockMovementType.STOCK_OUT) totalStockOut = t.total;
  }

  // Running balances must be computed on the chronological (createdAt desc)
  // order returned by the query; each row's balanceAfter is then fixed, so we
  // can safely re-order rows for display by the requested sort field.
  const ledger = applyRunningBalances(currentQuantity, allMovements);
  const sortedLedger = sortRows(ledger, query.sortBy, query.sortOrder ?? "desc", {
    createdAt: (r) => new Date(r.createdAt).getTime(),
    quantity: (r) => r.quantity,
    type: (r) => r.type,
  });
  const { items, pagination } = paginateArray(sortedLedger, query);

  return {
    item: {
      warehouseId: query.warehouseId,
      warehouseName: whDoc.name,
      warehouseCode: whDoc.code,
      productId: query.productId,
      productName: product.name,
      secondaryProductName: product.secondaryName,
      brandId: String(brand._id),
      brandName: brand.name,
      stockUnit: product.stockUnit ?? "unit",
      unitsPerStockUnit: product.unitsPerStockUnit ?? 1,
      baseUnit: product.baseUnit ?? "piece",
      quantity: currentQuantity,
      lowStockThreshold: resolveLowStockThreshold(
        balance?.lowStockThreshold,
        product.lowStockThreshold
      ),
      warehouseLowStockThreshold: balance?.lowStockThreshold ?? undefined,
      productLowStockThreshold: product.lowStockThreshold,
      updatedAt: balance?.updatedAt ?? null,
    },
    summary: {
      totalStockIn,
      totalStockOut,
      movementCount: allMovements.length,
    },
    items,
    pagination,
  };
}

export async function listMovementHistory(query: MovementsQuery) {
  const filter: Record<string, unknown> = {};

  if (query.warehouseId && Types.ObjectId.isValid(query.warehouseId)) {
    filter.warehouseId = query.warehouseId;
  }
  if (query.brandId && Types.ObjectId.isValid(query.brandId)) {
    filter.brandId = query.brandId;
  }
  if (query.productId && Types.ObjectId.isValid(query.productId)) {
    filter.productId = query.productId;
  }
  if (query.type) {
    filter.type = query.type;
  }
  if (query.dateFrom || query.dateTo) {
    filter.createdAt = {};
    if (query.dateFrom) {
      (filter.createdAt as Record<string, Date>).$gte = new Date(query.dateFrom);
    }
    if (query.dateTo) {
      const end = new Date(query.dateTo);
      end.setHours(23, 59, 59, 999);
      (filter.createdAt as Record<string, Date>).$lte = end;
    }
  }

  const search = query.search?.trim();
  if (search) {
    const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const [productIds, brandIds, warehouseIds] = await Promise.all([
      Product.find({ $or: [{ name: regex }, { secondaryName: regex }] }).distinct("_id"),
      Brand.find({ name: regex }).distinct("_id"),
      Warehouse.find({ $or: [{ name: regex }, { code: regex }] }).distinct("_id"),
    ]);
    filter.$or = [
      { productId: { $in: productIds } },
      { brandId: { $in: brandIds } },
      { warehouseId: { $in: warehouseIds } },
      { destinationWarehouseId: { $in: warehouseIds } },
      { invoiceNumber: regex },
      { clientName: regex },
    ];
  }

  const { page, limit, skip, sortOrder } = getPaginationParams(query);
  const sortField = mongoSort(query.sortBy ?? "createdAt", sortOrder);

  const [total, movements] = await Promise.all([
    StockMovement.countDocuments(filter),
    StockMovement.find(filter)
      .sort(sortField)
      .skip(skip)
      .limit(limit)
      .populate("productId", "name secondaryName stockUnit unitsPerStockUnit baseUnit")
      .populate("brandId", "name")
      .populate("warehouseId", "name code")
      .populate("destinationWarehouseId", "name code")
      .lean(),
  ]);

  const balanceKeys = new Map<string, { warehouseId: Types.ObjectId; productId: Types.ObjectId }>();
  for (const m of movements as MovementDoc[]) {
    const warehouse = m.warehouseId as { _id: Types.ObjectId } | Types.ObjectId | undefined;
    const product = m.productId as { _id: Types.ObjectId } | Types.ObjectId | undefined;
    const warehouseId =
      warehouse && typeof warehouse === "object" && "_id" in warehouse
        ? warehouse._id
        : (warehouse as Types.ObjectId | undefined);
    const productId =
      product && typeof product === "object" && "_id" in product
        ? product._id
        : (product as Types.ObjectId | undefined);
    if (!warehouseId || !productId) continue;
    balanceKeys.set(`${String(warehouseId)}:${String(productId)}`, {
      warehouseId,
      productId,
    });
  }

  const balancePairs = Array.from(balanceKeys.values());
  const balances =
    balancePairs.length === 0
      ? []
      : await InventoryBalance.find({
          $or: balancePairs.map((pair) => ({
            warehouseId: pair.warehouseId,
            productId: pair.productId,
          })),
        })
          .select("warehouseId productId quantity")
          .lean();

  const balanceByKey = new Map(
    balances.map((row) => [
      `${String(row.warehouseId)}:${String(row.productId)}`,
      row.quantity,
    ])
  );

  const items = (movements as MovementDoc[]).map((m) => {
    const row = mapMovementRow(m);
    const remainingStock =
      row.warehouse?.id && row.product?.id
        ? (balanceByKey.get(`${row.warehouse.id}:${row.product.id}`) ?? 0)
        : 0;
    return { ...row, remainingStock };
  });

  return {
    items,
    pagination: buildPaginationMeta(total, page, limit),
  };
}

export async function listLowStock(query: LowStockQuery) {
  const sharedFilters = {
    brandId: query.brandId,
    includeZero: true as const,
  };

  const [warehouseScopedRows, allWarehouseRows] = await Promise.all([
    fetchStockRows({
      ...sharedFilters,
      warehouseId: query.warehouseId,
    }),
    fetchStockRows(sharedFilters),
  ]);

  const warehouseLowRows = warehouseScopedRows.filter(isWarehouseLowStock);
  const allWarehouseLowRows = allWarehouseRows.filter(isWarehouseLowStock);
  const totalLowRows = buildLowStockTotals(allWarehouseRows);

  const matchesSearch = (parts: string[]) =>
    !query.search?.trim() ||
    parts.some((value) =>
      value.toLowerCase().includes(query.search!.trim().toLowerCase())
    );

  const filteredWarehouseItems = warehouseLowRows.filter((row) =>
    matchesSearch([
      row.productName,
      row.secondaryProductName ?? "",
      row.brandName,
      row.warehouseName,
      row.warehouseCode,
    ])
  );

  const totalLowProductIds = new Set(
    totalLowRows
      .filter((row) =>
        matchesSearch([row.productName, row.secondaryProductName ?? "", row.brandName])
      )
      .map((row) => row.productId)
  );

  const groupedProducts = groupLowStockByProduct(allWarehouseRows, {
    warehouseLowItems: query.warehouseId ? filteredWarehouseItems : allWarehouseLowRows.filter((row) =>
      matchesSearch([
        row.productName,
        row.secondaryProductName ?? "",
        row.brandName,
        row.warehouseName,
        row.warehouseCode,
      ])
    ),
    totalLowProductIds,
  });

  const sortedProducts = sortRows(
    groupedProducts,
    query.sortBy ?? "quantity",
    query.sortOrder ?? "asc",
    {
      quantity: (p) => p.sortQuantity,
      productName: (p) => p.productName,
      brandName: (p) => p.brandName,
      warehouseName: (p) => p.sortQuantity,
      lowStockThreshold: (p) => p.sortLowStockThreshold,
    }
  );

  const warehouseColumns = extractWarehouseColumns(allWarehouseRows);

  const { items, pagination } = paginateArray(sortedProducts, query);

  return {
    count: groupedProducts.length,
    warehouses: warehouseColumns,
    items: items.map(
      ({
        sortQuantity: _sortQuantity,
        sortLowStockThreshold: _sortLowStockThreshold,
        ...product
      }) => product
    ),
    pagination,
  };
}

export async function getAdminDashboard() {
  const allRows = await fetchStockRows({ includeZero: true });
  const stockSummary = buildStockSummary(allRows);

  const [recentMovements, pendingTransfers, warehouses, recentSales] =
    await Promise.all([
      listMovementHistory({
        page: 1,
        limit: 10,
        sortBy: "createdAt",
        sortOrder: "desc",
      }),
      Transfer.countDocuments({ status: TransferStatus.PENDING }),
      Warehouse.find({ isActive: true }).select("name code").lean(),
      StockMovement.find({
        type: StockMovementType.STOCK_OUT,
        dispatchType: DispatchType.DIRECT_SELLING,
      })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate("productId", "name secondaryName")
        .populate("brandId", "name")
        .populate("warehouseId", "name code")
        .lean(),
    ]);

  const lowWarehouseItems = allRows.filter(isWarehouseLowStock);
  const sortedLowWarehouseItems = sortRows(
    lowWarehouseItems,
    "quantity",
    "asc",
    {
      quantity: (r) => r.quantity,
      productName: (r) => r.productName,
      brandName: (r) => r.brandName,
      warehouseName: (r) => r.warehouseName,
      lowStockThreshold: (r) => r.lowStockThreshold ?? 0,
    }
  );
  const lowTotals = buildLowStockTotals(allRows);

  const recentTransfers = await Transfer.find()
    .sort({ createdAt: -1 })
    .limit(15)
    .populate("productId", "name secondaryName")
    .populate("brandId", "name")
    .populate("sourceWarehouseId", "name code")
    .populate("destinationWarehouseId", "name code")
    .populate("createdBy", "name")
    .populate("receivedBy", "name")
    .populate("returnedBy", "name")
    .lean();

  const transferActivity = recentTransfers.map((t) => {
    const product = t.productId as unknown as { name: string };
    const brand = t.brandId as unknown as { name: string };
    const source = t.sourceWarehouseId as unknown as { name: string; code: string };
    const dest = t.destinationWarehouseId as unknown as { name: string; code: string };
    const createdBy = t.createdBy as unknown as { name: string } | null;
    const receivedBy = t.receivedBy as unknown as { name: string } | null;
    const returnedBy = t.returnedBy as unknown as { name: string } | null;
    return {
      id: String(t._id),
      date: t.createdAt.toISOString().slice(0, 10),
      status: t.status,
      quantity: t.quantity,
      product: product.name,
      brand: brand.name,
      sourceWarehouse: source.code,
      destinationWarehouse: dest.code,
      initiatedBy: createdBy?.name,
      receivedBy: receivedBy?.name,
      returnedBy: returnedBy?.name,
      createdAt: t.createdAt,
      receivedAt: t.receivedAt,
      returnedAt: t.returnedAt,
    };
  });

  const sales = recentSales.map((m) => {
    const product = m.productId as unknown as { _id: Types.ObjectId; name: string };
    const brand = m.brandId as unknown as { _id: Types.ObjectId; name: string };
    const warehouse = m.warehouseId as unknown as {
      _id: Types.ObjectId;
      name: string;
      code: string;
    };
    return {
      id: String(m._id),
      quantity: m.quantity,
      clientName: m.clientName,
      invoiceNumber: m.invoiceNumber,
      product: product.name,
      brand: brand.name,
      warehouse: warehouse.name,
      createdAt: m.createdAt,
    };
  });

  return {
    totalInventoryUnits: stockSummary.totalUnits,
    totalSkus: stockSummary.totalSkus,
    warehouseCount: warehouses.length,
    pendingTransfers,
    lowStockCount: lowWarehouseItems.length,
    lowStockItems: sortedLowWarehouseItems.slice(0, 10).map((row) => ({
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName,
      warehouseCode: row.warehouseCode,
      productId: row.productId,
      productName: row.productName,
      secondaryProductName: row.secondaryProductName,
      brandId: row.brandId,
      brandName: row.brandName,
      quantity: row.quantity,
      lowStockThreshold: row.lowStockThreshold,
      warehouseLowStockThreshold: row.warehouseLowStockThreshold,
      stockUnit: row.stockUnit,
      unitsPerStockUnit: row.unitsPerStockUnit,
      baseUnit: row.baseUnit,
    })),
    lowStockTotalCount: lowTotals.length,
    lowStockTotals: lowTotals.slice(0, 10).map((row) => ({
      productId: row.productId,
      productName: row.productName,
      secondaryProductName: row.secondaryProductName,
      brandId: row.brandId,
      brandName: row.brandName,
      totalQuantity: row.totalQuantity,
      totalLowStockThreshold: row.totalLowStockThreshold,
      stockUnit: row.stockUnit,
      unitsPerStockUnit: row.unitsPerStockUnit,
      baseUnit: row.baseUnit,
    })),
    transferActivity,
    warehouseSummaries: stockSummary.byWarehouse,
    recentMovements: recentMovements.items,
    recentSales: sales,
  };
}

function buildStockSummary(rows: StockRow[]) {
  const byWarehouse = new Map<
    string,
    { warehouseId: string; name: string; code: string; totalUnits: number; skuCount: number }
  >();
  const uniqueProducts = new Set<string>();
  let totalUnits = 0;

  for (const r of rows) {
    totalUnits += r.quantity;
    if (r.quantity > 0) {
      uniqueProducts.add(r.productId);
    }
    const wh = byWarehouse.get(r.warehouseId) ?? {
      warehouseId: r.warehouseId,
      name: r.warehouseName,
      code: r.warehouseCode,
      totalUnits: 0,
      skuCount: 0,
    };
    wh.totalUnits += r.quantity;
    if (r.quantity > 0) {
      wh.skuCount += 1;
    }
    byWarehouse.set(r.warehouseId, wh);
  }

  return {
    totalUnits,
    totalSkus: uniqueProducts.size,
    byWarehouse: Array.from(byWarehouse.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    ),
  };
}

export async function adjustStockBalance(input: AdjustStockInput, user: AuthUser) {
  if (!Types.ObjectId.isValid(input.warehouseId)) {
    throw new BadRequestError("Invalid warehouse");
  }

  const warehouse = await Warehouse.findOne({
    _id: input.warehouseId,
    isActive: true,
  });
  if (!warehouse) {
    throw new NotFoundError("Warehouse not found");
  }

  const {
    productId,
    brandId,
    name: productName,
  } = await balanceService.validateProductForBrand(input.productId, input.brandId);

  return runInTransaction(async (session) => {
    const { previous, next, delta } = await balanceService.setBalance(
      input.warehouseId,
      String(productId),
      input.quantity,
      session
    );

    if (delta !== 0) {
      const movementType =
        delta > 0 ? StockMovementType.STOCK_IN : StockMovementType.STOCK_OUT;

      const [movement] = await StockMovement.create(
        [
          {
            type: movementType,
            warehouseId: input.warehouseId,
            productId,
            brandId,
            quantity: Math.abs(delta),
            notes: input.reason
              ? `Admin adjustment: ${input.reason}`
              : "Admin adjustment",
            createdBy: user.id,
          },
        ],
        dbSession(session)
      );

      await AuditLog.create(
        [
          {
            action: "STOCK_ADJUSTED",
            entity: "StockMovement",
            entityId: movement._id,
            userId: user.id,
            metadata: {
              warehouseId: input.warehouseId,
              warehouseName: warehouse.name,
              warehouseCode: warehouse.code,
              productId: String(productId),
              productName,
              previous,
              next,
              ...(input.reason ? { reason: input.reason } : {}),
            },
          },
        ],
        dbSession(session)
      );
    }

    return {
      warehouseId: input.warehouseId,
      productId: String(productId),
      brandId: String(brandId),
      previousQuantity: previous,
      quantity: next,
      changed: delta !== 0,
    };
  });
}

export async function ensureProductBalancesForAllWarehouses(
  productId: string,
  session?: ClientSession | null
) {
  if (!Types.ObjectId.isValid(productId)) {
    throw new BadRequestError("Invalid product");
  }

  const product = await Product.findById(productId).session(session ?? null).lean();
  if (!product) {
    throw new NotFoundError("Product not found");
  }

  const [warehouses, existingBalances] = await Promise.all([
    Warehouse.find({ isActive: true }).select("_id").session(session ?? null).lean(),
    InventoryBalance.find({ productId }).select("warehouseId").session(session ?? null).lean(),
  ]);

  const existingWarehouseIds = new Set(
    existingBalances.map((balance) => String(balance.warehouseId))
  );

  const missing = warehouses
    .filter((warehouse) => !existingWarehouseIds.has(String(warehouse._id)))
    .map((warehouse) => ({
      warehouseId: warehouse._id,
      productId,
      quantity: 0,
    }));

  if (missing.length > 0) {
    await InventoryBalance.insertMany(missing, dbSession(session));
  }
}

/** Ensures every active warehouse has an explicit low-stock threshold (default 10 cartons). */
export async function ensureDefaultWarehouseLowStockThresholds(
  productId: string,
  session?: ClientSession | null
) {
  if (!Types.ObjectId.isValid(productId)) {
    throw new BadRequestError("Invalid product");
  }

  const product = await Product.findById(productId).session(session ?? null).lean();
  if (!product) {
    throw new NotFoundError("Product not found");
  }

  const per = product.unitsPerStockUnit ?? 1;
  const defaultBase = defaultLowStockThresholdBase(per);

  if (product.totalLowStockThreshold == null) {
    await Product.updateOne(
      { _id: productId },
      { $set: { totalLowStockThreshold: defaultBase } },
      dbSession(session)
    );
  }

  await ensureProductBalancesForAllWarehouses(productId, session);

  await InventoryBalance.updateMany(
    {
      productId,
      $or: [{ lowStockThreshold: { $exists: false } }, { lowStockThreshold: null }],
    },
    { $set: { lowStockThreshold: defaultBase } },
    dbSession(session)
  );
}

export async function updateLowStockThreshold(
  input: UpdateLowStockThresholdInput,
  user: AuthUser,
  session?: ClientSession | null
) {
  if (
    !Types.ObjectId.isValid(input.warehouseId) ||
    !Types.ObjectId.isValid(input.productId)
  ) {
    throw new BadRequestError("Invalid warehouse or product");
  }

  const [warehouse, product, existingBalance] = await Promise.all([
    Warehouse.findOne({ _id: input.warehouseId, isActive: true })
      .session(session ?? null)
      .lean(),
    Product.findById(input.productId).session(session ?? null).lean(),
    InventoryBalance.findOne({
      warehouseId: input.warehouseId,
      productId: input.productId,
    }).session(session ?? null),
  ]);

  if (!warehouse) {
    throw new NotFoundError("Warehouse not found");
  }
  if (!product) {
    throw new NotFoundError("Product not found");
  }

  let balance = existingBalance;
  if (!balance) {
    if (input.lowStockThreshold === null) {
      throw new NotFoundError("No stock record for this product at this warehouse");
    }
    const [created] = await InventoryBalance.create(
      [
        {
          warehouseId: input.warehouseId,
          productId: input.productId,
          quantity: 0,
          lowStockThreshold: input.lowStockThreshold,
        },
      ],
      dbSession(session)
    );
    balance = created;
  } else {
    if (input.lowStockThreshold === null) {
      balance.lowStockThreshold = undefined;
    } else {
      balance.lowStockThreshold = input.lowStockThreshold;
    }
    await balance.save(dbSession(session));
  }

  const effectiveThreshold = resolveLowStockThreshold(
    balance.lowStockThreshold,
    product.lowStockThreshold
  );

  await AuditLog.create(
    [
      {
        action: "LOW_STOCK_THRESHOLD_UPDATED",
        entity: "InventoryBalance",
        entityId: balance._id,
        userId: user.id,
        metadata: {
          warehouseId: input.warehouseId,
          warehouseName: warehouse.name,
          warehouseCode: warehouse.code,
          productId: input.productId,
          productName: product.name,
          lowStockThreshold: input.lowStockThreshold,
          effectiveThreshold,
        },
      },
    ],
    dbSession(session)
  );

  return {
    warehouseId: input.warehouseId,
    productId: input.productId,
    warehouseLowStockThreshold: balance.lowStockThreshold ?? null,
    productLowStockThreshold: product.lowStockThreshold ?? null,
    lowStockThreshold: effectiveThreshold ?? null,
  };
}

export type ProductWarehouseThresholdRow = {
  warehouseId: string;
  warehouseName: string;
  warehouseCode: string;
  quantity: number;
  warehouseLowStockThreshold: number | null;
  effectiveLowStockThreshold: number | null;
};

export type ProductWarehouseLowStockOverride = {
  warehouseId: string;
  warehouseName: string;
  warehouseCode: string;
  lowStockThreshold: number;
};

export async function getWarehouseLowStockOverridesForProducts(
  productIds: string[]
): Promise<Map<string, ProductWarehouseLowStockOverride[]>> {
  const result = new Map<string, ProductWarehouseLowStockOverride[]>();
  for (const id of productIds) {
    result.set(id, []);
  }

  const validIds = productIds
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));

  if (validIds.length === 0) return result;

  const balances = await InventoryBalance.find({
    productId: { $in: validIds },
    lowStockThreshold: { $exists: true, $ne: null },
  })
    .populate<{
      warehouseId: { _id: Types.ObjectId; name: string; code: string; isActive?: boolean };
    }>("warehouseId", "name code isActive")
    .lean();

  for (const balance of balances) {
    if (balance.lowStockThreshold == null) continue;
    const warehouse = balance.warehouseId;
    if (!warehouse || typeof warehouse !== "object") continue;
    if (warehouse.isActive === false) continue;

    const productId = String(balance.productId);
    const list = result.get(productId) ?? [];
    list.push({
      warehouseId: String(warehouse._id),
      warehouseName: warehouse.name,
      warehouseCode: warehouse.code,
      lowStockThreshold: balance.lowStockThreshold,
    });
    result.set(productId, list);
  }

  for (const [productId, list] of result) {
    list.sort((a, b) => a.warehouseName.localeCompare(b.warehouseName));
    result.set(productId, list);
  }

  return result;
}

export async function listProductWarehouseThresholds(
  productId: string
): Promise<ProductWarehouseThresholdRow[]> {
  if (!Types.ObjectId.isValid(productId)) {
    throw new BadRequestError("Invalid product");
  }

  const product = await Product.findById(productId).lean();
  if (!product) {
    throw new NotFoundError("Product not found");
  }

  const [warehouses, balances] = await Promise.all([
    Warehouse.find({ isActive: true }).sort({ name: 1 }).lean(),
    InventoryBalance.find({ productId }).lean(),
  ]);

  const balanceByWarehouse = new Map(
    balances.map((b) => [String(b.warehouseId), b])
  );

  return warehouses.map((wh) => {
    const balance = balanceByWarehouse.get(String(wh._id));
    const warehouseThreshold = balance?.lowStockThreshold;
    return {
      warehouseId: String(wh._id),
      warehouseName: wh.name,
      warehouseCode: wh.code,
      quantity: balance?.quantity ?? 0,
      warehouseLowStockThreshold: warehouseThreshold ?? null,
      effectiveLowStockThreshold:
        resolveLowStockThreshold(warehouseThreshold, product.lowStockThreshold) ??
        null,
    };
  });
}

export async function updateProductWarehouseThresholds(
  productId: string,
  thresholds: Array<{ warehouseId: string; lowStockThreshold: number | null }>,
  user: AuthUser,
  session?: ClientSession | null
) {
  if (!Types.ObjectId.isValid(productId)) {
    throw new BadRequestError("Invalid product");
  }

  const product = await Product.findById(productId).session(session ?? null).lean();
  if (!product) {
    throw new NotFoundError("Product not found");
  }

  const results = [];
  for (const row of thresholds) {
    const result = await updateLowStockThreshold(
      {
        warehouseId: row.warehouseId,
        productId,
        lowStockThreshold: row.lowStockThreshold,
      },
      user,
      session
    );
    results.push(result);
  }
  return results;
}

export async function listInvoiceMovements(query: InvoiceListQuery) {
  const rows = await fetchInvoiceMovementRows(query);
  const sortBy = query.sortBy ?? "createdAt";
  const sorted = sortInvoiceMovementRows(rows, sortBy, query.sortOrder ?? "desc");
  const { items, pagination } = paginateArray(sorted, query);
  return { items, pagination };
}

export type InvoiceGroupLine = {
  movementId: string;
  productId: string;
  productName: string;
  secondaryProductName?: string;
  brandName: string;
  quantity: number;
  stockUnit?: string;
  unitsPerStockUnit?: number;
  baseUnit?: string;
  type: "STOCK_IN" | "STOCK_OUT";
  dispatchType?: string;
  invoiceModificationCount?: number;
  createdAt: string;
};

export type InvoiceGroup = {
  id: string;
  invoiceNumber: string;
  clientName: string;
  createdAt: string;
  voucherType: string;
  warehouse?: { id: string; name: string; code: string };
  modificationCount: number;
  lines: InvoiceGroupLine[];
};

async function resolveInvoiceMovementFilter(
  query: Pick<InvoiceListQuery, "search" | "warehouseId" | "clientId">
) {
  const filter: Record<string, unknown> = {
    $and: [
      {
        $or: [
          { dispatchType: DispatchType.DIRECT_SELLING },
          { invoiceNumber: { $exists: true, $nin: [null, ""] } },
          { clientName: { $exists: true, $nin: [null, ""] } },
        ],
      },
      {
        notes: {
          $not: {
            $regex: `^${INVOICE_QTY_CORRECTION_NOTE_PREFIX}`,
            $options: "i",
          },
        },
      },
    ],
  };

  const warehouseId = query.warehouseId?.trim();
  if (warehouseId) {
    if (!Types.ObjectId.isValid(warehouseId)) {
      throw new BadRequestError("Invalid warehouse filter");
    }
    filter.warehouseId = new Types.ObjectId(warehouseId);
  }

  const clientId = query.clientId?.trim();
  if (clientId) {
    if (!Types.ObjectId.isValid(clientId)) {
      throw new BadRequestError("Invalid client filter");
    }
    const client = await Client.findById(clientId).lean();
    if (!client) {
      throw new NotFoundError("Client not found");
    }
    filter.clientName = exactCaseInsensitiveRegex(client.name);
  }

  const term = query.search?.trim();
  if (term) {
    const regex = { $regex: term, $options: "i" };
    const productIds = await Product.find({
      $or: [{ name: regex }, { secondaryName: regex }],
    }).distinct("_id");
    const searchClauses: Record<string, unknown>[] = [
      { invoiceNumber: regex },
      { clientName: regex },
    ];
    if (productIds.length > 0) {
      searchClauses.push({ productId: { $in: productIds } });
    }
    (filter.$and as Record<string, unknown>[]).push({ $or: searchClauses });
  }

  return filter;
}

async function fetchInvoiceMovementRows(
  query: Pick<InvoiceListQuery, "search" | "warehouseId" | "clientId">
) {
  const filter = await resolveInvoiceMovementFilter(query);

  const movements = await StockMovement.find(filter)
    .sort({ createdAt: -1 })
    .populate("productId", "name secondaryName stockUnit unitsPerStockUnit baseUnit")
    .populate("brandId", "name")
    .populate("warehouseId", "name code")
    .populate("destinationWarehouseId", "name code")
    .lean();

  return (movements as MovementDoc[]).map((m) => mapMovementRow(m));
}

function voucherTypeLabel(row: ReturnType<typeof mapMovementRow>): string {
  if (row.notes?.toLowerCase().startsWith(INVOICE_QTY_CORRECTION_NOTE_PREFIX.toLowerCase())) {
    return "Invoice edit";
  }
  if (row.type === "STOCK_IN") return "Return";
  if (row.dispatchType === "DIRECT_SELLING") return "Sales";
  if (row.dispatchType === "TRANSFER") return "Transfer";
  return row.type === "STOCK_OUT" ? "Stock Out" : "Stock In";
}

function buildInvoiceGroupKey(row: ReturnType<typeof mapMovementRow>): string {
  const invoice = row.invoiceNumber?.trim();
  if (invoice) {
    return [
      invoice.toLowerCase(),
      (row.clientName?.trim() ?? "").toLowerCase(),
      row.warehouse?.id ?? "",
      row.type,
      row.dispatchType ?? "",
    ].join("|");
  }
  return `movement:${row.id}`;
}

function movementCreatedAtIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function saleInvoiceSiblingFilter(params: {
  invoiceNumber?: string;
  clientName?: string;
  warehouseId: Types.ObjectId;
}) {
  const previousInvoice = params.invoiceNumber?.trim();
  const previousClient = params.clientName?.trim();
  return {
    type: StockMovementType.STOCK_OUT,
    dispatchType: DispatchType.DIRECT_SELLING,
    warehouseId: params.warehouseId,
    ...(previousInvoice
      ? { invoiceNumber: exactCaseInsensitiveRegex(previousInvoice) }
      : {}),
    ...(previousClient
      ? { clientName: exactCaseInsensitiveRegex(previousClient) }
      : {}),
  };
}

async function incrementInvoiceModificationCount(
  params: {
    invoiceNumber?: string;
    clientName?: string;
    warehouseId: Types.ObjectId;
  },
  session: ClientSession | null
) {
  await StockMovement.updateMany(saleInvoiceSiblingFilter(params), {
    $inc: { invoiceModificationCount: 1 },
  }).session(session ?? null);
}

function toInvoiceGroupLine(row: ReturnType<typeof mapMovementRow>): InvoiceGroupLine {
  return {
    movementId: row.id,
    productId: row.product?.id ?? "",
    productName: row.product?.name ?? "Unknown product",
    secondaryProductName: row.product?.secondaryName,
    brandName: row.brand?.name ?? "",
    quantity: row.quantity,
    stockUnit: row.product?.stockUnit,
    unitsPerStockUnit: row.product?.unitsPerStockUnit,
    baseUnit: row.product?.baseUnit,
    type: row.type,
    dispatchType: row.dispatchType,
    invoiceModificationCount: row.invoiceModificationCount ?? 0,
    createdAt: movementCreatedAtIso(row.createdAt),
  };
}

function groupInvoiceMovementRows(rows: ReturnType<typeof mapMovementRow>[]): InvoiceGroup[] {
  const groups = new Map<string, InvoiceGroup>();

  for (const row of rows) {
    const key = buildInvoiceGroupKey(row);
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        id: key,
        invoiceNumber: row.invoiceNumber?.trim() ?? "",
        clientName: row.clientName?.trim() ?? "",
        createdAt: movementCreatedAtIso(row.createdAt),
        voucherType: voucherTypeLabel(row),
        warehouse: row.warehouse,
        modificationCount: row.invoiceModificationCount ?? 0,
        lines: [toInvoiceGroupLine(row)],
      });
      continue;
    }

    existing.lines.push(toInvoiceGroupLine(row));
    if (new Date(row.createdAt).getTime() < new Date(existing.createdAt).getTime()) {
      existing.createdAt = movementCreatedAtIso(row.createdAt);
    }
    existing.modificationCount = Math.max(
      existing.modificationCount,
      row.invoiceModificationCount ?? 0
    );
  }

  for (const group of groups.values()) {
    group.modificationCount = Math.max(
      group.modificationCount,
      ...group.lines.map((line) => line.invoiceModificationCount ?? 0)
    );
    group.lines.sort((a, b) => a.productName.localeCompare(b.productName));
  }

  return Array.from(groups.values());
}

function sortInvoiceMovementRows(
  rows: ReturnType<typeof mapMovementRow>[],
  sortBy: NonNullable<InvoiceListQuery["sortBy"]>,
  sortOrder: "asc" | "desc"
) {
  return sortRows(rows, sortBy, sortOrder, {
    createdAt: (r) => new Date(r.createdAt).getTime(),
    clientName: (r) => r.clientName ?? "",
    invoiceNumber: (r) => r.invoiceNumber ?? "",
    quantity: (r) => r.quantity,
    type: (r) => r.type,
    modificationCount: (r) => r.invoiceModificationCount ?? 0,
  });
}

function sortInvoiceGroups(
  groups: InvoiceGroup[],
  sortBy: NonNullable<InvoiceListQuery["sortBy"]>,
  sortOrder: "asc" | "desc"
) {
  return sortRows(groups, sortBy, sortOrder, {
    createdAt: (g) => new Date(g.createdAt).getTime(),
    clientName: (g) => g.clientName,
    invoiceNumber: (g) => g.invoiceNumber,
    quantity: (g) => g.lines.reduce((sum, line) => sum + line.quantity, 0),
    type: (g) => g.voucherType,
    modificationCount: (g) => g.modificationCount,
  });
}

export async function listInvoiceGroups(query: InvoiceListQuery) {
  const rows = await fetchInvoiceMovementRows(query);
  const sortBy = query.sortBy ?? "createdAt";
  const groups = sortInvoiceGroups(
    groupInvoiceMovementRows(rows),
    sortBy,
    query.sortOrder ?? "desc"
  );
  const { items, pagination } = paginateArray(groups, query);
  return { items, pagination };
}

export async function searchMovementsForInvoiceFix(query: InvoiceListQuery) {
  return listInvoiceMovements(query);
}

export async function updateMovementInvoice(
  movementId: string,
  input: UpdateMovementInvoiceInput,
  user: AuthUser
) {
  if (!Types.ObjectId.isValid(movementId)) {
    throw new BadRequestError("Invalid movement id");
  }

  const applyUpdate = async (session: ClientSession | null = null) => {
    const movement = await StockMovement.findById(movementId).session(session ?? null);
    if (!movement) {
      throw new NotFoundError("Stock movement not found");
    }

    const previousInvoice = movement.invoiceNumber?.trim() || "";
    const previousClient = movement.clientName?.trim() || "";
    const nextInvoice =
      input.invoiceNumber !== undefined ? input.invoiceNumber.trim() : previousInvoice;
    const nextClient =
      input.clientName !== undefined ? input.clientName.trim() : previousClient;

    const invoiceChanged = nextInvoice !== previousInvoice;
    const clientChanged = nextClient !== previousClient;

    const batchQuantityUpdates = input.lineUpdates ?? [];
    const singleQuantityUpdate =
      input.quantity !== undefined && batchQuantityUpdates.length === 0
        ? [{ movementId, quantity: input.quantity }]
        : [];
    const quantityUpdates = [...batchQuantityUpdates, ...singleQuantityUpdate];

    if (!invoiceChanged && !clientChanged && quantityUpdates.length === 0) {
      const unchanged = await StockMovement.findById(movementId)
        .populate("productId", "name secondaryName stockUnit unitsPerStockUnit baseUnit")
        .populate("brandId", "name")
        .populate("warehouseId", "name code")
        .populate("destinationWarehouseId", "name code")
        .session(session ?? null)
        .lean();
      return mapMovementRow(unchanged as MovementDoc);
    }

    for (const update of quantityUpdates) {
      if (!Types.ObjectId.isValid(update.movementId)) {
        throw new BadRequestError("Invalid movement id in line updates");
      }

      const lineMovement = await StockMovement.findById(update.movementId).session(
        session ?? null
      );
      if (!lineMovement) {
        throw new NotFoundError("Stock movement not found");
      }
      if (
        lineMovement.type !== StockMovementType.STOCK_OUT ||
        lineMovement.dispatchType !== DispatchType.DIRECT_SELLING
      ) {
        throw new BadRequestError("Quantity can only be updated on client sale invoices");
      }

      const previousQuantity = lineMovement.quantity;
      const nextQuantity = update.quantity;
      if (nextQuantity === previousQuantity) {
        continue;
      }
      if (nextQuantity < 0) {
        throw new BadRequestError("Quantity cannot be negative");
      }

      const returnedQuantity = await sumReturnedQuantityForSale(
        {
          _id: lineMovement._id,
          invoiceNumber: lineMovement.invoiceNumber,
          clientName: lineMovement.clientName,
          productId: lineMovement.productId,
          warehouseId: lineMovement.warehouseId,
        },
        session
      );

      if (nextQuantity < returnedQuantity) {
        throw new BadRequestError(
          `Sold quantity cannot be below ${returnedQuantity} — that much has already been returned on this line`
        );
      }

      const delta = saleQuantityInventoryDelta(
        previousQuantity,
        nextQuantity,
        returnedQuantity
      );
      if (delta < 0) {
        await balanceService.assertSufficientStock(
          String(lineMovement.warehouseId),
          String(lineMovement.productId),
          Math.abs(delta),
          session
        );
      }
      if (delta !== 0) {
        await balanceService.adjustBalance(
          String(lineMovement.warehouseId),
          String(lineMovement.productId),
          delta,
          session
        );

        const clientLabel = lineMovement.clientName?.trim() || "Client";
        const invoiceLabel = lineMovement.invoiceNumber?.trim() || "—";
        await StockMovement.create(
          [
            {
              type:
                delta > 0 ? StockMovementType.STOCK_IN : StockMovementType.STOCK_OUT,
              warehouseId: lineMovement.warehouseId,
              productId: lineMovement.productId,
              brandId: lineMovement.brandId,
              quantity: Math.abs(delta),
              clientName: lineMovement.clientName,
              invoiceNumber: lineMovement.invoiceNumber,
              relatedSaleMovementId: lineMovement._id,
              notes: `${INVOICE_QTY_CORRECTION_NOTE_PREFIX} · ${clientLabel} · ${invoiceLabel} · sold ${previousQuantity} → ${nextQuantity}`,
              createdBy: user.id,
            },
          ],
          dbSession(session)
        );
      }

      lineMovement.quantity = nextQuantity;
      lineMovement.invoiceModificationCount =
        (lineMovement.invoiceModificationCount ?? 0) + 1;
      await lineMovement.save({ session });

      const lineRow = mapMovementRow(
        (await StockMovement.findById(lineMovement._id)
          .populate("productId", "name secondaryName stockUnit unitsPerStockUnit baseUnit")
          .populate("brandId", "name")
          .populate("warehouseId", "name code")
          .populate("destinationWarehouseId", "name code")
          .session(session ?? null)
          .lean()) as MovementDoc
      );

      await AuditLog.create(
        [
          {
            action: "INVOICE_UPDATED",
            entity: "StockMovement",
            entityId: lineMovement._id,
            userId: user.id,
            metadata: {
              movementId: String(lineMovement._id),
              movementType: lineMovement.type,
              productId: lineRow.product?.id,
              productName: lineRow.product?.name,
              brandId: lineRow.brand?.id,
              brandName: lineRow.brand?.name,
              warehouseId: lineRow.warehouse?.id,
              warehouseName: lineRow.warehouse?.name,
              warehouseCode: lineRow.warehouse?.code,
              previousInvoiceNumber: lineMovement.invoiceNumber ?? undefined,
              invoiceNumber: lineMovement.invoiceNumber ?? undefined,
              previousClientName: lineMovement.clientName ?? undefined,
              clientName: lineMovement.clientName ?? undefined,
              previousQuantity,
              quantity: nextQuantity,
              inventoryDelta: delta,
            },
          },
        ],
        { session }
      );
    }

    if (invoiceChanged || clientChanged) {
      const saleSiblingFilter = saleInvoiceSiblingFilter({
        invoiceNumber: previousInvoice,
        clientName: previousClient,
        warehouseId: movement.warehouseId,
      });
      const saleUpdate: Record<string, unknown> = {};
      if (invoiceChanged) {
        saleUpdate.invoiceNumber = nextInvoice || undefined;
      }
      if (clientChanged) {
        saleUpdate.clientName = nextClient || undefined;
      }

      const saleLines = await StockMovement.find(saleSiblingFilter).session(session ?? null);
      await StockMovement.updateMany(saleSiblingFilter, { $set: saleUpdate }).session(
        session ?? null
      );

      for (const saleLine of saleLines) {
        const returnSyncFilter: Record<string, unknown> = {
          type: StockMovementType.STOCK_IN,
          $or: [
            { relatedSaleMovementId: saleLine._id },
            {
              relatedSaleMovementId: { $exists: false },
              productId: saleLine.productId,
              warehouseId: saleLine.warehouseId,
              ...(previousInvoice
                ? { invoiceNumber: exactCaseInsensitiveRegex(previousInvoice) }
                : {}),
              ...(previousClient
                ? { clientName: exactCaseInsensitiveRegex(previousClient) }
                : {}),
            },
          ],
        };

        await StockMovement.updateMany(returnSyncFilter, {
          $set: saleUpdate,
        }).session(session ?? null);
      }

      const anchorRow = mapMovementRow(
        (await StockMovement.findById(movementId)
          .populate("productId", "name secondaryName stockUnit unitsPerStockUnit baseUnit")
          .populate("brandId", "name")
          .populate("warehouseId", "name code")
          .populate("destinationWarehouseId", "name code")
          .session(session ?? null)
          .lean()) as MovementDoc
      );

      await AuditLog.create(
        [
          {
            action: "INVOICE_UPDATED",
            entity: "StockMovement",
            entityId: movement._id,
            userId: user.id,
            metadata: {
              movementId: String(movement._id),
              movementType: movement.type,
              productId: anchorRow.product?.id,
              productName: anchorRow.product?.name,
              brandId: anchorRow.brand?.id,
              brandName: anchorRow.brand?.name,
              warehouseId: anchorRow.warehouse?.id,
              warehouseName: anchorRow.warehouse?.name,
              warehouseCode: anchorRow.warehouse?.code,
              previousClientName: previousClient || undefined,
              clientName: nextClient || undefined,
              previousInvoiceNumber: previousInvoice || undefined,
              invoiceNumber: nextInvoice || undefined,
              updatedLineCount: saleLines.length,
            },
          },
        ],
        { session }
      );
    }

    if (invoiceChanged || clientChanged) {
      await incrementInvoiceModificationCount(
        {
          invoiceNumber: previousInvoice,
          clientName: previousClient,
          warehouseId: movement.warehouseId,
        },
        session
      );
    }

    const refreshed = await StockMovement.findById(movementId)
      .populate("productId", "name secondaryName stockUnit unitsPerStockUnit baseUnit")
      .populate("brandId", "name")
      .populate("warehouseId", "name code")
      .populate("destinationWarehouseId", "name code")
      .session(session ?? null)
      .lean();

    return mapMovementRow(refreshed as MovementDoc);
  };

  return runInTransaction(applyUpdate);
}

export async function deleteSaleInvoice(movementId: string, user: AuthUser) {
  if (!Types.ObjectId.isValid(movementId)) {
    throw new BadRequestError("Invalid movement id");
  }

  return runInTransaction(async (session) => {
    const movement = await StockMovement.findById(movementId).session(session ?? null);
    if (!movement) {
      throw new NotFoundError("Stock movement not found");
    }

    if (
      movement.type !== StockMovementType.STOCK_OUT ||
      movement.dispatchType !== DispatchType.DIRECT_SELLING
    ) {
      throw new BadRequestError("Only client sale invoices can be deleted");
    }

    const returnedQuantity = await sumReturnedQuantityForSale(
      {
        _id: movement._id,
        invoiceNumber: movement.invoiceNumber,
        clientName: movement.clientName,
        productId: movement.productId,
        warehouseId: movement.warehouseId,
      },
      session
    );

    const restoreQuantity = movement.quantity - returnedQuantity;
    if (restoreQuantity > 0) {
      await balanceService.adjustBalance(
        String(movement.warehouseId),
        String(movement.productId),
        restoreQuantity,
        session
      );
    }

    await StockMovement.deleteMany({
      $or: [
        { _id: movement._id },
        {
          type: StockMovementType.STOCK_IN,
          relatedSaleMovementId: movement._id,
        },
        {
          type: StockMovementType.STOCK_IN,
          relatedSaleMovementId: { $exists: false },
          invoiceNumber: exactCaseInsensitiveRegex(movement.invoiceNumber ?? ""),
          clientName: exactCaseInsensitiveRegex(movement.clientName ?? ""),
          productId: movement.productId,
          warehouseId: movement.warehouseId,
        },
      ],
    }).session(session ?? null);

    const product = await Product.findById(movement.productId).lean();
    const warehouse = await Warehouse.findById(movement.warehouseId).lean();

    await AuditLog.create(
      [
        {
          action: "INVOICE_DELETED",
          entity: "StockMovement",
          entityId: movement._id,
          userId: user.id,
          metadata: {
            movementId: String(movement._id),
            invoiceNumber: movement.invoiceNumber,
            clientName: movement.clientName,
            quantity: movement.quantity,
            returnedQuantity,
            restoredQuantity: restoreQuantity,
            productName: product?.name,
            warehouseName: warehouse?.name,
          },
        },
      ],
      dbSession(session)
    );

    return { deleted: true, id: movementId };
  });
}

export type MovementInvoiceUpdateEntry = {
  id: string;
  createdAt: Date;
  user?: { id: string; name: string; email: string };
  previousQuantity?: number;
  quantity?: number;
  inventoryDelta?: number;
  previousInvoiceNumber?: string;
  invoiceNumber?: string;
  previousClientName?: string;
  clientName?: string;
  productName?: string;
  warehouseName?: string;
  warehouseCode?: string;
  updatedLineCount?: number;
  summary: string;
};

function metaNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function metaText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function summarizeInvoiceUpdate(meta: Record<string, unknown>): string {
  const parts: string[] = [];
  const prevQty = metaNumber(meta.previousQuantity);
  const nextQty = metaNumber(meta.quantity);
  if (prevQty !== undefined && nextQty !== undefined && prevQty !== nextQty) {
    parts.push(`Quantity ${prevQty.toLocaleString("en-IN")} → ${nextQty.toLocaleString("en-IN")}`);
  }

  const prevInvoice = metaText(meta.previousInvoiceNumber);
  const nextInvoice = metaText(meta.invoiceNumber);
  if (prevInvoice !== undefined || nextInvoice !== undefined) {
    if ((prevInvoice ?? "") !== (nextInvoice ?? "")) {
      parts.push(`Invoice ${prevInvoice || "—"} → ${nextInvoice || "—"}`);
    }
  }

  const prevClient = metaText(meta.previousClientName);
  const nextClient = metaText(meta.clientName);
  if (prevClient !== undefined || nextClient !== undefined) {
    if ((prevClient ?? "") !== (nextClient ?? "")) {
      parts.push(`Client ${prevClient || "—"} → ${nextClient || "—"}`);
    }
  }

  const updatedLineCount = metaNumber(meta.updatedLineCount);
  if (updatedLineCount !== undefined && updatedLineCount > 1 && parts.length === 0) {
    parts.push(`Updated ${updatedLineCount} invoice lines`);
  }

  return parts.length > 0 ? parts.join(" · ") : "Invoice details updated";
}

export async function listMovementInvoiceUpdates(movementId: string) {
  if (!Types.ObjectId.isValid(movementId)) {
    throw new BadRequestError("Invalid movement id");
  }

  const movementOid = new Types.ObjectId(movementId);
  const movement = await StockMovement.findById(movementOid).lean();
  if (!movement) {
    throw new NotFoundError("Stock movement not found");
  }

  const logs = await AuditLog.find({
    action: "INVOICE_UPDATED",
    entity: "StockMovement",
    $or: [{ entityId: movementOid }, { "metadata.movementId": movementId }],
  })
    .sort({ createdAt: -1 })
    .populate("userId", "name email")
    .lean();

  const items: MovementInvoiceUpdateEntry[] = logs.map((log) => {
    const meta = (log.metadata ?? {}) as Record<string, unknown>;
    const user = log.userId as
      | { _id: Types.ObjectId; name: string; email: string }
      | null
      | undefined;

    return {
      id: String(log._id),
      createdAt: log.createdAt,
      user: user
        ? { id: String(user._id), name: user.name, email: user.email }
        : undefined,
      previousQuantity: metaNumber(meta.previousQuantity),
      quantity: metaNumber(meta.quantity),
      inventoryDelta: metaNumber(meta.inventoryDelta),
      previousInvoiceNumber: metaText(meta.previousInvoiceNumber),
      invoiceNumber: metaText(meta.invoiceNumber),
      previousClientName: metaText(meta.previousClientName),
      clientName: metaText(meta.clientName),
      productName: metaText(meta.productName),
      warehouseName: metaText(meta.warehouseName),
      warehouseCode: metaText(meta.warehouseCode),
      updatedLineCount: metaNumber(meta.updatedLineCount),
      summary: summarizeInvoiceUpdate(meta),
    };
  });

  return {
    movementId,
    modificationCount: movement.invoiceModificationCount ?? 0,
    items,
  };
}
