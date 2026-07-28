/**
 * Case-insensitive, space-insensitive name key for matching and uniqueness.
 * Extra/internal spaces are ignored so "11 inch plate" matches "11  inch plate".
 */
export function normalizeProductName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "");
}

/** Alias for brand/client/other entity name comparison during imports. */
export const normalizeEntityName = normalizeProductName;

export function formatProductDisplayName(name: string, secondaryName?: string): string {
  if (secondaryName?.trim()) {
    return `${name.trim()} (${secondaryName.trim()})`;
  }
  return name.trim();
}
