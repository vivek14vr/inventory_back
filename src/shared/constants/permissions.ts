/** Module.action permission codes — assign per user (optionally per warehouse). */
export const Permission = {
  DASHBOARD_VIEW: "dashboard.view",

  STOCK_VIEW: "stock.view",
  STOCK_IN: "stock.in",
  STOCK_OUT: "stock.out",
  /** Show Check Stock row Actions (History / Return / Update). */
  STOCK_ACTIONS: "stock.actions",
  /** Check Stock → Movements tab */
  STOCK_MOVEMENTS: "stock.movements",
  /** Check Stock → Low stock tab */
  STOCK_LOW: "stock.low",

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

export type PermissionNavGroup = "main" | "more";

export type PermissionModuleDefinition = {
  id: string;
  label: string;
  description: string;
  warehouseScoped: boolean;
  /** Matches sidebar: Main menu vs More. */
  navGroup: PermissionNavGroup;
  permissions: PermissionDefinition[];
};

/**
 * Access-grant catalog aligned with sidebar modules (admin layout / staff nav).
 * Permission codes stay stable so existing grants keep working.
 */
export const PERMISSION_MODULES: PermissionModuleDefinition[] = [
  {
    id: "home",
    label: "Home",
    description: "Landing page with shortcuts and summary for the user’s warehouse.",
    warehouseScoped: false,
    navGroup: "main",
    permissions: [
      {
        code: Permission.DASHBOARD_VIEW,
        label: "View Home",
        description: "Open the Home screen after login.",
        example: "See today’s shortcuts and warehouse overview on Home.",
      },
      {
        code: Permission.INVENTORY_DASHBOARD,
        label: "Admin Home stats",
        description: "Company-wide totals, low stock, and transfer activity on admin Home.",
        example: "See company-wide low-stock alerts on the admin Home page.",
      },
    ],
  },
  {
    id: "stock-in",
    label: "Stock In",
    description: "Record goods received at a warehouse. Each grant is for one location.",
    warehouseScoped: true,
    navGroup: "main",
    permissions: [
      {
        code: Permission.STOCK_IN,
        label: "Record stock in",
        description: "Add stock when goods arrive or are put back into inventory.",
        example: "Log 50 cartons received from the factory into Goregaon.",
      },
    ],
  },
  {
    id: "stock-out",
    label: "Stock Out",
    description:
      "Record sales and other issues from a warehouse. Creating a send also needs Create transfer for that warehouse.",
    warehouseScoped: true,
    navGroup: "main",
    permissions: [
      {
        code: Permission.STOCK_OUT,
        label: "Record stock out",
        description: "Remove stock for sales, samples, or transfers out.",
        example: "Sell 10 boxes to a client and attach an invoice number.",
      },
    ],
  },
  {
    id: "transfer",
    label: "Send Stock",
    description:
      "Create and receive inter-warehouse transfers. Creating a send also needs Stock Out at the source warehouse.",
    warehouseScoped: true,
    navGroup: "main",
    permissions: [
      {
        code: Permission.TRANSFERS_VIEW,
        label: "Create transfer",
        description:
          "Open Send Stock and create a send from this warehouse (also needs Stock Out here).",
        example: "Send 20 boxes from Goregaon to Vasai.",
      },
      {
        code: Permission.TRANSFERS_RECEIVE,
        label: "Receive transfers",
        description: "Receive incoming stock at this warehouse from the Send Stock page.",
        example: "Confirm a 20-box transfer arrived at Goregaon.",
      },
    ],
  },
  {
    id: "transfer-history",
    label: "Transfer History",
    description:
      "Grant per warehouse. Shows Transfer History for transfers sent from that warehouse (not inbound from elsewhere).",
    warehouseScoped: true,
    navGroup: "more",
    permissions: [
      {
        code: Permission.TRANSFERS_MANAGE,
        label: "Manage transfer history",
        description:
          "View/manage transfers sent from this warehouse (receive actions, returns, cancel/update on those rows).",
        example: "Goregaon manage shows Goregaon → Vasai, not Vasai → Goregaon.",
      },
    ],
  },
  {
    id: "return",
    label: "Return",
    description: "Client invoice returns at a specific warehouse (sold-qty corrections).",
    warehouseScoped: true,
    navGroup: "main",
    permissions: [
      {
        code: Permission.RETURNS_CLIENT,
        label: "Client returns by invoice",
        description:
          "Open sale invoices and update sold quantities (including zero) to return stock.",
        example:
          "Reduce invoice #1042 from 200 to 0 pieces so stock is added back to Goregaon.",
      },
    ],
  },
  {
    id: "check-stock",
    label: "Check Stock",
    description:
      "Check Stock tabs and Actions. Grant each tab separately; company-wide inventory browse lives under Invoices for admins.",
    warehouseScoped: true,
    navGroup: "main",
    permissions: [
      {
        code: Permission.STOCK_VIEW,
        label: "Current stock tab",
        description: "Open Check Stock → Current stock for this warehouse.",
        example: "See Goregaon on-hand quantities by product.",
      },
      {
        code: Permission.STOCK_MOVEMENTS,
        label: "Movements tab",
        description: "Open Check Stock → Movements for this warehouse.",
        example: "Review stock in/out history at Goregaon.",
      },
      {
        code: Permission.STOCK_LOW,
        label: "Low stock tab",
        description: "Open Check Stock → Low stock for this warehouse.",
        example: "See which Goregaon products are below threshold.",
      },
      {
        code: Permission.STOCK_ACTIONS,
        label: "Stock actions column",
        description:
          "Show the Actions column on Current stock (History, and Return/Update when those modules are also granted).",
        example: "Let Goregaon staff open History or Return from the stock table.",
      },
    ],
  },
  {
    id: "invoices",
    label: "Invoices",
    description:
      "Sale invoices, quantity corrections, and company-wide inventory. Needs both actions below for the menu item.",
    warehouseScoped: false,
    navGroup: "main",
    permissions: [
      {
        code: Permission.INVENTORY_VIEW,
        label: "Browse inventory & invoices",
        description:
          "Open Check Stock / movements across all warehouses and the Invoices list.",
        example: "Look up Product B stock in every warehouse or search an invoice.",
      },
      {
        code: Permission.INVENTORY_ADJUST,
        label: "Adjust quantities & fix invoices",
        description:
          "Change on-hand quantities, correct wrong invoice numbers, and update sold quantities.",
        example: "Fix a typo on invoice #1042 or delete a duplicate sale.",
      },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    description: "Operational reports and CSV downloads for the warehouses you allow.",
    warehouseScoped: true,
    navGroup: "main",
    permissions: [
      {
        code: Permission.REPORTS_VIEW,
        label: "View & export reports",
        description:
          "Open Reports and download CSV exports for this warehouse only.",
        example: "Export Goregaon stock movement report for accounting.",
      },
    ],
  },
  {
    id: "imports",
    label: "Imports",
    description:
      "Bulk import product catalog, Tally sales register (direct sell), and legacy tally deductions.",
    warehouseScoped: false,
    navGroup: "more",
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
    id: "products",
    label: "Products",
    description: "Product catalogue: names, units, low-stock thresholds, and brand link.",
    warehouseScoped: false,
    navGroup: "more",
    permissions: [
      {
        code: Permission.PRODUCTS_VIEW,
        label: "View products",
        description: "Open the Products page and browse the catalogue (read-only).",
        example: "Look up pack size and low-stock threshold for Product C.",
      },
      {
        code: Permission.PRODUCTS_MANAGE,
        label: "Manage products",
        description:
          "Includes View. Add, edit, deactivate, and delete products; set units and low-stock alerts.",
        example: "Create “Widget XL” with 800 pieces per carton and threshold 5 cartons.",
      },
    ],
  },
  {
    id: "warehouses",
    label: "Warehouses",
    description: "Master list of storage locations (names, codes, active/inactive).",
    warehouseScoped: false,
    navGroup: "more",
    permissions: [
      {
        code: Permission.WAREHOUSES_VIEW,
        label: "View warehouses",
        description: "Open the Warehouses page and see location details.",
        example: "Review all active depots before assigning a user’s home warehouse.",
      },
      {
        code: Permission.WAREHOUSES_MANAGE,
        label: "Manage warehouses",
        description:
          "Includes View. Create, rename, or set warehouses active/inactive.",
        example: "Add “Pune depot” or mark a closed site as inactive.",
      },
    ],
  },
  {
    id: "brands",
    label: "Brands",
    description: "Product brands used to group the catalogue.",
    warehouseScoped: false,
    navGroup: "more",
    permissions: [
      {
        code: Permission.BRANDS_VIEW,
        label: "View brands",
        description: "See the brand list and details.",
        example: "Browse all brands before creating a new product.",
      },
      {
        code: Permission.BRANDS_MANAGE,
        label: "Manage brands",
        description: "Includes View. Add, rename, or deactivate brands.",
        example: "Add brand “Acme” or deactivate a discontinued line.",
      },
    ],
  },
  {
    id: "clients",
    label: "Clients",
    description: "Customer master list with primary and secondary names.",
    warehouseScoped: false,
    navGroup: "more",
    permissions: [
      {
        code: Permission.CLIENTS_VIEW,
        label: "View clients",
        description: "See the client list and details.",
        example: "Browse clients before recording a direct sale.",
      },
      {
        code: Permission.CLIENTS_MANAGE,
        label: "Manage clients",
        description: "Includes View. Add, rename, or deactivate clients.",
        example: "Add client “Acme Corp” with secondary name “Acme Mumbai”.",
      },
    ],
  },
  {
    id: "users",
    label: "Users",
    description: "Create staff accounts and grant or revoke module permissions.",
    warehouseScoped: false,
    navGroup: "more",
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
    id: "daily-checklists",
    label: "Daily Checklists",
    description:
      "Recurring warehouse tasks. Also unlocks Notifications in the menu.",
    warehouseScoped: false,
    navGroup: "more",
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
        description: "Tick off assigned tasks and receive related notifications.",
        example: "Mark “Count cash drawer” done before the morning deadline.",
      },
    ],
  },
  {
    id: "activity-log",
    label: "Activity Log",
    description: "Read-only trail of who did what across the system.",
    warehouseScoped: false,
    navGroup: "more",
    permissions: [
      {
        code: Permission.AUDIT_VIEW,
        label: "View activity log",
        description: "See audit entries including permission changes and stock movements.",
        example: "Review who granted Stock Out access to a user yesterday.",
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

/**
 * Codes still accepted on write so existing DB grants can be migrated.
 * Prefer {@link ALL_PERMISSION_CODES} for new grants / catalog.
 */
export const LEGACY_PERMISSION_CODES: readonly PermissionCode[] = [
  Permission.RETURNS_WAREHOUSE,
];

/** Zod / write-path: current + legacy codes (legacy migrated in normalize). */
export const ACCEPTED_PERMISSION_CODES: PermissionCode[] = [
  ...ALL_PERMISSION_CODES,
  ...LEGACY_PERMISSION_CODES,
];

/** Permissions that grant client return (invoice sold-qty correction). */
export const CLIENT_RETURN_PERMISSIONS: PermissionCode[] = [
  Permission.RETURNS_CLIENT,
];

/** Permissions that grant warehouse transfer returns (via Transfer History manage). */
export const WAREHOUSE_RETURN_PERMISSIONS: PermissionCode[] = [
  Permission.TRANSFERS_MANAGE,
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
  Permission.USERS_MANAGE,
];

export function isAdminOnlyPermission(code: string): boolean {
  return (ADMIN_ONLY_PERMISSIONS as readonly string[]).includes(code);
}

/**
 * Company master-data: Manage always includes View.
 * Checking View is satisfied when the matching Manage grant is held.
 */
export const MANAGE_IMPLIES_VIEW: Partial<
  Record<PermissionCode, PermissionCode>
> = {
  [Permission.PRODUCTS_MANAGE]: Permission.PRODUCTS_VIEW,
  [Permission.BRANDS_MANAGE]: Permission.BRANDS_VIEW,
  [Permission.CLIENTS_MANAGE]: Permission.CLIENTS_VIEW,
  [Permission.WAREHOUSES_MANAGE]: Permission.WAREHOUSES_VIEW,
};

/** View code → manage code that implies it (if any). */
export const VIEW_IMPLIED_BY_MANAGE: Partial<
  Record<PermissionCode, PermissionCode>
> = Object.fromEntries(
  Object.entries(MANAGE_IMPLIES_VIEW).map(([manage, view]) => [view, manage])
) as Partial<Record<PermissionCode, PermissionCode>>;

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
    { code: Permission.TRANSFERS_VIEW, warehouseId },
    { code: Permission.TRANSFERS_RECEIVE, warehouseId },
    { code: Permission.CHECKLISTS_COMPLETE },
  ];
}
