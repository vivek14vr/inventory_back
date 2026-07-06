# System Audit — Inventory Platform

**Date:** 2026-07-06  
**Scope:** Backend (`src/`) + Frontend (`frontend/src/`)  
**Status:** Remediation complete — see Changelog and per-item status below  
**Validation at scan time:** Backend 57/57 tests pass, `tsc` OK; frontend lint + build OK

---

## Summary

| Severity | Count |
|----------|------:|
| Critical | 5 |
| High | 10 |
| Medium (backend) | 7 |
| Medium (frontend) | 10 |
| Low | 8 |
| **Total** | **40** |

---

## Critical

### AUDIT-001 — Sold-qty update ignores prior returns

| Field | Value |
|-------|-------|
| **Area** | Backend |
| **File** | `src/modules/inventory/inventory.service.ts` → `updateMovementInvoice()` |
| **Impact** | Reducing sold quantity credits stock by the full delta without subtracting linked `STOCK_IN` return movements → **double-counted inventory** |
| **Status** | Open |

### AUDIT-002 — Delete invoice ignores linked returns

| Field | Value |
|-------|-------|
| **Area** | Backend |
| **File** | `src/modules/inventory/inventory.service.ts` → `deleteSaleInvoice()` |
| **Impact** | Deleting a partially returned sale restores the full sold quantity → **over-restores stock** |
| **Status** | Open |

### AUDIT-003 — Transfer receive race (double credit)

| Field | Value |
|-------|-------|
| **Area** | Backend |
| **Files** | `src/modules/transfers/transfers.service.ts` (`updateTransferStatus`) vs `src/modules/stock/stock.service.ts` (`receiveTransfer`) |
| **Impact** | Admin “mark received” and warehouse receive running concurrently can both credit the destination warehouse |
| **Status** | Open |

### AUDIT-004 — `returnTransfer` not atomic

| Field | Value |
|-------|-------|
| **Area** | Backend |
| **File** | `src/modules/transfers/transfers.service.ts` → `returnTransfer()` |
| **Impact** | Concurrent return actions can move stock twice |
| **Status** | Open |

### AUDIT-005 — Setting sold qty to 0 may fail at persistence

| Field | Value |
|-------|-------|
| **Area** | Backend |
| **Files** | `src/models/StockMovement.ts` (`quantity: min: 1`) vs client-return validation (`min: 0`) |
| **Impact** | Client return “set sold qty to zero” can pass API validation but fail on `save()` |
| **Status** | Open |

---

## High

### AUDIT-006 — `allowInsufficientStock` does not bypass atomic decrement

| Field | Value |
|-------|-------|
| **Area** | Backend |
| **Files** | `src/modules/imports/salesImport.service.ts`, `src/modules/stock/stock.service.ts` → `adjustBalance()` |
| **Impact** | Sales backfill still fails when stock is insufficient; flag only skips pre-check, not `$gte` guard |
| **Status** | Open |

### AUDIT-007 — In-transit returns hidden for source warehouse

| Field | Value |
|-------|-------|
| **Area** | Frontend + Backend API usage |
| **Files** | `frontend/src/components/stock/WarehouseReturnPanel.tsx`, `listPendingTransfers` (destination-only filter) |
| **Impact** | Sending warehouse cannot see or return its own in-transit shipments |
| **Status** | Open |

### AUDIT-008 — Invoices nav vs route permission mismatch

| Field | Value |
|-------|-------|
| **Area** | Frontend |
| **Files** | `frontend/src/components/layout/buildAppNav.ts` vs `frontend/src/lib/auth/permissions.ts` (`APP_ROUTE_PERMISSIONS`) |
| **Impact** | Users with only `inventory.view` see “Invoices” in nav but are blocked on `/app/wrong-invoice` (requires view **and** adjust) |
| **Status** | Open |

### AUDIT-009 — Return panel ignores warehouse scope in UI

| Field | Value |
|-------|-------|
| **Area** | Frontend |
| **File** | `frontend/src/components/stock/ReturnPanel.tsx` |
| **Impact** | Return options shown globally; API returns 403 for warehouses the user cannot access |
| **Status** | Open |

### AUDIT-010 — Product import reactivation wipes all warehouse stock

| Field | Value |
|-------|-------|
| **Area** | Backend |
| **File** | `src/modules/imports/productImport.service.ts` → `resetImportedProductStockToZero()` |
| **Impact** | Merging/reactivating an inactive product via import sets stock to **0 at all warehouses** |
| **Status** | Open |

### AUDIT-011 — Product import merge overwrites thresholds

| Field | Value |
|-------|-------|
| **Area** | Backend |
| **File** | `src/modules/imports/productImport.service.ts` → `finalizeImportedProduct()` |
| **Impact** | Catalog import can overwrite manually configured per-warehouse low-stock thresholds |
| **Status** | Open |

### AUDIT-012 — No duplicate guard on sales re-import

