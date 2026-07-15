import type {
  HoseIntegrityStatus,
  Partner,
  SaleOrderCreateInput,
  SaleOrderDetail,
  SaleOrderSummary,
} from "@ventor/shared";
import type { OdooClient } from "./client.js";

export async function countDraftSaleOrders(client: OdooClient): Promise<number> {
  return client.searchCount("sale.order", [["state", "=", "draft"]]);
}

export async function searchCustomers(client: OdooClient, query: string, limit = 20): Promise<Partner[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const rows = await client.searchRead(
    "res.partner",
    [["name", "ilike", trimmed]],
    ["id", "name", "email"],
    { limit }
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email || null,
  }));
}

export async function createSaleOrder(client: OdooClient, input: SaleOrderCreateInput): Promise<number> {
  const orderLine = input.lines.map((line) => [
    0,
    0,
    {
      product_id: line.productId,
      product_uom_qty: line.quantity,
      ...(line.priceUnit !== undefined ? { price_unit: line.priceUnit } : {}),
    },
  ]);

  const values: Record<string, unknown> = {
    partner_id: input.partnerId,
    order_line: orderLine,
  };
  if (input.poNumber) {
    values.x_studio_customer_reference = input.poNumber;
  }
  if (input.isHoseOrder) {
    values.is_hose_order = true;
  }

  return client.executeKw<number>("sale.order", "create", [values]);
}

export async function searchSaleOrders(
  client: OdooClient,
  query: string,
  limit = 50
): Promise<SaleOrderSummary[]> {
  const trimmed = query.trim();
  const domain = trimmed
    ? ["|", ["name", "ilike", trimmed], ["partner_id.name", "ilike", trimmed]]
    : [];

  const rows = await client.searchRead(
    "sale.order",
    domain,
    ["id", "name", "partner_id", "state", "amount_total", "date_order", "user_id"],
    { limit, order: "date_order desc, id desc" }
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    partnerName: row.partner_id[1],
    state: row.state,
    amountTotal: row.amount_total,
    dateOrder: row.date_order || null,
    salespersonName: row.user_id ? row.user_id[1] : null,
  }));
}

export async function getSaleOrderDetail(
  client: OdooClient,
  orderId: number
): Promise<SaleOrderDetail | null> {
  const orders = await client.searchRead(
    "sale.order",
    [["id", "=", orderId]],
    [
      "id",
      "name",
      "partner_id",
      "amount_untaxed",
      "amount_tax",
      "amount_total",
      "state",
      "date_order",
      "user_id",
      "x_studio_customer_reference",
      "is_hose_order",
      "hose_can_toggle",
      "hose_integrity_status",
    ]
  );
  if (orders.length === 0) return null;
  const order = orders[0];

  const lineRows = await client.searchRead(
    "sale.order.line",
    [["order_id", "=", orderId], ["display_type", "=", false]],
    ["id", "product_id", "name", "product_uom_qty", "price_unit"]
  );

  const productIds = lineRows.map((row) => row.product_id[0]);
  const costByProductId = new Map<number, number>();
  const slByProductId = new Map<number, string | null>();
  if (productIds.length > 0) {
    const productRows = await client.searchRead(
      "product.product",
      [["id", "in", productIds]],
      ["id", "standard_price", "x_studio_sl"]
    );
    for (const row of productRows) {
      costByProductId.set(row.id, row.standard_price);
      slByProductId.set(row.id, row.x_studio_sl || null);
    }
  }

  return {
    id: order.id,
    name: order.name,
    partnerId: order.partner_id[0],
    partnerName: order.partner_id[1],
    dateOrder: order.date_order || null,
    salespersonName: order.user_id ? order.user_id[1] : null,
    state: order.state,
    amountUntaxed: order.amount_untaxed,
    amountTax: order.amount_tax,
    amountTotal: order.amount_total,
    editable: order.state === "draft",
    poNumber: order.x_studio_customer_reference || null,
    isHoseOrder: order.is_hose_order,
    hoseCanToggle: order.hose_can_toggle,
    hoseIntegrityStatus: (order.hose_integrity_status as HoseIntegrityStatus) || null,
    lines: lineRows.map((row) => ({
      lineId: row.id,
      productId: row.product_id[0],
      productName: row.product_id[1],
      sl: slByProductId.get(row.product_id[0]) ?? null,
      description: row.name || null,
      quantity: row.product_uom_qty,
      priceUnit: row.price_unit,
      costPrice: costByProductId.get(row.product_id[0]) ?? 0,
    })),
  };
}

async function assertEditable(client: OdooClient, orderId: number): Promise<void> {
  const orders = await client.searchRead("sale.order", [["id", "=", orderId]], ["state"]);
  if (orders.length === 0) {
    throw new Error("Sale order not found");
  }
  if (orders[0].state !== "draft") {
    throw new Error("Sale order is no longer a draft and cannot be edited");
  }
}

export async function updateSaleOrderCustomer(
  client: OdooClient,
  orderId: number,
  partnerId: number
): Promise<void> {
  await assertEditable(client, orderId);
  await client.executeKw("sale.order", "write", [[orderId], { partner_id: partnerId }]);
}

export async function updateSaleOrderFields(
  client: OdooClient,
  orderId: number,
  fields: { poNumber?: string; isHoseOrder?: boolean }
): Promise<void> {
  await assertEditable(client, orderId);
  const values: Record<string, unknown> = {};
  if (fields.poNumber !== undefined) {
    values.x_studio_customer_reference = fields.poNumber;
  }
  if (fields.isHoseOrder !== undefined) {
    values.is_hose_order = fields.isHoseOrder;
  }
  if (Object.keys(values).length === 0) return;
  await client.executeKw("sale.order", "write", [[orderId], values]);
}

export async function addSaleOrderLine(
  client: OdooClient,
  orderId: number,
  line: { productId: number; quantity: number }
): Promise<void> {
  await assertEditable(client, orderId);
  await client.executeKw("sale.order", "write", [
    [orderId],
    { order_line: [[0, 0, { product_id: line.productId, product_uom_qty: line.quantity }]] },
  ]);
}

export async function updateSaleOrderLineQuantity(
  client: OdooClient,
  orderId: number,
  lineId: number,
  quantity: number
): Promise<void> {
  await assertEditable(client, orderId);
  await client.executeKw("sale.order.line", "write", [[lineId], { product_uom_qty: quantity }]);
}

export async function updateSaleOrderLinePrice(
  client: OdooClient,
  orderId: number,
  lineId: number,
  priceUnit: number
): Promise<void> {
  await assertEditable(client, orderId);
  await client.executeKw("sale.order.line", "write", [[lineId], { price_unit: priceUnit }]);
}

export async function removeSaleOrderLine(
  client: OdooClient,
  orderId: number,
  lineId: number
): Promise<void> {
  await assertEditable(client, orderId);
  await client.executeKw("sale.order", "write", [[orderId], { order_line: [[2, lineId, 0]] }]);
}
