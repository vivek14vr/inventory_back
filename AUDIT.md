# System Audit — Inventory Platform

**Date:** 2026-07-06  
**Scope:** Backend (`src/`) + Frontend (`frontend/src/`)  
**Status:** Remediation complete (see summary below)  
**Validation:** Backend 67/67 tests pass, `tsc` OK; frontend lint + build OK

---

## Remediation summary

| Status | Count | IDs |
|--------|------:|-----|
| **Fixed** | 35 | 001–017, 019–020, 023–036, 038–039 |
| **Partial** | 2 | 018, 040 |
| **Mitigated** | 2 | 021, 022 |
| **Accepted** | 1 | 037 |
| **Total** | **40** | |

| Severity | Found | Fixed / mitigated |
|----------|------:|------------------:|
| Critical | 5 | 5 fixed |
| High | 10 | 10 fixed |
| Medium (backend) | 7 | 5 fixed, 2 mitigated |
| Medium (frontend) | 10 | 10 fixed |
| Low | 8 | 5 fixed, 1 accepted, 1 partial, 1 mitigated (022 counted above) |

**Outstanding (non-blocking):**

- **AUDIT-018** — Product import rows use `runInTransaction`; balance/threshold writes pass Mongo session, but `createProduct` / `updateProduct` are not fully inside the transaction.
- **AUDIT-040** — Unit tests cover parsers, return deltas, and import limits; no full DB integration or concurrency suite.
- **AUDIT-021** — Requires MongoDB replica set in production for true multi-document atomicity.
- **AUDIT-022** — Upload size and row limits reduce risk; underlying `multer` / `xlsx` advisories remain.
- **AUDIT-037** — Legacy `/imports/tally` API kept; direct sell import is the supported UI path.

---

## Critical

### AUDIT-001 — Sold-qty update ignores prior returns

| Field | Value |
|-------|-------|
| **Area** | Backend |
| **File** | `src/modules/inventory/inventory.service.ts` → `updateMovementInvoice()` |
| **Impact** | Reducing sold quantity credits stock by the full delta without subtracting linked `STOCK_IN` return movements → **double-counted inventory** |
| **Status** | **Fixed** — `saleQuantityInventoryDelta()` + `sumReturnedQuantityForSale()` in `saleReturn.utils.ts` |

### AUDIT-002 — Delete invoice ignores linked returns

| Field | Value |
|-------|-------|
| **Area** | Backend |
| **File** | `src/modules/inventory/inventory.service.ts` → `deleteSaleInvoice()` |
| **Impact** | Deleting a partially returned sale restores the full sold quantity → **over-restores stock** |
| **Status** | **Fixed** — restores `quantity − returnedQuantity`; deletes linked and legacy unlinked returns |

### AUDIT-003 — Transfer receive race (double credit)

| Field | Value |
|-------|-------|
| **Area** | Backend |
| **Files** | `src/modules/transfers/transfers.service.ts` (`updateTransferStatus`) vs `src/modules/stock/stock.service.ts` (`receiveTransfer`) |
| **Impact** | Admin “mark received” and warehouse receive running concurrently can both credit the destination warehouse |
| **Status** | **Fixed** — atomic PENDING → RECEIVED claim in both paths |

### AUDIT-004 — `returnTransfer` not atomic

| Field | Value |
|-------|-------|
| **Area** | Backend |
| **File** | `src/modules/transfers/transfers.service.ts` → `returnTransfer()` |
| **Impact** | Concurrent return actions can move stock twice |
| **Status** | **Fixed** — `runInTransaction` + status-guarded `findOneAndUpdate` |

### AUDIT-005 — Setting sold qty to 0 may fail at persistence

| Field | Value |
|-------|-------|
| **Area** | Backend |
| **Files** | `src/models/StockMovement.ts` (`quantity: min: 1`) vs client-return validation (`min: 0`) |
| **Impact** | Client return “set sold qty to zero” can pass API validation but fail on `save()` |
| **Status** | **Fixed** — `StockMovement.quantity` min changed to `0` |

---

## High

### AUDIT-006 — `allowInsufficientStock` does not bypass atomic decrement

| Field | Value |
|-------|-------|
| **Area** | Backend |
| **Files** | `src/modules/imports/salesImport.service.ts`, `src/modules/stock/stock.service.ts` → `adjustBalance()` |
| **Impact** | Sales backfill still fails when stock is insufficient; flag only skips pre-check, not `$gte` guard |
| **Status** | **Fixed** — `adjustBalance({ allowNegative })` when `allowInsufficientStock` is set |

