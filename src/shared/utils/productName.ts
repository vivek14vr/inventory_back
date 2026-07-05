/** Lowercase trimmed primary name for case-insensitive uniqueness checks. */
export function normalizeProductName(name: string): string {
  return name.trim().toLowerCase();
}

export function formatProductDisplayName(name: string, secondaryName?: string): string {
  if (secondaryName?.trim()) {
    return `${name.trim()} (${secondaryName.trim()})`;
  }
  return name.trim();
}
