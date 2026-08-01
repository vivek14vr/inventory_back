import { Types } from "mongoose";
import { AuditLog } from "../../models/AuditLog.js";
import { Client } from "../../models/Client.js";
import { InventoryBalance } from "../../models/InventoryBalance.js";
import { StockMovement } from "../../models/StockMovement.js";
import { Brand } from "../../models/Brand.js";
import { SalesInvoiceClaim } from "../../models/SalesInvoiceClaim.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../shared/errors/AppError.js";
import { StockMovementType } from "../../shared/constants/roles.js";
import type { AuthUser } from "../../shared/types/auth.js";
import { dbSession, runInTransaction } from "../../shared/utils/mongoTransaction.js";
import * as inventoryAdminService from "../inventory/inventory.service.js";
import * as balanceService from "../stock/inventory.service.js";

type AuditLike = {
  action: string;
  entityId?: Types.ObjectId | string | null;
  revertedAt?: Date | null;
  revertStartedAt?: Date | null;
  metadata?: Record<string, unknown>;
};

const SUPPORTED_ACTIONS = new Set([
  "STOCK_ADJUSTED",
  "STOCK_IN",
  "STOCK_OUT",
  "CLIENT_RETURN",
  "CLIENT_UPDATED",
  "CLIENT_ACTIVATED",
  "CLIENT_DEACTIVATED",
  "CLIENT_CREATED",
  "CLIENT_DELETED",
  "BRAND_DELETED",
  "INVOICE_UPDATED",
]);

export function revertCapability(log: AuditLike): { canRevert: boolean; reason?: string } {
  if (log.revertedAt) return { canRevert: false, reason: "Already reverted" };
  if (log.revertStartedAt) return { canRevert: false, reason: "Revert is already in progress" };
  if (!SUPPORTED_ACTIONS.has(log.action)) {
    return { canRevert: false, reason: "This action has no safe automatic revert" };
  }
  const metadata = log.metadata ?? {};
  if (log.action === "STOCK_ADJUSTED") {
    const complete =
      typeof metadata.warehouseId === "string" &&
      typeof metadata.productId === "string" &&
      typeof metadata.previous === "number" &&
      typeof metadata.next === "number";
    if (!complete) return { canRevert: false, reason: "Prior stock values are unavailable" };
  }
  if (["STOCK_IN", "STOCK_OUT", "CLIENT_RETURN"].includes(log.action)) {
    if (!log.entityId) {
      return { canRevert: false, reason: "The stock movement id is unavailable" };
    }
    if (log.metadata?.transferId || log.metadata?.dispatchType === "TRANSFER") {
      return {
        canRevert: false,
        reason: "Revert the related transfer event to preserve both warehouses",
      };
    }
  }
  if (["CLIENT_UPDATED", "CLIENT_ACTIVATED", "CLIENT_DEACTIVATED"].includes(log.action)) {
    if (!log.entityId || changeList(metadata).length === 0) {
      return { canRevert: false, reason: "Prior client values are unavailable" };
    }
  }
  if (["CLIENT_CREATED", "CLIENT_DELETED", "BRAND_DELETED"].includes(log.action) && !log.entityId) {
    return { canRevert: false, reason: "The affected record id is unavailable" };
  }
  if (log.action === "INVOICE_UPDATED") {
    const movementId = metadata.movementId ?? log.entityId;
    const hasPriorValue =
      typeof metadata.previousQuantity === "number" ||
      typeof metadata.previousInvoiceNumber === "string" ||
      typeof metadata.previousClientName === "string";
    if (!movementId || !hasPriorValue) {
      return { canRevert: false, reason: "Prior invoice values are unavailable" };
    }
  }
  return { canRevert: true };
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BadRequestError(`Audit record is missing ${label}`);
  }
  return value;
}

function objectId(value: unknown, label: string): string {
  const id = typeof value === "string" ? value : "";
  if (!Types.ObjectId.isValid(id)) throw new BadRequestError(`Audit record is missing ${label}`);
  return id;
}