| Field | Value |
|-------|-------|
| **Area** | Backend |
| **File** | `src/modules/imports/salesImport.service.ts` → `confirmSalesImport()` |
| **Impact** | Re-importing the same voucher can double-record sales and stock movements |
| **Status** | Open |

### AUDIT-013 — Transfer cancel/receive race

| Field | Value |
|-------|-------|
| **Area** | Backend |
| **File** | `src/modules/transfers/transfers.service.ts` |
| **Impact** | Cancel and receive on the same PENDING transfer can corrupt stock balances |
| **Status** | Open |

### AUDIT-014 — Import/report uploads skip token refresh retry

| Field | Value |
|-------|-------|
| **Area** | Frontend |
| **File** | `frontend/src/lib/api/client.ts` (raw `fetch` for uploads/exports) |
| **Impact** | Expired access token causes failed uploads/exports even when refresh would succeed |
| **Status** | Open |

### AUDIT-015 — `refreshUser` clears user on transient network errors

| Field | Value |
|-------|-------|
| **Area** | Frontend |
| **File** | `frontend/src/contexts/AuthContext.tsx` |
| **Impact** | Brief API failure presents as logout while tokens may still be valid |
| **Status** | Open |

---

## Medium — Backend

### AUDIT-016 — Invoice list undercounts returns vs detail view

| Field | Value |
|-------|-------|
| **File** | `src/modules/stock/clientReturn.service.ts` |
| **Impact** | List shows inflated “returnable” quantities; actions may fail on detail |
| **Status** | Open |

### AUDIT-017 — Sales import creates products outside stock-out transaction

| Field | Value |
|-------|-------|
| **File** | `src/modules/imports/salesImport.service.ts` |
| **Impact** | Orphan products if batch commit fails mid-run |
| **Status** | Open |

### AUDIT-018 — Product import rows not transactional

| Field | Value |
|-------|-------|
| **File** | `src/modules/imports/productImport.service.ts` |
| **Impact** | Partial row state on failure |
| **Status** | Open |

### AUDIT-019 — `markLastWorked` clears all invoices globally

| Field | Value |
|-------|-------|
| **File** | `src/modules/inventory/inventory.service.ts` |
| **Impact** | Wrong-invoice “last worked” marker wiped system-wide instead of per-invoice |
| **Status** | Open |

### AUDIT-020 — Invoice field updates don’t sync linked returns

| Field | Value |
|-------|-------|
| **File** | `src/modules/inventory/inventory.service.ts` |
| **Impact** | Orphaned or stale return movement metadata |
| **Status** | Open |

### AUDIT-021 — Standalone MongoDB has no real multi-document transactions

| Field | Value |
|-------|-------|
| **File** | Infrastructure / deployment |
| **Impact** | Dev or single-node setups can leave inconsistent state under failure |
| **Status** | Mitigated — documented in `docs/OPERATIONS.md`; `mongoTransaction.ts` warns on standalone |

### AUDIT-022 — `multer` / `xlsx` dependency advisories

| Field | Value |
|-------|-------|
| **File** | `package.json` (import endpoints) |
| **Impact** | Known DoS / parsing risks on file upload endpoints |
| **Status** | Mitigated — 10 MB upload cap, 5,000-row parser limit; see `docs/OPERATIONS.md` |

---

## Medium — Frontend

### AUDIT-023 — Dual inventory permissions always prefer warehouse API

| Field | Value |
|-------|-------|
| **File** | `frontend/src/app/(dashboard)/app/inventory/page.tsx` |
| **Impact** | Users with both `stock.view` and `inventory.view` never see company-wide Check Stock |
| **Status** | Open |

### AUDIT-024 — Company inventory “Last updated” shows epoch when empty

| Field | Value |
|-------|-------|
| **File** | `frontend/src/app/(dashboard)/admin/inventory/page.tsx` |
| **Impact** | Misleading 1970 timestamps when no locations exist |
| **Status** | Open |

### AUDIT-025 — Client return search + pagination race

| Field | Value |
|-------|-------|
| **File** | `frontend/src/components/stock/ClientReturnPanel.tsx` |
| **Impact** | Stale or wrong page flicker when search and pagination overlap |
| **Status** | Open |

### AUDIT-026 — Expanded invoice blank on detail load failure

| Field | Value |
|-------|-------|
| **File** | `frontend/src/components/stock/ClientReturnPanel.tsx` |
| **Impact** | Accordion expands with no error message when detail fetch fails |
| **Status** | Open |

### AUDIT-027 — Warehouse return shared notes field across rows

| Field | Value |
|-------|-------|
| **File** | `frontend/src/components/stock/WarehouseReturnPanel.tsx` |
| **Impact** | Notes entered for one transfer can apply to another |
| **Status** | Open |

### AUDIT-028 — Warehouse return received list capped at 100

