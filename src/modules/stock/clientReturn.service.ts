import { Types, type ClientSession } from "mongoose";
import { AuditLog } from "../../models/AuditLog.js";
import { StockMovement } from "../../models/StockMovement.js";
import { Warehouse } from "../../models/Warehouse.js";
import { Product } from "../../models/Product.js";
import {
  DispatchType,
  StockMovementType,
} from "../../shared/constants/roles.js";
import {
  CLIENT_RETURN_PERMISSIONS,
} from "../../shared/constants/permissions.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../shared/errors/AppError.js";
import {
  assertNonNegativeIntegerQuantity,
  assertPositiveIntegerQuantity,
} from "../../shared/validation/quantity.js";
import type { AuthUser } from "../../shared/types/auth.js";
import { dbSession, runInTransaction } from "../../shared/utils/mongoTransaction.js";
import { buildStockMovementAuditMetadata } from "../../shared/utils/auditMetadata.js";
import { hasPermission, isAdmin, getWarehouseIdsForPermission } from "../../shared/utils/permissions.js";
import { resolveWarehouseIdForAnyPermission } from "../../shared/utils/permissions.js";
import { paginateArray } from "../../shared/pagination/pagination.js";
import { exactCaseInsensitiveRegex } from "../../shared/utils/invoiceMatch.js";
import {
  saleQuantityInventoryDelta,
  sumReturnedQuantityForSale,
} from "./saleReturn.utils.js";
import * as balanceService from "./inventory.service.js";
import * as inventoryAdminService from "../inventory/inventory.service.js";
import type {
  ClientReturnInvoiceQuery,
  ClientReturnListQuery,
  ClientReturnSubmitInput,
} from "./stock.validation.js";

type SaleMovementDoc = {
  _id: Types.ObjectId;
  quantity: number;
  invoiceNumber?: string;
  clientName?: string;
  warehouseId: Types.ObjectId;
  productId: Types.ObjectId | { _id: Types.ObjectId };
  brandId: Types.ObjectId | { _id: Types.ObjectId };
  createdAt: Date;
  productIdPop?: {
    _id: Types.ObjectId;
    name: string;
    secondaryName?: string;
    stockUnit?: string;
    unitsPerStockUnit?: number;
    baseUnit?: string;
  };
  brandIdPop?: { _id: Types.ObjectId; name: string };
  warehouseIdPop?: { _id: Types.ObjectId; name: string; code: string };
};

export type ClientReturnInvoiceLine = {
  saleMovementId: string;
  productId: string;
  productName: string;
  secondaryProductName?: string;
  brandId: string;
  brandName: string;
  stockUnit?: string;
  unitsPerStockUnit?: number;
  baseUnit?: string;
  soldQuantity: number;
  returnedQuantity: number;
  returnableQuantity: number;
};

export type ClientReturnInvoice = {
  invoiceNumber: string;
  clientName: string;
  warehouse: { id: string; name: string; code: string };
  saleDate: string;
  lines: ClientReturnInvoiceLine[];
};

export type ClientReturnInvoiceSummary = {
  id: string;
  invoiceNumber: string;
  clientName: string;
  warehouse: { id: string; name: string; code: string };
  saleDate: string;
  lineCount: number;
  totalReturnableQuantity: number;
};

function buildClientReturnGroupKey(
  invoiceNumber: string,
  clientName: string,
  warehouseId: string
): string {
  return [
    invoiceNumber.toLowerCase(),
    clientName.toLowerCase(),
    warehouseId,
  ].join("|");
}

function resolveClientReturnWarehouseFilter(
  user: AuthUser,
  warehouseId?: string
): Record<string, unknown> {
  if (warehouseId) {
    const resolved = resolveWarehouseIdForAnyPermission(
      user,
      CLIENT_RETURN_PERMISSIONS,
      warehouseId
    );
    return { warehouseId: new Types.ObjectId(resolved) };
  }

  if (isAdmin(user)) {
    return {};
  }

  const allowed = [
    ...new Set(
      CLIENT_RETURN_PERMISSIONS.flatMap((code) =>
        getWarehouseIdsForPermission(user, code)
      )
    ),
  ];

  if (allowed.length === 0) {
    throw new ForbiddenError("No warehouse access for client returns");
  }

  if (allowed.length === 1) {
    return { warehouseId: new Types.ObjectId(allowed[0]) };
  }

  return { warehouseId: { $in: allowed.map((id) => new Types.ObjectId(id)) } };
}

