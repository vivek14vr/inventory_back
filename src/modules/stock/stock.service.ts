import crypto from "node:crypto";
import { Types } from "mongoose";
import type mongoose from "mongoose";
import { AuditLog } from "../../models/AuditLog.js";
import { Brand } from "../../models/Brand.js";
import { InventoryBalance } from "../../models/InventoryBalance.js";
import { Product } from "../../models/Product.js";
import { SalesInvoiceClaim } from "../../models/SalesInvoiceClaim.js";
import { StockMovement } from "../../models/StockMovement.js";
import { Transfer } from "../../models/Transfer.js";
import { Warehouse } from "../../models/Warehouse.js";
import {
  DispatchType,
  StockMovementType,
  TransferStatus,
} from "../../shared/constants/roles.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../shared/errors/AppError.js";
import { exactCaseInsensitiveRegex } from "../../shared/utils/invoiceMatch.js";
import type { AuthUser } from "../../shared/types/auth.js";
import {
  dbSession,
  mongoSupportsTransactions,
  runInTransaction,
} from "../../shared/utils/mongoTransaction.js";
import {
  buildStockMovementAuditMetadata,
  buildTransferAuditMetadata,
} from "../../shared/utils/auditMetadata.js";
import { Permission } from "../../shared/constants/permissions.js";
import {
  getWarehouseIdsForPermission,
  isAdmin,
  resolveWarehouseIdForAnyPermission,
} from "../../shared/utils/permissions.js";
import { resolveWarehouseId } from "../../shared/utils/warehouseAccess.js";
import {
  filterBySearch,
  paginateArray,
  sortRows,
} from "../../shared/pagination/pagination.js";
import * as inventoryService from "./inventory.service.js";
import type {
  BalancesQuery,
  ProductAvailabilityQuery,
  StockInInput,
  StockOutBatchInput,
  StockOutInput,
} from "./stock.validation.js";

function toMovementResponse(doc: {
  _id: Types.ObjectId;
  type: string;
  quantity: number;
  dispatchType?: string;
  clientName?: string;
  invoiceNumber?: string;
  notes?: string;
  createdAt: Date;
  productId?: { _id: Types.ObjectId; name: string };
  brandId?: { _id: Types.ObjectId; name: string };
  warehouseId?: { _id: Types.ObjectId; name: string; code: string };
  destinationWarehouseId?: { _id: Types.ObjectId; name: string; code: string };
  transferId?: Types.ObjectId;
}) {
  const product = doc.productId as { _id: Types.ObjectId; name: string } | undefined;
  const brand = doc.brandId as { _id: Types.ObjectId; name: string } | undefined;
  const warehouse = doc.warehouseId as
    | { _id: Types.ObjectId; name: string; code: string }
    | undefined;
  const dest = doc.destinationWarehouseId as
    | { _id: Types.ObjectId; name: string; code: string }
    | undefined;

  return {
    id: String(doc._id),
    type: doc.type,
    quantity: doc.quantity,
    dispatchType: doc.dispatchType,
    clientName: doc.clientName,
    invoiceNumber: doc.invoiceNumber,
    notes: doc.notes,
    product: product ? { id: String(product._id), name: product.name } : undefined,
    brand: brand ? { id: String(brand._id), name: brand.name } : undefined,
    warehouse: warehouse
      ? { id: String(warehouse._id), name: warehouse.name, code: warehouse.code }
      : undefined,
    destinationWarehouse: dest
      ? { id: String(dest._id), name: dest.name, code: dest.code }
      : undefined,
    transferId: doc.transferId ? String(doc.transferId) : undefined,
    createdAt: doc.createdAt,
  };
}

export async function listMovements(user: AuthUser, limit = 50) {
  let filter: Record<string, unknown> = {};

  if (!isAdmin(user)) {
    const allowed = getWarehouseIdsForPermission(user, Permission.STOCK_VIEW);
    if (allowed.length === 1) {
      filter = { warehouseId: allowed[0] };
    } else if (allowed.length > 1) {
      filter = { warehouseId: { $in: allowed } };
    } else {
      filter = { warehouseId: null };
    }
  }

  const movements = await StockMovement.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("productId", "name")
    .populate("brandId", "name")
    .populate("warehouseId", "name code")
    .populate("destinationWarehouseId", "name code")
    .lean();

  return movements.map((m) =>
    toMovementResponse(m as unknown as Parameters<typeof toMovementResponse>[0])
  );
}