### AUDIT-007 — In-transit returns hidden for source warehouse

| Field | Value |
|-------|-------|
| **Area** | Frontend + Backend API usage |
| **Files** | `frontend/src/components/stock/WarehouseReturnPanel.tsx`, `listPendingTransfers` (destination-only filter) |
| **Impact** | Sending warehouse cannot see or return its own in-transit shipments |
| **Status** | **Fixed** — `listPendingTransfers` matches source or destination; panel scoped both ways |

### AUDIT-008 — Invoices nav vs route permission mismatch

| Field | Value |
|-------|-------|
| **Area** | Frontend |
| **Files** | `frontend/src/components/layout/buildAppNav.ts` vs `frontend/src/lib/auth/permissions.ts` (`APP_ROUTE_PERMISSIONS`) |
| **Impact** | Users with only `inventory.view` see “Invoices” in nav but are blocked on `/app/wrong-invoice` (requires view **and** adjust) |
| **Status** | **Fixed** — nav and route both require `inventory.view` **and** `inventory.adjust` |

### AUDIT-009 — Return panel ignores warehouse scope in UI

| Field | Value |
|-------|-------|
| **Area** | Frontend |
| **File** | `frontend/src/components/stock/ReturnPanel.tsx` |
| **Impact** | Return options shown globally; API returns 403 for warehouses the user cannot access |
| **Status** | **Fixed** — warehouse-scoped permission checks via `canWarehouseReturn()` |

### AUDIT-010 — Product import reactivation wipes all warehouse stock

| Field | Value |
|-------|-------|
| **Area** | Backend |
| **File** | `src/modules/imports/productImport.service.ts` → `resetImportedProductStockToZero()` |
| **Impact** | Merging/reactivating an inactive product via import sets stock to **0 at all warehouses** |
| **Status** | **Fixed** — `resetStock` only on **create** path, not merge/reactivate |

### AUDIT-011 — Product import merge overwrites thresholds

| Field | Value |
|-------|-------|
| **Area** | Backend |
| **File** | `src/modules/imports/productImport.service.ts` → `finalizeImportedProduct()` |
| **Impact** | Catalog import can overwrite manually configured per-warehouse low-stock thresholds |
| **Status** | **Fixed** — thresholds applied only from explicit Excel columns |

### AUDIT-012 — No duplicate guard on sales re-import

| Field | Value |
|-------|-------|
| **Area** | Backend |
| **File** | `src/modules/imports/salesImport.service.ts` → `confirmSalesImport()` |
| **Impact** | Re-importing the same voucher can double-record sales and stock movements |
| **Status** | **Fixed** — case-insensitive duplicate check in `confirmSalesImport` and atomically in `stockOutBatch` |

### AUDIT-013 — Transfer cancel/receive race

| Field | Value |
|-------|-------|
| **Area** | Backend |
| **File** | `src/modules/transfers/transfers.service.ts` |
| **Impact** | Cancel and receive on the same PENDING transfer can corrupt stock balances |
| **Status** | **Fixed** — cancel/receive use atomic status claims inside transactions |

### AUDIT-014 — Import/report uploads skip token refresh retry

| Field | Value |
|-------|-------|
| **Area** | Frontend |
| **File** | `frontend/src/lib/api/client.ts` (raw `fetch` for uploads/exports) |
| **Impact** | Expired access token causes failed uploads/exports even when refresh would succeed |
| **Status** | **Fixed** — `fetchWithAuth` with 401 retry for uploads and exports |

### AUDIT-015 — `refreshUser` clears user on transient network errors

| Field | Value |
|-------|-------|
| **Area** | Frontend |
| **File** | `frontend/src/contexts/AuthContext.tsx` |
| **Impact** | Brief API failure presents as logout while tokens may still be valid |
| **Status** | **Fixed** — network errors (`status 0`) no longer clear session |

---

## Medium — Backend

### AUDIT-016 — Invoice list undercounts returns vs detail view

| Field | Value |
|-------|-------|
| **File** | `src/modules/stock/clientReturn.service.ts` |
| **Impact** | List shows inflated “returnable” quantities; actions may fail on detail |
| **Status** | **Fixed** — unlinked returns included in list totals; case-insensitive invoice matching |

### AUDIT-017 — Sales import creates products outside stock-out transaction

| Field | Value |
|-------|-------|
| **File** | `src/modules/imports/salesImport.service.ts` |
| **Impact** | Orphan products if batch commit fails mid-run |
| **Status** | **Fixed** — product creation deferred until after duplicate check; `deactivateImportedProducts()` on voucher failure |

