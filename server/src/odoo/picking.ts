import type {
  BackorderDecisionResult,
  Picking,
  PickingLine,
  PickingStatusFilter,
  PickingTypeGroup,
  PickingTypeSettings,
  ValidatePickingResult,
} from "@khanico/shared";
import type { OdooClient } from "./client.js";

const STATUS_FILTER_STATES: Record<Exclude<PickingStatusFilter, "all">, string[]> = {
  pending: ["assigned", "confirmed", "waiting"],
  done: ["done"],
};

/**
 * stock.picking.type's display name is Odoo's default "{company}: {type name}"
 * many2one label (e.g. "Khanico Limited: Delivery Orders"). The company prefix
 * isn't useful here, so only the part after the last ": " is shown.
 */
function stripCompanyPrefix(displayName: string): string {
  const separatorIndex = displayName.lastIndexOf(": ");
  return separatorIndex === -1 ? displayName : displayName.slice(separatorIndex + 2);
}

interface AllowedScope {
  pickingTypeIds: number[] | null;
  warehouseIds: number[] | null;
}

/**
 * res.users.allowed_picking_type_ids/allowed_warehouse_ids restrict which
 * operation types and warehouses a user should see, but Odoo's own record rules only
 * enforce this on stock.picking.type itself, not on stock.picking — so it must be
 * applied explicitly here on every picking query.
 */
async function getAllowedScope(client: OdooClient): Promise<AllowedScope> {
  const rows = await client.searchRead(
    "res.users",
    [["id", "=", client.uid]],
    ["allowed_picking_type_ids", "allowed_warehouse_ids"]
  );
  const user = rows[0];
  return {
    pickingTypeIds: user?.allowed_picking_type_ids?.length ? user.allowed_picking_type_ids : null,
    warehouseIds: user?.allowed_warehouse_ids?.length ? user.allowed_warehouse_ids : null,
  };
}

function applyScopeToDomain(domain: unknown[], scope: AllowedScope): unknown[] {
  const scoped = [...domain];
  if (scope.pickingTypeIds) {
    scoped.push(["picking_type_id", "in", scope.pickingTypeIds]);
  }
  if (scope.warehouseIds) {
    scoped.push(["picking_type_id.warehouse_id", "in", scope.warehouseIds]);
  }
  return scoped;
}

/**
 * The "Pick" step of a Pick/Pack/Ship warehouse flow (Odoo sequence_code "PICK") should
 * only ever show transfers that are actually Ready (stock reserved) — Confirmed/Waiting
 * pickings in that step aren't actionable yet, unlike other operation types where staff
 * may want to see upcoming work ahead of reservation.
 */
async function isPickOperationType(client: OdooClient, pickingTypeId: number): Promise<boolean> {
  const rows = await client.searchRead(
    "stock.picking.type",
    [["id", "=", pickingTypeId]],
    ["sequence_code"]
  );
  return rows[0]?.sequence_code === "PICK";
}

export async function listOpenPickings(
  client: OdooClient,
  pickingTypeId?: number,
  query?: string,
  status: PickingStatusFilter = "pending"
): Promise<Picking[]> {
  const domain: unknown[] = [];
  if (status !== "all") {
    const states =
      status === "pending" && pickingTypeId && (await isPickOperationType(client, pickingTypeId))
        ? ["assigned"]
        : STATUS_FILTER_STATES[status];
    domain.push(["state", "in", states]);
  }
  if (pickingTypeId) {
    domain.push(["picking_type_id", "=", pickingTypeId]);
  }

  const trimmed = query?.trim();
  if (trimmed) {
    domain.push(
      "|",
      "|",
      ["name", "ilike", trimmed],
      ["origin", "ilike", trimmed],
      ["partner_id.name", "ilike", trimmed]
    );
  }

  const scope = await getAllowedScope(client);
  const rows = await client.searchRead(
    "stock.picking",
    applyScopeToDomain(domain, scope),
    ["id", "name", "picking_type_id", "state", "origin", "partner_id", "date_done"],
    { limit: 200, order: "id desc" }
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    pickingTypeId: row.picking_type_id[0],
    pickingTypeName: stripCompanyPrefix(row.picking_type_id[1]),
    state: row.state,
    origin: row.origin || null,
    partnerName: row.partner_id ? row.partner_id[1] : null,
    dateDone: row.date_done || null,
  }));
}

