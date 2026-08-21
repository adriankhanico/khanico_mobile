import type { StockMoveHistoryEntry } from "@khanico/shared";
import { apiGet } from "../lib/api-client";

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function renderHistoryEntry(entry: StockMoveHistoryEntry): string {
  const inner = `
    <div class="product-card-top">
      <strong>${entry.quantity}</strong>
      <span class="muted">${escapeHtml(formatDateTime(entry.date))}</span>
    </div>
    <div class="product-meta">
      <span>${escapeHtml(entry.sourceLocationName)} → ${escapeHtml(entry.destLocationName)}</span>
    </div>
    ${entry.pickingName ? `<div class="muted">${escapeHtml(entry.pickingName)}</div>` : ""}
  `;

  return entry.pickingId && entry.pickingTypeId
    ? `<a href="#/picking/${entry.pickingTypeId}/${entry.pickingId}" class="result-row">${inner}</a>`
    : `<div class="result-row-static">${inner}</div>`;
}

export async function mountProductHistory(root: HTMLElement, segments: string[]) {
  const [productIdRaw, productNameRaw] = segments;
  const productId = Number(productIdRaw);
  const productName = productNameRaw ? decodeURIComponent(productNameRaw) : "";

  if (!Number.isInteger(productId)) {
    root.innerHTML = `<section class="page"><p class="error">Invalid product.</p></section>`;
    return;
  }

  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  let dateFrom = toDateInputValue(thirtyDaysAgo);
  let dateTo = toDateInputValue(today);

  root.innerHTML = `
    <section class="page">
      <button id="back-btn" type="button" class="link-btn">← Back</button>
      <h2>Move History</h2>
      <p class="muted">${escapeHtml(productName)}</p>

      <div class="order-line-fields">
        <label>
          From
          <input id="history-from" type="date" value="${dateFrom}" />
        </label>
        <label>
          To
          <input id="history-to" type="date" value="${dateTo}" />
        </label>
      </div>

      <div id="history-results" class="results"></div>
    </section>
  `;

  root.querySelector<HTMLButtonElement>("#back-btn")!.addEventListener("click", () => history.back());

  const fromInput = root.querySelector<HTMLInputElement>("#history-from")!;
  const toInput = root.querySelector<HTMLInputElement>("#history-to")!;
  const resultsEl = root.querySelector<HTMLDivElement>("#history-results")!;

  function renderEntries(entries: StockMoveHistoryEntry[]) {
    resultsEl.innerHTML =
      entries.map(renderHistoryEntry).join("") || `<p class="muted">No moves in this date range.</p>`;
  }

  async function loadHistory() {
    resultsEl.innerHTML = `<p class="muted">Loading…</p>`;
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      const entries = await apiGet<StockMoveHistoryEntry[]>(
        `/inventory/${productId}/history?${params.toString()}`
      );
      renderEntries(entries);
    } catch {
      resultsEl.innerHTML = `<p class="error">Failed to load move history.</p>`;
    }
  }

  fromInput.addEventListener("change", () => {
    dateFrom = fromInput.value;
    loadHistory();
  });
  toInput.addEventListener("change", () => {
    dateTo = toInput.value;
    loadHistory();
  });

  await loadHistory();
}
