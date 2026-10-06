import type { MissingBarcodeProduct } from "@khanico/shared";
import type { OdooClient } from "./client.js";

/**
 * Storable products with no barcode that have stock in an internal location — the ones
 * someone can actually walk to and label. "any" keeps both quant conditions on the same
 * quant, so stock in a non-internal location doesn't count.
 */
const MISSING_BARCODE_DOMAIN = [
  ["barcode", "=", false],
  ["type", "=", "product"],
  [
    "stock_quant_ids",
    "any",
    [
      ["location_id.usage", "=", "internal"],
      ["quantity", ">", 0],
    ],
  ],
];

/** Brand comes from the product_brand module (product.template.product_brand_id). */
const BRAND_FIELD = "product_brand_id";

export async function countProductsMissingBarcode(client: OdooClient): Promise<number> {
  return client.searchCount("product.product", MISSING_BARCODE_DOMAIN);
}

export async function listProductsMissingBarcode(client: OdooClient): Promise<MissingBarcodeProduct[]> {
  const products = await client.searchRead(
    "product.product",
    MISSING_BARCODE_DOMAIN,
    ["id", "name", "default_code", "x_studio_sl", BRAND_FIELD],
    { order: "name, id" }
  );
  if (products.length === 0) return [];

  const quants = await client.searchRead(
    "stock.quant",
    [
      ["product_id", "in", products.map((p) => p.id)],
      ["location_id.usage", "=", "internal"],
      ["quantity", ">", 0],
    ],
    ["product_id", "location_id", "quantity"],
    { order: "location_id" }
  );
  const locationsByProductId = new Map<number, MissingBarcodeProduct["locations"]>();
  for (const quant of quants) {
    const productId = quant.product_id[0];
    const locations = locationsByProductId.get(productId) ?? [];
    const existing = locations.find((loc) => loc.locationId === quant.location_id[0]);
    if (existing) {
      // Separate lots/packages in the same bin come back as separate quants.
      existing.quantity += quant.quantity;
    } else {
      locations.push({
        locationId: quant.location_id[0],
        locationName: quant.location_id[1],
        quantity: quant.quantity,
      });
    }
    locationsByProductId.set(productId, locations);
  }

  return products.map((p) => ({
    id: p.id,
    name: p.name,
    defaultCode: p.default_code || null,
    sl: p.x_studio_sl || null,
    brandId: p[BRAND_FIELD] ? p[BRAND_FIELD][0] : null,
    brandName: p[BRAND_FIELD] ? p[BRAND_FIELD][1] : null,
    locations: locationsByProductId.get(p.id) ?? [],
  }));
}