function normalizeInvoice(value: string): string {
  return value.trim();
}

function normalizeClient(value: string): string {
  return value.trim();
}

function refId(
  value: Types.ObjectId | { _id: Types.ObjectId } | string | null | undefined
): string {
  if (!value) return "";
  if (typeof value === "object" && "_id" in value) {
    return String(value._id);
  }
  return String(value);
}

function saleWarehouseId(
  sale: Pick<SaleMovementDoc, "warehouseId"> | { warehouseId: unknown }
): string {
  const warehouse = sale.warehouseId as
    | Types.ObjectId
    | { _id: Types.ObjectId }
    | null
    | undefined;
  if (!warehouse) return "";
  if (typeof warehouse === "object" && "_id" in warehouse) {
    return String(warehouse._id);
  }
  return String(warehouse);
}

function assertCanReturnAtWarehouse(user: AuthUser, warehouseId: string): void {
  if (isAdmin(user)) return;
  if (
    CLIENT_RETURN_PERMISSIONS.some((code) =>
      hasPermission(user, code, warehouseId)
    )
  ) {
    return;
  }
  throw new ForbiddenError("You do not have permission to process returns at this warehouse");
}

async function sumReturnedQuantity(
  sale: SaleMovementDoc,
  session?: ClientSession | null
): Promise<number> {
  return sumReturnedQuantityForSale(
    {
      _id: sale._id,
      invoiceNumber: sale.invoiceNumber,
      clientName: sale.clientName,
      productId: new Types.ObjectId(refId(sale.productId)),
      warehouseId: new Types.ObjectId(
        refId(sale.warehouseIdPop?._id ?? sale.warehouseId)
      ),
    },
    session
  );
}

async function mapSaleToLine(
  sale: SaleMovementDoc,
  session?: ClientSession | null
): Promise<ClientReturnInvoiceLine> {
  const product = sale.productIdPop;
  const brand = sale.brandIdPop;
  const returnedQuantity = await sumReturnedQuantity(sale, session);
  const soldQuantity = sale.quantity;

  return {
    saleMovementId: String(sale._id),
    productId: refId(sale.productId),
    productName: product?.name ?? "Unknown product",
    secondaryProductName: product?.secondaryName,
    brandId: refId(sale.brandId),
    brandName: brand?.name ?? "",
    stockUnit: product?.stockUnit,
    unitsPerStockUnit: product?.unitsPerStockUnit,
    baseUnit: product?.baseUnit,
    soldQuantity,
    returnedQuantity,
    returnableQuantity: Math.max(soldQuantity - returnedQuantity, 0),
  };
}

async function findSaleMovements(
  invoiceNumber: string,
  clientName?: string,
  warehouseId?: string
): Promise<SaleMovementDoc[]> {
  const filter: Record<string, unknown> = {
    type: StockMovementType.STOCK_OUT,
    dispatchType: DispatchType.DIRECT_SELLING,
    invoiceNumber: exactCaseInsensitiveRegex(invoiceNumber),
  };

  if (clientName) {
    filter.clientName = exactCaseInsensitiveRegex(clientName);
  }
  if (warehouseId) {
    filter.warehouseId = new Types.ObjectId(warehouseId);
  }

  const sales = await StockMovement.find(filter)
    .sort({ createdAt: 1 })
    .populate("productId", "name secondaryName stockUnit unitsPerStockUnit baseUnit")
    .populate("brandId", "name")
    .populate("warehouseId", "name code")
    .lean();

  return sales.map((sale) => ({
    ...sale,
    productIdPop: sale.productId as unknown as SaleMovementDoc["productIdPop"],
    brandIdPop: sale.brandId as unknown as SaleMovementDoc["brandIdPop"],
    warehouseIdPop: sale.warehouseId as unknown as SaleMovementDoc["warehouseIdPop"],
  })) as SaleMovementDoc[];
}

