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
  ready: ["assigned"],
  waiting: ["confirmed", "waiting"],
  done: ["done"],
};

/**
 * stock.picking.type's display name is Odoo's default "{company}: {type name}"
 * many2one label (e.g. "Khanico Limited: Delivery Orders"). The company prefix
 * isn't useful here, so only the part after the last ": " is shown.
 */
export function stripCompanyPrefix(displayName: string): string {
  const separatorIndex = displayName.lastIndexOf(": ");
  return separatorIndex === -1 ? displayName : displayName.slice(separatorIndex + 2);
}

export const PICKING_FIELDS = [
  "id",
  "name",
  "picking_type_id",
  "state",
  "origin",
  "partner_id",
  "scheduled_date",
  "date_done",
  "location_id",
  "location_dest_id",
];

export function toPicking(row: any): Picking {
  return {
    id: row.id,
    name: row.name,
    pickingTypeId: row.picking_type_id[0],
    pickingTypeName: stripCompanyPrefix(row.picking_type_id[1]),
    state: row.state,
    origin: row.origin || null,
    partnerName: row.partner_id ? row.partner_id[1] : null,
    scheduledDate: row.scheduled_date || null,
    dateDone: row.date_done || null,
    locationName: row.location_id ? row.location_id[1] : null,
    locationDestName: row.location_dest_id ? row.location_dest_id[1] : null,
  };
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
    PICKING_FIELDS,
    { limit: 200, order: "id desc" }
  );

  return rows.map(toPicking);
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
        readyCount: 0,
        waitingCount: 0,
        lateCount: 0,
      };
      groups.set(picking.pickingTypeId, group);
    }
    group.pickings.push(picking);
  }

  // Counted like Odoo's Inventory Overview cards: "To Process" (ready), Waiting, and Late.
  // Groups keep their waiting transfers (even for the Pick step), so the list's Waiting tab can show them.
  const now = Date.now();
  for (const group of groups.values()) {
    for (const picking of group.pickings) {
      if (picking.state === "assigned") group.readyCount++;
      else group.waitingCount++;
      if (picking.scheduledDate && new Date(`${picking.scheduledDate.replace(" ", "T")}Z`).getTime() < now) {
        group.lateCount++;
      }
    }
  }

  return Array.from(groups.values()).sort((a, b) => a.pickingTypeName.localeCompare(b.pickingTypeName));
}

export async function getPicking(client: OdooClient, pickingId: number): Promise<Picking | null> {
  const scope = await getAllowedScope(client);
  const rows = await client.searchRead(
    "stock.picking",
    applyScopeToDomain([["id", "=", pickingId]], scope),
    PICKING_FIELDS
  );
  if (rows.length === 0) return null;
  return toPicking(rows[0]);
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

const CHAIN_MOVE_FIELDS = ["id", "product_id", "description_picking", "purchase_line_id", "move_orig_ids"];
/** How many steps back (e.g. Putaway ← Quarantine ← Receipt) to look for the purchase order line. */
const MAX_CHAIN_DEPTH = 4;

/**
 * Drops the product's own name from a description: Odoo often starts description_picking and
 * PO line names with "[CODE] Name", which the line already shows. Null if nothing else is left.
 */
function stripProductName(description: string | false | null, productDisplayName: string): string | null {
  if (!description) return null;
  const plainName = productDisplayName.replace(/^\[[^\]]*\]\s*/, "");
  const lines = description.split("\n");
  while (lines.length > 0 && [productDisplayName, plainName, ""].includes(lines[0].trim())) lines.shift();
  const rest = lines.join("\n").trim();
  return rest || null;
}

/**
 * For each move whose goods came from a purchase order — directly (a receipt) or further back in
 * its chain of origin moves (e.g. a Quarantine → Stock transfer after the receipt) — finds the most
 * useful description: the first one along the chain that says more than the product name, falling
 * back to the PO line's own description. Moves with no purchase order behind them are left out.
 */
