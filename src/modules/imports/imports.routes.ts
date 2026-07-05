import { Router } from "express";
import multer from "multer";
import { Permission } from "../../shared/constants/permissions.js";
import { BadRequestError } from "../../shared/errors/AppError.js";
import { authenticate } from "../../shared/middleware/authenticate.js";
import { requireAdminOrPermission } from "../../shared/middleware/requirePermission.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { sendSuccess } from "../../shared/utils/apiResponse.js";
import * as importsService from "./imports.service.js";
import * as productImportService from "./productImport.service.js";
import { productImportConfirmSchema } from "./imports.validation.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
    ];
    const ext = file.originalname.toLowerCase();
    if (
      allowed.includes(file.mimetype) ||
      ext.endsWith(".xlsx") ||
      ext.endsWith(".xls") ||
      ext.endsWith(".csv")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only Excel files (.xlsx, .xls) are allowed"));
    }
  },
});

const router = Router();

router.use(authenticate, requireAdminOrPermission(Permission.IMPORTS_MANAGE));

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const imports = await importsService.listImports();
    sendSuccess(res, imports);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const doc = await importsService.getImportById(String(req.params.id));
    sendSuccess(res, doc);
  })
);

router.post(
  "/products/preview",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new BadRequestError("Excel file is required");
    }

    const preview = await productImportService.previewProductImport(req.file.buffer);
    sendSuccess(res, preview);
  })
);

router.post(
  "/products/confirm",
  asyncHandler(async (req, res) => {
    const input = productImportConfirmSchema.parse(req.body);
    const result = await productImportService.confirmProductImport(input, req.user!);
    sendSuccess(res, result, 201);
  })
);

router.post(
  "/tally",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new BadRequestError("Excel file is required");
    }

    const warehouseId = String(req.body.warehouseId ?? "");
    if (!warehouseId) {
      throw new BadRequestError("warehouseId is required");
    }

    const result = await importsService.processTallyImport(
      req.file.buffer,
      req.file.originalname,
      warehouseId,
      req.user!
    );

    sendSuccess(res, result, 201);
  })
);

export const importsRoutes = router;