export async function getClientReturnInvoice(
  query: ClientReturnInvoiceQuery,
  user: AuthUser
): Promise<ClientReturnInvoice> {
  const invoiceNumber = normalizeInvoice(query.invoiceNumber);
  if (!invoiceNumber) {
    throw new BadRequestError("Invoice number is required");
  }

  const clientName = query.clientName ? normalizeClient(query.clientName) : undefined;
  const warehouseId = query.warehouseId
    ? resolveWarehouseIdForAnyPermission(
        user,
        CLIENT_RETURN_PERMISSIONS,
        query.warehouseId
      )
    : undefined;

  const sales = await findSaleMovements(invoiceNumber, clientName, warehouseId);
  if (sales.length === 0) {
    throw new NotFoundError("No sale invoice found with that invoice number");
  }

  const distinctClients = new Set(
    sales.map((sale) => sale.clientName?.trim() ?? "").filter(Boolean)
  );
  if (!clientName && distinctClients.size > 1) {
    throw new BadRequestError(
      "Multiple clients share this invoice number — enter the client name as well"
    );
  }

  const distinctWarehouses = new Set(sales.map((sale) => saleWarehouseId(sale)));
  if (!warehouseId && distinctWarehouses.size > 1 && !isAdmin(user)) {
    throw new BadRequestError(
      "This invoice spans multiple warehouses — select a warehouse"
    );
  }

  const scopedSales =
    warehouseId != null
      ? sales.filter((sale) => saleWarehouseId(sale) === warehouseId)
      : sales;

  if (scopedSales.length === 0) {
    throw new NotFoundError("No matching sale lines for this warehouse");
  }

  const first = scopedSales[0]!;
  const wh = first.warehouseIdPop;
  if (!wh) {
    throw new NotFoundError("Warehouse not found for invoice");
  }

  assertCanReturnAtWarehouse(user, saleWarehouseId(first));

  const lines = await Promise.all(scopedSales.map((sale) => mapSaleToLine(sale)));

  return {
    invoiceNumber,
    clientName: clientName ?? first.clientName?.trim() ?? "",
    warehouse: { id: String(wh._id), name: wh.name, code: wh.code },
    saleDate:
      first.createdAt instanceof Date
        ? first.createdAt.toISOString()
        : String(first.createdAt),
    lines,
  };
}