export async function listBalancesForUser(user: AuthUser, query: BalancesQuery) {
  const warehouseId = resolveWarehouseIdForAnyPermission(
    user,
    [Permission.STOCK_VIEW, Permission.STOCK_OUT, Permission.STOCK_IN],
    query.warehouseId
  );

  if (query.productId) {
    if (!Types.ObjectId.isValid(query.productId)) {
      throw new BadRequestError("Invalid product ID");
    }
    const product = await Product.findById(query.productId)
      .populate<{ brandId: { _id: Types.ObjectId; name: string } }>("brandId", "name")
      .lean();
    if (!product) {
      throw new NotFoundError("Product not found");
    }
    const brand = product.brandId as { _id: Types.ObjectId; name: string };
    const balance = await InventoryBalance.findOne({
      warehouseId,
      productId: query.productId,
    }).lean();
    const row = {
      productId: query.productId,
      productName: product.name,
      secondaryProductName: product.secondaryName,
      brandId: String(brand._id),
      brandName: brand.name,
      stockUnit: product.stockUnit ?? "unit",
      unitsPerStockUnit: product.unitsPerStockUnit ?? 1,
      baseUnit: product.baseUnit ?? "piece",
      quantity: balance?.quantity ?? 0,
      updatedAt: balance?.updatedAt ?? null,
    };
    return paginateArray([row], query);
  }

  const rows = await inventoryService.listBalances(warehouseId);

  let filtered = filterBySearch(rows, query.search, [
    (r) => r.productName,
    (r) => r.secondaryProductName ?? "",
    (r) => r.brandName,
  ]);
  if (query.brandId) {
    filtered = filtered.filter((row) => row.brandId === query.brandId);
  }
  filtered = sortRows(filtered, query.sortBy, query.sortOrder ?? "desc", {
    quantity: (r) => r.quantity,
    productName: (r) => r.productName,
    brandName: (r) => r.brandName,
    updatedAt: (r) => {
      const value = r.updatedAt;
      if (value instanceof Date) return value.getTime();
      if (value) return new Date(value as string).getTime();
      return 0;
    },
  });
  return paginateArray(filtered, query);
}

export async function listProductAvailability(
  user: AuthUser,
  query: ProductAvailabilityQuery
) {
  const warehouseId = resolveWarehouseIdForAnyPermission(
    user,
    [Permission.STOCK_VIEW, Permission.STOCK_OUT, Permission.STOCK_IN],
    query.warehouseId
  );

  if (!Types.ObjectId.isValid(query.brandId)) {
    throw new BadRequestError("Invalid brand ID");
  }

  const [warehouse, brand] = await Promise.all([
    Warehouse.findOne({ _id: warehouseId, isActive: true }).lean(),
    Brand.findOne({ _id: query.brandId, isActive: true }).lean(),
  ]);

  if (!warehouse) {
    throw new NotFoundError("Warehouse not found");
  }
  if (!brand) {
    throw new NotFoundError("Brand not found");
  }

  const products = await Product.find({
    brandId: query.brandId,
    isActive: true,
  })
    .sort({ name: 1 })
    .lean();

  const balances = await InventoryBalance.find({
    warehouseId,
    productId: { $in: products.map((p) => p._id) },
  }).lean();

  const quantityByProductId = new Map(
    balances.map((balance) => [String(balance.productId), balance.quantity])
  );

  return products.map((product) => ({
    productId: String(product._id),
    quantity: quantityByProductId.get(String(product._id)) ?? 0,
    stockUnit: product.stockUnit ?? "unit",
    unitsPerStockUnit: product.unitsPerStockUnit ?? 1,
    baseUnit: product.baseUnit ?? "piece",
  }));
}

