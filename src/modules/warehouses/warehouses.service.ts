import { Types } from "mongoose";
import { Warehouse } from "../../models/Warehouse.js";
import {
  BadRequestError,
  NotFoundError,
} from "../../shared/errors/AppError.js";
import type {
  CreateWarehouseInput,
  UpdateWarehouseInput,
} from "./warehouses.validation.js";

export function toPublicWarehouse(doc: {
  _id: Types.ObjectId;
  name: string;
  code: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: String(doc._id),
    name: doc.name,
    code: doc.code,
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export async function listWarehouses(includeInactive = false) {
  const filter = includeInactive ? {} : { isActive: true };
  const warehouses = await Warehouse.find(filter).sort({ name: 1 }).lean();
  return warehouses.map((w) => toPublicWarehouse(w));
}

export async function getWarehouseById(id: string) {
  if (!Types.ObjectId.isValid(id)) {
    throw new NotFoundError("Warehouse not found");
  }
  const warehouse = await Warehouse.findById(id).lean();
  if (!warehouse) {
    throw new NotFoundError("Warehouse not found");
  }
  return toPublicWarehouse(warehouse);
}

export async function createWarehouse(input: CreateWarehouseInput) {
  const code = input.code.toUpperCase();
  const existing = await Warehouse.findOne({
    $or: [{ code }, { name: input.name }],
  });
  if (existing) {
    throw new BadRequestError(
      existing.code === code
        ? "Warehouse code already exists"
        : "Warehouse name already exists"
    );
  }

  const warehouse = await Warehouse.create({
    name: input.name,
    code,
    isActive: input.isActive ?? true,
  });

  return toPublicWarehouse(warehouse.toObject());
}

export async function updateWarehouse(id: string, input: UpdateWarehouseInput) {
  if (!Types.ObjectId.isValid(id)) {
    throw new NotFoundError("Warehouse not found");
  }

  const warehouse = await Warehouse.findById(id);
  if (!warehouse) {
    throw new NotFoundError("Warehouse not found");
  }

  if (input.name && input.name !== warehouse.name) {
    const nameTaken = await Warehouse.findOne({
      name: input.name,
      _id: { $ne: id },
    });
    if (nameTaken) {
      throw new BadRequestError("Warehouse name already exists");
    }
    warehouse.name = input.name;
  }

  if (input.code) {
    const code = input.code.toUpperCase();
    if (code !== warehouse.code) {
      const codeTaken = await Warehouse.findOne({ code, _id: { $ne: id } });
      if (codeTaken) {
        throw new BadRequestError("Warehouse code already exists");
      }
      warehouse.code = code;
    }
  }

  if (input.isActive !== undefined) {
    warehouse.isActive = input.isActive;
  }

  await warehouse.save();
  return toPublicWarehouse(warehouse.toObject());
}
