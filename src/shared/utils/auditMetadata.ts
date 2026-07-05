import type { Types } from "mongoose";

type NamedEntity = { _id: Types.ObjectId; name: string };
type WarehouseEntity = { _id: Types.ObjectId; name: string; code: string };
type UserEntity = { _id: Types.ObjectId; name: string; email?: string };

function str(id: Types.ObjectId | string | undefined): string | undefined {
  return id ? String(id) : undefined;
}

export function buildStockMovementAuditMetadata(input: {
  quantity: number;
  warehouse?: WarehouseEntity | null;
  product?: NamedEntity | null;
  brand?: NamedEntity | null;
  dispatchType?: string;
  destinationWarehouse?: WarehouseEntity | null;
  transferId?: Types.ObjectId | string;
  clientName?: string;
  invoiceNumber?: string;
  notes?: string;
}): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    quantity: input.quantity,
  };

  if (input.warehouse) {
    meta.warehouseId = str(input.warehouse._id);
    meta.warehouseName = input.warehouse.name;
    meta.warehouseCode = input.warehouse.code;
  }
  if (input.product) {
    meta.productId = str(input.product._id);
    meta.productName = input.product.name;
  }
  if (input.brand) {
    meta.brandId = str(input.brand._id);
    meta.brandName = input.brand.name;
  }
  if (input.dispatchType) meta.dispatchType = input.dispatchType;
  if (input.destinationWarehouse) {
    meta.destinationWarehouseId = str(input.destinationWarehouse._id);
    meta.destinationWarehouseName = input.destinationWarehouse.name;
    meta.destinationWarehouseCode = input.destinationWarehouse.code;
  }
  if (input.transferId) meta.transferId = str(input.transferId);
  if (input.clientName) meta.clientName = input.clientName;
  if (input.invoiceNumber) meta.invoiceNumber = input.invoiceNumber;
  if (input.notes) meta.notes = input.notes;

  return meta;
}

export function buildTransferAuditMetadata(input: {
  transferId: Types.ObjectId | string;
  quantity: number;
  status?: string;
  product?: NamedEntity | null;
  brand?: NamedEntity | null;
  sourceWarehouse?: WarehouseEntity | null;
  destinationWarehouse?: WarehouseEntity | null;
  initiatedBy?: UserEntity | null;
  receivedBy?: UserEntity | null;
  returnedBy?: UserEntity | null;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    transferId: str(input.transferId),
    quantity: input.quantity,
  };

  if (input.status) meta.status = input.status;
  if (input.product) {
    meta.productId = str(input.product._id);
    meta.productName = input.product.name;
  }
  if (input.brand) {
    meta.brandId = str(input.brand._id);
    meta.brandName = input.brand.name;
  }
  if (input.sourceWarehouse) {
    meta.sourceWarehouseId = str(input.sourceWarehouse._id);
    meta.sourceWarehouseName = input.sourceWarehouse.name;
    meta.sourceWarehouseCode = input.sourceWarehouse.code;
  }
  if (input.destinationWarehouse) {
    meta.destinationWarehouseId = str(input.destinationWarehouse._id);
    meta.destinationWarehouseName = input.destinationWarehouse.name;
    meta.destinationWarehouseCode = input.destinationWarehouse.code;
  }
  if (input.initiatedBy) {
    meta.initiatedBy = str(input.initiatedBy._id);
    meta.initiatedByName = input.initiatedBy.name;
  }
  if (input.receivedBy) {
    meta.receivedBy = str(input.receivedBy._id);
    meta.receivedByName = input.receivedBy.name;
  }
  if (input.returnedBy) {
    meta.returnedBy = str(input.returnedBy._id);
    meta.returnedByName = input.returnedBy.name;
  }
  if (input.extra) Object.assign(meta, input.extra);

  return meta;
}

export function buildChecklistAuditMetadata(input: {
  checklistId: string;
  checklistTitle: string;
  taskId: string;
  taskTitle: string;
  date: string;
  dueTime?: string;
  completedLate?: boolean;
  userName?: string;
}): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    checklistId: input.checklistId,
    checklistTitle: input.checklistTitle,
    taskId: input.taskId,
    taskTitle: input.taskTitle,
    date: input.date,
  };
  if (input.dueTime) meta.dueTime = input.dueTime;
  if (input.completedLate) meta.completedLate = true;
  if (input.userName) meta.userName = input.userName;
  return meta;
}
