export type LowStockStockRow = {
  productId: string;
  productName: string;
  secondaryProductName?: string;
  brandId: string;
  brandName: string;
  quantity: number;
  stockUnit: string;
  unitsPerStockUnit: number;
  baseUnit: string;
  /** Per-warehouse effective threshold (override or product default). */
  lowStockThreshold?: number;
  /** Product-wide default used when a warehouse has no override. */
  productLowStockThreshold?: number;
  /** Overall product threshold — independent of warehouse thresholds. */
  productTotalLowStockThreshold?: number;
};

export type LowStockTotalRow = {
  productId: string;
  productName: string;
  secondaryProductName?: string;
  brandId: string;
  brandName: string;
  stockUnit: string;
  unitsPerStockUnit: number;
  baseUnit: string;
  totalQuantity: number;
  totalLowStockThreshold: number;
};

export type LowStockWarehouseRow = LowStockStockRow & {
  warehouseId: string;
  warehouseName: string;
  warehouseCode: string;
  warehouseLowStockThreshold?: number;
};

export type LowStockGroupedProduct = {
  productId: string;
  productName: string;
  secondaryProductName?: string;
  brandId: string;
  brandName: string;
  stockUnit: string;
  unitsPerStockUnit: number;
  baseUnit: string;
  totalQuantity: number;
  /** Overall threshold from product.totalLowStockThreshold only. */
  totalLowStockThreshold?: number;
  isTotalLow: boolean;
  /** Quantity at each warehouse when that location is low. */
  warehouseLow: Record<string, number>;
  /** Per-warehouse alert threshold (override or product default). */
  warehouseThreshold: Record<string, number>;
  /** True when the warehouse has a custom threshold override. */
  warehouseThresholdCustom: Record<string, boolean>;
  sortQuantity: number;
  sortLowStockThreshold: number;
};

export function resolveLowStockThreshold(
  balanceThreshold?: number | null,
  productThreshold?: number | null
): number | undefined {
  if (balanceThreshold != null) return balanceThreshold;
  if (productThreshold != null) return productThreshold;
  return undefined;
}

export function isWarehouseLowStock(row: LowStockStockRow): boolean {
  if (row.lowStockThreshold == null || row.lowStockThreshold <= 0) {
    return false;
  }
  return row.quantity <= row.lowStockThreshold;
}

export function isTotalLowStock(
  totalQuantity: number,
  productTotalLowStockThreshold?: number | null
): boolean {
  if (productTotalLowStockThreshold == null || productTotalLowStockThreshold <= 0) {
    return false;
  }
  return totalQuantity <= productTotalLowStockThreshold;
}

export function buildLowStockTotals(rows: LowStockStockRow[]): LowStockTotalRow[] {
  const byProduct = new Map<
    string,
    LowStockTotalRow & { overallThreshold?: number }
  >();

  for (const row of rows) {
    const existing = byProduct.get(row.productId);
    if (!existing) {
      byProduct.set(row.productId, {
        productId: row.productId,
        productName: row.productName,
        secondaryProductName: row.secondaryProductName,
        brandId: row.brandId,
        brandName: row.brandName,
        stockUnit: row.stockUnit,
        unitsPerStockUnit: row.unitsPerStockUnit,
        baseUnit: row.baseUnit,
        totalQuantity: row.quantity,
        totalLowStockThreshold: row.productTotalLowStockThreshold ?? 0,
        overallThreshold: row.productTotalLowStockThreshold,
      });
      continue;
    }

    existing.totalQuantity += row.quantity;
    if (row.productTotalLowStockThreshold != null) {
      existing.overallThreshold = row.productTotalLowStockThreshold;
      existing.totalLowStockThreshold = row.productTotalLowStockThreshold;
    }
  }

  return Array.from(byProduct.values())
    .filter(
      (row) =>
        row.overallThreshold != null &&
        row.overallThreshold > 0 &&
        row.totalQuantity <= row.overallThreshold
    )
    .map(({ overallThreshold: _overallThreshold, ...row }) => row);
}

export function groupLowStockByProduct(
  allRows: LowStockWarehouseRow[],
  options: {
    warehouseLowItems: LowStockWarehouseRow[];
    totalLowProductIds: Set<string>;
  }
): LowStockGroupedProduct[] {
  const lowKeys = new Set(
    options.warehouseLowItems.map((row) => `${row.warehouseId}:${row.productId}`)
  );
  const productIds: string[] = [];
  const seenProducts = new Set<string>();

  for (const item of options.warehouseLowItems) {
    if (!seenProducts.has(item.productId)) {
      seenProducts.add(item.productId);
      productIds.push(item.productId);
    }
  }
  for (const productId of options.totalLowProductIds) {
    if (!seenProducts.has(productId)) {
      seenProducts.add(productId);
      productIds.push(productId);
    }
  }

  const rowsByProduct = new Map<string, LowStockWarehouseRow[]>();
  for (const row of allRows) {
    if (!seenProducts.has(row.productId)) continue;
    const list = rowsByProduct.get(row.productId) ?? [];
    list.push(row);
    rowsByProduct.set(row.productId, list);
  }

  const products: LowStockGroupedProduct[] = [];

  for (const productId of productIds) {
    const rows = rowsByProduct.get(productId) ?? [];
    const first = rows[0];
    if (!first) continue;

    const warehouseLow: Record<string, number> = {};
    const warehouseThreshold: Record<string, number> = {};
    const warehouseThresholdCustom: Record<string, boolean> = {};
    let totalQuantity = 0;
    let sortQuantity = Infinity;
    let sortLowStockThreshold = Infinity;
    const overallThreshold = first.productTotalLowStockThreshold;

    for (const row of rows) {
      totalQuantity += row.quantity;
      if (row.lowStockThreshold != null) {
        warehouseThreshold[row.warehouseId] = row.lowStockThreshold;
        warehouseThresholdCustom[row.warehouseId] = row.warehouseLowStockThreshold != null;
      }
      if (lowKeys.has(`${row.warehouseId}:${row.productId}`)) {
        warehouseLow[row.warehouseId] = row.quantity;
        sortQuantity = Math.min(sortQuantity, row.quantity);
        if (row.lowStockThreshold != null) {
          sortLowStockThreshold = Math.min(sortLowStockThreshold, row.lowStockThreshold);
        }
      }
    }

    const isTotalLow =
      options.totalLowProductIds.has(productId) ||
      isTotalLowStock(totalQuantity, overallThreshold);

    products.push({
      productId: first.productId,
      productName: first.productName,
      secondaryProductName: first.secondaryProductName,
      brandId: first.brandId,
      brandName: first.brandName,
      stockUnit: first.stockUnit,
      unitsPerStockUnit: first.unitsPerStockUnit,
      baseUnit: first.baseUnit,
      totalQuantity,
      totalLowStockThreshold: overallThreshold,
      isTotalLow,
      warehouseLow,
      warehouseThreshold,
      warehouseThresholdCustom,
      sortQuantity: sortQuantity === Infinity ? totalQuantity : sortQuantity,
      sortLowStockThreshold:
        sortLowStockThreshold === Infinity
          ? overallThreshold ?? 0
          : sortLowStockThreshold,
    });
  }

  return products;
}

export function extractWarehouseColumns(
  rows: LowStockWarehouseRow[]
): Array<{ warehouseId: string; name: string; code: string }> {
  const map = new Map<string, { warehouseId: string; name: string; code: string }>();
  for (const row of rows) {
    if (!map.has(row.warehouseId)) {
      map.set(row.warehouseId, {
        warehouseId: row.warehouseId,
        name: row.warehouseName,
        code: row.warehouseCode,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}