function changeList(metadata: Record<string, unknown>): Array<{
  field: string;
  before: unknown;
  after: unknown;
}> {
  if (!Array.isArray(metadata.changes)) return [];
  return metadata.changes.filter(
    (change): change is { field: string; before: unknown; after: unknown } =>
      typeof change === "object" &&
      change !== null &&
      typeof (change as { field?: unknown }).field === "string" &&
      ["name", "secondaryName", "isActive"].includes(
        (change as { field: string }).field
      )
  );
}

function exactTextRegex(value: string): RegExp {
  return new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
}

async function createRevertAudit(
  originalId: Types.ObjectId,
  originalAction: string,
  user: AuthUser,
  metadata: Record<string, unknown>,
  session: Parameters<typeof dbSession>[0]
) {
  const [revertLog] = await AuditLog.create(
    [
      {
        action: "ACTION_REVERTED",
        entity: "AuditLog",
        entityId: originalId,
        userId: user.id,
        metadata: { originalAuditId: String(originalId), originalAction, ...metadata },
      },
    ],
    dbSession(session)
  );
  await AuditLog.updateOne(
    { _id: originalId, revertedAt: { $exists: false } },
    {
      $set: {
        revertedAt: new Date(),
        revertedBy: new Types.ObjectId(user.id),
        revertAuditLogId: revertLog._id,
      },
      $unset: { revertStartedAt: 1 },
    },
    dbSession(session)
  );
  return revertLog;
}

async function revertStockAdjustment(log: {
  _id: Types.ObjectId;
  action: string;
  entityId?: Types.ObjectId;
  metadata?: Record<string, unknown>;
}, user: AuthUser) {
  const metadata = log.metadata ?? {};
  const warehouseId = objectId(metadata.warehouseId, "warehouse id");
  const productId = objectId(metadata.productId, "product id");
  const previous = finiteNumber(metadata.previous, "previous quantity");
  const next = finiteNumber(metadata.next, "new quantity");

  return runInTransaction(async (session) => {
    const original = await AuditLog.findOne({ _id: log._id, revertedAt: { $exists: false } })
      .session(session ?? null);
    if (!original) throw new ConflictError("This action was already reverted");

    const balance = await InventoryBalance.findOne({ warehouseId, productId }).session(
      session ?? null
    );
    const current = balance?.quantity ?? 0;
    if (current !== next) {
      throw new ConflictError(
        `Stock changed after this action (current ${current}, expected ${next}). Revert the newer action first.`
      );
    }

    if (balance) {
      balance.quantity = previous;
      await balance.save({ session });
    } else if (previous > 0) {
      await InventoryBalance.create(
        [{ warehouseId, productId, quantity: previous }],
        dbSession(session)
      );
    }

    const delta = previous - next;
    if (delta !== 0) {
      const originalMovement = log.entityId
        ? await StockMovement.findById(log.entityId).session(session ?? null)
        : null;
      await StockMovement.create(
        [
          {
            type: delta > 0 ? StockMovementType.STOCK_IN : StockMovementType.STOCK_OUT,
            warehouseId,
            productId,
            brandId: originalMovement?.brandId ?? objectId(metadata.brandId, "brand id"),
            quantity: Math.abs(delta),
            balanceAfter: previous,
            notes: `Revert stock adjustment · audit ${String(log._id)}`,
            createdBy: user.id,
          },
        ],
        dbSession(session)
      );
    }

    await createRevertAudit(log._id, log.action, user, { previous, revertedFrom: next }, session);
    return { reverted: true, auditId: String(log._id) };
  });
}

