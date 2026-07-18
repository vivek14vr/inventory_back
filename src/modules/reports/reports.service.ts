import { Types } from "mongoose";
import { StockMovement } from "../../models/StockMovement.js";
import { Transfer } from "../../models/Transfer.js";
import { DispatchType, StockMovementType } from "../../shared/constants/roles.js";
import { ForbiddenError } from "../../shared/errors/AppError.js";
import type { AuthUser } from "../../shared/types/auth.js";
import { isAdmin } from "../../shared/utils/permissions.js";
import * as inventoryAdmin from "../inventory/inventory.service.js";
import { INVOICE_QTY_CORRECTION_NOTE_PREFIX } from "../stock/saleReturn.utils.js";
import type {
  MovementReportQuery,
  ReportFilter,
  StockReportQuery,
  TransferReportQuery,
} from "./reports.validation.js";
import { buildDateFilter, toCsv } from "./reports.utils.js";

/** Warehouses a staff user may see in reports (home + any scoped grant). */
export function getStaffReportWarehouseIds(user: AuthUser): string[] {
  const ids = new Set<string>();
  if (user.warehouseId) ids.add(user.warehouseId);
  for (const grant of user.permissions ?? []) {
    if (grant.warehouseId) ids.add(grant.warehouseId);
  }
  return [...ids];
}

/**
 * Resolve warehouse scope for reports.
 * Admins: optional single warehouse filter.
 * Staff: must be limited to their warehouses; omit → all allowed ($in).
 */
export function resolveReportWarehouseScope(
  user: AuthUser,
  requestedWarehouseId?: string
): { warehouseId?: string; warehouseIds?: string[] } {
  if (isAdmin(user)) {
    if (requestedWarehouseId && Types.ObjectId.isValid(requestedWarehouseId)) {
      return { warehouseId: requestedWarehouseId };
    }
    return {};
  }

  const allowed = getStaffReportWarehouseIds(user);
  if (allowed.length === 0) {
    throw new ForbiddenError("No warehouse access for reports");
  }

  if (requestedWarehouseId) {
    if (!Types.ObjectId.isValid(requestedWarehouseId)) {
      throw new ForbiddenError("Invalid warehouse");
    }
    if (!allowed.includes(requestedWarehouseId)) {
      throw new ForbiddenError("You do not have access to this warehouse");
    }
    return { warehouseId: requestedWarehouseId };
  }

  if (allowed.length === 1) {
    return { warehouseId: allowed[0] };
  }
  return { warehouseIds: allowed };
}

function applyWarehouseScope(
  filter: Record<string, unknown>,
  scope: { warehouseId?: string; warehouseIds?: string[] },
  field = "warehouseId"
): void {
  if (scope.warehouseId) {
    filter[field] = scope.warehouseId;
  } else if (scope.warehouseIds?.length) {
    filter[field] = { $in: scope.warehouseIds };
  }
}

function movementFilter(
  query: MovementReportQuery,
  scope: { warehouseId?: string; warehouseIds?: string[] }
): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (query.type) filter.type = query.type;
  applyWarehouseScope(filter, scope);
  if (query.brandId && Types.ObjectId.isValid(query.brandId)) {
    filter.brandId = query.brandId;
  }
  if (query.productId && Types.ObjectId.isValid(query.productId)) {
    filter.productId = query.productId;
  }
  const createdAt = buildDateFilter(query.dateFrom, query.dateTo);
  if (createdAt) filter.createdAt = createdAt;
  return filter;
}

