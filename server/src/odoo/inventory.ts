import type { LocationOption, MoveStockRequest, Product, ProductDetail, StockLocationQty } from "@ventor/shared";
import type { OdooClient } from "./client.js";

/** Resolves the warehouse's "Internal Transfers" operation type (Odoo sequence_code "INT"). */
async function getInternalTransferPickingTypeId(client: OdooClient): Promise<number> {
  const rows = await client.searchRead(
    "stock.picking.type",
    [["sequence_code", "=", "INT"]],
    ["id"],
    { limit: 1 }
  );
  if (rows.length === 0) {
    throw new Error("No Internal Transfers operation type configured in Odoo");
  }
  return rows[0].id;
}

const PRODUCT_FIELDS = [
  "id",
  "name",
  "default_code",
  "barcode",
  "x_studio_sl",
  "list_price",
  "qty_available",
  "taxes_id",
];
const PRODUCT_DETAIL_FIELDS = [...PRODUCT_FIELDS, "description_sale"];

async function computeVatRates(client: OdooClient, rows: any[]): Promise<Map<number, number>> {
  const taxIds = [...new Set(rows.flatMap((row) => row.taxes_id as number[]))];
  const rateByTaxId = new Map<number, number>();
  if (taxIds.length > 0) {
    const taxes = await client.searchRead(
      "account.tax",
      [["id", "in", taxIds]],
      ["id", "amount", "amount_type", "price_include"]
    );
    for (const tax of taxes) {
      if (tax.amount_type === "percent" && !tax.price_include) {
        rateByTaxId.set(tax.id, tax.amount / 100);
      }
    }
  }

  const rateByProductId = new Map<number, number>();
  for (const row of rows) {
    const totalRate = (row.taxes_id as number[]).reduce(
      (sum, taxId) => sum + (rateByTaxId.get(taxId) ?? 0),
      0
    );
    rateByProductId.set(row.id, totalRate);
  }
  return rateByProductId;
}

function toProduct(raw: any, vatRate: number): Product {
  return {
    id: raw.id,
    name: raw.name,
    defaultCode: raw.default_code || null,
    barcode: raw.barcode || null,
    sl: raw.x_studio_sl || null,
    listPrice: raw.list_price,
    priceWithVat: raw.list_price * (1 + vatRate),
    qtyAvailable: raw.qty_available,
  };
}

export async function searchProducts(client: OdooClient, query: string, limit = 25): Promise<Product[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const domain = [
    "|",
    "|",
    "|",
    ["default_code", "ilike", trimmed],
    ["barcode", "=", trimmed],
    ["x_studio_sl", "=", trimmed],
    ["name", "ilike", trimmed],
  ];

  const rows = await client.searchRead("product.product", domain, PRODUCT_FIELDS, { limit });
  const vatRates = await computeVatRates(client, rows);
  return rows.map((row) => toProduct(row, vatRates.get(row.id) ?? 0));
}

export async function getProductDetail(
  client: OdooClient,
  productId: number
): Promise<ProductDetail | null> {
  const rows = await client.searchRead(
    "product.product",
    [["id", "=", productId]],
    PRODUCT_DETAIL_FIELDS
  );
  if (rows.length === 0) return null;

  const vatRates = await computeVatRates(client, rows);
  const locations = await getProductLocations(client, productId);
  return {
    ...toProduct(rows[0], vatRates.get(rows[0].id) ?? 0),
    description: rows[0].description_sale || null,
    locations,
  };
}

export async function getProductLocations(
  client: OdooClient,
  productId: number
): Promise<StockLocationQty[]> {
  const rows = await client.executeKw<any[]>(
    "stock.quant",
    "search_read",
    [
      [
        ["product_id", "=", productId],
        ["location_id.usage", "=", "internal"],
        ["quantity", ">", 0],
      ],
    ],
    { fields: ["location_id", "quantity"] }
  );

  return rows.map((row) => ({
    locationId: row.location_id[0],
    locationName: row.location_id[1],
    quantity: row.quantity,
  }));
}

export async function searchLocations(
  client: OdooClient,
  query: string,
  limit = 20
): Promise<LocationOption[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const rows = await client.searchRead(
    "stock.location",
    [
      ["usage", "=", "internal"],
      "|",
      ["barcode", "=", trimmed],
      ["complete_name", "ilike", trimmed],
    ],
    ["id", "complete_name", "barcode"],
    { limit }
  );

  return rows.map((row) => ({ id: row.id, name: row.complete_name, barcode: row.barcode || null }));
}

export class InvalidMoveError extends Error {}

/**
 * Creates and immediately validates a one-line Internal Transfer moving a single
 * product between two internal locations. Mirrors the exact sequence confirmed
 * live against the test DB: create -> confirm -> assign -> set picked qty -> validate.
 * A same-qty internal move never triggers Odoo's backorder wizard (verified live),
 * so button_validate is expected to return true directly.
 */
export async function moveStock(client: OdooClient, productId: number, move: MoveStockRequest): Promise<void> {
  if (move.sourceLocationId === move.destLocationId) {
    throw new InvalidMoveError("Source and destination locations must be different");
  }
  if (move.quantity <= 0) {
    throw new InvalidMoveError("Quantity must be greater than zero");
  }

  const quantRows = await client.searchRead(
    "stock.quant",
    [
      ["product_id", "=", productId],
      ["location_id", "=", move.sourceLocationId],
    ],
    ["quantity"]
  );
  const availableQty = quantRows[0]?.quantity ?? 0;
  if (move.quantity > availableQty) {
    throw new InvalidMoveError(`Only ${availableQty} available at the source location`);
  }

  const pickingTypeId = await getInternalTransferPickingTypeId(client);

  const pickingId = await client.executeKw<number>("stock.picking", "create", [
    {
      picking_type_id: pickingTypeId,
      location_id: move.sourceLocationId,
      location_dest_id: move.destLocationId,
      move_ids_without_package: [
        [
          0,
          0,
          {
            product_id: productId,
            product_uom_qty: move.quantity,
            location_id: move.sourceLocationId,
            location_dest_id: move.destLocationId,
            name: "Ventor stock move",
          },
        ],
      ],
    },
  ]);

  await client.executeKw("stock.picking", "action_confirm", [[pickingId]]);
  await client.executeKw("stock.picking", "action_assign", [[pickingId]]);

  const moveLines = await client.searchRead("stock.move.line", [["picking_id", "=", pickingId]], ["id"]);
  for (const line of moveLines) {
    await client.executeKw("stock.move.line", "write", [[line.id], { quantity: move.quantity, picked: true }]);
  }

  const result = await client.executeKw<unknown>("stock.picking", "button_validate", [[pickingId]]);
  if (result !== true) {
    throw new Error("Transfer could not be completed automatically — check it in Odoo");
  }
}