async function revertStockMovement(log: {
  _id: Types.ObjectId;
  action: string;
  entityId?: Types.ObjectId;
  metadata?: Record<string, unknown>;
}, user: AuthUser) {
  if (!log.entityId) throw new BadRequestError("Audit record has no stock movement id");

  const movement = await StockMovement.findById(log.entityId);
  if (!movement) throw new NotFoundError("Stock movement no longer exists");

  if (movement.transferId || movement.dispatchType === "TRANSFER") {
    throw new BadRequestError("Transfer stock must be reverted from its transfer event");
  }

  if (log.action === "STOCK_OUT" && movement.dispatchType === "DIRECT_SELLING") {
    await inventoryAdminService.deleteSaleInvoice(String(movement._id), user);
    await createRevertAudit(log._id, log.action, user, {
      movementId: String(movement._id),
      restoredQuantity: movement.quantity,
      method: "invoice_deleted",
    }, undefined);
    return { reverted: true, auditId: String(log._id) };
  }

  if (log.action === "CLIENT_RETURN") {
    if (!movement.relatedSaleMovementId) {
      throw new BadRequestError("The return is missing its related sale movement");
    }
    return runInTransaction(async (session) => {
      const original = await AuditLog.findOne({ _id: log._id, revertedAt: { $exists: false } })
        .session(session ?? null);
      if (!original) throw new ConflictError("This action was already reverted");

      const nextBalance = await balanceService.adjustBalance(
        movement.warehouseId,
        movement.productId,
        -movement.quantity,
        session
      );
      const updatedSale = await StockMovement.updateOne(
        {
          _id: movement.relatedSaleMovementId,
          clientReturnedQuantity: { $gte: movement.quantity },
        },
        { $inc: { clientReturnedQuantity: -movement.quantity } },
        dbSession(session)
      );
      if (updatedSale.modifiedCount !== 1) {
        if (!session) {
          await balanceService.adjustBalance(
            movement.warehouseId,
            movement.productId,
            movement.quantity
          );
        }
        throw new ConflictError("The related sale return quantity changed after this action");
      }

      await StockMovement.deleteOne({ _id: movement._id }, dbSession(session));
      await createRevertAudit(log._id, log.action, user, {
        movementId: String(movement._id),
        restoredQuantity: movement.quantity,
        balanceAfter: nextBalance,
        method: "return_removed",
      }, session);
      return { reverted: true, auditId: String(log._id) };
    });
  }

  return runInTransaction(async (session) => {
    const original = await AuditLog.findOne({ _id: log._id, revertedAt: { $exists: false } })
      .session(session ?? null);
    if (!original) throw new ConflictError("This action was already reverted");

    const isIncrease = movement.type === StockMovementType.STOCK_IN;
    const delta = isIncrease ? -movement.quantity : movement.quantity;
    const nextBalance = await balanceService.adjustBalance(
      movement.warehouseId,
      movement.productId,
      delta,
      session
    );

    await StockMovement.create(
      [
        {
          type: isIncrease ? StockMovementType.STOCK_OUT : StockMovementType.STOCK_IN,
          warehouseId: movement.warehouseId,
          productId: movement.productId,
          brandId: movement.brandId,
          quantity: movement.quantity,
          balanceAfter: nextBalance,
          clientName: movement.clientName,
          invoiceNumber: movement.invoiceNumber,
          relatedSaleMovementId: movement.relatedSaleMovementId,
          notes: `Revert ${log.action.toLowerCase().replace(/_/g, " ")} · audit ${String(log._id)}`,
          createdBy: user.id,
        },
      ],
      dbSession(session)
    );

    await createRevertAudit(log._id, log.action, user, {
      movementId: String(movement._id),
      restoredQuantity: movement.quantity,
      balanceAfter: nextBalance,
      method: "compensating_movement",
    }, session);
    return { reverted: true, auditId: String(log._id) };
  });
}

async function revertClientChange(log: {
  _id: Types.ObjectId;
  action: string;
  entityId?: Types.ObjectId;
  metadata?: Record<string, unknown>;
}, user: AuthUser) {
  if (!log.entityId) throw new BadRequestError("Audit record has no client id");
  const changes = changeList(log.metadata ?? {});
  if (changes.length === 0) throw new BadRequestError("Audit record has no prior client values");

  return runInTransaction(async (session) => {
    const original = await AuditLog.findOne({ _id: log._id, revertedAt: { $exists: false } })
      .session(session ?? null);
    if (!original) throw new ConflictError("This action was already reverted");
    const client = await Client.findById(log.entityId).session(session ?? null);
    if (!client) throw new NotFoundError("Client no longer exists");

    for (const change of changes) {
      const current = (client as unknown as Record<string, unknown>)[change.field];
      const normalizedCurrent = current ?? null;
      const normalizedAfter = change.after ?? null;
      if (normalizedCurrent !== normalizedAfter) {
        throw new ConflictError(
          `Client ${change.field} changed again after this action. Revert the newer action first.`
        );
      }
      (client as unknown as Record<string, unknown>)[change.field] =
        change.before === null ? undefined : change.before;
    }
    await client.save({ session });
    await createRevertAudit(log._id, log.action, user, { restoredFields: changes.map((c) => c.field) }, session);
    return { reverted: true, auditId: String(log._id) };
  });
}

