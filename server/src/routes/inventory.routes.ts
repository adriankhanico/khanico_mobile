import { Router } from "express";
import type { MoveStockRequest } from "@khanico/shared";
import { createOdooClientForUser } from "../odoo/client.js";
import {
  getProductDetail,
  getProductLocations,
  InvalidMoveError,
  moveStock,
  searchLocations,
  searchProducts,
} from "../odoo/inventory.js";
import { redactProductPrices } from "../lib/redact-prices.js";

export const inventoryRouter = Router();

inventoryRouter.get("/locations/search", async (req, res, next) => {
  try {
    const client = createOdooClientForUser(req.odoo!);
    const query = String(req.query.q ?? "");
    const locations = await searchLocations(client, query);
    res.json(locations);
  } catch (err) {
    next(err);
  }
});

inventoryRouter.get("/search", async (req, res, next) => {
  try {
    const client = createOdooClientForUser(req.odoo!);
    const query = String(req.query.q ?? "");
    const products = await searchProducts(client, query);
    res.json(req.odooIsAdmin ? products : products.map(redactProductPrices));
  } catch (err) {
    next(err);
  }
});

inventoryRouter.get("/:productId/detail", async (req, res, next) => {
  try {
    const client = createOdooClientForUser(req.odoo!);
    const productId = Number(req.params.productId);
    if (!Number.isInteger(productId)) {
      return res.status(400).json({ error: "bad_request", message: "productId must be an integer" });
    }
    const detail = await getProductDetail(client, productId);
    if (!detail) {
      return res.status(404).json({ error: "not_found", message: "Product not found" });
    }
    res.json(req.odooIsAdmin ? detail : redactProductPrices(detail));
  } catch (err) {
    next(err);
  }
});

inventoryRouter.get("/:productId/locations", async (req, res, next) => {
  try {
    const client = createOdooClientForUser(req.odoo!);
    const productId = Number(req.params.productId);
    if (!Number.isInteger(productId)) {
      return res.status(400).json({ error: "bad_request", message: "productId must be an integer" });
    }
    const locations = await getProductLocations(client, productId);
    res.json(locations);
  } catch (err) {
    next(err);
  }
});

inventoryRouter.post("/:productId/move", async (req, res, next) => {
  try {
    const client = createOdooClientForUser(req.odoo!);
    const productId = Number(req.params.productId);
    const { sourceLocationId, destLocationId, quantity } = req.body as MoveStockRequest;
    if (
      !Number.isInteger(productId) ||
      !Number.isInteger(sourceLocationId) ||
      !Number.isInteger(destLocationId) ||
      typeof quantity !== "number" ||
      quantity <= 0
    ) {
      return res.status(400).json({
        error: "bad_request",
        message: "productId, sourceLocationId, destLocationId must be integers and quantity must be a positive number",
      });
    }
    try {
      await moveStock(client, productId, { sourceLocationId, destLocationId, quantity });
    } catch (err) {
      if (err instanceof InvalidMoveError) {
        return res.status(400).json({ error: "invalid_move", message: err.message });
      }
      throw err;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
