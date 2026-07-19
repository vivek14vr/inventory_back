import { Types } from "mongoose";
import { Brand } from "../../models/Brand.js";
import { InventoryBalance } from "../../models/InventoryBalance.js";
import { Product } from "../../models/Product.js";
import { StockMovement } from "../../models/StockMovement.js";
import { DispatchType, StockMovementType } from "../../shared/constants/roles.js";
import { Permission } from "../../shared/constants/permissions.js";
import { BadRequestError, ForbiddenError } from "../../shared/errors/AppError.js";
import type { AuthUser } from "../../shared/types/auth.js";
import {
  getWarehouseIdsForPermission,
  hasPermission,
  isAdmin,
} from "../../shared/utils/permissions.js";
import type {
  InvoiceSuggestionsQuery,
  ProductSuggestionsQuery,
} from "./search.validation.js";
import { buildCaseInsensitiveRegex } from "./search.utils.js";

type BalanceWarehouseFilter = {
  warehouseFilter: Record<string, unknown>;
  quantityScope: "total" | "warehouse";
};

function resolveBalanceWarehouseFilter(
  user: AuthUser,
  warehouseId?: string
): BalanceWarehouseFilter {
  if (warehouseId) {
    if (!Types.ObjectId.isValid(warehouseId)) {
      throw new BadRequestError("Invalid warehouse ID");
    }
    if (
      !isAdmin(user) &&
      !hasPermission(user, Permission.INVENTORY_VIEW) &&
      !hasPermission(user, Permission.STOCK_VIEW, warehouseId) &&
      !hasPermission(user, Permission.STOCK_MOVEMENTS, warehouseId) &&
      !hasPermission(user, Permission.STOCK_LOW, warehouseId)
    ) {
      throw new ForbiddenError("You do not have access to this warehouse");
    }
    return {
      warehouseFilter: { warehouseId: new Types.ObjectId(warehouseId) },
      quantityScope: "warehouse",
    };
  }

  if (isAdmin(user) || hasPermission(user, Permission.INVENTORY_VIEW)) {
    return { warehouseFilter: {}, quantityScope: "total" };
  }

  const stockWarehouses = [
    ...new Set([
      ...getWarehouseIdsForPermission(user, Permission.STOCK_VIEW),
      ...getWarehouseIdsForPermission(user, Permission.STOCK_MOVEMENTS),
      ...getWarehouseIdsForPermission(user, Permission.STOCK_LOW),
    ]),
  ];
  if (stockWarehouses.length === 0) {
    throw new ForbiddenError("You do not have permission to search products");
  }

  if (stockWarehouses.length === 1) {
    return {
      warehouseFilter: { warehouseId: new Types.ObjectId(stockWarehouses[0]) },
      quantityScope: "warehouse",
    };
  }

  return {
    warehouseFilter: {
      warehouseId: { $in: stockWarehouses.map((id) => new Types.ObjectId(id)) },
    },
    quantityScope: "total",
  };
}

