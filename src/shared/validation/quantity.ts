import { BadRequestError } from "../errors/AppError.js";

export const QUANTITY_NON_NEGATIVE_MESSAGE = "Quantity cannot be negative";
export const QUANTITY_POSITIVE_MESSAGE = "Quantity must be at least 1";

export function assertNonNegativeIntegerQuantity(
  quantity: number,
  label = "Quantity"
): void {
  if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity < 0) {
    throw new BadRequestError(
      label === "Quantity" ? QUANTITY_NON_NEGATIVE_MESSAGE : `${label} cannot be negative`
    );
  }
}

export function assertPositiveIntegerQuantity(
  quantity: number,
  label = "Quantity"
): void {
  if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity < 1) {
    throw new BadRequestError(
      label === "Quantity" ? QUANTITY_POSITIVE_MESSAGE : `${label} must be at least 1`
    );
  }
}