### AUDIT-018 — Product import rows not transactional

| Field | Value |
|-------|-------|
| **File** | `src/modules/imports/productImport.service.ts` |
| **Impact** | Partial row state on failure |
| **Status** | **Partial** — per-row `runInTransaction`; balance reset / `ensureProductBalances` use session; `createProduct` / `updateProduct` not fully transactional |

### AUDIT-019 — `markLastWorked` clears all invoices globally

| Field | Value |
|-------|-------|
| **File** | `src/modules/inventory/inventory.service.ts` |
| **Impact** | Wrong-invoice “last worked” marker wiped system-wide instead of per-invoice |
| **Status** | **Fixed** — scoped to invoice + client |

### AUDIT-020 — Invoice field updates don’t sync linked returns

| Field | Value |
|-------|-------|
| **File** | `src/modules/inventory/inventory.service.ts` |
| **Impact** | Orphaned or stale return movement metadata |
| **Status** | **Fixed** — linked `STOCK_IN` movements updated when invoice/client fields change |

### AUDIT-021 — Standalone MongoDB has no real multi-document transactions

| Field | Value |
|-------|-------|
| **File** | Infrastructure / deployment |
| **Impact** | Dev or single-node setups can leave inconsistent state under failure |
| **Status** | **Mitigated** — documented in `docs/OPERATIONS.md`; `mongoTransaction.ts` warns on standalone |

### AUDIT-022 — `multer` / `xlsx` dependency advisories

| Field | Value |
|-------|-------|
| **File** | `package.json` (import endpoints) |
| **Impact** | Known DoS / parsing risks on file upload endpoints |
| **Status** | **Mitigated** — 10 MB upload cap, 5,000-row parser + confirm limit; see `docs/OPERATIONS.md` |

---

## Medium — Frontend

### AUDIT-023 — Dual inventory permissions always prefer warehouse API

| Field | Value |
|-------|-------|
| **File** | `frontend/src/app/(dashboard)/app/inventory/page.tsx` |
| **Impact** | Users with both `stock.view` and `inventory.view` never see company-wide Check Stock |
| **Status** | **Fixed** — “My warehouse” / “Company-wide” toggle; company mode omits `warehouseId` filter |

### AUDIT-024 — Company inventory “Last updated” shows epoch when empty

| Field | Value |
|-------|-------|
| **File** | `frontend/src/app/(dashboard)/admin/inventory/page.tsx` |
| **Impact** | Misleading 1970 timestamps when no locations exist |
| **Status** | **Fixed** — shows “—” when no valid location timestamps |

### AUDIT-025 — Client return search + pagination race

| Field | Value |
|-------|-------|
| **File** | `frontend/src/components/stock/ClientReturnPanel.tsx` |
| **Impact** | Stale or wrong page flicker when search and pagination overlap |
| **Status** | **Fixed** — request-id guard on list loads |

### AUDIT-026 — Expanded invoice blank on detail load failure

| Field | Value |
|-------|-------|
| **File** | `frontend/src/components/stock/ClientReturnPanel.tsx` |
| **Impact** | Accordion expands with no error message when detail fetch fails |
| **Status** | **Fixed** — inline error shown in expanded row |

### AUDIT-027 — Warehouse return shared notes field across rows

| Field | Value |
|-------|-------|
| **File** | `frontend/src/components/stock/WarehouseReturnPanel.tsx` |
| **Impact** | Notes entered for one transfer can apply to another |
| **Status** | **Fixed** — per-row notes state |

### AUDIT-028 — Warehouse return received list capped at 100

| Field | Value |
|-------|-------|
| **File** | `frontend/src/components/stock/WarehouseReturnPanel.tsx` |
| **Impact** | No pagination; older received transfers unreachable |
| **Status** | **Fixed** — server-side pagination on received transfers |

### AUDIT-029 — Product import confirm lacks merge-target validation

| Field | Value |
|-------|-------|
| **File** | `frontend/src/components/imports/ProductImportPanel.tsx` |
| **Impact** | Invalid confirm payloads possible before API rejection |
| **Status** | **Fixed** — client-side merge target validation before confirm |

### AUDIT-030 — Wrong-invoice page shows edit/delete without adjust check

| Field | Value |
|-------|-------|
| **File** | Wrong-invoice page components |
| **Impact** | View-only users see actions that return 403 |
| **Status** | **Fixed** — `canAdjust` gates edit/delete in `WrongInvoicePanel` / `InvoiceGroupedTable` |

### AUDIT-031 — Admin return flow ignores `requireWarehouse`