export async function listOpenPickingsGrouped(
  client: OdooClient,
  query?: string
): Promise<PickingTypeGroup[]> {
  const pickings = await listOpenPickings(client, undefined, query);
  const groups = new Map<number, PickingTypeGroup>();

  for (const picking of pickings) {
    let group = groups.get(picking.pickingTypeId);
    if (!group) {
      group = {
        pickingTypeId: picking.pickingTypeId,
        pickingTypeName: picking.pickingTypeName,
        pickings: [],
      };
      groups.set(picking.pickingTypeId, group);
    }
    group.pickings.push(picking);
  }

  // listOpenPickings() above fetches all types in one query (no pickingTypeId), so its
  // per-type Pick narrowing never applies — filter the Pick group down to Ready here.
  for (const group of groups.values()) {
    if (await isPickOperationType(client, group.pickingTypeId)) {
      group.pickings = group.pickings.filter((p) => p.state === "assigned");
    }
  }

  return Array.from(groups.values()).sort((a, b) => a.pickingTypeName.localeCompare(b.pickingTypeName));
}

export async function getPicking(client: OdooClient, pickingId: number): Promise<Picking | null> {
  const scope = await getAllowedScope(client);
  const rows = await client.searchRead(
    "stock.picking",
    applyScopeToDomain([["id", "=", pickingId]], scope),
    ["id", "name", "picking_type_id", "state", "origin", "partner_id", "date_done"]
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    name: row.name,
    pickingTypeId: row.picking_type_id[0],
    pickingTypeName: stripCompanyPrefix(row.picking_type_id[1]),
    state: row.state,
    origin: row.origin || null,
    partnerName: row.partner_id ? row.partner_id[1] : null,
    dateDone: row.date_done || null,
  };
}

export async function getPickingTypeSettings(
  client: OdooClient,
  pickingTypeId: number
): Promise<PickingTypeSettings> {
  const result = await client.executeKw<any>("stock.picking.type", "get_warehouse_operation_settings", [
    [pickingTypeId],
  ]);
  return {
    id: result.id,
    name: result.name,
    whCode: result.wh_code,
    whName: result.wh_name,
    settings: result.settings,
  };
}

export async function getPickingLines(client: OdooClient, pickingId: number): Promise<PickingLine[]> {
  const rows = await client.executeKw<any[]>(
    "stock.move.line",
    "search_read",
    [[["picking_id", "=", pickingId]]],
    {
      fields: [
        "id",
        "product_id",
        "quantity",
        "picked",
        "lot_id",
        "location_id",
        "location_dest_id",
        "x_studio_desc_on_order",
        "move_id",
      ],
    }
  );

  const moveIds = [...new Set(rows.map((row) => row.move_id[0]))];
  const demandByMoveId = new Map<number, number>();
  if (moveIds.length > 0) {
    const moveRows = await client.searchRead("stock.move", [["id", "in", moveIds]], ["id", "product_uom_qty"]);
    for (const row of moveRows) {
      demandByMoveId.set(row.id, row.product_uom_qty);
    }
  }

  const productIds = [...new Set(rows.map((row) => row.product_id[0]))];
  const slByProductId = new Map<number, string | null>();
  if (productIds.length > 0) {
    const productRows = await client.searchRead(
      "product.product",
      [["id", "in", productIds]],
      ["id", "x_studio_sl"]
    );
    for (const row of productRows) {
      slByProductId.set(row.id, row.x_studio_sl || null);
    }
  }

  return rows.map((row) => ({
    id: row.id,
    productId: row.product_id[0],
    productName: row.product_id[1],
    productDescription: row.x_studio_desc_on_order || null,
    productBarcode: null,
    productSl: slByProductId.get(row.product_id[0]) ?? null,
    requestedQty: demandByMoveId.get(row.move_id[0]) ?? row.quantity,
    quantity: row.quantity,
    picked: row.picked,
    lotId: row.lot_id ? row.lot_id[0] : null,
    locationId: row.location_id[0],
    locationName: row.location_id[1],
    locationDestId: row.location_dest_id[0],
    locationDestName: row.location_dest_id[1],
  }));
}

export async function findMoveLineByBarcode(
  client: OdooClient,
  pickingId: number,
  barcode: string
): Promise<PickingLine | null> {
  const products = await client.searchRead("product.product", [["barcode", "=", barcode]], ["id"], {
    limit: 1,
  });
  if (products.length === 0) return null;

  const lines = await getPickingLines(client, pickingId);
  return lines.find((line) => line.productId === products[0].id && !line.picked) ?? null;
}

