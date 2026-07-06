import { Types, type ClientSession } from "mongoose";
import { StockMovement } from "../../models/StockMovement.js";
import {
  DispatchType,
  StockMovementType,
} from "../../shared/constants/roles.js";

type SaleMovementRef = {
  _id: Types.ObjectId;
  invoiceNumber?: string;
  clientName?: string;
  productId: Types.ObjectId;
  warehouseId: Types.ObjectId;
};

async function countSaleLinesForProductOnInvoice(
  invoiceNumber: string,
  clientName: string,
  productId: Types.ObjectId,
  session?: ClientSession | null
): Promise<number> {
  return StockMovement.countDocuments({
    type: StockMovementType.STOCK_OUT,
    dispatchType: DispatchType.DIRECT_SELLING,
    invoiceNumber,
    clientName,
    productId,
  }).session(session ?? null);
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

  if (saleLinesForProduct === 1) {
    const unlinked = await StockMovement.find({
      type: StockMovementType.STOCK_IN,
      relatedSaleMovementId: { $exists: false },
      invoiceNumber,
      clientName,
      productId: sale.productId,
      warehouseId: sale.warehouseId,
    })
      .session(session ?? null)
      .lean();

    total += unlinked.reduce((sum, row) => sum + row.quantity, 0);
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
