import { Router } from "express";
import type { SaleOrderCreateInput, SaleOrderLineInput } from "@ventor/shared";
import { createOdooClientForUser } from "../odoo/client.js";
import {
  addSaleOrderLine,
  createSaleOrder,
  getSaleOrderDetail,
  removeSaleOrderLine,
  searchCustomers,
  searchSaleOrders,
  updateSaleOrderCustomer,
  updateSaleOrderFields,
  updateSaleOrderLinePrice,
  updateSaleOrderLineQuantity,
} from "../odoo/sales.js";
import { redactSaleOrderDetailPrices, redactSaleOrderSummaryPrices } from "../lib/redact-prices.js";

export const salesRouter = Router();

salesRouter.get("/customers", async (req, res, next) => {
  try {
    const client = createOdooClientForUser(req.odoo!);
    const query = String(req.query.q ?? "");
    const customers = await searchCustomers(client, query);
    res.json(customers);
  } catch (err) {
    next(err);
  }
});

salesRouter.post("/sale-orders", async (req, res, next) => {
  try {
    const client = createOdooClientForUser(req.odoo!);
    const { partnerId, lines, poNumber, isHoseOrder } = req.body as SaleOrderCreateInput;
    if (!Number.isInteger(partnerId) || !Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: "bad_request", message: "partnerId and non-empty lines are required" });
    }
    const effectiveLines = req.odooIsAdmin
      ? lines
      : lines.map(({ priceUnit, ...rest }) => rest);
    const orderId = await createSaleOrder(client, { partnerId, lines: effectiveLines, poNumber, isHoseOrder });
    res.status(201).json({ id: orderId });
  } catch (err) {
    next(err);
  }
});

salesRouter.get("/sale-orders", async (req, res, next) => {
  try {
    const client = createOdooClientForUser(req.odoo!);
    const query = String(req.query.q ?? "");
    const orders = await searchSaleOrders(client, query);
    res.json(req.odooIsAdmin ? orders : orders.map(redactSaleOrderSummaryPrices));
  } catch (err) {
    next(err);
  }
});

salesRouter.get("/sale-orders/:id", async (req, res, next) => {
  try {
    const client = createOdooClientForUser(req.odoo!);
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId)) {
      return res.status(400).json({ error: "bad_request", message: "id must be an integer" });
    }
    const order = await getSaleOrderDetail(client, orderId);
    if (!order) {
      return res.status(404).json({ error: "not_found", message: "Sale order not found" });
    }
    res.json(req.odooIsAdmin ? order : redactSaleOrderDetailPrices(order));
  } catch (err) {
    next(err);
  }
});

salesRouter.put("/sale-orders/:id/customer", async (req, res, next) => {
  try {
    const client = createOdooClientForUser(req.odoo!);
    const orderId = Number(req.params.id);
    const { partnerId } = req.body as { partnerId: number };
    if (!Number.isInteger(orderId) || !Number.isInteger(partnerId)) {
      return res.status(400).json({ error: "bad_request", message: "orderId and partnerId must be integers" });
    }
    await updateSaleOrderCustomer(client, orderId, partnerId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

salesRouter.put("/sale-orders/:id/fields", async (req, res, next) => {
  try {
    const client = createOdooClientForUser(req.odoo!);
    const orderId = Number(req.params.id);
    const { poNumber, isHoseOrder } = req.body as { poNumber?: string; isHoseOrder?: boolean };
    if (!Number.isInteger(orderId)) {
      return res.status(400).json({ error: "bad_request", message: "id must be an integer" });
    }
    await updateSaleOrderFields(client, orderId, { poNumber, isHoseOrder });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

salesRouter.post("/sale-orders/:id/lines", async (req, res, next) => {
  try {
    const client = createOdooClientForUser(req.odoo!);
    const orderId = Number(req.params.id);
    const { productId, quantity } = req.body as SaleOrderLineInput;
    if (!Number.isInteger(orderId) || !Number.isInteger(productId) || typeof quantity !== "number") {
      return res.status(400).json({ error: "bad_request", message: "orderId, productId, and quantity are required" });
    }
    await addSaleOrderLine(client, orderId, { productId, quantity });
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

salesRouter.put("/sale-orders/:id/lines/:lineId", async (req, res, next) => {
  try {
    const client = createOdooClientForUser(req.odoo!);
    const orderId = Number(req.params.id);
    const lineId = Number(req.params.lineId);
    const { quantity } = req.body as { quantity: number };
    if (!Number.isInteger(orderId) || !Number.isInteger(lineId) || typeof quantity !== "number") {
      return res.status(400).json({ error: "bad_request", message: "orderId, lineId, and quantity are required" });
    }
    await updateSaleOrderLineQuantity(client, orderId, lineId, quantity);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

salesRouter.put("/sale-orders/:id/lines/:lineId/price", async (req, res, next) => {
  try {
    if (!req.odooIsAdmin) {
      return res.status(403).json({ error: "forbidden", message: "You don't have permission to edit price." });
    }
    const client = createOdooClientForUser(req.odoo!);
    const orderId = Number(req.params.id);
    const lineId = Number(req.params.lineId);
    const { priceUnit } = req.body as { priceUnit: number };
    if (!Number.isInteger(orderId) || !Number.isInteger(lineId) || typeof priceUnit !== "number") {
      return res
        .status(400)
        .json({ error: "bad_request", message: "orderId, lineId, and priceUnit are required" });
    }
    await updateSaleOrderLinePrice(client, orderId, lineId, priceUnit);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

salesRouter.delete("/sale-orders/:id/lines/:lineId", async (req, res, next) => {
  try {
    const client = createOdooClientForUser(req.odoo!);
    const orderId = Number(req.params.id);
    const lineId = Number(req.params.lineId);
    if (!Number.isInteger(orderId) || !Number.isInteger(lineId)) {
      return res.status(400).json({ error: "bad_request", message: "orderId and lineId must be integers" });
    }
    await removeSaleOrderLine(client, orderId, lineId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