async function revertClientCreated(log: {
  _id: Types.ObjectId;
  action: string;
  entityId?: Types.ObjectId;
  metadata?: Record<string, unknown>;
}, user: AuthUser) {
  if (!log.entityId) throw new BadRequestError("Audit record has no client id");
  const expectedName = String(log.metadata?.name ?? "");
  return runInTransaction(async (session) => {
    const client = await Client.findById(log.entityId).session(session ?? null);
    if (!client) throw new NotFoundError("Client no longer exists");
    if (client.name !== expectedName) {
      throw new ConflictError("Client changed after creation. Revert the newer change first.");
    }
    const nameMatch = exactTextRegex(client.name);
    const [movementCount, invoiceClaimCount] = await Promise.all([
      StockMovement.countDocuments({ clientName: nameMatch }).session(session ?? null),
      SalesInvoiceClaim.countDocuments({ clientName: nameMatch }).session(session ?? null),
    ]);
    if (movementCount > 0 || invoiceClaimCount > 0) {
      throw new ConflictError(
        "Client gained invoice or stock history after creation and cannot be removed"
      );
    }
    await Client.deleteOne({ _id: client._id }).session(session ?? null);
    await createRevertAudit(log._id, log.action, user, { deletedClientId: String(client._id) }, session);
    return { reverted: true, auditId: String(log._id) };
  });
}

async function revertBrandDeleted(log: {
  _id: Types.ObjectId;
  action: string;
  entityId?: Types.ObjectId;
  metadata?: Record<string, unknown>;
}, user: AuthUser) {
  if (!log.entityId) throw new BadRequestError("Audit record has no brand id");
  const name = String(log.metadata?.name ?? "").trim();
  if (!name) throw new BadRequestError("Audit record has no brand name");
  return runInTransaction(async (session) => {
    if (await Brand.exists({
      $or: [{ _id: log.entityId }, { name: exactTextRegex(name) }],
    }).session(session ?? null)) {
      throw new ConflictError("The brand id or name is already in use");
    }
    await Brand.create(
      [{ _id: log.entityId, name, isActive: log.metadata?.isActive !== false }],
      dbSession(session)
    );
    await createRevertAudit(log._id, log.action, user, { restoredBrandId: String(log.entityId) }, session);
    return { reverted: true, auditId: String(log._id) };
  });
}

async function revertClientDeleted(log: {
  _id: Types.ObjectId;
  action: string;
  entityId?: Types.ObjectId;
  metadata?: Record<string, unknown>;
}, user: AuthUser) {
  if (!log.entityId) throw new BadRequestError("Audit record has no client id");
  const name = String(log.metadata?.name ?? "").trim();
  if (!name) throw new BadRequestError("Audit record has no client name");
  return runInTransaction(async (session) => {
    if (await Client.exists({ $or: [{ _id: log.entityId }, { name: exactTextRegex(name) }] }).session(session ?? null)) {
      throw new ConflictError("The client id or name is already in use");
    }
    await Client.create(
      [{
        _id: log.entityId,
        name,
        secondaryName: log.metadata?.secondaryName || undefined,
        isActive: log.metadata?.isActive !== false,
      }],
      dbSession(session)
    );
    await createRevertAudit(log._id, log.action, user, { restoredClientId: String(log.entityId) }, session);
    return { reverted: true, auditId: String(log._id) };
  });
}