async function getPurchaseDescriptions(client: OdooClient, startMoves: any[]): Promise<Map<number, string | null>> {
  interface Trace {
    productName: string;
    description: string | null;
    purchaseLineId: number | null;
    frontier: number[];
  }
  const traces = new Map<number, Trace>();
  for (const move of startMoves) {
    traces.set(move.id, {
      productName: move.product_id[1],
      description: stripProductName(move.description_picking, move.product_id[1]),
      purchaseLineId: move.purchase_line_id ? move.purchase_line_id[0] : null,
      frontier: move.move_orig_ids,
    });
  }

  for (let depth = 0; depth < MAX_CHAIN_DEPTH; depth++) {
    const open = [...traces.values()].filter((t) => t.purchaseLineId === null && t.frontier.length > 0);
    if (open.length === 0) break;
    const originIds = [...new Set(open.flatMap((t) => t.frontier))];
    const origins = new Map<number, any>();
    for (const row of await client.searchRead("stock.move", [["id", "in", originIds]], CHAIN_MOVE_FIELDS)) {
      origins.set(row.id, row);
    }
    for (const trace of open) {
      const moves = trace.frontier.map((id) => origins.get(id)).filter(Boolean);
      for (const move of moves) {
        trace.description ??= stripProductName(move.description_picking, trace.productName);
        if (move.purchase_line_id && trace.purchaseLineId === null) trace.purchaseLineId = move.purchase_line_id[0];
      }
      trace.frontier = [...new Set(moves.flatMap((move) => move.move_orig_ids as number[]))];
    }
  }

  const missing = [...traces.values()].filter((t) => t.purchaseLineId !== null && t.description === null);
  const lineNames = new Map<number, string>();
  if (missing.length > 0) {
    const lineIds = [...new Set(missing.map((t) => t.purchaseLineId!))];
    for (const row of await client.searchRead("purchase.order.line", [["id", "in", lineIds]], ["id", "name"])) {
      lineNames.set(row.id, row.name);
    }
  }

  const result = new Map<number, string | null>();
  for (const [moveId, trace] of traces) {
    if (trace.purchaseLineId === null) continue;
    result.set(
      moveId,
      trace.description ?? stripProductName(lineNames.get(trace.purchaseLineId) ?? null, trace.productName)
    );
  }
  return result;
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
  const pickingDescriptionByMoveId = new Map<number, string | null>();
  let purchaseDescriptionByMoveId = new Map<number, string | null>();
  if (moveIds.length > 0) {
    const moveRows = await client.searchRead("stock.move", [["id", "in", moveIds]], [
      "id",
      "product_uom_qty",
      ...CHAIN_MOVE_FIELDS,
    ]);
    for (const row of moveRows) {
      demandByMoveId.set(row.id, row.product_uom_qty);
      pickingDescriptionByMoveId.set(row.id, row.description_picking || null);
    }
    purchaseDescriptionByMoveId = await getPurchaseDescriptions(client, moveRows);
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
    pickingDescription: pickingDescriptionByMoveId.get(row.move_id[0]) ?? null,
    purchaseDescription: purchaseDescriptionByMoveId.get(row.move_id[0]) ?? null,
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

/**
 * A transfer's demand (stock.move), for transfers that aren't Ready yet. Odoo only creates the
 * stock.move.line rows getPickingLines reads once stock is reserved, so Waiting transfers have
 * none — but their moves already say what's coming. Lines here are keyed by move id and are for
 * display only: nothing can be scanned or picked against them.
 */
export async function getPickingDemandLines(client: OdooClient, pickingId: number): Promise<PickingLine[]> {
  // The Studio description lives on stock.move.line; only read it from stock.move if it exists there too.
  const descFields = await client.executeKw<Record<string, unknown>>(
    "stock.move",
    "fields_get",
    [["x_studio_desc_on_order"]],
    { attributes: ["type"] }
  );
  const hasDescOnOrder = "x_studio_desc_on_order" in descFields;

  const moves = await client.searchRead(
    "stock.move",
    [
      ["picking_id", "=", pickingId],
      ["state", "!=", "cancel"],
    ],
    [
      "product_uom_qty",
      "quantity",
      "location_id",
      "location_dest_id",
      ...CHAIN_MOVE_FIELDS,
      ...(hasDescOnOrder ? ["x_studio_desc_on_order"] : []),
    ],
    { order: "sequence, id" }
  );
  if (moves.length === 0) return [];

  const purchaseDescriptionByMoveId = await getPurchaseDescriptions(client, moves);

  const productIds = [...new Set(moves.map((move) => move.product_id[0]))];
  const slByProductId = new Map<number, string | null>();
  const productRows = await client.searchRead("product.product", [["id", "in", productIds]], ["id", "x_studio_sl"]);
  for (const row of productRows) {
    slByProductId.set(row.id, row.x_studio_sl || null);
  }

  return moves.map((move) => ({
    id: move.id,
    productId: move.product_id[0],
    productName: move.product_id[1],
    productDescription: (hasDescOnOrder && move.x_studio_desc_on_order) || null,
    productBarcode: null,
    productSl: slByProductId.get(move.product_id[0]) ?? null,
    pickingDescription: move.description_picking || null,
    purchaseDescription: purchaseDescriptionByMoveId.get(move.id) ?? null,
    requestedQty: move.product_uom_qty,
    quantity: move.quantity,
    picked: false,
    lotId: null,
    locationId: move.location_id[0],
    locationName: move.location_id[1],
    locationDestId: move.location_dest_id[0],
    locationDestName: move.location_dest_id[1],
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