export async function stockIn(input: StockInInput, user: AuthUser) {
  if (input.transferId) {
    return runInTransaction(async (session) => {
      const receiveWarehouseId = resolveWarehouseIdForAnyPermission(
        user,
        [Permission.STOCK_IN, Permission.TRANSFERS_RECEIVE],
        input.warehouseId
      );
      return receiveTransfer(input, user, receiveWarehouseId, session);
    });
  }

  const warehouseId = resolveWarehouseId(
    user,
    input.warehouseId,
    Permission.STOCK_IN
  );

  const { productId, brandId, name: productName } =
    await inventoryService.validateProductForBrand(input.productId, input.brandId);

  const [warehouse, brand] = await Promise.all([
    Warehouse.findById(warehouseId).lean(),
    Brand.findById(brandId).lean(),
  ]);

  if (!warehouse || warehouse.isActive === false) {
    throw new BadRequestError("Selected warehouse is inactive");
  }

  const { movementId, balance } = await runInTransaction(async (session) => {
    const newQty = await inventoryService.adjustBalance(
      warehouseId,
      String(productId),
      input.quantity,
      session
    );

    const [movement] = await StockMovement.create(
      [
        {
          type: StockMovementType.STOCK_IN,
          warehouseId,
          productId,
          brandId,
          quantity: input.quantity,
          clientName: input.clientName?.trim() || undefined,
          invoiceNumber: input.invoiceNumber?.trim() || undefined,
          notes: input.notes,
          createdBy: user.id,
        },
      ],
      dbSession(session)
    );

    await AuditLog.create(
      [
        {
          action: "STOCK_IN",
          entity: "StockMovement",
          entityId: movement._id,
          userId: user.id,
          metadata: buildStockMovementAuditMetadata({
            quantity: input.quantity,
            warehouse: warehouse as { _id: Types.ObjectId; name: string; code: string } | null,
            product: { _id: productId, name: productName },
            brand: brand as { _id: Types.ObjectId; name: string } | null,
            clientName: input.clientName?.trim(),
            invoiceNumber: input.invoiceNumber?.trim(),
            notes: input.notes,
          }),
        },
      ],
      dbSession(session)
    );

    return { movementId: movement._id, balance: newQty };
  });

  const populated = await StockMovement.findById(movementId)
    .populate("productId", "name")
    .populate("brandId", "name")
    .populate("warehouseId", "name code")
    .lean();

  if (!populated) {
    throw new NotFoundError("Stock movement not found after create");
  }

  return {
    movement: toMovementResponse(
      populated as unknown as Parameters<typeof toMovementResponse>[0]
    ),
    balance,
  };
}

async function receiveTransfer(
  input: StockInInput,
  user: AuthUser,
  warehouseId: string,
  session: mongoose.ClientSession | null
) {
  if (!input.transferId || !Types.ObjectId.isValid(input.transferId)) {
    throw new BadRequestError("Invalid transfer ID");
  }

  const transfer = await Transfer.findById(input.transferId).session(session ?? null);
  if (!transfer) {
    throw new NotFoundError("Transfer not found");
  }

  if (String(transfer.destinationWarehouseId) !== warehouseId) {
    throw new ForbiddenError("This transfer is not for your warehouse");
  }

  if (transfer.status !== TransferStatus.PENDING) {
    throw new BadRequestError("Transfer is already received or cancelled");
  }

  if (input.productId !== String(transfer.productId)) {
    throw new BadRequestError("Product does not match the transfer");
  }

  if (input.brandId !== String(transfer.brandId)) {
    throw new BadRequestError("Brand does not match the transfer");
  }

  if (input.quantity !== transfer.quantity) {
    throw new BadRequestError(
      `Quantity must match transfer quantity (${transfer.quantity})`
    );
  }

  // Atomically claim the transfer before crediting stock. If a concurrent
  // request (or admin action) already moved it out of PENDING, this returns
  // null and we abort without double-crediting the destination balance.
  const claimed = await Transfer.findOneAndUpdate(
    { _id: transfer._id, status: TransferStatus.PENDING },
    {
      $set: {
        status: TransferStatus.RECEIVED,
        receivedBy: new Types.ObjectId(user.id),
        receivedAt: new Date(),
      },
    },
    { new: true, ...(session ? { session } : {}) }
  );
  if (!claimed) {
    throw new BadRequestError("Transfer is already received or cancelled");
  }

  const newQty = await inventoryService.adjustBalance(
    warehouseId,
    String(transfer.productId),
    transfer.quantity,
    session
  );

  const [movement] = await StockMovement.create(
    [
      {
        type: StockMovementType.STOCK_IN,
        warehouseId,
        productId: transfer.productId,
        brandId: transfer.brandId,
        quantity: transfer.quantity,
        transferId: transfer._id,
        notes: input.notes ?? "Received from inter-warehouse transfer",
        createdBy: user.id,
      },
    ],
    dbSession(session)
  );

  await Transfer.updateOne(
    { _id: transfer._id },
    { $set: { stockInMovementId: movement._id } },
    dbSession(session)
  );
  transfer.status = TransferStatus.RECEIVED;
  transfer.stockInMovementId = movement._id;
  transfer.receivedBy = claimed.receivedBy;
  transfer.receivedAt = claimed.receivedAt;

  const populatedTransfer = await Transfer.findById(transfer._id)
    .populate("productId", "name")
    .populate("brandId", "name")
    .populate("sourceWarehouseId", "name code")
    .populate("destinationWarehouseId", "name code")
    .populate("createdBy", "name email")
    .session(session ?? null)
    .lean();

  const pt = populatedTransfer as unknown as {
    _id: Types.ObjectId;
    quantity: number;
    status: string;
    productId: { _id: Types.ObjectId; name: string };
    brandId: { _id: Types.ObjectId; name: string };
    sourceWarehouseId: { _id: Types.ObjectId; name: string; code: string };
    destinationWarehouseId: { _id: Types.ObjectId; name: string; code: string };
    createdBy?: { _id: Types.ObjectId; name: string; email?: string };
  };

  await AuditLog.create(
    [
      {
        action: "TRANSFER_RECEIVED",
        entity: "Transfer",
        entityId: transfer._id,
        userId: user.id,
        metadata: buildTransferAuditMetadata({
          transferId: transfer._id,
          quantity: transfer.quantity,
          status: TransferStatus.RECEIVED,
          product: pt.productId,
          brand: pt.brandId,
          sourceWarehouse: pt.sourceWarehouseId,
          destinationWarehouse: pt.destinationWarehouseId,
          initiatedBy: pt.createdBy ?? null,
          receivedBy: { _id: new Types.ObjectId(user.id), name: user.name },
        }),
      },
    ],
    dbSession(session)
  );

  const populated = await StockMovement.findById(movement._id)
    .session(session ?? null)
    .populate("productId", "name")
    .populate("brandId", "name")
    .populate("warehouseId", "name code")
    .lean();

  return {
    movement: toMovementResponse(
      populated as unknown as Parameters<typeof toMovementResponse>[0]
    ),
    balance: newQty,
    transferId: String(transfer._id),
  };
}