export async function listClientReturnInvoices(
  query: ClientReturnListQuery,
  user: AuthUser
) {
  const warehouseFilter = resolveClientReturnWarehouseFilter(user, query.warehouseId);

  const saleFilter: Record<string, unknown> = {
    type: StockMovementType.STOCK_OUT,
    dispatchType: DispatchType.DIRECT_SELLING,
    invoiceNumber: { $exists: true, $nin: [null, ""] },
    ...warehouseFilter,
  };

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
    saleFilter.$and = [{ $or: searchClauses }];
  }

  const sales = await StockMovement.find(saleFilter)
    .sort({ createdAt: -1 })
    .populate("warehouseId", "name code")
    .lean();

  if (sales.length === 0) {
    return {
      items: [] as ClientReturnInvoiceSummary[],
      pagination: paginateArray([], query).pagination,
    };
  }

  const saleIds = sales.map((sale) => sale._id);
  const linkedReturns = await StockMovement.aggregate<{ _id: Types.ObjectId; total: number }>([
    {
      $match: {
        type: StockMovementType.STOCK_IN,
        relatedSaleMovementId: { $in: saleIds },
      },
    },
    { $group: { _id: "$relatedSaleMovementId", total: { $sum: "$quantity" } } },
  ]);
  const returnedBySaleId = new Map(
    linkedReturns.map((row) => [String(row._id), row.total])
  );

  const saleLineCountByProductKey = new Map<string, number>();
  const invoiceNumbers = new Set<string>();
  for (const sale of sales) {
    const invoiceNumber = sale.invoiceNumber?.trim() ?? "";
    const clientName = sale.clientName?.trim() ?? "";
    if (!invoiceNumber) continue;
    invoiceNumbers.add(invoiceNumber);
    const productKey = [
      invoiceNumber.toLowerCase(),
      clientName.toLowerCase(),
      String(sale.productId),
    ].join("|");
    saleLineCountByProductKey.set(
      productKey,
      (saleLineCountByProductKey.get(productKey) ?? 0) + 1
    );
  }

  const unlinkedByKey = new Map<string, number>();
  if (invoiceNumbers.size > 0) {
    const invoiceMatchers = [...invoiceNumbers].map((invoiceNumber) => ({
      invoiceNumber: exactCaseInsensitiveRegex(invoiceNumber),
    }));

    const unlinkedReturns = await StockMovement.aggregate<{
      _id: {
        invoiceNumber: string;
        clientName: string;
        productId: Types.ObjectId;
        warehouseId: Types.ObjectId;
      };
      total: number;
    }>([
      {
        $match: {
          type: StockMovementType.STOCK_IN,
          relatedSaleMovementId: { $exists: false },
          $or: invoiceMatchers,
        },
      },
      {
        $group: {
          _id: {
            invoiceNumber: "$invoiceNumber",
            clientName: "$clientName",
            productId: "$productId",
            warehouseId: "$warehouseId",
          },
          total: { $sum: "$quantity" },
        },
      },
    ]);

    for (const row of unlinkedReturns) {
      const key = [
        row._id.invoiceNumber?.trim().toLowerCase() ?? "",
        row._id.clientName?.trim().toLowerCase() ?? "",
        String(row._id.productId),
        String(row._id.warehouseId),
      ].join("|");
      unlinkedByKey.set(key, row.total);
    }
  }

  function returnedQuantityForSale(sale: (typeof sales)[number]): number {
    let total = returnedBySaleId.get(String(sale._id)) ?? 0;
    const invoiceNumber = sale.invoiceNumber?.trim() ?? "";
    const clientName = sale.clientName?.trim() ?? "";
    const productKey = [
      invoiceNumber.toLowerCase(),
      clientName.toLowerCase(),
      String(sale.productId),
    ].join("|");

    if ((saleLineCountByProductKey.get(productKey) ?? 0) >= 1) {
      const warehouse = sale.warehouseId as unknown as { _id: Types.ObjectId } | Types.ObjectId;
      const warehouseId =
        typeof warehouse === "object" && warehouse && "_id" in warehouse
          ? String(warehouse._id)
          : String(warehouse);
      const unlinkedKey = [
        invoiceNumber.toLowerCase(),
        clientName.toLowerCase(),
        String(sale.productId),
        warehouseId,
      ].join("|");

      const lineCount = saleLineCountByProductKey.get(productKey) ?? 0;
      if (lineCount === 1) {
        total += unlinkedByKey.get(unlinkedKey) ?? 0;
      } else {
        const matchingSales = sales.filter(
          (candidate) =>
            (candidate.invoiceNumber?.trim().toLowerCase() ?? "") ===
              invoiceNumber.toLowerCase() &&
            (candidate.clientName?.trim().toLowerCase() ?? "") ===
              clientName.toLowerCase() &&
            String(candidate.productId) === String(sale.productId)
        );
        const firstSaleForProduct = matchingSales.at(-1);
        if (firstSaleForProduct && String(firstSaleForProduct._id) === String(sale._id)) {
          total += unlinkedByKey.get(unlinkedKey) ?? 0;
        }
      }
    }

    return total;
  }

  const groups = new Map<string, ClientReturnInvoiceSummary>();

  for (const sale of sales) {
    const invoiceNumber = sale.invoiceNumber?.trim() ?? "";
    const clientName = sale.clientName?.trim() ?? "";
    const warehouse = sale.warehouseId as unknown as {
      _id: Types.ObjectId;
      name: string;
      code: string;
    } | null;
    if (!invoiceNumber || !warehouse) continue;

    const warehouseId = String(warehouse._id);
    assertCanReturnAtWarehouse(user, warehouseId);

    const key = buildClientReturnGroupKey(invoiceNumber, clientName, warehouseId);
    const returnedQuantity = returnedQuantityForSale(sale);
    const returnableQuantity = Math.max(sale.quantity - returnedQuantity, 0);
    const saleDate =
      sale.createdAt instanceof Date
        ? sale.createdAt.toISOString()
        : String(sale.createdAt);

    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        id: key,
        invoiceNumber,
        clientName,
        warehouse: {
          id: warehouseId,
          name: warehouse.name,
          code: warehouse.code,
        },
        saleDate,
        lineCount: 1,
        totalReturnableQuantity: returnableQuantity,
      });
      continue;
    }

    existing.lineCount += 1;
    existing.totalReturnableQuantity += returnableQuantity;
    if (new Date(saleDate).getTime() < new Date(existing.saleDate).getTime()) {
      existing.saleDate = saleDate;
    }
  }

  const sorted = Array.from(groups.values()).sort(
    (a, b) => new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime()
  );

  const { items, pagination } = paginateArray(sorted, query);
  return { items, pagination };
}

