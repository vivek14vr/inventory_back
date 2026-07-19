import { Types, type ClientSession } from "mongoose";
import { StockMovement } from "../../models/StockMovement.js";
import {
  DispatchType,
  StockMovementType,
} from "../../shared/constants/roles.js";
import { exactCaseInsensitiveRegex } from "../../shared/utils/invoiceMatch.js";

/** Ledger rows for sold-qty edits; must not count toward returned quantity. */
export const INVOICE_QTY_CORRECTION_NOTE_PREFIX = "Invoice quantity correction";

export const notInvoiceQtyCorrection = {
  notes: { $not: { $regex: `^${INVOICE_QTY_CORRECTION_NOTE_PREFIX}`, $options: "i" } },
};

type SaleMovementRef = {
  _id: Types.ObjectId;
  invoiceNumber?: string;
  clientName?: string;
  productId: Types.ObjectId;
  warehouseId: Types.ObjectId;
};

function saleLineFilter(
  invoiceNumber: string,
  clientName: string,
  productId: Types.ObjectId
) {
  return {
    type: StockMovementType.STOCK_OUT,
    dispatchType: DispatchType.DIRECT_SELLING,
    invoiceNumber: exactCaseInsensitiveRegex(invoiceNumber),
    clientName: exactCaseInsensitiveRegex(clientName),
    productId,
  };
}

function unlinkedReturnFilter(
  invoiceNumber: string,
  clientName: string,
  productId: Types.ObjectId,
  warehouseId: Types.ObjectId
) {
  return {
    type: StockMovementType.STOCK_IN,
    relatedSaleMovementId: { $exists: false },
    invoiceNumber: exactCaseInsensitiveRegex(invoiceNumber),
    clientName: exactCaseInsensitiveRegex(clientName),
    productId,
    warehouseId,
    ...notInvoiceQtyCorrection,
  };
}

async function countSaleLinesForProductOnInvoice(
  invoiceNumber: string,
  clientName: string,
  productId: Types.ObjectId,
  session?: ClientSession | null
): Promise<number> {
  return StockMovement.countDocuments(
    saleLineFilter(invoiceNumber, clientName, productId)
  ).session(session ?? null);
}

async function sumUnlinkedReturnQuantity(
  invoiceNumber: string,
  clientName: string,
  productId: Types.ObjectId,
  warehouseId: Types.ObjectId,
  session?: ClientSession | null
): Promise<number> {
  const unlinked = await StockMovement.find(
    unlinkedReturnFilter(invoiceNumber, clientName, productId, warehouseId)
  )
    .session(session ?? null)
    .lean();

  return unlinked.reduce((sum, row) => sum + row.quantity, 0);
}

/** Total quantity already returned against a sale line (linked + legacy unlinked). */
export async function sumReturnedQuantityForSale(
  sale: SaleMovementRef,
  session?: ClientSession | null
): Promise<number> {
  const linked = await StockMovement.aggregate<{ total: number }>([
    {
      $match: {
        type: StockMovementType.STOCK_IN,
        relatedSaleMovementId: sale._id,
        ...notInvoiceQtyCorrection,
      },
    },
    { $group: { _id: null, total: { $sum: "$quantity" } } },
  ]).session(session ?? null);

  let total = linked[0]?.total ?? 0;

  const invoiceNumber = sale.invoiceNumber?.trim() ?? "";
  const clientName = sale.clientName?.trim() ?? "";
  if (!invoiceNumber) return total;

  const saleLinesForProduct = await countSaleLinesForProductOnInvoice(
    invoiceNumber,
    clientName,
    sale.productId,
    session
  );

  if (saleLinesForProduct === 0) return total;

  const shouldIncludeUnlinked =
    saleLinesForProduct === 1 ||
    (await StockMovement.findOne(saleLineFilter(invoiceNumber, clientName, sale.productId))
      .sort({ createdAt: 1 })
      .select("_id")
      .session(session ?? null)
      .lean()
      .then((first) => first && String(first._id) === String(sale._id)));

  if (shouldIncludeUnlinked) {
    total += await sumUnlinkedReturnQuantity(
      invoiceNumber,
      clientName,
      sale.productId,
      sale.warehouseId,
      session
    );
  }

  return total;
}

