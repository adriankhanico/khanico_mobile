import type { CountLine, CountLocation, SetCountRequest } from "@khanico/shared";
import type { OdooClient } from "./client.js";

/**
 * Counts follow Odoo's own Physical Inventory flow: a manager assigns quants to a
 * user with "Request a Count" (sets user_id + inventory_date), the user enters a
 * counted quantity here, and the manager reviews and applies it in Odoo. This app
 * never applies counts itself, so stock only changes once a manager clicks Apply.
 *
 * Odoo only allows counted quantities to be written on stock.quant in "inventory
 * mode" — the same context its Physical Inventory screen uses.
 */
const INVENTORY_MODE = { context: { inventory_mode: true } };

const QUANT_FIELDS = [
  "id",
  "product_id",
  "location_id",
  "lot_id",
  "user_id",
  "inventory_date",
  "inventory_quantity",
  "inventory_quantity_set",
];

export class InvalidCountError extends Error {}

async function toCountLines(client: OdooClient, quants: any[]): Promise<CountLine[]> {
  const productIds = [...new Set(quants.map((q) => q.product_id[0]))];
  const productById = new Map<number, any>();
  if (productIds.length > 0) {
    const products = await client.searchRead(
      "product.product",
      [["id", "in", productIds]],
      ["id", "default_code", "barcode", "x_studio_sl"]
    );
    for (const product of products) {
      productById.set(product.id, product);
    }
  }

  return quants.map((q) => {
    const product = productById.get(q.product_id[0]);
    return {
      quantId: q.id,
      locationId: q.location_id[0],
      locationName: q.location_id[1],
      productId: q.product_id[0],
      productName: q.product_id[1],
      productCode: product?.default_code || null,
      productBarcode: product?.barcode || null,
      productSl: product?.x_studio_sl || null,
      lotName: q.lot_id ? q.lot_id[1] : null,
      scheduledDate: q.inventory_date || null,
      countedQty: q.inventory_quantity_set ? q.inventory_quantity : null,
    };
  });
}

function myCountsDomain(client: OdooClient): unknown[] {
  return [
    ["user_id", "=", client.uid],
    ["location_id.usage", "=", "internal"],
  ];
}

export async function getMyCounts(client: OdooClient): Promise<CountLine[]> {
  const quants = await client.searchRead("stock.quant", myCountsDomain(client), QUANT_FIELDS, {
    order: "location_id, inventory_date, id",
  });
  return toCountLines(client, quants);
}

export async function countMyCountsToDo(client: OdooClient): Promise<number> {
  return client.searchCount("stock.quant", [
    ...myCountsDomain(client),
    ["inventory_quantity_set", "=", false],
  ]);
}

export async function getCountLocation(client: OdooClient, locationId: number): Promise<CountLocation | null> {
  const locations = await client.searchRead(
    "stock.location",
    [
      ["id", "=", locationId],
      ["usage", "=", "internal"],
    ],
    ["id", "complete_name", "barcode"]
  );
  if (locations.length === 0) return null;

  const quants = await client.searchRead(
    "stock.quant",
    [...myCountsDomain(client), ["location_id", "=", locationId]],
    QUANT_FIELDS,
    { order: "inventory_date, id" }
  );
  return {
    location: { id: locations[0].id, name: locations[0].complete_name, barcode: locations[0].barcode || null },
    lines: await toCountLines(client, quants),
  };
}

/**
 * Records a counted quantity, like typing it into Odoo's Counted Quantity column.
 * With a quantId it counts that assigned line; without one it counts a product that
 * isn't on the list, reusing its quant in that location or creating one. Lines with
 * no assignee are assigned to the counter so they show up in their list; lines
 * assigned to someone else keep their assignee.
 */
export async function setCount(client: OdooClient, request: SetCountRequest): Promise<CountLine> {
  const { locationId, productId, quantId, countedQty } = request;
  if (!Number.isFinite(countedQty) || countedQty < 0) {
    throw new InvalidCountError("Counted quantity must be zero or more");
  }

  let quant: any;
  if (quantId !== undefined) {
    const rows = await client.searchRead("stock.quant", [["id", "=", quantId]], QUANT_FIELDS);
    quant = rows[0];
    if (!quant || quant.location_id[0] !== locationId || quant.product_id[0] !== productId) {
      throw new InvalidCountError("This count line no longer matches that product and location — refresh and try again");
    }
  } else {
    const products = await client.searchRead("product.product", [["id", "=", productId]], ["tracking", "name"]);
    if (products.length === 0) {
      throw new InvalidCountError("Product not found");
    }
    if (products[0].tracking !== "none") {
      throw new InvalidCountError(
        `"${products[0].name}" is tracked by lot/serial number — count it in Odoo, or ask for a count to be assigned`
      );
    }
    const locationCount = await client.searchCount("stock.location", [
      ["id", "=", locationId],
      ["usage", "=", "internal"],
    ]);
    if (locationCount === 0) {
      throw new InvalidCountError("Location not found");
    }

    const rows = await client.searchRead(
      "stock.quant",
      [
        ["product_id", "=", productId],
        ["location_id", "=", locationId],
        ["lot_id", "=", false],
        ["package_id", "=", false],
        ["owner_id", "=", false],
      ],
      QUANT_FIELDS,
      { limit: 1 }
    );
    quant = rows[0];
    if (!quant) {
      const newQuantId = await client.executeKw<number | number[]>(
        "stock.quant",
        "create",
        [{ product_id: productId, location_id: locationId, inventory_quantity: countedQty }],
        INVENTORY_MODE
      );
      const createdId = Array.isArray(newQuantId) ? newQuantId[0] : newQuantId;
      quant = (await client.searchRead("stock.quant", [["id", "=", createdId]], QUANT_FIELDS))[0];
    }
  }

  const values: Record<string, unknown> = { inventory_quantity: countedQty, inventory_quantity_set: true };
  if (!quant.user_id) values.user_id = client.uid;
  await client.executeKw("stock.quant", "write", [[quant.id], values], INVENTORY_MODE);

  const updated = await client.searchRead("stock.quant", [["id", "=", quant.id]], QUANT_FIELDS);
  return (await toCountLines(client, updated))[0];
}
