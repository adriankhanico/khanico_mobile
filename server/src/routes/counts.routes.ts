import { Router } from "express";
import type { SetCountRequest } from "@khanico/shared";
import { createOdooClientForUser } from "../odoo/client.js";
import { getCountLocation, getMyCounts, InvalidCountError, setCount } from "../odoo/counts.js";

export const countsRouter = Router();

countsRouter.get("/", async (req, res, next) => {
  try {
    const client = createOdooClientForUser(req.odoo!);
    res.json(await getMyCounts(client));
  } catch (err) {
    next(err);
  }
});

countsRouter.get("/location/:locationId", async (req, res, next) => {
  try {
    const client = createOdooClientForUser(req.odoo!);
    const locationId = Number(req.params.locationId);
    if (!Number.isInteger(locationId)) {
      return res.status(400).json({ error: "bad_request", message: "locationId must be an integer" });
    }
    const countLocation = await getCountLocation(client, locationId);
    if (!countLocation) {
      return res.status(404).json({ error: "not_found", message: "Location not found" });
    }
    res.json(countLocation);
  } catch (err) {
    next(err);
  }
});

countsRouter.post("/", async (req, res, next) => {
  try {
    const client = createOdooClientForUser(req.odoo!);
    const { locationId, productId, quantId, countedQty } = req.body as SetCountRequest;
    if (
      !Number.isInteger(locationId) ||
      !Number.isInteger(productId) ||
      (quantId !== undefined && !Number.isInteger(quantId)) ||
      typeof countedQty !== "number"
    ) {
      return res.status(400).json({
        error: "bad_request",
        message: "locationId, productId (and quantId, if given) must be integers and countedQty must be a number",
      });
    }
    try {
      const line = await setCount(client, { locationId, productId, quantId, countedQty });
      res.json(line);
    } catch (err) {
      if (err instanceof InvalidCountError) {
        return res.status(400).json({ error: "invalid_count", message: err.message });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});
