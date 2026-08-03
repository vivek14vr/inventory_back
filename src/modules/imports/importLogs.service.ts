import { Types } from "mongoose";
import { ImportLog, type ImportLogKind } from "../../models/ImportLog.js";
import { AuditLog } from "../../models/AuditLog.js";
import { NotFoundError } from "../../shared/errors/AppError.js";

export type StoredImportResult = Record<string, unknown> & {
  fileName?: string;
  totalRows?: number;
  totalLines?: number;
  successCount: number;
  failedCount: number;
  createdProductCount?: number;
  createdBrandCount?: number;
  createdClientCount?: number;
  rows?: Array<{ status?: string }>;
};

function formatLog(doc: any, includeResult = false) {
  const importedBy = doc.importedBy as
    | Types.ObjectId
    | { _id: Types.ObjectId; name: string };
  const populatedUser = importedBy && "name" in Object(importedBy)
    ? (importedBy as { _id: Types.ObjectId; name: string })
    : null;
  return {
    id: String(doc._id),
    kind: doc.kind as ImportLogKind,
    fileName: doc.fileName,
    importedBy: populatedUser
      ? { id: String(populatedUser._id), name: populatedUser.name }
      : { id: String(importedBy), name: "Unknown" },
    totalRows: doc.totalRows,
    successCount: doc.successCount,
    failedCount: doc.failedCount,
    skippedCount: doc.skippedCount ?? 0,
    createdProductCount: doc.createdProductCount ?? 0,
    createdBrandCount: doc.createdBrandCount ?? 0,
    createdClientCount: doc.createdClientCount ?? 0,
    createdAt: doc.createdAt,
    hasReportFile: Boolean(doc.reportFileName || doc.reportFile),
    ...(includeResult ? { result: doc.result } : {}),
  };
}