export async function searchProductSuggestions(
  user: AuthUser,
  query: ProductSuggestionsQuery
) {
  const term = query.search.trim();
  const regex = buildCaseInsensitiveRegex(term);
  const limit = query.limit ?? 8;

  if (query.brandId && !Types.ObjectId.isValid(query.brandId)) {
    throw new BadRequestError("Invalid brand ID");
  }

  const matchingBrandIds = await Brand.find({ name: regex, isActive: true })
    .select("_id")
    .lean();
  const brandIds = matchingBrandIds.map((brand) => brand._id);

  const productFilter: Record<string, unknown> = {
    $or: [
      { name: regex },
      { secondaryName: regex },
      ...(brandIds.length > 0 ? [{ brandId: { $in: brandIds } }] : []),
    ],
  };

  if (!query.includeInactive) {
    productFilter.isActive = true;
  }
  if (query.brandId) {
    productFilter.brandId = new Types.ObjectId(query.brandId);
  }

  const products = await Product.find(productFilter)
    .populate<{ brandId: { _id: Types.ObjectId; name: string } }>("brandId", "name")
    .sort({ name: 1 })
    .limit(limit)
    .lean();

  if (products.length === 0) {
    return { items: [] };
  }

  const productIds = products.map((product) => product._id);
  const { warehouseFilter, quantityScope } = resolveBalanceWarehouseFilter(
    user,
    query.warehouseId
  );

  const quantityRows = await InventoryBalance.aggregate<{ _id: Types.ObjectId; quantity: number }>(
    [
      {
        $match: {
          productId: { $in: productIds },
          ...warehouseFilter,
        },
      },
      {
        $group: {
          _id: "$productId",
          quantity: { $sum: "$quantity" },
        },
      },
    ]
  );

  const quantityByProduct = new Map(
    quantityRows.map((row) => [String(row._id), row.quantity])
  );

  return {
    items: products.map((product) => {
      const brand = product.brandId as { _id: Types.ObjectId; name: string };
      const productId = String(product._id);
      const quantity = quantityByProduct.get(productId) ?? 0;

      return {
        productId,
        productName: product.name,
        secondaryProductName: product.secondaryName,
        brandId: String(brand._id),
        brandName: brand.name,
        quantity,
        quantityScope,
      };
    }),
  };
}

export async function searchInvoiceSuggestions(
  _user: AuthUser,
  query: InvoiceSuggestionsQuery
) {
  const term = query.search.trim();
  const regex = buildCaseInsensitiveRegex(term);
  const limit = query.limit ?? 8;

  const productIds = await Product.find({
    isActive: true,
    $or: [{ name: regex }, { secondaryName: regex }],
  }).distinct("_id");

  const movementFilter = {
    type: StockMovementType.STOCK_OUT,
    dispatchType: DispatchType.DIRECT_SELLING,
    $and: [
      {
        $or: [
          { invoiceNumber: regex },
          { clientName: regex },
          ...(productIds.length > 0 ? [{ productId: { $in: productIds } }] : []),
        ],
      },
    ],
  };

  const movements = await StockMovement.find(movementFilter)
    .sort({ createdAt: -1 })
    .limit(Math.max(limit * 4, 20))
    .populate("productId", "name secondaryName")
    .lean();

  type Suggestion = {
    id: string;
    kind: "invoice" | "client" | "product";
    title: string;
    subtitle?: string;
    searchTerm: string;
  };

  const seen = new Set<string>();
  const items: Suggestion[] = [];

  function pushSuggestion(suggestion: Suggestion) {
    const key = `${suggestion.kind}:${suggestion.searchTerm.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(suggestion);
  }

  for (const movement of movements) {
    if (items.length >= limit) break;

    const invoiceNumber = movement.invoiceNumber?.trim();
    if (invoiceNumber && regex.test(invoiceNumber)) {
      pushSuggestion({
        id: `invoice:${invoiceNumber}`,
        kind: "invoice",
        title: invoiceNumber,
        subtitle: "Invoice number",
        searchTerm: invoiceNumber,
      });
    }

    const clientName = movement.clientName?.trim();
    if (clientName && regex.test(clientName)) {
      pushSuggestion({
        id: `client:${clientName}`,
        kind: "client",
        title: clientName,
        subtitle: "Client name",
        searchTerm: clientName,
      });
    }

    const product = movement.productId as unknown as
      | { _id: Types.ObjectId; name: string; secondaryName?: string }
      | null
      | undefined;
    if (product) {
      const productLabel = product.secondaryName?.trim()
        ? `${product.name} · ${product.secondaryName}`
        : product.name;
      if (
        regex.test(product.name) ||
        (product.secondaryName && regex.test(product.secondaryName))
      ) {
        pushSuggestion({
          id: `product:${product._id}`,
          kind: "product",
          title: productLabel,
          subtitle: "Product",
          searchTerm: product.name,
        });
      }
    }
  }

  return { items: items.slice(0, limit) };
}
