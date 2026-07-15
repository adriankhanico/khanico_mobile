import { Router } from "express";
import { createOdooClientForUser } from "../odoo/client.js";
import { getDashboardSummary } from "../odoo/dashboard.js";
import { redactSaleOrderSummaryPrices } from "../lib/redact-prices.js";

export const dashboardRouter = Router();

dashboardRouter.get("/", async (req, res, next) => {
  try {
    const client = createOdooClientForUser(req.odoo!);
    const summary = await getDashboardSummary(client);
    res.json(
      req.odooIsAdmin
        ? summary
        : { ...summary, recentOrders: summary.recentOrders.map(redactSaleOrderSummaryPrices) }
    );
  } catch (err) {
    next(err);
  }
});
