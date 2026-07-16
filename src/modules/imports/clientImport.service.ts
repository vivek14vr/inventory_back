import { Types } from "mongoose";
import * as XLSX from "xlsx";
import { AuditLog } from "../../models/AuditLog.js";
import { Client } from "../../models/Client.js";
import { assertImportRowCount } from "../../shared/constants/importLimits.js";
import { BadRequestError, NotFoundError } from "../../shared/errors/AppError.js";
import type { AuthUser } from "../../shared/types/auth.js";
import {
  createClient,
  updateClient,
} from "../clients/clients.service.js";
import type { ClientImportConfirmInput } from "./imports.validation.js";

export type ParsedClientImportRow = {
  rowNumber: number;
  primaryName: string;
  secondaryName?: string;
};

export type ClientImportPreviewRow = ParsedClientImportRow & {
  category: "matched" | "new";
  errors: string[];
  matchedClient?: {
    id: string;
    name: string;
    secondaryName?: string;
  };
  reactivatesClient?: {
    id: string;
    name: string;
  };
};

export type ClientImportResultRow = {
  rowNumber: number;
  primaryName: string;
  secondaryName?: string;
  status: "SUCCESS" | "FAILED";
  action: "merge" | "create";
  mergeTargetClientId?: string;
  message?: string;
  clientId?: string;
};

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function findColumnKey(keys: string[], aliases: string[]): string | undefined {
  return keys.find((key) => aliases.includes(normalizeHeader(key)));
}

function rowIsBlank(row: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => String(row[key] ?? "").trim() === "");
}

export function parseClientExcelBuffer(buffer: Buffer): ParsedClientImportRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new BadRequestError("Excel file has no sheets");
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    workbook.Sheets[sheetName],
    { defval: "" }
  );

  if (rows.length === 0) {
    throw new BadRequestError("Excel file has no data rows");
  }

  const keys = Object.keys(rows[0] ?? {});
  const primaryKey = findColumnKey(keys, [
    "primary name",
    "primary",
    "client name",
    "client",
    "name",
  ]);
  const secondaryKey = findColumnKey(keys, [
    "secondary name",
    "secondary",
    "alias",
    "alternate name",
  ]);

  if (!primaryKey) {
    throw new BadRequestError(
      'Could not find a "Primary name" column. Expected headers like Primary name and Secondary name.'
    );
  }

  const parsed: ParsedClientImportRow[] = [];
  const seenPrimary = new Map<string, number>();

  rows.forEach((row, index) => {
    if (rowIsBlank(row, keys)) return;

    const rowNumber = index + 2;
    const primaryName = String(row[primaryKey] ?? "").trim();
    const secondaryRaw = secondaryKey ? String(row[secondaryKey] ?? "").trim() : "";
    const secondaryName = secondaryRaw || undefined;

    const normalizedPrimary = primaryName.toLowerCase();
    const duplicateRow = seenPrimary.get(normalizedPrimary);
    if (duplicateRow != null) {
      parsed.push({
        rowNumber,
        primaryName,
        secondaryName,
      });
      return;
    }
    if (primaryName) {
      seenPrimary.set(normalizedPrimary, rowNumber);
    }

    parsed.push({
      rowNumber,
      primaryName,
      secondaryName,
    });
  });

  if (parsed.length === 0) {
    throw new BadRequestError("No client rows found in the Excel file");
  }

  assertImportRowCount(parsed.length, "Client import file");
  return parsed;
}

function validateParsedRow(
  row: ParsedClientImportRow,
  duplicateRow?: number
): string[] {
  const errors: string[] = [];
  if (!row.primaryName.trim()) {
    errors.push("Primary name is required");
  }
  if (duplicateRow != null) {
    errors.push(`Duplicate primary name (also on row ${duplicateRow})`);
  }
  return errors;
}

export async function previewClientImport(fileBuffer: Buffer) {
  const parsedRows = parseClientExcelBuffer(fileBuffer);
  const allClients = await Client.find().lean();
  const activeByName = new Map(
    allClients
      .filter((client) => client.isActive !== false)
      .map((client) => [client.name.trim().toLowerCase(), client])
  );
  const inactiveByName = new Map(
    allClients
      .filter((client) => client.isActive === false)
      .map((client) => [client.name.trim().toLowerCase(), client])
  );

  const seenPrimary = new Map<string, number>();
  const previewRows: ClientImportPreviewRow[] = parsedRows.map((row) => {
    const normalized = row.primaryName.trim().toLowerCase();
    const duplicateRow =
      normalized && seenPrimary.has(normalized) ? seenPrimary.get(normalized) : undefined;
    if (normalized && !duplicateRow) {
      seenPrimary.set(normalized, row.rowNumber);
    }

    const errors = validateParsedRow(row, duplicateRow);
    const active = normalized ? activeByName.get(normalized) : undefined;
    const inactive = !active && normalized ? inactiveByName.get(normalized) : undefined;

    const matchedClient = active
      ? {
          id: String(active._id),
          name: active.name,
          secondaryName: active.secondaryName,
        }
      : undefined;
    const reactivatesClient = inactive
      ? { id: String(inactive._id), name: inactive.name }
      : undefined;

    return {
      ...row,
      category: matchedClient || reactivatesClient ? "matched" : "new",
      errors,
      matchedClient,
      reactivatesClient,
    };
  });

  return {
    totalRows: previewRows.length,
    matchedCount: previewRows.filter((row) => row.category === "matched").length,
    newCount: previewRows.filter((row) => row.category === "new").length,
    errorCount: previewRows.filter((row) => row.errors.length > 0).length,
    rows: previewRows,
    existingClients: allClients
      .filter((client) => client.isActive !== false)
      .map((client) => ({
        id: String(client._id),
        name: client.name,
        secondaryName: client.secondaryName,
      })),
  };
}