export async function reportCurrentStock(
  query: StockReportQuery,
  user: AuthUser
) {
  const scope = resolveReportWarehouseScope(user, query.warehouseId);
  const data = await inventoryAdmin.listCurrentStock({
    warehouseId: scope.warehouseId,
    warehouseIds: scope.warehouseIds,
    brandId: query.brandId,
    productId: query.productId,
    includeZero: false,
    page: 1,
    limit: 10_000,
    sortBy: "productName",
    sortOrder: "asc",
  });

  if (query.groupBy === "warehouse") {
    return {
      groupBy: "warehouse",
      rows: data.summary.byWarehouse.map((w) => ({
        warehouse: w.name,
        code: w.code,
        totalUnits: w.totalUnits,
        skuCount: w.skuCount,
      })),
    };
  }

  if (query.groupBy === "brand") {
    return {
      groupBy: "brand",
      rows: data.summary.byBrand.map((b) => ({
        brand: b.name,
        totalUnits: b.totalUnits,
        skuCount: b.skuCount,
      })),
    };
  }

  if (query.groupBy === "product") {
    return {
      groupBy: "product",
      rows: data.summary.byProduct.map((p) => ({
        product: p.productName,
        brand: p.brandName,
        totalUnits: p.totalUnits,
        stockUnit: p.stockUnit,
        unitsPerStockUnit: p.unitsPerStockUnit,
        baseUnit: p.baseUnit,
      })),
    };
  }

  return {
    groupBy: "detail",
    rows: data.items.map((r) => ({
      warehouse: r.warehouseName,
      warehouseCode: r.warehouseCode,
      product: r.productName,
      brand: r.brandName,
      quantity: r.quantity,
      stockUnit: r.stockUnit,
      unitsPerStockUnit: r.unitsPerStockUnit,
      baseUnit: r.baseUnit,
    })),
  };
}

export async function reportStockMovements(
  query: MovementReportQuery,
  user: AuthUser
) {
  const scope = resolveReportWarehouseScope(user, query.warehouseId);
  const filter = movementFilter(query, scope);
  const movements = await StockMovement.find(filter)
    .sort({ createdAt: -1 })
    .limit(query.limit)
    .populate("productId", "name stockUnit unitsPerStockUnit baseUnit")
    .populate("brandId", "name")
    .populate("warehouseId", "name code")
    .populate("destinationWarehouseId", "name code")
    .lean();

  return {
    type: query.type ?? "ALL",
    rows: movements.map((m) => {
      const product = m.productId as unknown as {
        name: string;
        stockUnit?: string;
        unitsPerStockUnit?: number;
        baseUnit?: string;
      };
      const brand = m.brandId as unknown as { name: string };
      const warehouse = m.warehouseId as unknown as { name: string; code: string };
      const dest = m.destinationWarehouseId as unknown as
        | { name: string; code: string }
        | undefined;

      return {
        date: m.createdAt,
        type: m.type,
        warehouse: warehouse.code,
        product: product.name,
        brand: brand.name,
        quantity: m.quantity,
        stockUnit: product.stockUnit ?? "unit",
        unitsPerStockUnit: product.unitsPerStockUnit ?? 1,
        baseUnit: product.baseUnit ?? "piece",
        dispatchType: m.dispatchType ?? "",
        destination: dest?.code ?? "",
        clientName: m.clientName ?? "",
        invoiceNumber: m.invoiceNumber ?? "",
        notes: m.notes ?? "",
      };
    }),
  };
}

