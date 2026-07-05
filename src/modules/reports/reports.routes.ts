import { Router, type Response } from "express";
import { Permission } from "../../shared/constants/permissions.js";
import { BadRequestError } from "../../shared/errors/AppError.js";
import { authenticate } from "../../shared/middleware/authenticate.js";
import { requireAdminOrPermission } from "../../shared/middleware/requirePermission.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { sendSuccess } from "../../shared/utils/apiResponse.js";
import * as reportsService from "./reports.service.js";
import {
  movementReportSchema,
  reportFilterSchema,
  stockReportSchema,
  transferReportSchema,
} from "./reports.validation.js";

const router = Router();

router.use(authenticate, requireAdminOrPermission(Permission.REPORTS_VIEW));

async function handleExport(
  reportType: string,
  data: { rows: Record<string, unknown>[] },
  res: Response
) {
  const { csv, filename } = reportsService.exportReportCsv(reportType, data);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
}

router.get(
  "/stock",
  asyncHandler(async (req, res) => {
    const parsed = stockReportSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid query");
    }
    const data = await reportsService.reportCurrentStock(parsed.data);
    if (req.query.format === "csv") {
      const type =
        parsed.data.groupBy === "warehouse"
          ? "stock-warehouse"
          : parsed.data.groupBy === "brand"
            ? "stock-brand"
            : parsed.data.groupBy === "product"
              ? "stock-product"
              : "stock";
      return handleExport(type, data, res);
    }
    sendSuccess(res, data);
  })
);

router.get(
  "/stock-in",
  asyncHandler(async (req, res) => {
    const parsed = movementReportSchema.safeParse({ ...req.query, type: "STOCK_IN" });
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid query");
    }
    const data = await reportsService.reportStockMovements({
      ...parsed.data,
      type: "STOCK_IN",
    });
    if (req.query.format === "csv") {
      return handleExport("stock-in", data, res);
    }
    sendSuccess(res, data);
  })
);

router.get(
  "/stock-out",
  asyncHandler(async (req, res) => {
    const parsed = movementReportSchema.safeParse({ ...req.query, type: "STOCK_OUT" });
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid query");
    }
    const data = await reportsService.reportStockMovements({
      ...parsed.data,
      type: "STOCK_OUT",
    });
    if (req.query.format === "csv") {
      return handleExport("stock-out", data, res);
    }
    sendSuccess(res, data);
  })
);

router.get(
  "/transfers",
  asyncHandler(async (req, res) => {
    const parsed = transferReportSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid query");
    }
    const data = await reportsService.reportTransfers(parsed.data);
    if (req.query.format === "csv") {
      return handleExport("transfers", data, res);
    }
    sendSuccess(res, data);
  })
);

router.get(
  "/sales/by-client",
  asyncHandler(async (req, res) => {
    const parsed = reportFilterSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid query");
    }
    const data = await reportsService.reportSalesByClient(parsed.data);
    if (req.query.format === "csv") {
      return handleExport("sales-client", data, res);
    }
    sendSuccess(res, data);
  })
);

router.get(
  "/sales/by-invoice",
  asyncHandler(async (req, res) => {
    const parsed = reportFilterSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid query");
    }
    const data = await reportsService.reportSalesByInvoice(parsed.data);
    if (req.query.format === "csv") {
      return handleExport("sales-invoice", data, res);
    }
    sendSuccess(res, data);
  })
);

router.get(
  "/sales/by-brand",
  asyncHandler(async (req, res) => {
    const parsed = reportFilterSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid query");
    }
    const data = await reportsService.reportSalesByBrand(parsed.data);
    if (req.query.format === "csv") {
      return handleExport("sales-brand", data, res);
    }
    sendSuccess(res, data);
  })
);

export const reportsRoutes = router;