export async function saveGeneratedImportReport(input: {
  kind: ImportLogKind;
  fileName: string;
  reportFileName: string;
  reportMimeType?: string;
  reportFile: Buffer;
  result: StoredImportResult;
  userId: string;
}) {
  const skippedCount =
    input.result.rows?.filter((row) => row.status === "SKIPPED").length ?? 0;
  const totalRows =
    input.result.totalRows ??
    input.result.totalLines ??
    input.result.rows?.length ??
    0;
  const doc = await ImportLog.create({
    kind: input.kind,
    fileName: input.fileName.trim() || `${input.kind}-import.xlsx`,
    importedBy: input.userId,
    totalRows,
    successCount: input.result.successCount,
    failedCount: input.result.failedCount,
    skippedCount,
    createdProductCount: input.result.createdProductCount ?? 0,
    createdBrandCount: input.result.createdBrandCount ?? 0,
    createdClientCount: input.result.createdClientCount ?? 0,
    // The workbook is the durable artifact. Keep only a compact summary beside it
    // so large imports do not approach MongoDB's per-document size limit twice.
    result: {
      fileName: input.result.fileName,
      totalRows,
      successCount: input.result.successCount,
      failedCount: input.result.failedCount,
      skippedCount,
      createdProductCount: input.result.createdProductCount ?? 0,
      createdBrandCount: input.result.createdBrandCount ?? 0,
      createdClientCount: input.result.createdClientCount ?? 0,
    },
    reportFile: input.reportFile,
    reportFileName: input.reportFileName,
    reportMimeType:
      input.reportMimeType ||
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  await AuditLog.create({
    action: "IMPORT_REPORT_STORED",
    entity: "ImportLog",
    entityId: doc._id,
    userId: input.userId,
    source: "APPLICATION",
    outcome: "SUCCESS",
    metadata: {
      kind: input.kind,
      fileName: input.fileName,
      reportFileName: input.reportFileName,
      reportSize: input.reportFile.length,
      totalRows,
      successCount: input.result.successCount,
      failedCount: input.result.failedCount,
      skippedCount,
    },
  });
  return formatLog(doc.toObject());
}

export async function getStoredImportReport(id: string, importedBy?: string) {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError("Import log not found");
  const doc = await ImportLog.findOne({
    _id: id,
    ...(importedBy ? { importedBy } : {}),
  })
    .select("reportFile reportFileName reportMimeType")
    .lean();
  if (!doc?.reportFile) {
    throw new NotFoundError("The generated Excel file was not stored for this import");
  }
  const stored = doc.reportFile as unknown as Buffer;
  return {
    file: Buffer.isBuffer(stored)
      ? Buffer.from(stored)
      : Buffer.from((stored as unknown as { buffer: ArrayBuffer }).buffer),
    fileName: doc.reportFileName || "import-results.xlsx",
    mimeType:
      doc.reportMimeType ||
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

export async function getStoredImportReportForAudit(
  auditId: string,
  importedBy?: string
) {
  if (!Types.ObjectId.isValid(auditId)) throw new NotFoundError("Audit log not found");
  const audit = await AuditLog.findById(auditId).lean();
  if (!audit) throw new NotFoundError("Audit log not found");

  if (audit.entityId) {
    const direct = await ImportLog.findOne({
      _id: audit.entityId,
      ...(importedBy ? { importedBy } : {}),
    })
      .select("reportFile reportFileName reportMimeType")
      .lean();
    if (direct?.reportFile) {
      return getStoredImportReport(String(direct._id), importedBy);
    }
  }

  const changes = (audit.metadata?.changes ?? {}) as Record<string, unknown>;
  const kind = String(changes.kind ?? "");
  const fileName = String(changes.fileName ?? "");
  if (!(["products", "sales", "clients"] as string[]).includes(kind) || !fileName) {
    throw new NotFoundError("No generated Excel file is linked to this audit entry");
  }

  const windowMs = 2 * 60 * 1000;
  const candidates = await ImportLog.find({
    kind,
    fileName,
    ...(importedBy
      ? { importedBy }
      : audit.userId
        ? { importedBy: audit.userId }
        : {}),
    reportFile: { $exists: true },
    createdAt: {
      $gte: new Date(audit.createdAt.getTime() - windowMs),
      $lte: new Date(audit.createdAt.getTime() + windowMs),
    },
  })
    .select("createdAt")
    .lean();
  const closest = candidates.sort(
    (a, b) =>
      Math.abs(a.createdAt.getTime() - audit.createdAt.getTime()) -
      Math.abs(b.createdAt.getTime() - audit.createdAt.getTime())
  )[0];
  if (!closest) throw new NotFoundError("Generated Excel file not found for this audit entry");
  return getStoredImportReport(String(closest._id), importedBy);
}

export async function saveImportLog(
  kind: ImportLogKind,
  result: StoredImportResult,
  userId: string
) {
  const skippedCount = result.rows?.filter((row) => row.status === "SKIPPED").length ?? 0;
  const totalRows = result.totalRows ?? result.totalLines ?? result.rows?.length ?? 0;
  return ImportLog.create({
    kind,
    fileName: result.fileName?.trim() || `${kind}-import.xlsx`,
    importedBy: userId,
    totalRows,
    successCount: result.successCount,
    failedCount: result.failedCount,
    skippedCount,
    createdProductCount: result.createdProductCount ?? 0,
    createdBrandCount: result.createdBrandCount ?? 0,
    createdClientCount: result.createdClientCount ?? 0,
    result,
  });
}

export async function listImportLogs(limit = 100, importedBy?: string) {
  const docs = await ImportLog.find(importedBy ? { importedBy } : {})
    .select("-reportFile -result")
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 250))
    .populate("importedBy", "name")
    .lean();
  return docs.map((doc) => formatLog(doc));
}

export async function getImportLog(id: string, importedBy?: string) {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError("Import log not found");
  const doc = await ImportLog.findOne({
    _id: id,
    ...(importedBy ? { importedBy } : {}),
  })
    .select("-reportFile")
    .populate("importedBy", "name")
    .lean();
  if (!doc) throw new NotFoundError("Import log not found");
  return formatLog(doc, true);
}
