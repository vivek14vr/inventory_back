/** Module.action permission codes — assign per user (optionally per warehouse). */
export const Permission = {
  DASHBOARD_VIEW: "dashboard.view",

  STOCK_VIEW: "stock.view",
  STOCK_IN: "stock.in",
  STOCK_OUT: "stock.out",

  INVENTORY_VIEW: "inventory.view",
  INVENTORY_ADJUST: "inventory.adjust",
  INVENTORY_DASHBOARD: "inventory.dashboard",

  TRANSFERS_VIEW: "transfers.view",
  TRANSFERS_RECEIVE: "transfers.receive",
  TRANSFERS_MANAGE: "transfers.manage",

  WAREHOUSES_VIEW: "warehouses.view",
  WAREHOUSES_MANAGE: "warehouses.manage",

  BRANDS_VIEW: "brands.view",
  BRANDS_MANAGE: "brands.manage",

  PRODUCTS_VIEW: "products.view",
  PRODUCTS_MANAGE: "products.manage",

  REPORTS_VIEW: "reports.view",

  IMPORTS_MANAGE: "imports.manage",

  USERS_MANAGE: "users.manage",

  AUDIT_VIEW: "audit.view",

  CHECKLISTS_MANAGE: "checklists.manage",
  CHECKLISTS_COMPLETE: "checklists.complete",
} as const;

export type PermissionCode = (typeof Permission)[keyof typeof Permission];

export type PermissionGrant = {
  code: PermissionCode;
  warehouseId?: string;
};

export type PermissionDefinition = {
  code: PermissionCode;
  label: string;
  description?: string;
  example?: string;
  /** When set, overrides the module's warehouseScoped flag for this permission */
  warehouseScoped?: boolean;
};

export type PermissionModuleDefinition = {
  id: string;
  label: string;
  description: string;
  warehouseScoped: boolean;
  permissions: PermissionDefinition[];
};