export async function confirmClientImport(input: ClientImportConfirmInput, user: AuthUser) {
  assertImportRowCount(input.rows.length, "Client import confirm");

  const resultRows: ClientImportResultRow[] = [];
  let successCount = 0;
  let failedCount = 0;
  const seenPrimary = new Map<string, number>();

  for (const row of input.rows) {
    const base = {
      rowNumber: row.rowNumber,
      primaryName: row.primaryName.trim(),
      secondaryName: row.secondaryName?.trim() || undefined,
      action: row.action,
      mergeTargetClientId: row.mergeTargetClientId,
    };

    const errors: string[] = [];
    if (!base.primaryName) errors.push("Primary name is required");
    if (row.action === "merge" && !row.mergeTargetClientId) {
      errors.push("Select a client to merge into");
    }

    const normalized = base.primaryName.toLowerCase();
    if (normalized && seenPrimary.has(normalized)) {
      errors.push(
        `Duplicate primary name (same as row ${seenPrimary.get(normalized)})`
      );
    } else if (normalized) {
      seenPrimary.set(normalized, row.rowNumber);
    }

    if (errors.length > 0) {
      resultRows.push({
        ...base,
        status: "FAILED",
        message: errors.join("; "),
      });
      failedCount++;
      continue;
    }

    try {
      if (row.action === "merge") {
        const clientId = row.mergeTargetClientId!;
        if (!Types.ObjectId.isValid(clientId)) {
          throw new BadRequestError("Invalid client selected for merge");
        }

        const existing = await Client.findById(clientId);
        if (!existing) {
          throw new NotFoundError("Client not found");
        }

        const updated = await updateClient(clientId, {
          ...(base.secondaryName !== undefined
            ? { secondaryName: base.secondaryName }
            : {}),
          isActive: true,
        });

        resultRows.push({
          ...base,
          status: "SUCCESS",
          clientId: updated.id,
          message: `Updated ${updated.name}`,
        });
        successCount++;
        continue;
      }

      const created = await createClient({
        name: base.primaryName,
        secondaryName: base.secondaryName,
        isActive: true,
      });

      await AuditLog.create({
        action: "CLIENT_CREATED",
        entity: "Client",
        entityId: created.id,
        userId: user.id,
        metadata: {
          name: created.name,
          secondaryName: created.secondaryName,
          source: "client_import",
        },
      });

      resultRows.push({
        ...base,
        status: "SUCCESS",
        clientId: created.id,
        message: `Created ${created.name}`,
      });
      successCount++;
    } catch (err) {
      const inactive = await Client.findOne({
        name: new RegExp(
          `^${base.primaryName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          "i"
        ),
        isActive: false,
      });

      if (row.action === "create" && inactive) {
        try {
          const reactivated = await updateClient(String(inactive._id), {
            secondaryName: base.secondaryName,
            isActive: true,
          });
          resultRows.push({
            ...base,
            status: "SUCCESS",
            clientId: reactivated.id,
            message: `Reactivated ${reactivated.name}`,
          });
          successCount++;
          continue;
        } catch (reactivateErr) {
          resultRows.push({
            ...base,
            status: "FAILED",
            message:
              reactivateErr instanceof Error
                ? reactivateErr.message
                : "Failed to reactivate client",
          });
          failedCount++;
          continue;
        }
      }

      resultRows.push({
        ...base,
        status: "FAILED",
        message: err instanceof Error ? err.message : "Import failed",
      });
      failedCount++;
    }
  }

  await AuditLog.create({
    action: "CLIENT_IMPORT",
    entity: "Client",
    userId: user.id,
    metadata: {
      fileName: input.fileName,
      totalRows: input.rows.length,
      successCount,
      failedCount,
    },
  });

  return {
    fileName: input.fileName,
    totalRows: resultRows.length,
    successCount,
    failedCount,
    rows: resultRows,
  };
}
