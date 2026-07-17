import type { DashboardSummary } from "@khanico/shared";
import { apiGet, getCurrentUserName, isAdmin } from "../lib/api-client";
import { icon } from "../lib/icons";
import { iconForPickingType } from "../lib/picking-type-icon";

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function formatCount(n: number): string {
  return n.toLocaleString();
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function firstName(): string {
  return getCurrentUserName().trim().split(/\s+/)[0] ?? "";
}

export async function mountDashboard(root: HTMLElement) {
  root.innerHTML = `<section class="page"><p class="muted">Loading dashboard…</p></section>`;

  let summary: DashboardSummary | null = null;
  try {
    summary = await apiGet<DashboardSummary>("/dashboard");
  } catch {
    summary = null;
  }

  root.innerHTML = `
    <section class="page">
      <h2>${greeting()}${firstName() ? `, ${escapeHtml(firstName())}` : ""}</h2>
      <p class="muted dashboard-subtitle">Khanico Limited Warehouse</p>

      <a href="#/inventory" class="scan-hero-btn">
        <span class="scan-hero-icon">${icon("scan-barcode")}</span>
        <span class="scan-hero-text">
          <strong>Scan Barcode</strong>
          <span>Tap to scan or search</span>
        </span>
      </a>

      <div class="quick-actions">
        <a href="#/inventory" class="quick-action-tile">
          <span class="quick-action-icon">${icon("search")}</span>
          <span>Search Inventory</span>
        </a>
        <a href="#/sale-order/new" class="quick-action-tile">
          <span class="quick-action-icon">${icon("file-text")}</span>
          <span>New Sale Order</span>
        </a>
        <a href="#/picking" class="quick-action-tile">
          <span class="quick-action-icon">${icon("package")}</span>
          <span>Transfers</span>
        </a>
      </div>

      <h4>Today's tasks</h4>
      <div id="dashboard-task-tiles" class="task-tiles"></div>

      <h4>Sale orders</h4>
      <div id="dashboard-order-counts" class="results"></div>

      <div class="dashboard-recent-head">
        <h4>Recent sale orders</h4>
        <a href="#/sale-order" class="dashboard-view-all">View All</a>
      </div>
      <div id="dashboard-recent-orders" class="results"></div>
    </section>
  `;

  const taskTilesEl = root.querySelector<HTMLDivElement>("#dashboard-task-tiles")!;
  const orderCountsEl = root.querySelector<HTMLDivElement>("#dashboard-order-counts")!;
  const recentOrdersEl = root.querySelector<HTMLDivElement>("#dashboard-recent-orders")!;

  if (!summary) {
    taskTilesEl.innerHTML = `<p class="error">Failed to load pending transfers.</p>`;
    orderCountsEl.innerHTML = "";
    recentOrdersEl.innerHTML = "";
    return;
  }

  taskTilesEl.innerHTML =
    summary.pendingByCategory.length > 0
      ? summary.pendingByCategory
          .map(
            (c) => `
              <a href="#/picking/${c.pickingTypeId}" class="task-tile">
                <span class="task-tile-icon">${iconForPickingType(c.pickingTypeName)}</span>
                <span class="task-tile-count">${formatCount(c.count)}</span>
                <span class="task-tile-label">${escapeHtml(c.pickingTypeName)}</span>
              </a>`
          )
          .join("")
      : `<p class="muted">No pending transfers.</p>`;

  orderCountsEl.innerHTML = `
    <a href="#/sale-order" class="result-row category-row">
      <strong>Draft orders</strong>
      <span class="badge ${summary.draftOrderCount === 0 ? "badge-zero" : ""}">${formatCount(summary.draftOrderCount)}</span>
    </a>
  `;

  recentOrdersEl.innerHTML =
    summary.recentOrders.length > 0
      ? summary.recentOrders
          .map(
            (o) => `
              <a href="#/sale-order/${o.id}" class="result-row order-card">
                <div class="order-card-title">
                  <strong>${escapeHtml(o.name)}</strong>
                  <span class="state-pill state-${escapeHtml(o.state)}">${escapeHtml(o.state)}</span>
                </div>
                <div class="product-card-top">
                  <div class="order-card-customer">${escapeHtml(o.partnerName)}</div>
                  ${isAdmin() ? `<span class="stamp order-total">$${o.amountTotal.toFixed(2)}</span>` : ""}
                </div>
                <div class="product-meta">
                  <span>${escapeHtml(o.salespersonName ?? "—")}</span>
                  <span>${formatDate(o.dateOrder)}</span>
                </div>
              </a>`
          )
          .join("")
      : `<p class="muted">No sale orders yet.</p>`;
}
