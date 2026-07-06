import { escapeRegex } from "../../modules/search/search.utils.js";

/** Case-insensitive exact match for invoice / client strings stored on movements. */
export function exactCaseInsensitiveRegex(value: string): RegExp {
  const trimmed = value.trim();
  return new RegExp(`^${escapeRegex(trimmed)}$`, "i");
}
