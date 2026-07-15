import { Router } from "express";
import { createOdooClientForUser } from "../odoo/client.js";

export const publicHealthRouter = Router();
export const healthRouter = Router();

publicHealthRouter.get("/", (_req, res) => {
  res.json({ status: "ok" });
});

healthRouter.get("/odoo", async (req, res, next) => {
  try {
    const client = createOdooClientForUser(req.odoo!);
    const count = await client.searchCount("product.product", []);
    res.json({ status: "ok", productCount: count });
  } catch (err) {
    next(err);
  }
});
