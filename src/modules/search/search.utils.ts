export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildCaseInsensitiveRegex(term: string): RegExp {
  return new RegExp(escapeRegex(term), "i");
}