export class OverRequestedQtyError extends Error {
  constructor(public requestedQty: number) {
    super(`Quantity cannot exceed the requested amount (${requestedQty}).`);
  }
}

/** Looks up the "Demand" (stock.move.product_uom_qty) for a single move line, the same value getPickingLines() exposes as requestedQty. */
async function getRequestedQtyForLine(client: OdooClient, lineId: number): Promise<number> {
  const lineRows = await client.searchRead("stock.move.line", [["id", "=", lineId]], ["move_id", "quantity"]);
  if (lineRows.length === 0) {
    throw new Error("Move line not found");
  }
  const moveId = lineRows[0].move_id[0];
  const moveRows = await client.searchRead("stock.move", [["id", "=", moveId]], ["product_uom_qty"]);
  return moveRows[0]?.product_uom_qty ?? lineRows[0].quantity;
}

async function assertWithinRequestedQty(client: OdooClient, lineId: number, quantity: number): Promise<void> {
  const requestedQty = await getRequestedQtyForLine(client, lineId);
  if (quantity > requestedQty) {
    throw new OverRequestedQtyError(requestedQty);
  }
}

export async function updateMoveLineQuantity(
  client: OdooClient,
  lineId: number,
  quantity: number
): Promise<void> {
  await assertWithinRequestedQty(client, lineId, quantity);
  await client.executeKw("stock.move.line", "write", [[lineId], { quantity }]);
}

export async function confirmMoveLine(
  client: OdooClient,
  lineId: number,
  quantity: number,
  lotId?: number
): Promise<void> {
  await assertWithinRequestedQty(client, lineId, quantity);
  const values: Record<string, unknown> = { quantity, picked: true };
  if (lotId) {
    values.lot_id = lotId;
  }
  await client.executeKw("stock.move.line", "write", [[lineId], values]);
}

export async function setMoveLinePicked(
  client: OdooClient,
  lineId: number,
  picked: boolean
): Promise<void> {
  await client.executeKw("stock.move.line", "write", [[lineId], { picked }]);
}

interface BackorderWizardAction {
  res_model: string;
  context?: { default_pick_ids?: unknown; default_show_transfers?: boolean };
}

function isBackorderWizardAction(value: unknown): value is BackorderWizardAction {
  return (
    typeof value === "object" &&
    value !== null &&
    "res_model" in value &&
    (value as any).res_model === "stock.backorder.confirmation"
  );
}

export async function validatePicking(
  client: OdooClient,
  pickingId: number
): Promise<ValidatePickingResult> {
  const result = await client.executeKw<unknown>("stock.picking", "button_validate", [[pickingId]]);
  if (result === true) {
    return { validated: true, backorder: null };
  }

  if (isBackorderWizardAction(result)) {
    const wizardId = await client.executeKw<number>("stock.backorder.confirmation", "create", [
      {
        pick_ids: [[4, pickingId]],
        show_transfers: result.context?.default_show_transfers ?? false,
      },
    ]);
    return { validated: false, backorder: { wizardId } };
  }

  throw new Error("Unexpected response from button_validate");
}

export async function resolveBackorder(
  client: OdooClient,
  pickingId: number,
  wizardId: number,
  createBackorder: boolean
): Promise<BackorderDecisionResult> {
  const method = createBackorder ? "process" : "process_cancel_backorder";
  await client.executeKw("stock.backorder.confirmation", method, [[wizardId]], {
    context: {
      button_validate_picking_ids: [pickingId],
      default_show_transfers: false,
      default_pick_ids: [[4, pickingId]],
    },
  });

  const wizardRows = await client
    .executeKw<any[]>("stock.backorder.confirmation", "read", [[wizardId]], { fields: ["pick_ids"] })
    .catch(() => []);

  const pickIds: number[] = wizardRows[0]?.pick_ids ?? [];
  let backorderName: string | null = null;
  if (createBackorder && pickIds.length > 0) {
    const backorders = await client.searchRead(
      "stock.picking",
      [["backorder_id", "in", pickIds]],
      ["id", "name"]
    );
    backorderName = backorders[0]?.name ?? null;
  }

  return { validated: true, backorderName };
}
