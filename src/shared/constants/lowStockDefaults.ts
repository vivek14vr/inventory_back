/** Default low-stock alert when Excel or forms leave a threshold blank (10 cartons/boxes). */
export const DEFAULT_LOW_STOCK_STOCK_UNITS = 10;

export function defaultLowStockThresholdBase(unitsPerStockUnit: number): number {
  const per =
    Number.isFinite(unitsPerStockUnit) && unitsPerStockUnit > 0
      ? Math.round(unitsPerStockUnit)
      : 1;
  return DEFAULT_LOW_STOCK_STOCK_UNITS * per;
}

export function resolveLowStockThresholdWithDefault(
  value: number | undefined | null,
  unitsPerStockUnit: number
): number {
  if (value != null && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }
  return defaultLowStockThresholdBase(unitsPerStockUnit);
}