| Field | Value |
|-------|-------|
| **File** | Admin return UI |
| **Impact** | No warehouse picker unlike other admin stock flows |
| **Status** | **Fixed** — warehouse picker with `?warehouseId=` prefill |

### AUDIT-032 — `canWarehouseReturn()` defined but unused

| Field | Value |
|-------|-------|
| **File** | `frontend/src/lib/auth/permissions.ts` |
| **Impact** | Dead helper; UI uses weaker permission checks |
| **Status** | **Fixed** — used in `ReturnPanel` for warehouse return gating |

---

## Low

### AUDIT-033 — Invoice lookup is case-sensitive

| Field | Value |
|-------|-------|
| **Area** | Backend |
| **Impact** | `INV-001` ≠ `inv-001` in search/match |
| **Status** | **Fixed** — `exactCaseInsensitiveRegex()` in `invoiceMatch.ts`; adopted in imports, returns, and invoice sync |

### AUDIT-034 — `searchMovementsForInvoiceFix` is a no-op wrapper

| Field | Value |
|-------|-------|
| **Area** | Backend |
| **Impact** | Dead or misleading code path |
| **Status** | **Fixed** — simplified to direct query helper |

### AUDIT-035 — Sales parser stores `quantity: 0` before validation flags it

| Field | Value |
|-------|-------|
| **Area** | Backend |
| **Impact** | Transient invalid state in parse pipeline |
| **Status** | **Fixed** — zero/invalid quantity rows skipped during parse |

### AUDIT-036 — `/app/receive` is only a redirect

| Field | Value |
|-------|-------|
| **Area** | Frontend |
| **Impact** | Route exists but adds no unique behavior |
| **Status** | **Fixed** — `/app/receive` and `/admin/receive` redirect to transfer; constants alias transfer |

### AUDIT-037 — `uploadTally` API has no UI

| Field | Value |
|-------|-------|
| **Area** | Frontend / API |
| **Impact** | Dead or undocumented surface |
| **Status** | **Accepted** — direct sell import covers client deductions; legacy `/imports/tally` API retained without UI |

### AUDIT-038 — `ReturnPanel` success state is dead code

| Field | Value |
|-------|-------|
| **Area** | Frontend |
| **File** | `frontend/src/components/stock/ReturnPanel.tsx` |
| **Impact** | Unused state branch |
| **Status** | **Fixed** — dead success state removed |

### AUDIT-039 — Admin inventory “Return” button lacks product/warehouse context

| Field | Value |
|-------|-------|
| **Area** | Frontend |
| **Impact** | Navigation without pre-filled context |
| **Status** | **Fixed** — Return links include `?warehouseId=` |

### AUDIT-040 — No integration tests for critical paths

| Field | Value |
|-------|-------|
| **Area** | Both |
| **Impact** | Missing coverage for concurrency, return + qty-update interactions, sales import edge cases |
| **Status** | **Partial** — unit tests for sale-return deltas, import parsers, invoice match, and row limits; no full DB integration suite |

---

## Healthy (no action required)

- Atomic `adjustBalance()` decrement guard for single operations
- `receiveTransfer()` uses atomic PENDING → RECEIVED status claim
- Auth + permission middleware on business routes
- Permission codes aligned between frontend and backend catalogs
- Standard JSON API client retries after token refresh

---

## Key commits

| Repo | Commit | Summary |
|------|--------|---------|
| Backend | `19dce63` | Critical stock integrity + transfer atomicity |
| Backend | `bdfa6e2` | Imports, invoices, case-insensitive lookups |
| Backend | `379b9c7` | Return matching, import guards, operations docs |
| Frontend | `ca03bd8` | Returns and invoice UI hardening |
| Frontend | `f5927b5` | Inventory toggle, pagination, import validation |
| Frontend | `1fc25e5` | Company-wide Check Stock fix, receive route cleanup |

---

## Changelog

| Date | Author | Notes |
|------|--------|-------|
| 2026-07-06 | System scan | Initial audit — 40 findings |
| 2026-07-06 | Remediation | Fixed AUDIT-001–015, 019, 027 (partial); see git history |
| 2026-07-06 | Remediation | Fixed AUDIT-017–020, 023–026, 028–035, 038–039; see git history |
| 2026-07-06 | Remediation | AUDIT-021–022 mitigated; 036 fixed; 037 accepted; 040 partial |
| 2026-07-06 | Remediation | Residual fixes: case-insensitive returns, invoice delete cleanup, atomic duplicate import, confirm row limits |
| 2026-07-06 | Documentation | Synced per-item status fields with remediation summary |
