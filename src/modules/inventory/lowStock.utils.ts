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
  lowStockThreshold?: number;
  /** When set on the product, used for combined low-stock instead of summing warehouse thresholds. */
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

export function resolveLowStockThreshold(
  balanceThreshold?: number | null,
  productThreshold?: number | null
): number | undefined {
  if (balanceThreshold != null) return balanceThreshold;
  if (productThreshold != null) return productThreshold;
  return undefined;
}

export function isWarehouseLowStock(row: LowStockStockRow): boolean {
  if (row.lowStockThreshold === undefined || row.lowStockThreshold === null) {
    return false;
  }
  return row.quantity > 0 && row.quantity <= row.lowStockThreshold;
}

export function buildLowStockTotals(rows: LowStockStockRow[]): LowStockTotalRow[] {
  const byProduct = new Map<
    string,
    LowStockTotalRow & { summedThreshold: number; explicitTotal?: number }
  >();

  for (const r of rows) {
    if (r.quantity <= 0) continue;

    const existing = byProduct.get(r.productId);
    if (!existing) {
      byProduct.set(r.productId, {
        productId: r.productId,
        productName: r.productName,
        secondaryProductName: r.secondaryProductName,
        brandId: r.brandId,
        brandName: r.brandName,
        stockUnit: r.stockUnit,
        unitsPerStockUnit: r.unitsPerStockUnit,
        baseUnit: r.baseUnit,
        totalQuantity: r.quantity,
        totalLowStockThreshold: 0,
        summedThreshold: r.lowStockThreshold != null ? r.lowStockThreshold : 0,
        explicitTotal: r.productTotalLowStockThreshold,
      });
      continue;
    }

    existing.totalQuantity += r.quantity;
    if (r.lowStockThreshold != null) {
      existing.summedThreshold += r.lowStockThreshold;
    }
    if (r.productTotalLowStockThreshold != null) {
      existing.explicitTotal = r.productTotalLowStockThreshold;
    }
  }

  return Array.from(byProduct.values())
    .map((row) => ({
      productId: row.productId,
      productName: row.productName,
      secondaryProductName: row.secondaryProductName,
      brandId: row.brandId,
      brandName: row.brandName,
      stockUnit: row.stockUnit,
      unitsPerStockUnit: row.unitsPerStockUnit,
      baseUnit: row.baseUnit,
      totalQuantity: row.totalQuantity,
      totalLowStockThreshold: row.explicitTotal ?? row.summedThreshold,
    }))
    .filter(
      (row) =>
        row.totalLowStockThreshold > 0 &&
        row.totalQuantity > 0 &&
        row.totalQuantity <= row.totalLowStockThreshold
    );
}