export async function stockOut(input: StockOutInput, user: AuthUser) {
  const warehouseId = resolveWarehouseId(
    user,
    input.warehouseId,
    Permission.STOCK_OUT
  );
  const { productId, brandId, name: productName } =
    await inventoryService.validateProductForBrand(input.productId, input.brandId);

  const [sourceWarehouse, brand] = await Promise.all([
    Warehouse.findById(warehouseId).lean(),
    Brand.findById(brandId).lean(),
  ]);

  if (!sourceWarehouse || sourceWarehouse.isActive === false) {
    throw new BadRequestError("Selected warehouse is inactive");
  }

  let destinationWarehouseId: Types.ObjectId | undefined;
  let destinationWarehouse: { _id: Types.ObjectId; name: string; code: string } | null =
    null;

  if (input.dispatchType === DispatchType.TRANSFER) {
    if (!input.destinationWarehouseId) {
      throw new BadRequestError("Destination warehouse is required");
    }
    if (input.destinationWarehouseId === warehouseId) {
      throw new BadRequestError("Cannot transfer to the same warehouse");
    }

    const destination = await Warehouse.findOne({
      _id: input.destinationWarehouseId,
      isActive: true,
    }).lean();

    if (!destination) {
      throw new NotFoundError("Destination warehouse not found");
    }

    destinationWarehouseId = destination._id;
    destinationWarehouse = {
      _id: destination._id,
      name: destination.name,
      code: destination.code,
    };
  }

  const isDirectSale = input.dispatchType === DispatchType.DIRECT_SELLING;
  const clientName = isDirectSale ? input.clientName?.trim() : undefined;
  const invoiceNumber = isDirectSale
    ? input.invoiceNumber?.trim() || undefined
    : undefined;

  const claim =
    isDirectSale && invoiceNumber && clientName
      ? await acquireSalesInvoiceClaim(warehouseId, invoiceNumber, clientName)
      : null;
  const transactionsSupported = claim
    ? await mongoSupportsTransactions()
    : false;
  let writesStarted = false;

  let txnResult: {
    movementId: Types.ObjectId;
    balance: number;
    transferId: string | undefined;
  };
  try {
    txnResult = await runInTransaction(async (session) => {
      writesStarted = true;
      await inventoryService.assertSufficientStock(
        warehouseId,
        String(productId),
        input.quantity,
        session
      );

      const newQty = await inventoryService.adjustBalance(
        warehouseId,
        String(productId),
        -input.quantity,
        session
      );

      let transferId: Types.ObjectId | undefined;

      const [movement] = await StockMovement.create(
        [
          {
            type: StockMovementType.STOCK_OUT,
            warehouseId,
            productId,
            brandId,
            quantity: input.quantity,
            dispatchType: input.dispatchType,
            clientName:
              input.dispatchType === DispatchType.DIRECT_SELLING
                ? clientName
                : undefined,
            invoiceNumber:
              input.dispatchType === DispatchType.DIRECT_SELLING
                ? invoiceNumber
                : undefined,
            destinationWarehouseId,
            notes: input.notes,
            createdBy: user.id,
          },
        ],
        dbSession(session)
      );

      if (input.dispatchType === DispatchType.TRANSFER && destinationWarehouseId) {
        const [transfer] = await Transfer.create(
          [
            {
              sourceWarehouseId: warehouseId,
              destinationWarehouseId,
              productId,
              brandId,
              quantity: input.quantity,
              status: TransferStatus.PENDING,
              stockOutMovementId: movement._id,
              createdBy: user.id,
            },
          ],
          dbSession(session)
        );
        transferId = transfer._id;
        movement.transferId = transferId;
        await movement.save(dbSession(session));

        await AuditLog.create(
          [
            {
              action: "TRANSFER_CREATED",
              entity: "Transfer",
              entityId: transfer._id,
              userId: user.id,
              metadata: buildTransferAuditMetadata({
                transferId: transfer._id,
                quantity: input.quantity,
                status: TransferStatus.PENDING,
                product: { _id: productId, name: productName },
                brand: brand as { _id: Types.ObjectId; name: string } | null,
                sourceWarehouse: sourceWarehouse as {
                  _id: Types.ObjectId;
                  name: string;
                  code: string;
                } | null,
                destinationWarehouse,
                initiatedBy: { _id: new Types.ObjectId(user.id), name: user.name },
              }),
            },
          ],
          dbSession(session)
        );
      }

      await AuditLog.create(
        [
          {
            action: "STOCK_OUT",
            entity: "StockMovement",
            entityId: movement._id,
            userId: user.id,
            metadata: buildStockMovementAuditMetadata({
              quantity: input.quantity,
              warehouse: sourceWarehouse as {
                _id: Types.ObjectId;
                name: string;
                code: string;
              } | null,
              product: { _id: productId, name: productName },
              brand: brand as { _id: Types.ObjectId; name: string } | null,
              dispatchType: input.dispatchType,
              destinationWarehouse,
              transferId,
              clientName,
              invoiceNumber,
              notes: input.notes,
            }),
          },
        ],
        dbSession(session)
      );

      return {
        movementId: movement._id,
        balance: newQty,
        transferId: transferId ? String(transferId) : undefined,
      };
    });
  } catch (err) {
    if (claim) {
      if (transactionsSupported || !writesStarted) {
        await SalesInvoiceClaim.deleteOne({
          _id: claim._id,
          claimToken: claim.claimToken,
          status: "PROCESSING",
        });
      } else {
        await SalesInvoiceClaim.updateOne(
          {
            _id: claim._id,
            claimToken: claim.claimToken,
            status: "PROCESSING",
          },
          {
            $set: {
              status: "FAILED",
              failureMessage:
                err instanceof Error ? err.message : "Stock out failed",
            },
            $unset: { processingExpiresAt: 1 },
          }
        );
      }
    }
    throw err;
  }

  if (claim) {
    await SalesInvoiceClaim.updateOne(
      {
        _id: claim._id,
        claimToken: claim.claimToken,
        status: "PROCESSING",
      },
      {
        $set: {
          status: "COMPLETED",
          movementIds: [txnResult.movementId],
        },
        $unset: { processingExpiresAt: 1, failureMessage: 1 },
      }
    );
  }

  const populated = await StockMovement.findById(txnResult.movementId)
    .populate("productId", "name")
    .populate("brandId", "name")
    .populate("warehouseId", "name code")
    .populate("destinationWarehouseId", "name code")
    .lean();

  if (!populated) {
    throw new NotFoundError("Stock movement not found after create");
  }

  return {
    movement: toMovementResponse(
      populated as unknown as Parameters<typeof toMovementResponse>[0]
    ),
    balance: txnResult.balance,
    transferId: txnResult.transferId,
  };
}

