import type { CountLine, CountLocation, LocationOption, Product } from "@khanico/shared";
import { apiErrorMessage, apiGet, apiPost } from "../lib/api-client";
import { createCameraScanner, type CameraScanner } from "../lib/scanner/camera-scanner";
import { HidScanner } from "../lib/scanner/hid-scanner";
import { icon } from "../lib/icons";

/** Same gap HidScanner uses to tell a hardware scan burst from human typing. */
const SCAN_BURST_GAP_MS = 80;

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function todayIsoDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatQty(qty: number): string {
  return String(Math.round(qty * 1000) / 1000);
}

/** Parses a typed quantity (accepting a decimal comma); null when it isn't a count of zero or more. */
function parseQty(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  if (!trimmed) return null;
  const qty = Number(trimmed);
  return Number.isFinite(qty) && qty >= 0 ? qty : null;
}

function matchesCode(code: string, ...values: (string | null)[]): boolean {
  return values.some((value) => value !== null && value === code);
}

/** The router only swaps #app's contents, so page-level scanners must be detached on the way out. */
function onLeavePage(cleanup: () => void) {
  window.addEventListener("hashchange", cleanup, { once: true });
}

export function mountCountsRoute(root: HTMLElement, segments: string[]) {
  const locationId = Number(segments[0]);
  if (segments[0] && Number.isInteger(locationId)) {
    mountCountLocation(root, locationId);
  } else {
    mountCountList(root);
  }
}

async function mountCountList(root: HTMLElement) {
  root.innerHTML = `
    <section class="page">
      <h2>Stock Counts</h2>
      <p class="muted">Counts assigned to you in Odoo. Scan a location to start counting.</p>
      <div class="search-row">
        <input
          id="count-location-search"
          type="search"
          placeholder="Scan or search location"
          autocomplete="off"
          data-scan-target="true"
        />
      </div>
      <div id="count-location-status"></div>
      <div id="count-location-results" class="results"></div>
      <h4>Assigned to you</h4>
      <div id="count-assigned" class="results"><p class="muted">Loading…</p></div>
    </section>
  `;

  const searchInput = root.querySelector<HTMLInputElement>("#count-location-search")!;
  const statusEl = root.querySelector<HTMLDivElement>("#count-location-status")!;
  const resultsEl = root.querySelector<HTMLDivElement>("#count-location-results")!;
  const assignedEl = root.querySelector<HTMLDivElement>("#count-assigned")!;

  async function openLocationByCode(code: string) {
    statusEl.innerHTML = "";
    try {
      const locations = await apiGet<LocationOption[]>(`/inventory/locations/search?q=${encodeURIComponent(code)}`);
      const match = locations.find((loc) => loc.barcode === code) ?? (locations.length === 1 ? locations[0] : null);
      if (match) {
        window.location.hash = `/counts/${match.id}`;
      } else {
        statusEl.innerHTML = `<p class="error">No location found for ${escapeHtml(code)}.</p>`;
      }
    } catch (err) {
      statusEl.innerHTML = `<p class="error">${escapeHtml(apiErrorMessage(err, "Location lookup failed."))}</p>`;
    }
  }

  let debounce: ReturnType<typeof setTimeout> | undefined;
  searchInput.addEventListener("input", () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(async () => {
      const query = searchInput.value.trim();
      if (!query) {
        resultsEl.innerHTML = "";
        return;
      }
      try {
        const locations = await apiGet<LocationOption[]>(`/inventory/locations/search?q=${encodeURIComponent(query)}`);
        resultsEl.innerHTML =
          locations.length > 0
            ? locations
                .map((loc) => `<a href="#/counts/${loc.id}" class="result-row">${escapeHtml(loc.name)}</a>`)
                .join("")
            : `<p class="muted">No matching locations.</p>`;
      } catch {
        resultsEl.innerHTML = `<p class="error">Location search failed.</p>`;
      }
    }, 250);
  });

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.defaultPrevented && searchInput.value.trim()) {
      openLocationByCode(searchInput.value.trim());
    }
  });

  const hidScanner = new HidScanner({
    onScan: (code) => {
      searchInput.value = "";
      resultsEl.innerHTML = "";
      openLocationByCode(code);
    },
  });
  hidScanner.attach();
  onLeavePage(() => hidScanner.detach());

  let lines: CountLine[];
  try {
    lines = await apiGet<CountLine[]>("/counts");
  } catch (err) {
    assignedEl.innerHTML = `<p class="error">${escapeHtml(apiErrorMessage(err, "Failed to load your counts."))}</p>`;
    return;
  }

  if (lines.length === 0) {
    assignedEl.innerHTML = `<p class="muted">Nothing assigned to you. A manager can assign counts in Odoo with <strong>Request a Count</strong>, or you can scan any location to count it.</p>`;
    return;
  }

  const byLocation = new Map<number, CountLine[]>();
  for (const line of lines) {
    const group = byLocation.get(line.locationId) ?? [];
    group.push(line);
    byLocation.set(line.locationId, group);
  }

  const today = todayIsoDate();
  assignedEl.innerHTML = [...byLocation.values()]
    .map((group) => {
      const remaining = group.filter((line) => line.countedQty === null);
      const dueDates = remaining.map((line) => line.scheduledDate).filter((d): d is string => d !== null).sort();
      const due = dueDates[0];
      const dueLabel = !due
        ? ""
        : due < today
          ? `<span class="error">Overdue · ${escapeHtml(formatDate(due))}</span>`
          : `<span>Due ${due === today ? "today" : escapeHtml(formatDate(due))}</span>`;
      return `
        <a href="#/counts/${group[0].locationId}" class="result-row">
          <div class="product-card-top">
            <strong>${escapeHtml(group[0].locationName)}</strong>
            <span class="badge ${remaining.length === 0 ? "badge-zero" : ""}">${group.length - remaining.length}/${group.length}</span>
          </div>
          <div class="product-meta">
            <span>${remaining.length === 0 ? "All counted" : `${remaining.length} to count`}</span>
            ${dueLabel}
          </div>
        </a>`;
    })
    .join("");
}

