import { Types } from "mongoose";
import { Brand } from "../../models/Brand.js";
import { Product } from "../../models/Product.js";
import {
  BadRequestError,
  NotFoundError,
} from "../../shared/errors/AppError.js";
import type { CreateBrandInput, UpdateBrandInput } from "./brands.validation.js";

export function toPublicBrand(doc: {
  _id: Types.ObjectId;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: String(doc._id),
    name: doc.name,
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export async function listBrands(includeInactive = false) {
  const filter = includeInactive ? {} : { isActive: true };
  const brands = await Brand.find(filter).sort({ name: 1 }).lean();
  return brands.map((b) => toPublicBrand(b));
}

export async function getBrandById(id: string) {
  if (!Types.ObjectId.isValid(id)) {
    throw new NotFoundError("Brand not found");
  }
  const brand = await Brand.findById(id).lean();
  if (!brand) {
    throw new NotFoundError("Brand not found");
  }
  return toPublicBrand(brand);
}

export async function createBrand(input: CreateBrandInput) {
  const existing = await Brand.findOne({ name: input.name });
  if (existing) {
    throw new BadRequestError("Brand name already exists");
  }

  const brand = await Brand.create({
    name: input.name,
    isActive: input.isActive ?? true,
  });

  return toPublicBrand(brand.toObject());
}

export async function updateBrand(id: string, input: UpdateBrandInput) {
  if (!Types.ObjectId.isValid(id)) {
    throw new NotFoundError("Brand not found");
  }

  const brand = await Brand.findById(id);
  if (!brand) {
    throw new NotFoundError("Brand not found");
  }

  if (input.name && input.name !== brand.name) {
    const nameTaken = await Brand.findOne({ name: input.name, _id: { $ne: id } });
    if (nameTaken) {
      throw new BadRequestError("Brand name already exists");
    }
    brand.name = input.name;
  }

  if (input.isActive !== undefined) {
    brand.isActive = input.isActive;
  }

  await brand.save();
  return toPublicBrand(brand.toObject());
}

export async function getBrandProductCount(id: string): Promise<number> {
  return Product.countDocuments({ brandId: id, isActive: true });
}