export async function reportClientReturns(query: ReportFilter, user: AuthUser) {
  const scope = resolveReportWarehouseScope(user, query.warehouseId);
  const filter: Record<string, unknown> = {
    type: StockMovementType.STOCK_IN,
    $and: [
      {
        $or: [
          { relatedSaleMovementId: { $exists: true, $ne: null } },
          { notes: { $regex: "client return", $options: "i" } },
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

  applyWarehouseScope(filter, scope);
  if (query.brandId && Types.ObjectId.isValid(query.brandId)) {
    filter.brandId = query.brandId;
  }
  if (query.productId && Types.ObjectId.isValid(query.productId)) {
    filter.productId = query.productId;
  }
  if (query.clientName?.trim()) {
    filter.clientName = { $regex: query.clientName.trim(), $options: "i" };
  }
  if (query.invoiceNumber?.trim()) {
    filter.invoiceNumber = { $regex: query.invoiceNumber.trim(), $options: "i" };
  }
  const createdAt = buildDateFilter(query.dateFrom, query.dateTo);
  if (createdAt) filter.createdAt = createdAt;

  const movements = await StockMovement.find(filter)
    .sort({ createdAt: -1 })
    .limit(query.limit ?? 1000)
    .populate("productId", "name stockUnit unitsPerStockUnit baseUnit")
    .populate("brandId", "name")
    .populate("warehouseId", "name code")
    .lean();

  return {
    type: "RETURNS",
    rows: movements.map((m) => {
      const product = m.productId as unknown as {
        name: string;
        stockUnit?: string;
        unitsPerStockUnit?: number;
        baseUnit?: string;
      };
      const brand = m.brandId as unknown as { name: string };
      const warehouse = m.warehouseId as unknown as { name: string; code: string };

      return {
        date: m.createdAt,
        warehouse: warehouse.code,
        product: product.name,
        brand: brand.name,
        quantity: m.quantity,
        stockUnit: product.stockUnit ?? "unit",
        unitsPerStockUnit: product.unitsPerStockUnit ?? 1,
        baseUnit: product.baseUnit ?? "piece",
        clientName: m.clientName ?? "",
        invoiceNumber: m.invoiceNumber ?? "",
        notes: m.notes ?? "",
      };
    }),
  };
}

export async function reportTransfers(
  query: TransferReportQuery,
  user: AuthUser
) {
  const scope = resolveReportWarehouseScope(user, query.warehouseId);
  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (scope.warehouseId) {
    filter.$or = [
      { sourceWarehouseId: scope.warehouseId },
      { destinationWarehouseId: scope.warehouseId },
    ];
  } else if (scope.warehouseIds?.length) {
    filter.$or = [
      { sourceWarehouseId: { $in: scope.warehouseIds } },
      { destinationWarehouseId: { $in: scope.warehouseIds } },
    ];
  }
  if (query.brandId && Types.ObjectId.isValid(query.brandId)) {
    filter.brandId = query.brandId;
  }
  if (query.productId && Types.ObjectId.isValid(query.productId)) {
    filter.productId = query.productId;
  }
  const createdAt = buildDateFilter(query.dateFrom, query.dateTo);
  if (createdAt) filter.createdAt = createdAt;

  const transfers = await Transfer.find(filter)
    .sort({ createdAt: -1 })
    .limit(query.limit)
    .populate("productId", "name stockUnit unitsPerStockUnit baseUnit")
    .populate("brandId", "name")
    .populate("sourceWarehouseId", "name code")
    .populate("destinationWarehouseId", "name code")
    .lean();

  return {
    rows: transfers.map((t) => {
      const product = t.productId as unknown as {
        name: string;
        stockUnit?: string;
        unitsPerStockUnit?: number;
        baseUnit?: string;
      };
      const brand = t.brandId as unknown as { name: string };
      const source = t.sourceWarehouseId as unknown as { name: string; code: string };
      const dest = t.destinationWarehouseId as unknown as { name: string; code: string };

      return {
        date: t.createdAt,
        status: t.status,
        product: product.name,
        brand: brand.name,
        quantity: t.quantity,
        stockUnit: product.stockUnit ?? "unit",
        unitsPerStockUnit: product.unitsPerStockUnit ?? 1,
        baseUnit: product.baseUnit ?? "piece",
        from: source.code,
        to: dest.code,
        receivedAt: t.receivedAt ?? "",
      };
    }),
  };
}

async function salesMovements(query: ReportFilter, user: AuthUser) {
  const scope = resolveReportWarehouseScope(user, query.warehouseId);
  const filter: Record<string, unknown> = {
    type: StockMovementType.STOCK_OUT,
    dispatchType: DispatchType.DIRECT_SELLING,
  };

  applyWarehouseScope(filter, scope);
  if (query.brandId && Types.ObjectId.isValid(query.brandId)) {
    filter.brandId = query.brandId;
  }
  if (query.productId && Types.ObjectId.isValid(query.productId)) {
    filter.productId = query.productId;
  }
  if (query.clientName?.trim()) {
    filter.clientName = { $regex: query.clientName.trim(), $options: "i" };
  }
  if (query.invoiceNumber?.trim()) {
    filter.invoiceNumber = { $regex: query.invoiceNumber.trim(), $options: "i" };
  }
  const createdAt = buildDateFilter(query.dateFrom, query.dateTo);
  if (createdAt) filter.createdAt = createdAt;

  return StockMovement.find(filter)
    .sort({ createdAt: -1 })
    .limit(query.limit ?? 1000)
    .populate("productId", "name stockUnit unitsPerStockUnit baseUnit")
    .populate("brandId", "name")
    .populate("warehouseId", "name code")
    .lean();
}

function salesMovementLine(m: Awaited<ReturnType<typeof salesMovements>>[number]) {
  const product = m.productId as unknown as {
    name: string;
    stockUnit?: string;
    unitsPerStockUnit?: number;
    baseUnit?: string;
  };
  const brand = m.brandId as unknown as { name: string };
  const warehouse = m.warehouseId as unknown as { code: string };

  return {
    product: product.name,
    brand: brand.name,
    warehouse: warehouse.code,
    quantity: m.quantity,
    stockUnit: product.stockUnit ?? "unit",
    unitsPerStockUnit: product.unitsPerStockUnit ?? 1,
    baseUnit: product.baseUnit ?? "piece",
  };
}

export async function reportSalesByClient(query: ReportFilter, user: AuthUser) {
  const movements = await salesMovements(query, user);
  const grouped = new Map<
    string,
    {
      clientName: string;
      totalQuantity: number;
      invoices: Map<
        string,
        {
          invoiceNumber: string;
          date: Date;
          warehouse: string;
          totalQuantity: number;
          lineCount: number;
          lines: ReturnType<typeof salesMovementLine>[];
        }
      >;
    }
  >();

  for (const m of movements) {
    const client = m.clientName ?? "Unknown";
    const line = salesMovementLine(m);
    const invoiceNumber = m.invoiceNumber ?? "";
    const invoiceKey = `${invoiceNumber}\0${line.warehouse}`;

    const g = grouped.get(client) ?? {
      clientName: client,
      totalQuantity: 0,
      invoices: new Map(),
    };
    g.totalQuantity += m.quantity;

    let inv = g.invoices.get(invoiceKey);
    if (!inv) {
      inv = {
        invoiceNumber,
        date: m.createdAt,
        warehouse: line.warehouse,
        totalQuantity: 0,
        lineCount: 0,
        lines: [],
      };
      g.invoices.set(invoiceKey, inv);
    }
    inv.totalQuantity += m.quantity;
    inv.lineCount += 1;
    inv.lines.push(line);
    if (m.createdAt < inv.date) {
      inv.date = m.createdAt;
    }
    grouped.set(client, g);
  }

  return {
    rows: Array.from(grouped.values())
      .map((g) => ({
        clientName: g.clientName,
        totalQuantity: g.totalQuantity,
        invoiceCount: g.invoices.size,
        invoices: Array.from(g.invoices.values()).sort((a, b) => {
          const byDate = new Date(b.date).getTime() - new Date(a.date).getTime();
          if (byDate !== 0) return byDate;
          return a.invoiceNumber.localeCompare(b.invoiceNumber);
        }),
      }))
      .sort((a, b) => a.clientName.localeCompare(b.clientName)),
  };
}

export async function reportSalesByInvoice(query: ReportFilter, user: AuthUser) {
  const movements = await salesMovements(query, user);
  const grouped = new Map<
    string,
    {
      date: Date;
      invoiceNumber: string;
      clientName: string;
      warehouse: string;
      totalQuantity: number;
      lineCount: number;
      lines: ReturnType<typeof salesMovementLine>[];
    }
  >();

  for (const m of movements) {
    const line = salesMovementLine(m);
    const invoiceNumber = m.invoiceNumber ?? "";
    const clientName = m.clientName ?? "";
    const invoiceKey = `${invoiceNumber}\0${clientName}\0${line.warehouse}`;

    let inv = grouped.get(invoiceKey);
    if (!inv) {
      inv = {
        date: m.createdAt,
        invoiceNumber,
        clientName,
        warehouse: line.warehouse,
        totalQuantity: 0,
        lineCount: 0,
        lines: [],
      };
      grouped.set(invoiceKey, inv);
    }
    inv.totalQuantity += m.quantity;
    inv.lineCount += 1;
    inv.lines.push(line);
    if (m.createdAt < inv.date) {
      inv.date = m.createdAt;
    }
  }

  return {
    rows: Array.from(grouped.values())
      .sort((a, b) => {
        const byDate = new Date(b.date).getTime() - new Date(a.date).getTime();
        if (byDate !== 0) return byDate;
        return a.invoiceNumber.localeCompare(b.invoiceNumber);
      })
      .map((inv) => ({
        date: inv.date,
        invoiceNumber: inv.invoiceNumber,
        clientName: inv.clientName,
        warehouse: inv.warehouse,
        totalQuantity: inv.totalQuantity,
        lineCount: inv.lineCount,
        lines: inv.lines,
      })),
  };
}

export async function reportSalesByBrand(query: ReportFilter, user: AuthUser) {
  const movements = await salesMovements(query, user);
  const grouped = new Map<
    string,
    {
      brand: string;
      totalQuantity: number;
      saleCount: number;
      products: Map<
        string,
        {
          product: string;
          quantity: number;
          saleCount: number;
          stockUnit: string;
          unitsPerStockUnit: number;
          baseUnit: string;
          sales: Array<{
            date: Date;
            clientName: string;
            invoiceNumber: string;
            warehouse: string;
            quantity: number;
          }>;
        }
      >;
    }
  >();

  for (const m of movements) {
    const line = salesMovementLine(m);
    const brand = line.brand;

    const g = grouped.get(brand) ?? {
      brand,
      totalQuantity: 0,
      saleCount: 0,
      products: new Map(),
    };
    g.totalQuantity += m.quantity;
    g.saleCount += 1;

    let product = g.products.get(line.product);
    if (!product) {
      product = {
        product: line.product,
        quantity: 0,
        saleCount: 0,
        stockUnit: line.stockUnit,
        unitsPerStockUnit: line.unitsPerStockUnit,
        baseUnit: line.baseUnit,
        sales: [],
      };
      g.products.set(line.product, product);
    }
    product.quantity += m.quantity;
    product.saleCount += 1;
    product.sales.push({
      date: m.createdAt,
      clientName: m.clientName ?? "",
      invoiceNumber: m.invoiceNumber ?? "",
      warehouse: line.warehouse,
      quantity: m.quantity,
    });
    grouped.set(brand, g);
  }

  return {
    rows: Array.from(grouped.values())
      .map((g) => ({
        brand: g.brand,
        totalQuantity: g.totalQuantity,
        saleCount: g.saleCount,
        products: Array.from(g.products.values())
          .map((product) => ({
            ...product,
            sales: [...product.sales].sort(
              (a, b) => b.date.getTime() - a.date.getTime()
            ),
          }))
          .sort((a, b) => a.product.localeCompare(b.product)),
      }))
      .sort((a, b) => a.brand.localeCompare(b.brand)),
  };
}

export function exportReportCsv(
  reportType: string,
  data: { rows: Record<string, unknown>[] }
): { csv: string; filename: string } {
  const rows = data.rows as Record<string, string | number>[];

  const configs: Record<string, { columns: { key: string; header: string }[]; filename: string }> = {
    stock: {
      filename: "current-stock",
      columns: [
        { key: "warehouse", header: "Warehouse" },
        { key: "warehouseCode", header: "Code" },
        { key: "product", header: "Product" },
        { key: "brand", header: "Brand" },
        { key: "quantity", header: "Quantity" },
      ],
    },
    "stock-warehouse": {
      filename: "stock-by-warehouse",
      columns: [
        { key: "warehouse", header: "Warehouse" },
        { key: "code", header: "Code" },
        { key: "totalUnits", header: "Total Units" },
        { key: "skuCount", header: "SKU Count" },
      ],
    },
    "stock-brand": {
      filename: "stock-by-brand",
      columns: [
        { key: "brand", header: "Brand" },
        { key: "totalUnits", header: "Total Units" },
        { key: "skuCount", header: "SKU Count" },
      ],
    },
    "stock-product": {
      filename: "stock-by-product",
      columns: [
        { key: "product", header: "Product" },
        { key: "brand", header: "Brand" },
        { key: "totalUnits", header: "Total Units" },
      ],
    },
    "stock-in": {
      filename: "stock-in-report",
      columns: [
        { key: "date", header: "Date" },
        { key: "warehouse", header: "Warehouse" },
        { key: "product", header: "Product" },
        { key: "brand", header: "Brand" },
        { key: "quantity", header: "Quantity" },
        { key: "notes", header: "Notes" },
      ],
    },
    "stock-out": {
      filename: "stock-out-report",
      columns: [
        { key: "date", header: "Date" },
        { key: "warehouse", header: "Warehouse" },
        { key: "product", header: "Product" },
        { key: "brand", header: "Brand" },
        { key: "quantity", header: "Quantity" },
        { key: "dispatchType", header: "Dispatch" },
        { key: "destination", header: "Destination" },
        { key: "clientName", header: "Client" },
        { key: "invoiceNumber", header: "Invoice" },
      ],
    },
    returns: {
      filename: "returns-report",
      columns: [
        { key: "date", header: "Date" },
        { key: "warehouse", header: "Warehouse" },
        { key: "product", header: "Product" },
        { key: "brand", header: "Brand" },
        { key: "quantity", header: "Quantity" },
        { key: "clientName", header: "Client" },
        { key: "invoiceNumber", header: "Invoice" },
        { key: "notes", header: "Notes" },
      ],
    },
    transfers: {
      filename: "transfer-report",
      columns: [
        { key: "date", header: "Date" },
        { key: "from", header: "From" },
        { key: "to", header: "To" },
        { key: "product", header: "Product" },
        { key: "brand", header: "Brand" },
        { key: "status", header: "Status" },
        { key: "quantity", header: "Quantity" },
        { key: "receivedAt", header: "Received At" },
      ],
    },
    "sales-client": {
      filename: "sales-by-client",
      columns: [
        { key: "clientName", header: "Client" },
        { key: "totalQuantity", header: "Total Quantity" },
        { key: "invoiceCount", header: "Invoices" },
      ],
    },
    "sales-invoice": {
      filename: "sales-by-invoice",
      columns: [
        { key: "date", header: "Date" },
        { key: "invoiceNumber", header: "Invoice" },
        { key: "clientName", header: "Client" },
        { key: "warehouse", header: "Warehouse" },
        { key: "totalQuantity", header: "Total Quantity" },
        { key: "lineCount", header: "Products" },
      ],
    },
    "sales-brand": {
      filename: "sales-by-brand",
      columns: [
        { key: "brand", header: "Brand" },
        { key: "totalQuantity", header: "Total Quantity" },
        { key: "saleCount", header: "Sales Count" },
      ],
    },
  };

  const config = configs[reportType] ?? configs.stock;
  const formatted = rows.map((r) => {
    const out: Record<string, string | number> = {};
    for (const col of config.columns) {
      const val = r[col.key] as unknown;
      if (val instanceof Date) {
        out[col.key] = val.toISOString();
      } else if (typeof val === "string" || typeof val === "number") {
        out[col.key] = val;
      } else if (val != null) {
        out[col.key] = String(val);
      } else {
        out[col.key] = "";
      }
    }
    return out;
  });

  return {
    csv: toCsv(formatted, config.columns),
    filename: `${config.filename}-${Date.now()}.csv`,
  };
}
