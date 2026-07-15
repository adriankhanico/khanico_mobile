import type { Product, SaleOrderDetail, SaleOrderLine, SaleOrderSummary } from "@ventor/shared";

/** Zeroes out price fields for non-admin users. Shape/types stay intact; the client decides whether to render the (now-zero) value based on its own admin flag — this only stops the real number from ever reaching a non-admin's browser. */
export function redactProductPrices<T extends Product>(product: T): T {
  return { ...product, listPrice: 0, priceWithVat: 0 };
}

export function redactSaleOrderSummaryPrices(order: SaleOrderSummary): SaleOrderSummary {
  return { ...order, amountTotal: 0 };
}

function redactSaleOrderLine(line: SaleOrderLine): SaleOrderLine {
  return { ...line, priceUnit: 0, costPrice: 0 };
}

export function redactSaleOrderDetailPrices(order: SaleOrderDetail): SaleOrderDetail {
  return {
    ...order,
    amountUntaxed: 0,
    amountTax: 0,
    amountTotal: 0,
    lines: order.lines.map(redactSaleOrderLine),
  };
}
