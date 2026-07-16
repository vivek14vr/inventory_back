# Confirmed Bugs

Validated scan of `/Users/vivekraj/Desktop/inventory` (backend + frontend).  
Backend tests: **71/71 pass**. Frontend typecheck + lint: **clean**.

Legend: `OPEN` · `IN PROGRESS` · `FIXED`

---

## Fixed in this branch

| ID | Severity | Bug | Fix |
|----|----------|-----|-----|
| AUTH-001 | High | `apiClient` omitted `Authorization` when access token expired | `resolveAuthToken()` + 401 retry before JSON parse |
| AUTH-002 | Medium | Paginated API skipped proactive refresh | `getValidAccessToken()` in `pagination.ts` |
| AUTH-003 | Low | `clearAuthTokens` missed HTTPS `Secure` cookie | Clear with `Secure` on HTTPS |
| UI-001 | Low | `WrongInvoicePanel` updated ref during render | Sync ref in `useEffect` |
| UI-002 | Low | Unused `validatePositiveInteger` import | Removed |
| **BUG-001** | High | `returnTransfer` set RETURNED before stock assert | Assert stock **before** status claim |
| **BUG-002** | High | Product import writes outside Mongo session | Session threaded through `createProduct` / `updateProduct` / thresholds |
| **BUG-003** | High | Sales duplicate invoice race on standalone Mongo | Atomic invoice-level claim collection; multi-product invoices remain valid |
| **BUG-004** | Medium | Client return qty false error after success | Removed fragile post-hoc balance equality check |
| **BUG-005** | Medium | Client import confirm skipped duplicate names | `seenPrimary` check in confirm (same as preview) |
| **BUG-006** | Medium | Missing access cookie forced login (no silent refresh) | Login page attempts refresh + redirect when refresh token exists |
| **BUG-007** | Medium | Refresh token rotation non-atomic | `findOneAndUpdate` atomic claim before issuing new tokens |
| **BUG-008** | Low | `GET /imports/:id` before static paths | Moved `GET /:id` below product/client/sales/tally routes |
| **BUG-009** | Low | `api.auth.refresh` ignored localStorage refresh | Sends stored refresh token in body |

---

## Accepted / env-dependent (not code bugs)

| ID | Notes |
|----|-------|
| AUDIT-021 | Transactions no-op on standalone Mongo — use a replica set in production |
| AUDIT-022 | xlsx/multer size limits exist; upstream advisories remain |
| AUDIT-037 | Tally import API without UI — accepted |
| AUDIT-040 | Limited integration/concurrency test coverage |

---

## Deploy notes

1. **Deploy frontend + backend** together (auth client + session rotation + import/stock fixes).
2. The backend removes the invalid movement-level index automatically if it was ever created. No invoice cleanup is required for the replacement claim index.
3. Prefer a **MongoDB replica set** in production so `runInTransaction` provides full multi-doc atomicity (AUDIT-021).
