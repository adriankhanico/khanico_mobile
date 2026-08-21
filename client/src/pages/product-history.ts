import type { StockMoveDirection, StockMoveHistoryEntry } from "@khanico/shared";
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

const DIRECTION_FILTERS: { value: StockMoveDirection | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "incoming", label: "Incoming" },
  { value: "outgoing", label: "Outgoing" },
  { value: "internal", label: "Internal" },
];

const DIRECTION_LABELS: Record<StockMoveDirection, string> = {
  incoming: "Incoming",
  outgoing: "Outgoing",
  internal: "Internal",
};

function renderHistoryEntry(entry: StockMoveHistoryEntry): string {
  const inner = `
    <div class="product-card-top">
      <strong>${entry.quantity}</strong>
      <span class="state-pill direction-${entry.direction}">${DIRECTION_LABELS[entry.direction]}</span>
    </div>
    <div class="product-meta">
      <span>${escapeHtml(entry.sourceLocationName)} → ${escapeHtml(entry.destLocationName)}</span>
    </div>
    <div class="muted">${escapeHtml(formatDateTime(entry.date))}${
    entry.pickingName ? ` · ${escapeHtml(entry.pickingName)}` : ""
  }</div>
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

      <div class="status-filter-row">
        ${DIRECTION_FILTERS.map(
          (f) =>
            `<button type="button" class="status-filter-btn ${f.value === "all" ? "active" : ""}" data-direction="${f.value}">${f.label}</button>`
        ).join("")}
      </div>

      <div id="history-results" class="results"></div>
    </section>
  `;

  root.querySelector<HTMLButtonElement>("#back-btn")!.addEventListener("click", () => history.back());

  const fromInput = root.querySelector<HTMLInputElement>("#history-from")!;
  const toInput = root.querySelector<HTMLInputElement>("#history-to")!;
  const resultsEl = root.querySelector<HTMLDivElement>("#history-results")!;
  const filterButtons = root.querySelectorAll<HTMLButtonElement>("[data-direction]");

  let currentEntries: StockMoveHistoryEntry[] = [];
  let currentDirection: StockMoveDirection | "all" = "all";

  function renderEntries() {
    const filtered =
      currentDirection === "all" ? currentEntries : currentEntries.filter((e) => e.direction === currentDirection);
    resultsEl.innerHTML =
      filtered.map(renderHistoryEntry).join("") || `<p class="muted">No moves in this date range.</p>`;
  }

  async function loadHistory() {
    resultsEl.innerHTML = `<p class="muted">Loading…</p>`;
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      currentEntries = await apiGet<StockMoveHistoryEntry[]>(
        `/inventory/${productId}/history?${params.toString()}`
      );
      renderEntries();
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

  filterButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      currentDirection = btn.dataset.direction as StockMoveDirection | "all";
      filterButtons.forEach((b) => b.classList.toggle("active", b === btn));
      renderEntries();
    });
  });

  await loadHistory();
}