async function revertInvoiceUpdate(log: {
  _id: Types.ObjectId;
  action: string;
  entityId?: Types.ObjectId;
  metadata?: Record<string, unknown>;
}, user: AuthUser) {
  const metadata = log.metadata ?? {};
  const movementId = objectId(metadata.movementId ?? log.entityId?.toString(), "movement id");
  const movement = await StockMovement.findById(movementId);
  if (!movement) throw new NotFoundError("Invoice movement no longer exists");
  if (await AuditLog.exists({ _id: log._id, revertedAt: { $exists: true } })) {
    throw new ConflictError("This action was already reverted");
  }

  const update: {
    quantity?: number;
    invoiceNumber?: string;
    clientName?: string;
  } = {};
  if (typeof metadata.previousQuantity === "number" && typeof metadata.quantity === "number") {
    const current = movement.invoiceSoldQuantity ?? movement.quantity;
    if (current !== metadata.quantity) {
      throw new ConflictError("Invoice quantity changed again. Revert the newer action first.");
    }
    update.quantity = metadata.previousQuantity;
  }
  if (typeof metadata.previousInvoiceNumber === "string") {
    if ((movement.invoiceNumber ?? "") !== String(metadata.invoiceNumber ?? "")) {
      throw new ConflictError("Invoice number changed again. Revert the newer action first.");
    }
    update.invoiceNumber = metadata.previousInvoiceNumber;
  }
  if (typeof metadata.previousClientName === "string") {
    if ((movement.clientName ?? "") !== String(metadata.clientName ?? "")) {
      throw new ConflictError("Client name changed again. Revert the newer action first.");
    }
    update.clientName = metadata.previousClientName;
  }
  if (Object.keys(update).length === 0) {
    throw new BadRequestError("Audit record has no reversible invoice values");
  }

  await inventoryAdminService.updateMovementInvoice(movementId, update, user);
  const revertLog = await AuditLog.create({
    action: "ACTION_REVERTED",
    entity: "AuditLog",
    entityId: log._id,
    userId: user.id,
    metadata: { originalAuditId: String(log._id), originalAction: log.action, restored: update },
  });
  const marked = await AuditLog.updateOne(
    { _id: log._id, revertedAt: { $exists: false } },
    {
      $set: { revertedAt: new Date(), revertedBy: user.id, revertAuditLogId: revertLog._id },
      $unset: { revertStartedAt: 1 },
    }
  );
  if (marked.modifiedCount !== 1) throw new ConflictError("This action was already reverted");
  return { reverted: true, auditId: String(log._id) };
}

export async function revertAuditAction(auditId: string, user: AuthUser) {
  if (!Types.ObjectId.isValid(auditId)) throw new NotFoundError("Action not found");
  const log = await AuditLog.findById(auditId).lean();
  if (!log) throw new NotFoundError("Action not found");
  const capability = revertCapability(log);
  if (!capability.canRevert) throw new BadRequestError(capability.reason ?? "Action cannot be reverted");

  const claimed = await AuditLog.updateOne(
    {
      _id: log._id,
      revertedAt: { $exists: false },
      revertStartedAt: { $exists: false },
    },
    { $set: { revertStartedAt: new Date(), revertedBy: new Types.ObjectId(user.id) } }
  );
  if (claimed.modifiedCount !== 1) {
    throw new ConflictError("This action is already being reverted or was reverted");
  }

  try {
    if (log.action === "STOCK_ADJUSTED") return await revertStockAdjustment(log, user);
    if (["STOCK_IN", "STOCK_OUT", "CLIENT_RETURN"].includes(log.action)) {
      return await revertStockMovement(log, user);
    }
    if (["CLIENT_UPDATED", "CLIENT_ACTIVATED", "CLIENT_DEACTIVATED"].includes(log.action)) {
      return await revertClientChange(log, user);
    }
    if (log.action === "CLIENT_CREATED") return await revertClientCreated(log, user);
    if (log.action === "CLIENT_DELETED") return await revertClientDeleted(log, user);
    if (log.action === "BRAND_DELETED") return await revertBrandDeleted(log, user);
    if (log.action === "INVOICE_UPDATED") return await revertInvoiceUpdate(log, user);
    throw new BadRequestError("Action cannot be reverted safely");
  } catch (error) {
    await AuditLog.updateOne(
      { _id: log._id, revertedAt: { $exists: false } },
      { $unset: { revertStartedAt: 1, revertedBy: 1 } }
    );
    throw error;
  }
}
