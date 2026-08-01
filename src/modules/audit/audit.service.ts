import { Types } from "mongoose";
import { AuditLog } from "../../models/AuditLog.js";
import { User } from "../../models/User.js";
import { buildDateFilter } from "../reports/reports.utils.js";
import {
  buildPaginationMeta,
  getPaginationParams,
  mongoSort,
} from "../../shared/pagination/pagination.js";
import type { AuditLogQuery } from "./audit.validation.js";
import { escapeRegex } from "../search/search.utils.js";
import { revertCapability } from "../reports/revert.service.js";

export async function listAuditLogs(query: AuditLogQuery) {
  const filter: Record<string, unknown> = {};

  if (query.action?.trim()) {
    filter.action = { $regex: escapeRegex(query.action.trim()), $options: "i" };
  }
  if (query.entity?.trim()) {
    filter.entity = query.entity.trim();
  }
  if (query.userId && Types.ObjectId.isValid(query.userId)) {
    filter.userId = query.userId;
  }
  if (query.source) {
    filter.source =
      query.source === "APPLICATION"
        ? { $in: ["APPLICATION", null] }
        : query.source;
  }
  if (query.outcome) {
    filter.outcome =
      query.outcome === "SUCCESS" ? { $in: ["SUCCESS", null] } : query.outcome;
  }

  const createdAt = buildDateFilter(query.dateFrom, query.dateTo);
  if (createdAt) filter.createdAt = createdAt;

  const { page, limit, skip, sortOrder } = getPaginationParams(query);
  const sortField = mongoSort(query.sortBy ?? "createdAt", sortOrder);

  const [total, logs] = await Promise.all([
    AuditLog.countDocuments(filter),
    AuditLog.find(filter)
      .sort(sortField)
      .skip(skip)
      .limit(limit)
      .populate("userId", "name email role")
      .lean(),
  ]);

  const items = logs.map((log) => {
    const user = log.userId as
      | { _id: Types.ObjectId; name: string; email: string; role: string }
      | null
      | undefined;

    const capability = revertCapability(log);

    return {
      id: String(log._id),
      action: log.action,
      entity: log.entity,
      entityId: log.entityId ? String(log.entityId) : undefined,
      source: log.source ?? "APPLICATION",
      outcome: log.outcome ?? "SUCCESS",
      requestId: log.requestId,
      revertedAt: log.revertedAt,
      revertedBy: log.revertedBy ? String(log.revertedBy) : undefined,
      revertAuditLogId: log.revertAuditLogId ? String(log.revertAuditLogId) : undefined,
      canRevert: capability.canRevert,
      revertReason: capability.reason,
      user: user
        ? {
            id: String(user._id),
            name: user.name,
            email: user.email,
            role: user.role,
          }
        : undefined,
      metadata: log.metadata,
      createdAt: log.createdAt,
    };
  });

  return {
    items,
    pagination: buildPaginationMeta(total, page, limit),
  };
}

export async function getAuditSummary() {
  const since = new Date();
  since.setDate(since.getDate() - 7);

  const [total, last7Days, byAction] = await Promise.all([
    AuditLog.countDocuments(),
    AuditLog.countDocuments({ createdAt: { $gte: since } }),
    AuditLog.aggregate([
      { $group: { _id: "$action", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
  ]);

  return {
    total,
    last7Days,
    topActions: byAction.map((a: { _id: string; count: number }) => ({
      action: a._id,
      count: a.count,
    })),
  };
}

export async function listAuditUsers() {
  const users = await User.find()
    .select("name email role isActive")
    .sort({ name: 1 })
    .lean();

  return users.map((user) => ({
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
  }));
}