/** The line whose count form is open: an assigned line, or (quantId null) a product that isn't on the list. */
interface OpenCount {
  quantId: number | null;
  productId: number;
  productName: string;
  productCode: string | null;
  productBarcode: string | null;
  productSl: string | null;
  initialQty: string;
}

async function mountCountLocation(root: HTMLElement, locationId: number) {
  root.innerHTML = `<section class="page"><p class="muted">Loading…</p></section>`;

  let data: CountLocation;
  try {
    data = await apiGet<CountLocation>(`/counts/location/${locationId}`);
  } catch (err) {
    root.innerHTML = `
      <section class="page">
        <a href="#/counts" class="link-btn">← All counts</a>
        <p class="error">${escapeHtml(apiErrorMessage(err, "Failed to load this location."))}</p>
      </section>`;
    return;
  }

  root.innerHTML = `
    <section class="page">
      <a href="#/counts" class="link-btn">← All counts</a>
      <h2>${escapeHtml(data.location.name)}</h2>
      <p class="muted" id="count-progress"></p>
      <div class="search-row">
        <input
          id="count-scan-input"
          type="search"
          placeholder="Scan or search product"
          autocomplete="off"
          data-scan-target="true"
        />
        <button id="camera-scan-toggle" type="button" aria-label="Scan with camera">${icon("camera")}</button>
      </div>
      <div id="camera-panel" class="camera-panel hidden">
        <video id="camera-video" playsinline muted></video>
        <button id="camera-scan-close" type="button">Close</button>
      </div>
      <div id="count-scan-status"></div>
      <div id="count-search-results" class="results"></div>
      <div id="count-lines" class="results"></div>
    </section>
  `;

  const progressEl = root.querySelector<HTMLParagraphElement>("#count-progress")!;
  const scanInput = root.querySelector<HTMLInputElement>("#count-scan-input")!;
  const scanStatusEl = root.querySelector<HTMLDivElement>("#count-scan-status")!;
  const searchResultsEl = root.querySelector<HTMLDivElement>("#count-search-results")!;
  const linesEl = root.querySelector<HTMLDivElement>("#count-lines")!;
  const cameraPanel = root.querySelector<HTMLDivElement>("#camera-panel")!;
  const video = root.querySelector<HTMLVideoElement>("#camera-video")!;
  const cameraToggle = root.querySelector<HTMLButtonElement>("#camera-scan-toggle")!;
  const cameraClose = root.querySelector<HTMLButtonElement>("#camera-scan-close")!;

  const lines = data.lines;
  let open: OpenCount | null = null;
  /** Quantity field value from before the current keystroke burst, to undo a scan typed into it. */
  let qtyBeforeBurst = "";
  let searchResults: Product[] = [];

  function setStatus(html: string) {
    const formStatus = linesEl.querySelector<HTMLDivElement>("#count-form-status");
    (formStatus ?? scanStatusEl).innerHTML = html;
  }

  function renderForm(): string {
    return `
      <div class="move-form count-form">
        <label for="count-qty-input">Counted quantity</label>
        <input id="count-qty-input" type="text" inputmode="decimal" class="qty-input" autocomplete="off" value="${escapeHtml(
          open!.initialQty
        )}" data-scan-target="true" />
        <p class="muted count-form-hint">Scan the product again to add one.</p>
        <div id="count-form-status"></div>
        <div class="backorder-actions">
          <button type="button" class="btn-primary" id="count-save-btn">Save count</button>
          <button type="button" class="btn-secondary" id="count-cancel-btn">Cancel</button>
        </div>
      </div>`;
  }

  function renderCard(
    key: string,
    item: { productName: string; productCode: string | null; productSl: string | null },
    stateHtml: string,
    extraHtml: string,
    isOpen: boolean,
    done: boolean
  ): string {
    return `
      <div class="count-line ${done ? "count-line-done" : ""} ${isOpen ? "count-line-open" : ""}" data-count-key="${key}">
        <div class="product-card-top">
          <div class="product-name">${escapeHtml(item.productName)}</div>
          ${stateHtml}
        </div>
        <div class="product-meta">
          <span>${escapeHtml(item.productCode ?? "—")}</span>
          <span>SL ${escapeHtml(item.productSl ?? "—")}</span>
        </div>
        ${extraHtml}
        ${isOpen ? renderForm() : ""}
      </div>`;
  }

  function render() {
    const counted = lines.filter((line) => line.countedQty !== null).length;
    progressEl.textContent =
      lines.length > 0
        ? `${counted} of ${lines.length} counted`
        : "Nothing assigned to you here — scan a product to count it.";

    const newCard =
      open && open.quantId === null
        ? renderCard("new", open, `<span class="state-pill">Not on list</span>`, "", true, false)
        : "";

    linesEl.innerHTML =
      newCard +
      lines
        .map((line) =>
          renderCard(
            String(line.quantId),
            line,
            line.countedQty !== null
              ? `<span class="stamp">${icon("check")} ${formatQty(line.countedQty)}</span>`
              : `<span class="state-pill">To count</span>`,
            line.lotName ? `<div class="muted">Lot ${escapeHtml(line.lotName)}</div>` : "",
            open?.quantId === line.quantId,
            line.countedQty !== null
          )
        )
        .join("");

    if (open) bindForm();
  }

  function bindForm() {
    const qtyInput = linesEl.querySelector<HTMLInputElement>("#count-qty-input")!;
    const saveBtn = linesEl.querySelector<HTMLButtonElement>("#count-save-btn")!;
    const cancelBtn = linesEl.querySelector<HTMLButtonElement>("#count-cancel-btn")!;

    qtyBeforeBurst = qtyInput.value;
    let lastKeyAt = 0;
    qtyInput.addEventListener("keydown", (e) => {
      const now = performance.now();
      if (now - lastKeyAt > SCAN_BURST_GAP_MS) qtyBeforeBurst = qtyInput.value;
      lastKeyAt = now;
      // A scanner's Enter is consumed (defaultPrevented) by HidScanner; only a typed Enter saves.
      if (e.key === "Enter" && !e.defaultPrevented) save(qtyInput, saveBtn);
    });
    saveBtn.addEventListener("click", () => save(qtyInput, saveBtn));
    cancelBtn.addEventListener("click", () => {
      open = null;
      scanStatusEl.innerHTML = "";
      render();
    });

    qtyInput.closest(".count-line")?.scrollIntoView({ block: "nearest" });
    qtyInput.focus();
    qtyInput.select();
  }

  async function save(qtyInput: HTMLInputElement, saveBtn: HTMLButtonElement) {
    if (!open) return;
    const qty = parseQty(qtyInput.value);
    if (qty === null) {
      setStatus(`<span class="error">Enter the quantity you counted.</span>`);
      return;
    }
    saveBtn.disabled = true;
    setStatus("Saving…");
    try {
      const saved = await apiPost<CountLine>("/counts", {
        locationId,
        productId: open.productId,
        quantId: open.quantId ?? undefined,
        countedQty: qty,
      });
      const index = lines.findIndex((line) => line.quantId === saved.quantId);
      if (index >= 0) lines[index] = saved;
      else lines.unshift(saved);
      open = null;
      render();
      scanStatusEl.innerHTML = `<p class="success">Saved ${escapeHtml(saved.productName)}: ${formatQty(qty)}</p>`;
      (document.activeElement as HTMLElement | null)?.blur();
    } catch (err) {
      setStatus(`<span class="error">${escapeHtml(apiErrorMessage(err, "Failed to save count."))}</span>`);
      saveBtn.disabled = false;
    }
  }

  function openLine(line: CountLine, fromScan: boolean) {
    open = {
      quantId: line.quantId,
      productId: line.productId,
      productName: line.productName,
      productCode: line.productCode,
      productBarcode: line.productBarcode,
      productSl: line.productSl,
      initialQty: fromScan ? "1" : line.countedQty !== null ? formatQty(line.countedQty) : "",
    };
    render();
    if (fromScan && line.countedQty !== null) {
      setStatus(`<span class="muted">Previously counted ${formatQty(line.countedQty)} — saving replaces it.</span>`);
    }
  }

  function openProduct(product: Product, fromScan: boolean) {
    const onList = lines.filter((line) => line.productId === product.id);
    if (onList.length === 1) {
      openLine(onList[0], fromScan);
      return;
    }
    if (onList.length > 1) {
      scanStatusEl.innerHTML = `<p class="muted">This product has ${onList.length} lines here (different lots) — tap the one you're counting.</p>`;
      return;
    }
    open = {
      quantId: null,
      productId: product.id,
      productName: product.name,
      productCode: product.defaultCode,
      productBarcode: product.barcode,
      productSl: product.sl,
      initialQty: fromScan ? "1" : "",
    };
    scanStatusEl.innerHTML = "";
    render();
  }

  async function resolveCode(code: string) {
    const matches = lines.filter((line) => matchesCode(code, line.productBarcode, line.productCode, line.productSl));
    if (matches.length === 1) {
      scanStatusEl.innerHTML = "";
      openLine(matches[0], true);
      return;
    }
    if (matches.length > 1) {
      scanStatusEl.innerHTML = `<p class="muted">This product has ${matches.length} lines here (different lots) — tap the one you're counting.</p>`;
      return;
    }

    scanStatusEl.innerHTML = `<p class="muted">Looking up ${escapeHtml(code)}…</p>`;
    try {
      const [locations, products] = await Promise.all([
        apiGet<LocationOption[]>(`/inventory/locations/search?q=${encodeURIComponent(code)}`),
        apiGet<Product[]>(`/inventory/search?q=${encodeURIComponent(code)}`),
      ]);
      const location = locations.find((loc) => loc.barcode === code);
      if (location) {
        scanStatusEl.innerHTML = "";
        if (location.id !== locationId) window.location.hash = `/counts/${location.id}`;
        return;
      }
      const product = products.find((p) => matchesCode(code, p.barcode, p.defaultCode, p.sl));
      if (product) {
        openProduct(product, true);
        return;
      }
      scanStatusEl.innerHTML = `<p class="error">Nothing found for ${escapeHtml(code)}.</p>`;
    } catch (err) {
      scanStatusEl.innerHTML = `<p class="error">${escapeHtml(apiErrorMessage(err, "Lookup failed."))}</p>`;
    }
  }

  function handleScan(code: string) {
    const qtyInput = linesEl.querySelector<HTMLInputElement>("#count-qty-input");
    if (open && qtyInput) {
      scanInput.value = "";
      // The scanner typed the barcode into the quantity field before its Enter arrived; undo that.
      if (document.activeElement === qtyInput) qtyInput.value = qtyBeforeBurst;
      if (matchesCode(code, open.productBarcode, open.productCode, open.productSl)) {
        qtyInput.value = formatQty((parseQty(qtyInput.value) ?? 0) + 1);
        qtyBeforeBurst = qtyInput.value;
        setStatus("");
      } else {
        setStatus(`<span class="error">Save or cancel this count before scanning another item.</span>`);
      }
      return;
    }
    scanInput.value = "";
    searchResultsEl.innerHTML = "";
    resolveCode(code);
  }

  linesEl.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest(".count-form")) return;
    const card = target.closest<HTMLElement>("[data-count-key]");
    if (!card || card.dataset.countKey === "new") return;
    const line = lines.find((l) => String(l.quantId) === card.dataset.countKey);
    if (!line || open?.quantId === line.quantId) return;
    scanStatusEl.innerHTML = "";
    openLine(line, false);
  });

  let debounce: ReturnType<typeof setTimeout> | undefined;
  scanInput.addEventListener("input", () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(async () => {
      const query = scanInput.value.trim();
      if (!query) {
        searchResultsEl.innerHTML = "";
        return;
      }
      try {
        searchResults = await apiGet<Product[]>(`/inventory/search?q=${encodeURIComponent(query)}`);
        searchResultsEl.innerHTML =
          searchResults.length > 0
            ? searchResults
                .map(
                  (p) => `
                    <div class="result-row" data-search-product-id="${p.id}">
                      <strong>${escapeHtml(p.name)}</strong>
                      <div class="product-meta">
                        <span>${escapeHtml(p.defaultCode ?? "—")}</span>
                        <span>SL ${escapeHtml(p.sl ?? "—")}</span>
                      </div>
                    </div>`
                )
                .join("")
            : `<p class="muted">No matching products.</p>`;
      } catch {
        searchResultsEl.innerHTML = `<p class="error">Product search failed.</p>`;
      }
    }, 250);
  });

  scanInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.defaultPrevented && scanInput.value.trim()) {
      const code = scanInput.value.trim();
      scanInput.value = "";
      searchResultsEl.innerHTML = "";
      resolveCode(code);
    }
  });

  searchResultsEl.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-search-product-id]");
    if (!row) return;
    const product = searchResults.find((p) => p.id === Number(row.dataset.searchProductId));
    if (!product) return;
    scanInput.value = "";
    searchResultsEl.innerHTML = "";
    openProduct(product, false);
  });

  let cameraScanner: CameraScanner | null = null;

  async function openCamera() {
    cameraPanel.classList.remove("hidden");
    cameraScanner = createCameraScanner(video, (code) => {
      closeCamera();
      handleScan(code);
    });
    try {
      await cameraScanner.start();
    } catch (err) {
      scanStatusEl.innerHTML = `<p class="error">Camera unavailable: ${escapeHtml(
        err instanceof Error ? err.message : String(err)
      )}</p>`;
      closeCamera();
    }
  }

  function closeCamera() {
    cameraScanner?.stop();
    cameraScanner = null;
    cameraPanel.classList.add("hidden");
  }

  cameraToggle.addEventListener("click", () => {
    if (cameraPanel.classList.contains("hidden")) openCamera();
    else closeCamera();
  });
  cameraClose.addEventListener("click", closeCamera);

  const hidScanner = new HidScanner({ onScan: handleScan });
  hidScanner.attach();
  onLeavePage(() => {
    hidScanner.detach();
    closeCamera();
  });

  render();
}