type ValidatedSaleLine = {
  productId: Types.ObjectId;
  brandId: Types.ObjectId;
  productName: string;
  brandName: string;
  quantity: number;
};

const INVOICE_CLAIM_TTL_MS = 15 * 60 * 1000;

function normalizeInvoiceClaimPart(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en");
}

async function findExistingInvoiceMovements(
  warehouseId: string,
  invoiceNumber: string,
  clientName: string
) {
  return StockMovement.find({
    type: StockMovementType.STOCK_OUT,
    dispatchType: DispatchType.DIRECT_SELLING,
    warehouseId: new Types.ObjectId(warehouseId),
    invoiceNumber: exactCaseInsensitiveRegex(invoiceNumber),
    clientName: exactCaseInsensitiveRegex(clientName),
  })
    .select("_id")
    .lean();
}

async function acquireSalesInvoiceClaim(
  warehouseId: string,
  invoiceNumber: string,
  clientName: string
) {
  await SalesInvoiceClaim.init();

  const key = {
    warehouseId: new Types.ObjectId(warehouseId),
    invoiceNormalized: normalizeInvoiceClaimPart(invoiceNumber),
    clientNormalized: normalizeInvoiceClaimPart(clientName),
  };
  const claimToken = crypto.randomUUID();
  const processingExpiresAt = new Date(Date.now() + INVOICE_CLAIM_TTL_MS);

  const legacyMovements = await findExistingInvoiceMovements(
    warehouseId,
    invoiceNumber,
    clientName
  );
  if (legacyMovements.length > 0) {
    throw new BadRequestError(
      `Invoice ${invoiceNumber} for ${clientName} was already imported at this warehouse`
    );
  }

  try {
    return await SalesInvoiceClaim.create({
      ...key,
      invoiceNumber,
      clientName,
      status: "PROCESSING",
      claimToken,
      processingExpiresAt,
    });
  } catch (err: unknown) {
    if ((err as { code?: number }).code !== 11000) throw err;
  }

  const reclaimed = await SalesInvoiceClaim.findOneAndUpdate(
    {
      ...key,
      status: "PROCESSING",
      processingExpiresAt: { $lte: new Date() },
    },
    {
      $set: {
        invoiceNumber,
        clientName,
        claimToken,
        processingExpiresAt,
      },
      $unset: { failureMessage: 1 },
    },
    { new: true }
  );

  if (reclaimed) {
    const existingMovements = await findExistingInvoiceMovements(
      warehouseId,
      invoiceNumber,
      clientName
    );
    if (existingMovements.length > 0) {
      await SalesInvoiceClaim.updateOne(
        { _id: reclaimed._id, claimToken },
        {
          $set: {
            status: "COMPLETED",
            completedAt: new Date(),
          },
          $unset: { processingExpiresAt: 1, failureMessage: 1 },
        }
      );
      throw new BadRequestError(
        `Invoice ${invoiceNumber} for ${clientName} was already imported at this warehouse`
      );
    }

    // Expired PROCESSING with no movements is ambiguous after a crash (balance
    // may already have been decremented). Do not auto-retry — fail closed.
    await SalesInvoiceClaim.updateOne(
      { _id: reclaimed._id },
      {
        $set: {
          status: "FAILED",
          failureMessage:
            "Previous import attempt timed out. Verify stock manually before retrying this invoice.",
        },
        $unset: { processingExpiresAt: 1 },
      }
    );
    throw new BadRequestError(
      `Invoice ${invoiceNumber} for ${clientName} has a stuck import claim. Verify warehouse stock, then ask an admin to clear the claim before retrying.`
    );
  }

  const existing = await SalesInvoiceClaim.findOne(key).select("status").lean();
  const suffix =
    existing?.status === "PROCESSING"
      ? " is currently being processed"
      : existing?.status === "FAILED"
        ? " requires review after a partial failure"
        : " was already imported";
  throw new BadRequestError(
    `Invoice ${invoiceNumber} for ${clientName}${suffix} at this warehouse`
  );
}