async function loadSaleMovement(
  saleMovementId: string,
  session?: ClientSession | null
): Promise<SaleMovementDoc> {
  if (!Types.ObjectId.isValid(saleMovementId)) {
    throw new BadRequestError("Invalid sale movement id");
  }

  const sale = await StockMovement.findById(saleMovementId)
    .session(session ?? null)
    .populate("productId", "name secondaryName stockUnit unitsPerStockUnit baseUnit")
    .populate("brandId", "name")
    .populate("warehouseId", "name code")
    .lean();

  if (
    !sale ||
    sale.type !== StockMovementType.STOCK_OUT ||
    sale.dispatchType !== DispatchType.DIRECT_SELLING
  ) {
    throw new NotFoundError("Sale line not found");
  }

  return {
    ...sale,
    productIdPop: sale.productId as unknown as SaleMovementDoc["productIdPop"],
    brandIdPop: sale.brandId as unknown as SaleMovementDoc["brandIdPop"],
    warehouseIdPop: sale.warehouseId as unknown as SaleMovementDoc["warehouseIdPop"],
  } as SaleMovementDoc;
}

async function createReturnMovement(
  sale: SaleMovementDoc,
  quantity: number,
  user: AuthUser,
  notes: string | undefined,
  session: ClientSession | null
) {
  const warehouseId = saleWarehouseId(sale);
  const productId = refId(sale.productId);
  const brandId = refId(sale.brandId);

  const warehouse = await Warehouse.findById(warehouseId).session(session).lean();
  if (!warehouse || warehouse.isActive === false) {
    throw new BadRequestError("Warehouse is inactive");
  }

  const newQty = await balanceService.adjustBalance(
    warehouseId,
    productId,
    quantity,
    session
  );

  const [movement] = await StockMovement.create(
    [
      {
        type: StockMovementType.STOCK_IN,
        warehouseId: sale.warehouseIdPop?._id ?? new Types.ObjectId(refId(sale.warehouseId)),
        productId: new Types.ObjectId(productId),
        brandId: new Types.ObjectId(brandId),
        quantity,
        clientName: sale.clientName,
        invoiceNumber: sale.invoiceNumber,
        relatedSaleMovementId: sale._id,
        notes: notes?.trim() || `Client return · Invoice ${sale.invoiceNumber ?? ""}`.trim(),
        createdBy: user.id,
      },
    ],
    dbSession(session)
  );

  await AuditLog.create(
    [
      {
        action: "CLIENT_RETURN",
        entity: "StockMovement",
        entityId: movement._id,
        userId: user.id,
        metadata: {
          ...buildStockMovementAuditMetadata({
            quantity,
            warehouse: warehouse as { _id: Types.ObjectId; name: string; code: string },
            product: {
              _id: new Types.ObjectId(productId),
              name: sale.productIdPop?.name ?? "Product",
            },
            brand: sale.brandIdPop
              ? { _id: sale.brandIdPop._id, name: sale.brandIdPop.name }
              : null,
            clientName: sale.clientName,
            invoiceNumber: sale.invoiceNumber,
            notes,
          }),
          saleMovementId: String(sale._id),
          returnMovementId: String(movement._id),
        },
      },
    ],
    dbSession(session)
  );

  return { movementId: String(movement._id), balance: newQty };
}

