import type { MultiBarcodeInfo, ProductBarcode } from "@khanico/shared";
import { userHasGroup, type OdooClient } from "./client.js";

/**
 * Support for the khanico_multi_barcode Odoo module: extra barcodes on a product
 * (product.barcode, product.product.barcode_ids). The module also makes every
 * search on product.product's `barcode` field match the extra barcodes, so
 * barcode lookups elsewhere in the app pick them up without changes.
 *
 * Everything here is a no-op when the module isn't installed.
 */

const REMOVER_GROUP = ["khanico_multi_barcode", "group_barcode_remover"] as const;
const STOCK_USER_GROUP = ["stock", "group_stock_user"] as const;

/** Re-check now and then, so installing the module on Odoo doesn't need an app restart. */
const DETECTION_TTL_MS = 5 * 60 * 1000;
let detection: { at: number; installed: Promise<boolean> } | null = null;

export function hasMultiBarcode(client: OdooClient): Promise<boolean> {
  if (!detection || Date.now() - detection.at > DETECTION_TTL_MS) {
    const installed = client
      .executeKw<Record<string, unknown>>("product.product", "fields_get", [["barcode_ids"]], {
        attributes: ["type"],
      })
      .then((fields) => "barcode_ids" in fields);
    // Don't remember a failed check (e.g. Odoo briefly unreachable).
    installed.catch(() => {
      detection = null;
    });
    detection = { at: Date.now(), installed };
  }
  return detection.installed;
}

export class InvalidBarcodeError extends Error {}

function toProductBarcode(row: any): ProductBarcode {
  return { id: row.id, barcode: row.name, note: row.note || null };
}

/** Additional barcodes for each product, in the module's order. Empty when the module isn't installed. */
export async function getAdditionalBarcodes(
  client: OdooClient,
  productIds: number[]
): Promise<Map<number, ProductBarcode[]>> {
  const byProductId = new Map<number, ProductBarcode[]>();
  if (productIds.length === 0 || !(await hasMultiBarcode(client))) return byProductId;

  const rows = await client.searchRead(
    "product.barcode",
    [["product_id", "in", productIds]],
    ["id", "name", "note", "product_id"],
    { order: "sequence, id" }
  );
  for (const row of rows) {
    const list = byProductId.get(row.product_id[0]) ?? [];
    list.push(toProductBarcode(row));
    byProductId.set(row.product_id[0], list);
  }
  return byProductId;
}

/** Main barcode first, then any additional ones: everything a scan of this product could read. */
export function allBarcodes(mainBarcode: string | null, additional: ProductBarcode[] | undefined): string[] {
  return [...(mainBarcode ? [mainBarcode] : []), ...(additional ?? []).map((b) => b.barcode)];
}

export async function getMultiBarcodeInfo(client: OdooClient, productId: number): Promise<MultiBarcodeInfo | null> {
  if (!(await hasMultiBarcode(client))) return null;
  const [barcodes, isRemover, isStockUser] = await Promise.all([
    getAdditionalBarcodes(client, [productId]),
    userHasGroup(client, ...REMOVER_GROUP),
    userHasGroup(client, ...STOCK_USER_GROUP),
  ]);
  return {
    barcodes: barcodes.get(productId) ?? [],
    // Mirrors the module: anyone may add, removers may remove, removers and stock users may make main.
    canRemove: isRemover,
    canMakeMain: isRemover || isStockUser,
  };
}

export async function addAdditionalBarcode(
  client: OdooClient,
  productId: number,
  barcode: string,
  note: string | null
): Promise<void> {
  const trimmed = barcode.trim();
  if (!trimmed) throw new InvalidBarcodeError("Barcode cannot be empty");
  if (!(await hasMultiBarcode(client))) {
    throw new InvalidBarcodeError("Additional barcodes aren't enabled in Odoo");
  }
  // The module checks uniqueness against main barcodes, other additional barcodes and packagings.
  await client.executeKw("product.barcode", "create", [
    { product_id: productId, name: trimmed, ...(note?.trim() ? { note: note.trim() } : {}) },
  ]);
}

/** The product.barcode record, checked to belong to this product. */
async function getOwnBarcode(client: OdooClient, productId: number, barcodeId: number): Promise<void> {
  const count = await client.searchCount("product.barcode", [
    ["id", "=", barcodeId],
    ["product_id", "=", productId],
  ]);
  if (count === 0) throw new InvalidBarcodeError("That barcode no longer belongs to this product — refresh and try again");
}

export async function removeAdditionalBarcode(client: OdooClient, productId: number, barcodeId: number): Promise<void> {
  await getOwnBarcode(client, productId, barcodeId);
  // Odoo only lets the Barcode Remover group delete these, and logs the removal in the chatter.
  await client.executeKw("product.barcode", "action_remove", [[barcodeId]]);
}

/** Swaps an additional barcode with the main one, keeping the old main barcode as an additional one. */
export async function makeBarcodeMain(client: OdooClient, productId: number, barcodeId: number): Promise<void> {
  await getOwnBarcode(client, productId, barcodeId);
  await client.executeKw("product.barcode", "action_make_main", [[barcodeId]]);
}
