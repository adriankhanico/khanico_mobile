export interface Product {
  id: number;
  name: string;
  defaultCode: string | null;
  barcode: string | null;
  sl: string | null;
  listPrice: number;
  priceWithVat: number;
  qtyAvailable: number;
}

export interface StockLocationQty {
  locationId: number;
  locationName: string;
  quantity: number;
}

export interface Partner {
  id: number;
  name: string;
  email: string | null;
}

export interface PickingLine {
  id: number;
  productId: number;
  productName: string;
  productDescription: string | null;
  productBarcode: string | null;
  productSl: string | null;
  requestedQty: number;
  quantity: number;
  picked: boolean;
  lotId: number | null;
  locationId: number;
  locationName: string;
  locationDestId: number;
  locationDestName: string;
}

export interface Picking {
  id: number;
  name: string;
  pickingTypeId: number;
  pickingTypeName: string;
  state: string;
  origin: string | null;
  partnerName: string | null;
  dateDone: string | null;
}

export type PickingStatusFilter = "pending" | "done" | "all";

export interface PickingTypeSettings {
  id: number;
  name: string;
  whCode: string;
  whName: string;
  settings: Record<string, unknown>;
}

export interface PickingTypeGroup {
  pickingTypeId: number;
  pickingTypeName: string;
  pickings: Picking[];
}

export interface DashboardCategoryCount {
  pickingTypeId: number;
  pickingTypeName: string;
  count: number;
}

export interface DashboardSummary {
  pendingByCategory: DashboardCategoryCount[];
  draftOrderCount: number;
  recentOrders: SaleOrderSummary[];
}

export interface SaleOrderSummary {
  id: number;
  name: string;
  partnerName: string;
  state: string;
  amountTotal: number;
  dateOrder: string | null;
  salespersonName: string | null;
}

export interface SaleOrderLineInput {
  productId: number;
  quantity: number;
  priceUnit?: number;
}

export interface SaleOrderLine extends SaleOrderLineInput {
  lineId: number;
  productName: string;
  sl: string | null;
  description: string | null;
  priceUnit: number;
  costPrice: number;
}

export type HoseIntegrityStatus = "no_snapshot" | "ok" | "mismatch";

export interface SaleOrderDetail {
  id: number;
  name: string;
  partnerId: number;
  partnerName: string;
  dateOrder: string | null;
  salespersonName: string | null;
  state: string;
  amountUntaxed: number;
  amountTax: number;
  amountTotal: number;
  editable: boolean;
  poNumber: string | null;
  isHoseOrder: boolean;
  hoseCanToggle: boolean;
  hoseIntegrityStatus: HoseIntegrityStatus | null;
  lines: SaleOrderLine[];
  pickings: Picking[];
}

export interface SaleOrderCreateInput {
  partnerId: number;
  lines: SaleOrderLineInput[];
  poNumber?: string;
  isHoseOrder?: boolean;
}

export interface ProductDetail extends Product {
  description: string | null;
  locations: StockLocationQty[];
}

export interface LocationOption {
  id: number;
  name: string;
  barcode: string | null;
}

export interface MoveStockRequest {
  sourceLocationId: number;
  destLocationId: number;
  quantity: number;
}

export interface ScanRequest {
  barcode: string;
  qty?: number;
}

export interface ValidatePickingResult {
  validated: boolean;
  /** Present when Odoo needs a backorder decision before the picking can complete. */
  backorder: {
    wizardId: number;
  } | null;
}

export interface BackorderDecisionResult {
  validated: boolean;
  backorderName: string | null;
}

export interface ApiError {
  error: string;
  message: string;
}
