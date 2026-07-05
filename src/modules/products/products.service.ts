import { Types } from "mongoose";
import { Brand } from "../../models/Brand.js";
import { Product } from "../../models/Product.js";
import {
  BadRequestError,
  NotFoundError,
} from "../../shared/errors/AppError.js";
import {
  buildPaginationMeta,
  getPaginationParams,
  mongoSort,
} from "../../shared/pagination/pagination.js";
import { normalizeProductName } from "../../shared/utils/productName.js";
import type {
  CreateProductInput,
  ListProductsQuery,
  UpdateProductInput,
} from "./products.validation.js";

type ProductDoc = {
  _id: Types.ObjectId;
  name: string;
  nameNormalized?: string;
  secondaryName?: string;
  brandId: Types.ObjectId | { _id: Types.ObjectId; name: string; isActive: boolean };
  baseUnit?: string;
  stockUnit?: string;
  unitsPerStockUnit?: number;
  lowStockThreshold?: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export function toPublicProduct(doc: ProductDoc) {
  const brand = doc.brandId as { _id: Types.ObjectId; name: string; isActive: boolean };

  return {
    id: String(doc._id),
    name: doc.name,
    secondaryName: doc.secondaryName,
    brandId: String(brand._id ?? doc.brandId),
    brand: {
      id: String(brand._id ?? doc.brandId),
      name: brand.name,
      isActive: brand.isActive,
    },
    baseUnit: doc.baseUnit ?? "piece",
    stockUnit: doc.stockUnit ?? "unit",
    unitsPerStockUnit: doc.unitsPerStockUnit ?? 1,
    lowStockThreshold: doc.lowStockThreshold,
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function validateBrand(brandId: string): Promise<void> {
  if (!Types.ObjectId.isValid(brandId)) {
    throw new BadRequestError("Invalid brand ID");
  }
  const brand = await Brand.findOne({ _id: brandId, isActive: true });
  if (!brand) {
    throw new NotFoundError("Brand not found or inactive");
  }
}

async function assertUniqueProductLabels(
  brandId: string,
  name: string,
  secondaryName?: string,
  excludeId?: string
) {
  const labels = [name, secondaryName]
    .map((label) => label?.trim())
    .filter((label): label is string => Boolean(label))
    .map((label) => normalizeProductName(label));

  if (new Set(labels).size !== labels.length) {
    throw new BadRequestError(
      "Primary and secondary names must be different for the same product"
    );
  }

  const filter: Record<string, unknown> = {
    brandId,
  };
  if (excludeId) {
    filter._id = { $ne: excludeId };
  }

  const products = await Product.find(filter).select("name secondaryName").lean();
  const conflict = products.find((product) => {
    const existingLabels = [product.name, product.secondaryName]
      .map((label) => label?.trim())
      .filter((label): label is string => Boolean(label))
      .map((label) => normalizeProductName(label));
    return existingLabels.some((label) => labels.includes(label));
  });

  if (conflict) {
    throw new BadRequestError(
      "A product with this primary or secondary name already exists for the selected brand (names are not case sensitive)"
    );
  }
}

export async function listProducts(query: ListProductsQuery) {
  const filter: Record<string, unknown> = {};
  if (!query.includeInactive) {
    filter.isActive = true;
  }
  if (query.brandId) {
    if (!Types.ObjectId.isValid(query.brandId)) {
      throw new BadRequestError("Invalid brand ID");
    }
    filter.brandId = query.brandId;
  }
  if (query.search?.trim()) {
    const term = query.search.trim();
    filter.$or = [
      { name: { $regex: term, $options: "i" } },
      { secondaryName: { $regex: term, $options: "i" } },
    ];
  }

  const { page, limit, skip, sortOrder } = getPaginationParams(query);
  const sortField = mongoSort(
    query.sortBy === "createdAt" || query.sortBy === "lowStockThreshold"
      ? query.sortBy
      : "name",
    sortOrder
  );

  const [total, products] = await Promise.all([
    Product.countDocuments(filter),
    Product.find(filter)
      .populate("brandId", "name isActive")
      .sort(sortField)
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  let items = products.map((p) => toPublicProduct(p as ProductDoc));

  if (query.sortBy === "brand") {
    items = [...items].sort((a, b) => {
      const cmp = a.brand.name.localeCompare(b.brand.name);
      return query.sortOrder === "asc" ? cmp : -cmp;
    });
  }

  return {
    items,
    pagination: buildPaginationMeta(total, page, limit),
  };
}

export async function getProductById(id: string) {
  if (!Types.ObjectId.isValid(id)) {
    throw new NotFoundError("Product not found");
  }

  const product = await Product.findById(id)
    .populate("brandId", "name isActive")
    .lean();

  if (!product) {
    throw new NotFoundError("Product not found");
  }

  return toPublicProduct(product as ProductDoc);
}

export async function createProduct(input: CreateProductInput) {
  await validateBrand(input.brandId);
  await assertUniqueProductLabels(input.brandId, input.name, input.secondaryName);

  const normalized = normalizeProductName(input.name);

  try {
    const product = await Product.create({
      name: input.name.trim(),
      nameNormalized: normalized,
      secondaryName: input.secondaryName?.trim() || undefined,
      brandId: input.brandId,
      baseUnit: input.baseUnit ?? "piece",
      stockUnit: input.stockUnit ?? "unit",
      unitsPerStockUnit: input.unitsPerStockUnit ?? 1,
      lowStockThreshold: input.lowStockThreshold,
      isActive: input.isActive ?? true,
    });

    const populated = await Product.findById(product._id)
      .populate("brandId", "name isActive")
      .lean();

    return toPublicProduct(populated as ProductDoc);
  } catch (err: unknown) {
    if ((err as { code?: number }).code === 11000) {
      throw new BadRequestError(
        "A product with this primary or secondary name already exists for the selected brand (names are not case sensitive)"
      );
    }
    throw err;
  }
}

export async function updateProduct(id: string, input: UpdateProductInput) {
  if (!Types.ObjectId.isValid(id)) {
    throw new NotFoundError("Product not found");
  }

  const product = await Product.findById(id);
  if (!product) {
    throw new NotFoundError("Product not found");
  }

  const nextBrandId = input.brandId ?? String(product.brandId);
  if (input.brandId) {
    await validateBrand(input.brandId);
    product.brandId = new Types.ObjectId(input.brandId);
  }

  if (input.name) {
    product.name = input.name.trim();
    product.nameNormalized = normalizeProductName(input.name);
  }

  if (input.secondaryName !== undefined) {
    product.secondaryName = input.secondaryName?.trim() || undefined;
  }

  if (input.baseUnit !== undefined) {
    product.baseUnit = input.baseUnit;
  }

  if (input.stockUnit !== undefined) {
    product.stockUnit = input.stockUnit;
  }

  if (input.unitsPerStockUnit !== undefined) {
    product.unitsPerStockUnit = input.unitsPerStockUnit;
  }

  if (input.lowStockThreshold !== undefined) {
    product.lowStockThreshold =
      input.lowStockThreshold === null ? undefined : input.lowStockThreshold;
  }

  if (input.isActive !== undefined) {
    product.isActive = input.isActive;
  }

  await assertUniqueProductLabels(
    nextBrandId,
    product.name,
    product.secondaryName,
    id
  );

  try {
    await product.save();
    const populated = await Product.findById(product._id)
      .populate("brandId", "name isActive")
      .lean();
    return toPublicProduct(populated as ProductDoc);
  } catch (err: unknown) {
    if ((err as { code?: number }).code === 11000) {
      throw new BadRequestError(
        "A product with this primary or secondary name already exists for the selected brand (names are not case sensitive)"
      );
    }
    throw err;
  }
}
