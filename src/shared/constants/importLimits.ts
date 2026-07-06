import { BadRequestError } from "../errors/AppError.js";

/** Matches multer `fileSize` limit on import routes. */
export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;

/** Maximum parsed data rows per import upload (product, sales, tally). */
export const MAX_IMPORT_ROWS = 5_000;

export function assertImportRowCount(rowCount: number, label = "Import file"): void {
  if (rowCount > MAX_IMPORT_ROWS) {
    throw new BadRequestError(
      `${label} has ${rowCount.toLocaleString("en-IN")} rows; the maximum allowed is ${MAX_IMPORT_ROWS.toLocaleString("en-IN")}. Split the file and try again.`
    );
  }
}