async function returnSaleLine(
  saleMovementId: string,
  quantity: number,
  user: AuthUser,
  notes: string | undefined,
  session: ClientSession | null
) {
  const sale = await loadSaleMovement(saleMovementId, session);
  assertCanReturnAtWarehouse(user, saleWarehouseId(sale));

  const returned = await sumReturnedQuantity(sale, session);
  const returnable = sale.quantity - returned;
  assertPositiveIntegerQuantity(quantity, "Return quantity");
  if (quantity > returnable) {
    throw new BadRequestError(
      `Cannot return ${quantity} — only ${returnable} remaining on this line`
    );
  }

  return createReturnMovement(sale, quantity, user, notes, session);
}

export async function submitClientReturn(input: ClientReturnSubmitInput, user: AuthUser) {
  const notes = input.notes;

  if (input.mode === "update_quantity") {
    if (!input.saleMovementId) {
      throw new BadRequestError("saleMovementId is required");
    }
    if (input.quantity === undefined) {
      throw new BadRequestError("quantity is required");
    }
    assertNonNegativeIntegerQuantity(input.quantity, "Sold quantity");

    const sale = await loadSaleMovement(input.saleMovementId);
    const previousQuantity = sale.quantity;
    const warehouseId = saleWarehouseId(sale);
    const productId = refId(sale.productId);

    assertCanReturnAtWarehouse(user, warehouseId);

    const returnedQuantity = await sumReturnedQuantity(sale);
    if (input.quantity < returnedQuantity) {
      throw new BadRequestError(
        `Sold quantity cannot be below ${returnedQuantity} — that much has already been returned on this line`
      );
    }

    const balanceBefore = await balanceService.getBalance(warehouseId, productId);

    const row = await inventoryAdminService.updateMovementInvoice(
      input.saleMovementId,
      { quantity: input.quantity },
      user
    );

    const balanceAfter = await balanceService.getBalance(warehouseId, productId);
    const inventoryDelta = saleQuantityInventoryDelta(
      previousQuantity,
      input.quantity,
      returnedQuantity
    );

    if (inventoryDelta > 0 && balanceAfter !== balanceBefore + inventoryDelta) {
      throw new BadRequestError(
        "Inventory was not updated correctly — please refresh and try again"
      );
    }
    if (inventoryDelta < 0 && balanceAfter !== balanceBefore + inventoryDelta) {
      throw new BadRequestError(
        "Inventory was not updated correctly — please refresh and try again"
      );
    }

    return {
      mode: input.mode,
      updatedMovementId: row.id,
      quantity: row.quantity,
      previousQuantity,
      inventoryDelta,
      balanceBefore,
      balanceAfter,
      warehouseId,
      productId,
    };
  }

  if (input.mode === "full") {
    const invoiceNumber = input.invoiceNumber?.trim();
    if (!invoiceNumber) {
      throw new BadRequestError("invoiceNumber is required");
    }

    const invoice = await getClientReturnInvoice(
      {
        invoiceNumber,
        clientName: input.clientName,
        warehouseId: input.warehouseId,
      },
      user
    );

    const linesToReturn = invoice.lines.filter((line) => line.returnableQuantity > 0);
    if (linesToReturn.length === 0) {
      throw new BadRequestError("Nothing left to return on this invoice");
    }

    return runInTransaction(async (session) => {
      const results = [];
      for (const line of linesToReturn) {
        const result = await returnSaleLine(
          line.saleMovementId,
          line.returnableQuantity,
          user,
          notes,
          session
        );
        results.push({
          saleMovementId: line.saleMovementId,
          quantity: line.returnableQuantity,
          ...result,
        });
      }
      return { mode: input.mode, lines: results };
    });
  }

  if (input.mode === "line") {
    if (!input.saleMovementId) {
      throw new BadRequestError("saleMovementId is required");
    }
    if (!input.quantity || input.quantity < 1) {
      throw new BadRequestError("quantity must be at least 1");
    }

    return runInTransaction(async (session) => {
      const result = await returnSaleLine(
        input.saleMovementId!,
        input.quantity!,
        user,
        notes,
        session
      );
      return {
        mode: input.mode,
        saleMovementId: input.saleMovementId,
        quantity: input.quantity,
        ...result,
      };
    });
  }

  throw new BadRequestError("Invalid return mode");
}
