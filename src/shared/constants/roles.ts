export const UserRole = {
  ADMIN: "ADMIN",
  WAREHOUSE_USER: "WAREHOUSE_USER",
} as const;

export type UserRoleType = (typeof UserRole)[keyof typeof UserRole];

export const DispatchType = {
  TRANSFER: "TRANSFER",
  DIRECT_SELLING: "DIRECT_SELLING",
} as const;

export type DispatchTypeValue = (typeof DispatchType)[keyof typeof DispatchType];

export const StockMovementType = {
  STOCK_IN: "STOCK_IN",
  STOCK_OUT: "STOCK_OUT",
} as const;

export type StockMovementTypeValue =
  (typeof StockMovementType)[keyof typeof StockMovementType];

export const TransferStatus = {
  PENDING: "PENDING",
  RECEIVED: "RECEIVED",
  CANCELLED: "CANCELLED",
  RETURNED: "RETURNED",
} as const;

export type TransferStatusValue =
  (typeof TransferStatus)[keyof typeof TransferStatus];
