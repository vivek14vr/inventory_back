import { StockMovement } from "../../models/StockMovement.js";

export async function generateInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;

  const latest = await StockMovement.findOne({
    invoiceNumber: { $regex: `^${prefix}` },
  })
    .sort({ invoiceNumber: -1 })
    .select("invoiceNumber")
    .lean();

  let next = 1001;
  if (latest?.invoiceNumber) {
    const match = latest.invoiceNumber.match(/INV-\d+-(\d+)/);
    if (match) {
      next = Number.parseInt(match[1], 10) + 1;
    }
  }

  return `${prefix}${next}`;
}