export const PERMISSION_MODULES: PermissionModuleDefinition[] = [
  {
    id: "dashboard",
    label: "Home dashboard",
    description:
      "Landing page with quick links and summary cards for the user’s warehouse.",
    warehouseScoped: false,
    permissions: [
      {
        code: Permission.DASHBOARD_VIEW,
        label: "View home dashboard",
        description: "Open the Home screen after login.",
        example: "See today’s shortcuts and warehouse overview on the Home page.",
      },
    ],
  },
  {
    id: "stock",
    label: "Stock operations",
    description:
      "Day-to-day stock movements at a specific warehouse. Each grant applies to one warehouse only.",
    warehouseScoped: true,
    permissions: [
      {
        code: Permission.STOCK_VIEW,
        label: "View stock balances",
        description: "See how much of each product is on hand at the warehouse.",
        example: "Check that Goregaon has 40 boxes of Product A before dispatch.",
      },
      {
        code: Permission.STOCK_IN,
        label: "Record stock in",
        description: "Add stock when goods arrive or are returned.",
        example: "Log 50 cartons received from the factory into Goregaon.",
      },
      {
        code: Permission.STOCK_OUT,
        label: "Record stock out",
        description: "Remove stock for sales, samples, or other issues.",
        example: "Sell 10 boxes to a client and attach an invoice number.",
      },
    ],
  },
  {
    id: "inventory",
    label: "Inventory & invoices",
    description:
      "Company-wide stock visibility, movement history, quantity corrections, and invoice fixes.",
    warehouseScoped: false,
    permissions: [
      {
        code: Permission.INVENTORY_DASHBOARD,
        label: "View admin inventory dashboard",
        description: "Access admin Home stats: totals, low stock, and transfer activity.",
        example: "See company-wide low-stock alerts on the admin Home page.",
      },
      {
        code: Permission.INVENTORY_VIEW,
        label: "Browse inventory & movements",
        description: "Open Check Stock and movement history across all warehouses.",
        example: "Look up Product B stock in every warehouse and recent movements.",
      },
      {
        code: Permission.INVENTORY_ADJUST,
        label: "Adjust quantities & fix invoices",
        description:
          "Change on-hand quantities, correct wrong invoice numbers, and delete sale invoices.",
        example: "Fix a typo on invoice #1042 or delete a duplicate sale that restored stock.",
      },
    ],
  },
  {
    id: "transfers",
    label: "Inter-warehouse transfers",
    description:
      "Move stock between warehouses. View/receive are per warehouse; manage is company-wide.",
    warehouseScoped: true,
    permissions: [
      {
        code: Permission.TRANSFERS_VIEW,
        label: "View incoming transfers",
        description: "See transfers that are on the way to the selected warehouse.",
        example: "Goregaon staff see a shipment pending from the main depot.",
      },
      {
        code: Permission.TRANSFERS_RECEIVE,
        label: "Receive transfers",
        description: "Confirm goods arrived and add them to warehouse stock.",
        example: "Mark a 20-box transfer as received at Goregaon.",
      },
      {
        code: Permission.TRANSFERS_MANAGE,
        label: "Manage all transfers (global)",
        description:
          "Full transfer control: history, status changes, returns — not limited to one warehouse.",
        example: "Cancel a stuck transfer or return received goods to the source warehouse.",
        warehouseScoped: false,
      },
    ],
  },
  {
    id: "warehouses",
    label: "Warehouses",
    description: "Master list of storage locations (names, codes, active/inactive).",
    warehouseScoped: false,
    permissions: [
      {
        code: Permission.WAREHOUSES_VIEW,
        label: "View warehouse list",
        description: "Open the Warehouses page and see location details.",
        example: "Review all active depots before assigning a user’s home warehouse.",
      },
      {
        code: Permission.WAREHOUSES_MANAGE,
        label: "Create & edit warehouses",
        description: "Add new locations or deactivate old ones.",
        example: "Add “Pune depot” or mark a closed site as inactive.",
      },
    ],
  },
  {
    id: "brands",
    label: "Brands",
    description: "Product brands used to group the catalogue.",
    warehouseScoped: false,
    permissions: [
      {
        code: Permission.BRANDS_VIEW,
        label: "View brands",
        description: "See the brand list and details.",
        example: "Browse all brands before creating a new product.",
      },
      {
        code: Permission.BRANDS_MANAGE,
        label: "Create & edit brands",
        description: "Add, rename, or deactivate brands.",
        example: "Add brand “Acme” or deactivate a discontinued line.",
      },
    ],
  },
  {
    id: "products",
    label: "Products",
    description: "Product catalogue: names, units, low-stock thresholds, and brand link.",
    warehouseScoped: false,
    permissions: [
      {
        code: Permission.PRODUCTS_VIEW,
        label: "View products",
        description: "Open the Products page and product detail.",
        example: "Look up pack size and low-stock threshold for Product C.",
      },
      {
        code: Permission.PRODUCTS_MANAGE,
        label: "Create & edit products",
        description: "Add products, set stock units, thresholds, and active status.",
        example: "Create “Widget XL” with 800 kg per box and threshold 5 boxes.",
      },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    description: "Operational reports and CSV downloads.",
    warehouseScoped: false,
    permissions: [
      {
        code: Permission.REPORTS_VIEW,
        label: "View & export reports",
        description: "Open Reports and download CSV exports.",
        example: "Export monthly stock movement report for accounting.",
      },
    ],
  },
  {
    id: "imports",
    label: "Imports",
    description: "Bulk import catalog and inventory data.",
    warehouseScoped: false,
    permissions: [
      {
        code: Permission.IMPORTS_MANAGE,
        label: "Manage imports",
        description: "Upload and process import files.",
        example: "Import a product catalog spreadsheet.",
      },
    ],
  },
  {
    id: "users",
    label: "Users & access",
    description: "Create staff accounts and grant or revoke module permissions.",
    warehouseScoped: false,
    permissions: [
      {
        code: Permission.USERS_MANAGE,
        label: "Manage users & permissions",
        description:
          "Create users, set roles, activate/deactivate accounts, and edit every module grant.",
        example: "Give a Goregaon operator Stock In/Out only for their warehouse.",
      },
    ],
  },
  {
    id: "audit",
    label: "Activity log",
    description: "Read-only trail of who did what across the system.",
    warehouseScoped: false,
    permissions: [
      {
        code: Permission.AUDIT_VIEW,
        label: "View activity log",
        description: "See audit entries including permission changes and stock movements.",
        example: "Review who granted Stock Out access to a user yesterday.",
      },
    ],
  },
  {
    id: "checklists",
    label: "Daily checklists",
    description: "Recurring task lists for warehouse staff and supervisors.",
    warehouseScoped: false,
    permissions: [
      {
        code: Permission.CHECKLISTS_MANAGE,
        label: "Create & assign checklists",
        description: "Define daily tasks and assign them to users or warehouses.",
        example: "Create “Opening checks” with tasks due by 10:00 AM.",
      },
      {
        code: Permission.CHECKLISTS_COMPLETE,
        label: "Complete daily tasks",
        description: "Tick off assigned tasks and receive notifications.",
        example: "Mark “Count cash drawer” done before the morning deadline.",
      },
    ],
  },
];

const WAREHOUSE_SCOPED = new Set<PermissionCode>();

for (const mod of PERMISSION_MODULES) {
  for (const perm of mod.permissions) {
    const scoped = perm.warehouseScoped ?? mod.warehouseScoped;
    if (scoped) WAREHOUSE_SCOPED.add(perm.code);
  }
}

export function isWarehouseScopedPermission(code: string): boolean {
  return WAREHOUSE_SCOPED.has(code as PermissionCode);
}

export const ALL_PERMISSION_CODES: PermissionCode[] = PERMISSION_MODULES.flatMap((m) =>
  m.permissions.map((p) => p.code)
);

/** Default bundle for legacy warehouse operators */
export function defaultWarehouseOperatorPermissions(
  warehouseId: string
): PermissionGrant[] {
  return [
    { code: Permission.DASHBOARD_VIEW },
    { code: Permission.STOCK_VIEW, warehouseId },
    { code: Permission.STOCK_IN, warehouseId },
    { code: Permission.STOCK_OUT, warehouseId },
    { code: Permission.TRANSFERS_VIEW, warehouseId },
    { code: Permission.TRANSFERS_RECEIVE, warehouseId },
    { code: Permission.CHECKLISTS_COMPLETE },
  ];
}