export async function stockOutBatch(input: StockOutBatchInput, user: AuthUser) {
  const warehouseId = resolveWarehouseId(
    user,
    input.warehouseId,
    Permission.STOCK_OUT
  );

  const sourceWarehouse = await Warehouse.findById(warehouseId).lean();
  if (!sourceWarehouse || sourceWarehouse.isActive === false) {
    throw new BadRequestError("Selected warehouse is inactive");
  }

  const validatedLines: ValidatedSaleLine[] = [];
  for (const item of input.items) {
    const { productId, brandId, name: productName } =
      await inventoryService.validateProductForBrand(item.productId, item.brandId);
    const brand = await Brand.findById(brandId).lean();
    validatedLines.push({
      productId,
      brandId,
      productName,
      brandName: brand?.name ?? "",
      quantity: item.quantity,
    });
  }

  const clientName = input.clientName.trim();
  const invoiceNumber = input.invoiceNumber?.trim() || undefined;
  const notes = input.notes?.trim() || undefined;

  const claim = invoiceNumber
    ? await acquireSalesInvoiceClaim(warehouseId, invoiceNumber, clientName)
    : null;
  const transactionsSupported = claim
    ? await mongoSupportsTransactions()
    : false;
  let writesStarted = false;

  let txnResult: {
    movementIds: Types.ObjectId[];
    balances: Record<string, number>;
  };
  try {
    txnResult = await runInTransaction(async (session) => {
      for (const line of validatedLines) {
        await inventoryService.assertSufficientStock(
          warehouseId,
          String(line.productId),
          line.quantity,
          session
        );
      }

      const movementIds: Types.ObjectId[] = [];
      const balances: Record<string, number> = {};

      for (const line of validatedLines) {
        writesStarted = true;
        const newQty = await inventoryService.adjustBalance(
          warehouseId,
          String(line.productId),
          -line.quantity,
          session
        );
        balances[String(line.productId)] = newQty;

        const [movement] = await StockMovement.create(
          [
            {
              type: StockMovementType.STOCK_OUT,
              warehouseId,
              productId: line.productId,
              brandId: line.brandId,
              quantity: line.quantity,
              dispatchType: DispatchType.DIRECT_SELLING,
              clientName,
              invoiceNumber,
              notes,
              createdBy: user.id,
            },
          ],
          dbSession(session)
        );
        movementIds.push(movement._id);

        await AuditLog.create(
          [
            {
              action: "STOCK_OUT",
              entity: "StockMovement",
              entityId: movement._id,
              userId: user.id,
              metadata: buildStockMovementAuditMetadata({
                quantity: line.quantity,
                warehouse: sourceWarehouse as {
                  _id: Types.ObjectId;
                  name: string;
                  code: string;
                } | null,
                product: { _id: line.productId, name: line.productName },
                brand: { _id: line.brandId, name: line.brandName },
                dispatchType: DispatchType.DIRECT_SELLING,
                destinationWarehouse: null,
                transferId: undefined,
                clientName,
                invoiceNumber,
                notes,
              }),
            },
          ],
          dbSession(session)
        );
      }

      return { movementIds, balances };
    });
  } catch (err) {
    if (claim) {
      if (transactionsSupported || !writesStarted) {
        await SalesInvoiceClaim.deleteOne({
          _id: claim._id,
          claimToken: claim.claimToken,
          status: "PROCESSING",
        });
      } else {
        await SalesInvoiceClaim.updateOne(
          {
            _id: claim._id,
            claimToken: claim.claimToken,
            status: "PROCESSING",
          },
          {
            $set: {
              status: "FAILED",
              failureMessage:
                err instanceof Error ? err.message : "Stock out failed",
            },
            $unset: { processingExpiresAt: 1 },
          }
        );
      }
    }
    throw err;
  }

  if (claim) {
    await SalesInvoiceClaim.updateOne(
      {
        _id: claim._id,
        claimToken: claim.claimToken,
        status: "PROCESSING",
      },
      {
        $set: {
          status: "COMPLETED",
          movementIds: txnResult.movementIds,
        },
        $unset: { processingExpiresAt: 1, failureMessage: 1 },
      }
    );
  }

  const populated = await StockMovement.find({ _id: { $in: txnResult.movementIds } })
    .populate("productId", "name")
    .populate("brandId", "name")
    .populate("warehouseId", "name code")
    .lean();

  const order = new Map(
    txnResult.movementIds.map((id, index) => [String(id), index])
  );
  populated.sort(
    (a, b) =>
      (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0)
  );

  return {
    movements: populated.map((m) =>
      toMovementResponse(m as unknown as Parameters<typeof toMovementResponse>[0])
    ),
    balances: txnResult.balances,
    invoiceNumber,
    clientName,
  };
}
