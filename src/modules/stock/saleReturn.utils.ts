import { Types, type ClientSession } from "mongoose";
import { StockMovement } from "../../models/StockMovement.js";
import {
  DispatchType,
  StockMovementType,
} from "../../shared/constants/roles.js";
import { exactCaseInsensitiveRegex } from "../../shared/utils/invoiceMatch.js";

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
