import { Types } from "mongoose";
import { StockMovement } from "../../models/StockMovement.js";
import { Transfer } from "../../models/Transfer.js";
import { DispatchType, StockMovementType } from "../../shared/constants/roles.js";
import * as inventoryAdmin from "../inventory/inventory.service.js";
import type {
  MovementReportQuery,
  ReportFilter,
  StockReportQuery,
  TransferReportQuery,
} from "./reports.validation.js";
import { buildDateFilter, toCsv } from "./reports.utils.js";

function movementFilter(query: MovementReportQuery): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (query.type) filter.type = query.type;
  if (query.warehouseId && Types.ObjectId.isValid(query.warehouseId)) {
    filter.warehouseId = query.warehouseId;
  }
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

export async function reportCurrentStock(query: StockReportQuery) {
  const data = await inventoryAdmin.listCurrentStock({
    warehouseId: query.warehouseId,
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

export async function reportStockMovements(query: MovementReportQuery) {
  const filter = movementFilter(query);
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

export async function reportTransfers(query: TransferReportQuery) {
  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (query.warehouseId && Types.ObjectId.isValid(query.warehouseId)) {
    filter.$or = [
      { sourceWarehouseId: query.warehouseId },
      { destinationWarehouseId: query.warehouseId },
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

async function salesMovements(query: ReportFilter) {
  const filter: Record<string, unknown> = {
    type: StockMovementType.STOCK_OUT,
    dispatchType: DispatchType.DIRECT_SELLING,
  };

  if (query.warehouseId && Types.ObjectId.isValid(query.warehouseId)) {
    filter.warehouseId = query.warehouseId;
  }
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

export async function reportSalesByClient(query: ReportFilter) {
  const movements = await salesMovements(query);
  const grouped = new Map<
    string,
    { clientName: string; totalQuantity: number; invoiceCount: number }
  >();

  for (const m of movements) {
    const client = m.clientName ?? "Unknown";
    const g = grouped.get(client) ?? {
      clientName: client,
      totalQuantity: 0,
      invoiceCount: 0,
    };
    g.totalQuantity += m.quantity;
    g.invoiceCount += 1;
    grouped.set(client, g);
  }

  return {
    rows: Array.from(grouped.values()).sort((a, b) =>
      a.clientName.localeCompare(b.clientName)
    ),
  };
}

export async function reportSalesByInvoice(query: ReportFilter) {
  const movements = await salesMovements(query);

  return {
    rows: movements.map((m) => {
      const product = m.productId as unknown as {
        name: string;
        stockUnit?: string;
        unitsPerStockUnit?: number;
        baseUnit?: string;
      };
      const brand = m.brandId as unknown as { name: string };
      const warehouse = m.warehouseId as unknown as { code: string };

      return {
        date: m.createdAt,
        invoiceNumber: m.invoiceNumber ?? "",
        clientName: m.clientName ?? "",
        warehouse: warehouse.code,
        product: product.name,
        brand: brand.name,
        quantity: m.quantity,
        stockUnit: product.stockUnit ?? "unit",
        unitsPerStockUnit: product.unitsPerStockUnit ?? 1,
        baseUnit: product.baseUnit ?? "piece",
      };
    }),
  };
}

export async function reportSalesByBrand(query: ReportFilter) {
  const movements = await salesMovements(query);
  const grouped = new Map<
    string,
    { brand: string; totalQuantity: number; saleCount: number }
  >();

  for (const m of movements) {
    const brand = (m.brandId as unknown as { name: string }).name;
    const g = grouped.get(brand) ?? { brand, totalQuantity: 0, saleCount: 0 };
    g.totalQuantity += m.quantity;
    g.saleCount += 1;
    grouped.set(brand, g);
  }

  return {
    rows: Array.from(grouped.values()).sort((a, b) => a.brand.localeCompare(b.brand)),
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
    transfers: {
      filename: "transfer-report",
      columns: [
        { key: "date", header: "Date" },
        { key: "status", header: "Status" },
        { key: "product", header: "Product" },
        { key: "brand", header: "Brand" },
        { key: "quantity", header: "Quantity" },
        { key: "from", header: "From" },
        { key: "to", header: "To" },
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
        { key: "product", header: "Product" },
        { key: "brand", header: "Brand" },
        { key: "quantity", header: "Quantity" },
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