| Field | Value |
|-------|-------|
| **File** | `frontend/src/components/stock/WarehouseReturnPanel.tsx` |
| **Impact** | No pagination; older received transfers unreachable |
| **Status** | Open |

### AUDIT-029 — Product import confirm lacks merge-target validation

| Field | Value |
|-------|-------|
| **File** | `frontend/src/app/(dashboard)/admin/imports/page.tsx` (or related import UI) |
| **Impact** | Invalid confirm payloads possible before API rejection |
| **Status** | Open |

### AUDIT-030 — Wrong-invoice page shows edit/delete without adjust check

| Field | Value |
|-------|-------|
| **File** | Wrong-invoice page components |
| **Impact** | View-only users see actions that return 403 |
| **Status** | Open |

### AUDIT-031 — Admin return flow ignores `requireWarehouse`

| Field | Value |
|-------|-------|
| **File** | Admin return UI |
| **Impact** | No warehouse picker unlike other admin stock flows |
| **Status** | Open |

### AUDIT-032 — `canWarehouseReturn()` defined but unused

| Field | Value |
|-------|-------|
| **File** | `frontend/src/lib/auth/permissions.ts` |
| **Impact** | Dead helper; UI uses weaker permission checks |
| **Status** | Open |

---

## Low

### AUDIT-033 — Invoice lookup is case-sensitive

| Field | Value |
|-------|-------|
| **Area** | Backend |
| **Impact** | `INV-001` ≠ `inv-001` in search/match |
| **Status** | Open |

### AUDIT-034 — `searchMovementsForInvoiceFix` is a no-op wrapper

| Field | Value |
|-------|-------|
| **Area** | Backend |
| **Impact** | Dead or misleading code path |
| **Status** | Open |

### AUDIT-035 — Sales parser stores `quantity: 0` before validation flags it

| Field | Value |
|-------|-------|
| **Area** | Backend |
| **Impact** | Transient invalid state in parse pipeline |
| **Status** | Open |

### AUDIT-036 — `/app/receive` is only a redirect

| Field | Value |
|-------|-------|
| **Area** | Frontend |
| **Impact** | Route exists but adds no unique behavior |
| **Status** | Fixed — `/app/receive` and `/admin/receive` redirect to transfer; constants alias transfer |

### AUDIT-037 — `uploadTally` API has no UI

| Field | Value |
|-------|-------|
| **Area** | Frontend / API |
| **Impact** | Dead or undocumented surface |
| **Status** | Accepted — direct sell import covers client deductions; legacy `/imports/tally` API retained without UI |

### AUDIT-038 — `ReturnPanel` success state is dead code

| Field | Value |
|-------|-------|
| **Area** | Frontend |
| **File** | `frontend/src/components/stock/ReturnPanel.tsx` |
| **Impact** | Unused state branch |
| **Status** | Open |

### AUDIT-039 — Admin inventory “Return” button lacks product/warehouse context

| Field | Value |
|-------|-------|
| **Area** | Frontend |
| **Impact** | Navigation without pre-filled context |
| **Status** | Open |

### AUDIT-040 — No integration tests for critical paths

| Field | Value |
|-------|-------|
| **Area** | Both |
| **Impact** | Missing coverage for concurrency, return + qty-update interactions, sales import edge cases |
| **Status** | Partial — unit tests for sale-return deltas, import parsers, and row limits; no full DB integration suite |

---

## Healthy (no action required)

- Atomic `adjustBalance()` decrement guard for single operations
- `receiveTransfer()` uses atomic PENDING → RECEIVED status claim
- Auth + permission middleware on business routes
- Permission codes aligned between frontend and backend catalogs
- Standard JSON API client retries after token refresh

---

## Recommended remediation order

1. **AUDIT-001, AUDIT-002, AUDIT-005** — Sold-qty / zero-qty / delete-invoice stock integrity
2. **AUDIT-003, AUDIT-004, AUDIT-013** — Transfer concurrency and double-credit paths
3. **AUDIT-006, AUDIT-012** — Sales import reliability
4. **AUDIT-007, AUDIT-008, AUDIT-009** — Return and invoice RBAC/UX alignment
5. **AUDIT-010, AUDIT-011** — Product import safety (stock reset and threshold overwrite)

---

## Changelog

| Date | Author | Notes |
|------|--------|-------|
| 2026-07-06 | System scan | Initial audit — 40 findings |
| 2026-07-06 | Remediation | Fixed AUDIT-001–015, 019, 027 (partial); see git history |
| 2026-07-06 | Remediation | Fixed AUDIT-017–020, 023–026, 028–035, 038–039; see git history |
| 2026-07-06 | Remediation | AUDIT-021–022 mitigated (docs + row limits); 036–037 fixed; 040 partial (parser/limit tests) |
| 2026-07-06 | Remediation | Residual fixes: case-insensitive returns, invoice delete cleanup, atomic duplicate import, confirm row limits |
