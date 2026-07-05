import { Router } from "express";
import { healthRoutes } from "../modules/health/health.routes.js";
import { authRoutes } from "../modules/auth/auth.routes.js";
import { warehousesRoutes } from "../modules/warehouses/warehouses.routes.js";
import { brandsRoutes } from "../modules/brands/brands.routes.js";
import { productsRoutes } from "../modules/products/products.routes.js";
import { stockRoutes } from "../modules/stock/stock.routes.js";
import { inventoryRoutes } from "../modules/inventory/inventory.routes.js";
import { transfersRoutes } from "../modules/transfers/transfers.routes.js";
import { importsRoutes } from "../modules/imports/imports.routes.js";
import { reportsRoutes } from "../modules/reports/reports.routes.js";
import { auditRoutes } from "../modules/audit/audit.routes.js";
import { usersRoutes } from "../modules/users/users.routes.js";
import { checklistsRoutes } from "../modules/checklists/checklists.routes.js";
import { notificationsRoutes } from "../modules/notifications/notifications.routes.js";
import { permissionsRoutes } from "../modules/permissions/permissions.routes.js";

export function createApiRouter(): Router {
  const router = Router();

  router.use("/health", healthRoutes);
  router.use("/auth", authRoutes);
  router.use("/permissions", permissionsRoutes);
  router.use("/users", usersRoutes);
  router.use("/warehouses", warehousesRoutes);
  router.use("/brands", brandsRoutes);
  router.use("/products", productsRoutes);
  router.use("/stock", stockRoutes);
  router.use("/inventory", inventoryRoutes);
  router.use("/transfers", transfersRoutes);
  router.use("/imports", importsRoutes);
  router.use("/reports", reportsRoutes);
  router.use("/audit", auditRoutes);
  router.use("/checklists", checklistsRoutes);
  router.use("/notifications", notificationsRoutes);

  return router;
}
