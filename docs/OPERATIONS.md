# Operations

## MongoDB transactions

Multi-document writes use `runInTransaction()` (`src/shared/utils/mongoTransaction.ts`). That helper only starts a real MongoDB transaction when the server reports a replica set (`hello.setName`).

On a **standalone** MongoDB instance (typical local dev), operations run without a transaction. A failure mid-import or mid-transfer can leave partial writes. For production, run MongoDB as a **replica set** (see `docker-compose.yml` in the repo root).

The API logs a warning on startup when standalone mode is detected:

```
[mongo] Standalone MongoDB detected — using non-transactional writes.
```

## Import uploads

| Limit | Value | Where enforced |
|-------|------:|----------------|
| File size | 10 MB | `multer` on `/api/v1/imports/*` |
| Parsed rows | 5,000 | `assertImportRowCount()` in import parsers |

Supported formats: `.xlsx`, `.xls`, `.csv` (Excel MIME types).

Split large files before uploading. Row limits apply per flow (product catalog rows, sales register lines, tally deduction rows).

## Dependency notes

Import endpoints use `multer` (memory storage) and `xlsx` for parsing. Keep these packages updated; file uploads are a common attack surface. The row and size limits above reduce DoS risk from oversized workbooks.
