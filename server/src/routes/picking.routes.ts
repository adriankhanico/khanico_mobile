import { Router } from "express";
import type { PickingStatusFilter, ScanRequest } from "@ventor/shared";
import { createOdooClientForUser } from "../odoo/client.js";
import {
  confirmMoveLine,
  findMoveLineByBarcode,
  getPicking,
  getPickingLines,
  getPickingTypeSettings,
  listOpenPickings,
  listOpenPickingsGrouped,
  OverRequestedQtyError,
  resolveBackorder,
  setMoveLinePicked,
  updateMoveLineQuantity,
  validatePicking,
} from "../odoo/picking.js";

export const pickingRouter = Router();

// Blocks access to a picking whose type/warehouse falls outside the logged-in user's
// Ventor allowed_picking_type_ids/allowed_warehouse_ids, closing a gap where Odoo's own
// record rules restrict stock.picking.type reads but not stock.picking itself.
pickingRouter.param("id", async (req, res, next, idParam) => {
  const pickingId = Number(idParam);
  if (!Number.isInteger(pickingId)) {
    return res.status(400).json({ error: "bad_request", message: "id must be an integer" });
  }
  try {
    const client = createOdooClientForUser(req.odoo!);
    const picking = await getPicking(client, pickingId);
    if (!picking) {
      return res.status(404).json({ error: "not_found", message: "Picking not found" });
    }
    next();
  } catch (err) {
    next(err);
  }
});

pickingRouter.get("/", async (req, res, next) => {
  try {
    const client = createOdooClientForUser(req.odoo!);
    const pickingTypeId = req.query.picking_type_id ? Number(req.query.picking_type_id) : undefined;
    const query = req.query.q ? String(req.query.q) : undefined;
    const status = (req.query.status as PickingStatusFilter | undefined) ?? "pending";
    const pickings = await listOpenPickings(client, pickingTypeId, query, status);
    res.json(pickings);
  } catch (err) {
    next(err);
  }
});

pickingRouter.get("/grouped", async (req, res, next) => {
  try {
    const client = createOdooClientForUser(req.odoo!);
    const query = req.query.q ? String(req.query.q) : undefined;
    const groups = await listOpenPickingsGrouped(client, query);
    res.json(groups);
  } catch (err) {
    next(err);
  }
});

pickingRouter.get("/:id/lines", async (req, res, next) => {
  try {
    const client = createOdooClientForUser(req.odoo!);
    const pickingId = Number(req.params.id);
    if (!Number.isInteger(pickingId)) {
      return res.status(400).json({ error: "bad_request", message: "id must be an integer" });
    }
    const lines = await getPickingLines(client, pickingId);
    res.json(lines);
  } catch (err) {
    next(err);
  }
});

pickingRouter.get("/:id/settings", async (req, res, next) => {
  try {
    const client = createOdooClientForUser(req.odoo!);
    const pickingId = Number(req.params.id);
    const picking = await getPicking(client, pickingId);
    if (!picking) {
      return res.status(404).json({ error: "not_found", message: "Picking not found" });
    }
    const settings = await getPickingTypeSettings(client, picking.pickingTypeId);
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

pickingRouter.post("/:id/scan", async (req, res, next) => {
  try {
    const client = createOdooClientForUser(req.odoo!);
    const pickingId = Number(req.params.id);
    const { barcode, qty } = req.body as ScanRequest;
    if (!barcode) {
      return res.status(400).json({ error: "bad_request", message: "barcode is required" });
    }

    const line = await findMoveLineByBarcode(client, pickingId, barcode);
    if (!line) {
      return res.status(404).json({ error: "not_found", message: "No matching unpicked line for this barcode" });
    }

    try {
      await confirmMoveLine(client, line.id, qty ?? line.quantity);
    } catch (err) {
      if (err instanceof OverRequestedQtyError) {
        return res.status(400).json({ error: "over_requested_qty", message: err.message });
      }
      throw err;
    }
    res.json({ lineId: line.id, confirmed: true });
  } catch (err) {
    next(err);
  }
});

pickingRouter.post("/:id/lines/:lineId/quantity", async (req, res, next) => {
  try {
    const client = createOdooClientForUser(req.odoo!);
    const lineId = Number(req.params.lineId);
    const { quantity } = req.body as { quantity: number };
    if (!Number.isInteger(lineId) || typeof quantity !== "number" || quantity < 0) {
      return res
        .status(400)
        .json({ error: "bad_request", message: "lineId must be an integer and quantity must be a non-negative number" });
    }
    try {
      await updateMoveLineQuantity(client, lineId, quantity);
    } catch (err) {
      if (err instanceof OverRequestedQtyError) {
        return res.status(400).json({ error: "over_requested_qty", message: err.message });
      }
      throw err;
    }
    res.json({ lineId, quantity });
  } catch (err) {
    next(err);
  }
});

pickingRouter.post("/:id/lines/:lineId/picked", async (req, res, next) => {
  try {
    const client = createOdooClientForUser(req.odoo!);
    const lineId = Number(req.params.lineId);
    const { picked } = req.body as { picked: boolean };
    if (!Number.isInteger(lineId) || typeof picked !== "boolean") {
      return res
        .status(400)
        .json({ error: "bad_request", message: "lineId must be an integer and picked must be a boolean" });
    }
    await setMoveLinePicked(client, lineId, picked);
    res.json({ lineId, picked });
  } catch (err) {
    next(err);
  }
});

pickingRouter.post("/:id/validate", async (req, res, next) => {
  try {
    const client = createOdooClientForUser(req.odoo!);
    const pickingId = Number(req.params.id);
    const result = await validatePicking(client, pickingId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

pickingRouter.post("/:id/backorder/:wizardId", async (req, res, next) => {
  try {
    const client = createOdooClientForUser(req.odoo!);
    const pickingId = Number(req.params.id);
    const wizardId = Number(req.params.wizardId);
    const { createBackorder } = req.body as { createBackorder: boolean };
    if (!Number.isInteger(pickingId) || !Number.isInteger(wizardId) || typeof createBackorder !== "boolean") {
      return res.status(400).json({
        error: "bad_request",
        message: "picking id and wizardId must be integers and createBackorder must be a boolean",
      });
    }
    const result = await resolveBackorder(client, pickingId, wizardId, createBackorder);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
