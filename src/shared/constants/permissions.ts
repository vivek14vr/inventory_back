/** Module.action permission codes — assign per user (optionally per warehouse). */
export const Permission = {
  DASHBOARD_VIEW: "dashboard.view",

  STOCK_VIEW: "stock.view",
  STOCK_IN: "stock.in",
  STOCK_OUT: "stock.out",

  RETURNS_CLIENT: "returns.client",
  RETURNS_WAREHOUSE: "returns.warehouse",

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

  CLIENTS_VIEW: "clients.view",
  CLIENTS_MANAGE: "clients.manage",

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
    id: "returns",
    label: "Returns",
    description:
      "Process goods returned from clients (invoice corrections) or sent back between warehouses.",
    warehouseScoped: true,
    permissions: [
      {
        code: Permission.RETURNS_CLIENT,
        label: "Client returns by invoice",
        description:
          "Open sale invoices and update sold quantities (including zero) to return stock.",
        example:
          "Reduce invoice #1042 from 200 to 0 pieces so stock is added back to Goregaon.",
      },
      {
        code: Permission.RETURNS_WAREHOUSE,
        label: "Warehouse transfer returns",
        description:
          "Return received or in-transit transfers back to the source warehouse.",
        example:
          "Send a pending Vasai → Goregaon shipment back before it is received.",
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
        description:
          "Open Check Stock and movement history across all warehouses (company-wide).",
        example: "Look up Product B stock in every warehouse and recent movements.",
      },
      {
        code: Permission.INVENTORY_ADJUST,
        label: "Adjust quantities & fix invoices",
        description:
          "Change on-hand quantities, correct wrong invoice numbers, and update sold quantities on invoices.",
        example: "Fix a typo on invoice #1042 or delete a duplicate sale that restored stock.",
      },
    ],
  },
  {
    id: "transfers",
    label: "Inter-warehouse transfers",
    description:
      "Move stock between warehouses. Most staff only need View + Receive at their home warehouse.",
    warehouseScoped: true,
    permissions: [
      {
        code: Permission.TRANSFERS_VIEW,
        label: "View incoming transfers",
        description:
          "See shipments coming into this warehouse. Choose the warehouse below.",
        example: "Goregaon staff see a shipment pending from Vasai.",
      },
      {
        code: Permission.TRANSFERS_RECEIVE,
        label: "Receive transfers",
        description:
          "Mark goods as arrived and add them to this warehouse’s stock.",
        example: "Confirm a 20-box transfer arrived at Goregaon.",
      },
      {
        code: Permission.TRANSFERS_MANAGE,
        label: "Manage transfer history (every warehouse)",
        description:
          "Company-wide: see all transfer history and cancel/update stuck transfers. Creating a new transfer still needs Stock out at the source warehouse. Leave this off for normal warehouse staff — they only need View + Receive above.",
        example: "Cancel a stuck Vasai → Goregaon transfer or review company-wide history.",
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
    id: "clients",
    label: "Clients",
    description: "Customer master list with primary and secondary names.",
    warehouseScoped: false,
    permissions: [
      {
        code: Permission.CLIENTS_VIEW,
        label: "View clients",
        description: "See the client list and details.",
        example: "Browse clients before recording a direct sale.",
      },
      {
        code: Permission.CLIENTS_MANAGE,
        label: "Create & edit clients",
        description: "Add, rename, or deactivate clients.",
        example: "Add client “Acme Corp” with secondary name “Acme Mumbai”.",
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
    description:
      "Bulk import product catalog, Tally sales register (direct sell), and legacy tally stock deductions.",
    warehouseScoped: false,
    permissions: [
      {
        code: Permission.IMPORTS_MANAGE,
        label: "Manage imports",
        description:
          "Upload product catalog Excel, sales register Excel, and legacy tally deduction files.",
        example:
          "Import a product catalog spreadsheet or backfill Tally sales as stock-out.",
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

/** Permissions that grant client return (invoice sold-qty correction). */
export const CLIENT_RETURN_PERMISSIONS: PermissionCode[] = [
  Permission.RETURNS_CLIENT,
];

/** Permissions that grant warehouse transfer returns. */
export const WAREHOUSE_RETURN_PERMISSIONS: PermissionCode[] = [
  Permission.RETURNS_WAREHOUSE,
];

/** Permissions that grant reading warehouse stock balances. */
export const STOCK_BALANCE_READ_PERMISSIONS: PermissionCode[] = [
  Permission.STOCK_VIEW,
  Permission.STOCK_IN,
  Permission.STOCK_OUT,
];

/**
 * Company-wide / admin-power permissions that must not be granted to warehouse staff.
 * Admins ignore grants entirely (full access by role).
 */
export const ADMIN_ONLY_PERMISSIONS: readonly PermissionCode[] = [
  Permission.INVENTORY_VIEW,
  Permission.INVENTORY_ADJUST,
  Permission.INVENTORY_DASHBOARD,
  Permission.IMPORTS_MANAGE,
  Permission.AUDIT_VIEW,
  Permission.TRANSFERS_MANAGE,
  Permission.WAREHOUSES_MANAGE,
  Permission.USERS_MANAGE,
];

export function isAdminOnlyPermission(code: string): boolean {
  return (ADMIN_ONLY_PERMISSIONS as readonly string[]).includes(code);
}

/** Default bundle for legacy warehouse operators */
export function defaultWarehouseOperatorPermissions(
  warehouseId: string
): PermissionGrant[] {
  return [
    { code: Permission.DASHBOARD_VIEW },
    { code: Permission.STOCK_VIEW, warehouseId },
    { code: Permission.STOCK_IN, warehouseId },
    { code: Permission.STOCK_OUT, warehouseId },
    { code: Permission.RETURNS_CLIENT, warehouseId },
    { code: Permission.RETURNS_WAREHOUSE, warehouseId },
    { code: Permission.TRANSFERS_VIEW, warehouseId },
    { code: Permission.TRANSFERS_RECEIVE, warehouseId },
    { code: Permission.CHECKLISTS_COMPLETE },
  ];
}