/**
 * Stock balance change when a sale line quantity is edited.
 * Accounts for returns already credited via separate STOCK_IN movements.
 */
export function saleQuantityInventoryDelta(
  previousQuantity: number,
  nextQuantity: number,
  returnedQuantity: number
): number {
  if (nextQuantity === previousQuantity) return 0;
  if (nextQuantity > previousQuantity) {
    return previousQuantity - nextQuantity;
  }
  return previousQuantity - Math.max(nextQuantity, returnedQuantity);
}

/** Parse `sold 15 → 10` from an invoice-quantity-correction note. */
export function parseSoldTransitionFromCorrectionNote(
  notes?: string | null
): { from: number; to: number } | null {
  if (!notes) return null;
  const match = notes.match(/sold\s+(\d+(?:\.\d+)?)\s*(?:→|->)\s*(\d+(?:\.\d+)?)/i);
  if (!match) return null;
  const from = Number(match[1]);
  const to = Number(match[2]);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return { from, to };
}

/**
 * Net stock-in from invoice qty corrections (reduces effective sold).
 * STOCK_IN corrections restore stock → sold down; STOCK_OUT → sold up.
 */
export async function sumInvoiceQtyCorrectionSoldAdjust(
  saleId: Types.ObjectId,
  session?: ClientSession | null
): Promise<number> {
  const rows = await StockMovement.aggregate<{ _id: string; total: number }>([
    {
      $match: {
        relatedSaleMovementId: saleId,
        notes: {
          $regex: `^${INVOICE_QTY_CORRECTION_NOTE_PREFIX}`,
          $options: "i",
        },
      },
    },
    { $group: { _id: "$type", total: { $sum: "$quantity" } } },
  ]).session(session ?? null);

  let stockIn = 0;
  let stockOut = 0;
  for (const row of rows) {
    if (row._id === StockMovementType.STOCK_IN) stockIn = row.total;
    if (row._id === StockMovementType.STOCK_OUT) stockOut = row.total;
  }
  // Effective sold = originalQuantity - stockIn + stockOut
  return stockIn - stockOut;
}

/**
 * Current billed/sold qty for invoice UI and returns.
 * Prefer stored invoiceSoldQuantity; otherwise derive from original ± corrections.
 */
export function effectiveInvoiceSoldQuantity(params: {
  quantity: number;
  invoiceSoldQuantity?: number | null;
  soldAdjustFromCorrections?: number;
}): number {
  if (
    typeof params.invoiceSoldQuantity === "number" &&
    Number.isFinite(params.invoiceSoldQuantity)
  ) {
    return params.invoiceSoldQuantity;
  }
  const adjust = params.soldAdjustFromCorrections ?? 0;
  return params.quantity - adjust;
}

/**
 * If a past invoice edit rewrote `quantity`, recover the original from the
 * earliest correction note (`sold 15 → 10`) so Movements stay immutable.
 */
export async function restoreHistoricalSaleQuantityIfMutated(
  sale: {
    _id: Types.ObjectId;
    quantity: number;
    save: (opts?: { session?: ClientSession | null }) => Promise<unknown>;
  },
  session?: ClientSession | null
): Promise<number> {
  const firstCorrection = await StockMovement.findOne({
    relatedSaleMovementId: sale._id,
    notes: {
      $regex: `^${INVOICE_QTY_CORRECTION_NOTE_PREFIX}`,
      $options: "i",
    },
  })
    .sort({ createdAt: 1 })
    .select("notes")
    .session(session ?? null)
    .lean();

  const parsed = parseSoldTransitionFromCorrectionNote(firstCorrection?.notes);
  if (!parsed) return sale.quantity;

  if (sale.quantity !== parsed.from) {
    sale.quantity = parsed.from;
    await sale.save({ session });
  }
  return parsed.from;
}

/** Resolve historical movement qty for display (no write). */
export function historicalSaleQuantityFromCorrections(
  currentQuantity: number,
  firstCorrectionNotes?: string | null
): number {
  const parsed = parseSoldTransitionFromCorrectionNote(firstCorrectionNotes);
  if (parsed && currentQuantity !== parsed.from) return parsed.from;
  return currentQuantity;
}
