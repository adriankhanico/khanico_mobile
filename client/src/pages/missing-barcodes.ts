import type { MissingBarcodeProduct } from "@khanico/shared";
import { apiErrorMessage, apiGet, apiPut } from "../lib/api-client";
import { createCameraScanner, type CameraScanner } from "../lib/scanner/camera-scanner";
import { HidScanner } from "../lib/scanner/hid-scanner";
import { icon } from "../lib/icons";
import { partNumberHtml } from "../lib/part-number";

type SortKey = "location" | "name";

/** Route segment for products with no brand; any other segment is a brand id. */
const NO_BRAND = "none";
const SORT_STORAGE_KEY = "khanico-missing-barcodes-sort";

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function formatQty(qty: number): string {
  return String(Math.round(qty * 1000) / 1000);
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
}

function readSetting(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSetting(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable — the choice just won't be remembered
  }
}

/** Haptic feedback on devices that support it (Android scanners do; iOS ignores it). */
function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // not supported
  }
}

/** The router only swaps #app's contents, so page-level scanners must be detached on the way out. */
function onLeavePage(cleanup: () => void) {
  window.addEventListener("hashchange", cleanup, { once: true });
}

function compareText(a: string | null, b: string | null): number {
  // Blanks (no location) sort last.
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function sortProducts(products: MissingBarcodeProduct[], sort: SortKey): MissingBarcodeProduct[] {
  const byName = (a: MissingBarcodeProduct, b: MissingBarcodeProduct) => compareText(a.name, b.name);
  return [...products].sort((a, b) => {
    if (sort === "location") {
      return compareText(a.locations[0]?.locationName ?? null, b.locations[0]?.locationName ?? null) || byName(a, b);
    }
    return byName(a, b);
  });
}

function brandKey(p: MissingBarcodeProduct): string {
  return p.brandId === null ? NO_BRAND : String(p.brandId);
}

async function loadProducts(root: HTMLElement): Promise<MissingBarcodeProduct[] | null> {
  root.innerHTML = `<section class="page"><p class="muted">Loading…</p></section>`;
  try {
    return await apiGet<MissingBarcodeProduct[]>("/inventory/missing-barcodes");
  } catch (err) {
    root.innerHTML = `
      <section class="page">
        <h2>Missing Barcodes</h2>
        <p class="error">${escapeHtml(apiErrorMessage(err, "Failed to load products missing barcodes."))}</p>
      </section>`;
    return null;
  }
}

export function mountMissingBarcodesRoute(root: HTMLElement, segments: string[]) {
  mountMissingBarcodes(root, segments[0] || null);
}

interface SavedEntry {
  productName: string;
  barcode: string;
}

type BrandCount = [key: string, brand: { name: string; count: number }];

/**
 * Without a brand: the brand list (step 1). With one: that brand's products (step 2).
 * The search box always covers every product missing a barcode, whatever brand it's in.
 */
async function mountMissingBarcodes(root: HTMLElement, brand: string | null) {
  const loaded = await loadProducts(root);
  if (!loaded) return;
  let products = loaded;

  const brandName =
    brand === null
      ? null
      : brand === NO_BRAND
        ? "No brand"
        : products.find((p) => brandKey(p) === brand)?.brandName ?? "This brand";

  root.innerHTML = `
    <section class="page">
      ${brand !== null ? `<a href="#/barcodes" class="link-btn">← All brands</a>` : ""}
      <h2>${escapeHtml(brandName ?? "Missing Barcodes")}</h2>
      <div class="barcode-remaining">
        <span class="barcode-remaining-count" id="barcode-remaining-count"></span>
        <span class="barcode-remaining-label" id="barcode-remaining-label"></span>
      </div>
      <div id="barcode-feedback"></div>
      <div class="search-row">
        <input
          id="barcode-search"
          type="search"
          placeholder="${brand === null ? "Search brand, product, part number or SL" : "Search name, part number or SL"}"
          autocomplete="off"
        />
      </div>
      <div class="barcode-controls" id="barcode-controls">
        <label>
          <span>Sort by</span>
          <select id="barcode-sort">
            <option value="location">Location</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>
      <div id="camera-panel" class="camera-panel hidden">
        <video id="camera-video" playsinline muted></video>
        <button id="camera-scan-close" type="button">Close</button>
      </div>
      <div id="barcode-status"></div>
      <div id="barcode-list" class="results"></div>
      <div id="barcode-done"></div>
    </section>
  `;

  const remainingCountEl = root.querySelector<HTMLSpanElement>("#barcode-remaining-count")!;
  const remainingLabelEl = root.querySelector<HTMLSpanElement>("#barcode-remaining-label")!;
  const feedbackEl = root.querySelector<HTMLDivElement>("#barcode-feedback")!;
  const searchInput = root.querySelector<HTMLInputElement>("#barcode-search")!;
  const controlsEl = root.querySelector<HTMLDivElement>("#barcode-controls")!;
  const sortSelect = root.querySelector<HTMLSelectElement>("#barcode-sort")!;
  const statusEl = root.querySelector<HTMLDivElement>("#barcode-status")!;
  const listEl = root.querySelector<HTMLDivElement>("#barcode-list")!;
  const doneEl = root.querySelector<HTMLDivElement>("#barcode-done")!;
  const cameraPanel = root.querySelector<HTMLDivElement>("#camera-panel")!;
  const video = root.querySelector<HTMLVideoElement>("#camera-video")!;
  const cameraClose = root.querySelector<HTMLButtonElement>("#camera-scan-close")!;

  let sort: SortKey = readSetting(SORT_STORAGE_KEY) === "name" ? "name" : "location";
  sortSelect.value = sort;
  let openId: number | null = null;
  let saving = false;
  const saved: SavedEntry[] = [];

  function query(): string {
    return searchInput.value.trim().toLowerCase();
  }

  function inBrand(p: MissingBarcodeProduct): boolean {
    return brand === null || brandKey(p) === brand;
  }

  function brandCounts(): BrandCount[] {
    const brands = new Map<string, { name: string; count: number }>();
    for (const p of products) {
      const key = brandKey(p);
      const entry = brands.get(key) ?? { name: p.brandName ?? "No brand", count: 0 };
      entry.count++;
      brands.set(key, entry);
    }
    // Named brands alphabetically, "No brand" last.
    return [...brands.entries()].sort((a, b) =>
      a[0] === NO_BRAND ? 1 : b[0] === NO_BRAND ? -1 : compareText(a[1].name, b[1].name)
    );
  }

  function matchesSearch(p: MissingBarcodeProduct, q: string): boolean {
    return [p.name, p.defaultCode, p.sl].some((value) => value !== null && value.toLowerCase().includes(q));
  }

  /** Search matches from every brand (this brand's first), or this brand's list when not searching. */
  function visibleProducts(): MissingBarcodeProduct[] {
    const q = query();
    if (q) {
      return sortProducts(
        products.filter((p) => matchesSearch(p, q)),
        sort
      ).sort((a, b) => Number(!inBrand(a)) - Number(!inBrand(b)));
    }
    return brand === null ? [] : sortProducts(products.filter(inBrand), sort);
  }

  function renderRemaining() {
    const count = products.filter(inBrand).length;
    remainingCountEl.textContent = count.toLocaleString();
    remainingLabelEl.textContent =
      `${count === 1 ? "product" : "products"} without a barcode` +
      (brand === null ? ` across ${plural(brandCounts().length, "brand")}` : "");
  }

  function renderDone() {
    doneEl.innerHTML =
      saved.length > 0
        ? `
          <h4>Barcoded this session (${saved.length})</h4>
          <div class="results">
            ${saved
              .map(
                (entry) => `
                  <div class="result-row-static barcode-done-row">
                    <span class="barcode-done-check">${icon("check")}</span>
                    <div>
                      <div class="product-name">${escapeHtml(entry.productName)}</div>
                      <div class="muted">${escapeHtml(entry.barcode)}</div>
                    </div>
                  </div>`
              )
              .join("")}
          </div>`
        : "";
  }

  function renderForm(): string {
    return `
      <div class="move-form barcode-form">
        <label for="barcode-input">Barcode</label>
        <div class="search-row">
          <input id="barcode-input" type="text" autocomplete="off" placeholder="Scan the label or type it" data-scan-target="true" />
          <button id="camera-scan-toggle" type="button" aria-label="Scan with camera">${icon("camera")}</button>
        </div>
        <div id="barcode-form-status"></div>
        <div class="backorder-actions">
          <button type="button" class="btn-primary" id="barcode-save-btn">Save barcode</button>
          <button type="button" class="btn-secondary" id="barcode-skip-btn">Cancel</button>
        </div>
      </div>`;
  }

  function renderCard(p: MissingBarcodeProduct): string {
    const isOpen = p.id === openId;
    const locations = p.locations
      .map((loc) => `${escapeHtml(loc.locationName)} · ${formatQty(loc.quantity)}`)
      .join("<br />");
    // Name the brand whenever the product isn't from the brand being worked on.
    const showBrand = brand === null || brandKey(p) !== brand;
    return `
      <div class="count-line ${isOpen ? "count-line-open" : ""}" data-product-id="${p.id}">
        <div class="product-card-top">
          <div class="product-name">${escapeHtml(p.name)}</div>
          ${showBrand ? `<span class="state-pill">${escapeHtml(p.brandName ?? "No brand")}</span>` : ""}
        </div>
        <div class="product-meta">
          ${partNumberHtml(p.defaultCode)}
          <span>SL ${escapeHtml(p.sl ?? "—")}</span>
        </div>
        ${locations ? `<div class="muted barcode-locations">${locations}</div>` : ""}
        ${isOpen ? renderForm() : ""}
      </div>`;
  }

  function renderBrandRows(brands: BrandCount[]): string {
    return brands
      .map(
        ([key, b]) => `
          <a href="#/barcodes/${key}" class="result-row">
            <div class="product-card-top">
              <strong>${escapeHtml(b.name)}</strong>
              <span class="badge">${b.count.toLocaleString()}</span>
            </div>
          </a>`
      )
      .join("");
  }

  function render() {
    renderRemaining();
    const q = query();
    const visible = visibleProducts();
    controlsEl.classList.toggle("hidden", visible.length === 0);

    if (brand === null) {
      if (products.length === 0) {
        listEl.innerHTML = `<p class="muted">Every in-stock product has a barcode.</p>`;
        return;
      }
      const brands = brandCounts();
      if (!q) {
        listEl.innerHTML =
          `<p class="muted">Pick a brand to start, or search for any product.</p>` + renderBrandRows(brands);
        return;
      }
      const matchingBrands = brands.filter(([, b]) => b.name.toLowerCase().includes(q));
      listEl.innerHTML =
        matchingBrands.length === 0 && visible.length === 0
          ? `<p class="muted">No brand or product without a barcode matches that — it may already have one.</p>`
          : (matchingBrands.length > 0 ? `<h4>Brands</h4>${renderBrandRows(matchingBrands)}` : "") +
            (visible.length > 0 ? `<h4>Products</h4>${visible.map(renderCard).join("")}` : "");
      if (openId !== null) bindForm();
      return;
    }

    if (!q && visible.length === 0) {
      listEl.innerHTML = `
        <div class="barcode-brand-done">
          <span class="barcode-done-check">${icon("check")}</span>
          <div>
            <strong>Every ${escapeHtml(brandName!)} product has a barcode.</strong>
            <div><a href="#/barcodes" class="link-btn">Pick another brand →</a></div>
          </div>
        </div>`;
      return;
    }
    if (visible.length === 0) {
      listEl.innerHTML = `<p class="muted">No product without a barcode matches that — it may already have one.</p>`;
      return;
    }
    listEl.innerHTML = visible.map(renderCard).join("");
    if (openId !== null) bindForm();
  }

  function setFormStatus(html: string) {
    const formStatus = listEl.querySelector<HTMLDivElement>("#barcode-form-status");
    (formStatus ?? statusEl).innerHTML = html;
  }

  function bindForm() {
    const input = listEl.querySelector<HTMLInputElement>("#barcode-input");
    if (!input) return;
    const saveBtn = listEl.querySelector<HTMLButtonElement>("#barcode-save-btn")!;
    const skipBtn = listEl.querySelector<HTMLButtonElement>("#barcode-skip-btn")!;
    const cameraToggle = listEl.querySelector<HTMLButtonElement>("#camera-scan-toggle")!;

    input.addEventListener("keydown", (e) => {
      // A scanner's Enter is consumed (defaultPrevented) by HidScanner, which saves on its own.
      if (e.key === "Enter" && !e.defaultPrevented) save(input.value);
    });
    saveBtn.addEventListener("click", () => save(input.value));
    skipBtn.addEventListener("click", backToSearch);
    cameraToggle.addEventListener("click", () => {
      if (cameraPanel.classList.contains("hidden")) openCamera();
      else closeCamera();
    });

    input.closest(".count-line")?.scrollIntoView({ block: "nearest" });
    input.focus();
  }

  function openProduct(id: number | null) {
    openId = id;
    render();
  }

  /** Clears the search and puts the cursor back in it, ready to look up the next product. */
  function backToSearch() {
    searchInput.value = "";
    openProduct(null);
    searchInput.focus();
  }

  function restartAnimation(el: HTMLElement, className: string) {
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
  }

  function showSaved(product: MissingBarcodeProduct, barcode: string) {
    const productBrand = product.brandName ?? "No brand";
    const leftInBrand = products.filter((p) => brandKey(p) === brandKey(product)).length;
    const left =
      leftInBrand === 0
        ? `That's every ${escapeHtml(productBrand)} product done!`
        : `${plural(leftInBrand, "product")} left in ${escapeHtml(productBrand)}`;
    feedbackEl.innerHTML = `
      <div class="barcode-saved" role="status">
        <span class="barcode-saved-icon">${icon("check")}</span>
        <div>
          <strong>Barcode saved</strong>
          <div>${escapeHtml(product.name)}</div>
          <div class="barcode-saved-code">${escapeHtml(barcode)}</div>
          <div class="barcode-saved-left">${left}</div>
        </div>
      </div>`;
    restartAnimation(feedbackEl.firstElementChild as HTMLElement, "barcode-saved-flash");
    if (inBrand(product)) restartAnimation(remainingCountEl, "barcode-remaining-tick");
  }

  async function save(value: string) {
    const barcode = value.trim();
    const product = products.find((p) => p.id === openId);
    if (!product || saving) return;
    if (!barcode) {
      setFormStatus(`<span class="error">Scan or type a barcode first.</span>`);
      return;
    }

    saving = true;
    const saveBtn = listEl.querySelector<HTMLButtonElement>("#barcode-save-btn");
    if (saveBtn) saveBtn.disabled = true;
    setFormStatus("Saving…");
    try {
      await apiPut(`/inventory/${product.id}/barcode`, { barcode });
      products = products.filter((p) => p.id !== product.id);
      saved.unshift({ productName: product.name, barcode });
      vibrate(80);
      statusEl.innerHTML = "";
      backToSearch();
      showSaved(product, barcode);
      renderDone();
    } catch (err) {
      vibrate([60, 60, 60]);
      setFormStatus(`<span class="error">${escapeHtml(apiErrorMessage(err, "Failed to save barcode."))}</span>`);
      if (saveBtn) saveBtn.disabled = false;
      listEl.querySelector<HTMLInputElement>("#barcode-input")?.select();
    } finally {
      saving = false;
    }
  }

  function handleScan(code: string) {
    const input = listEl.querySelector<HTMLInputElement>("#barcode-input");
    if (openId === null || !input) {
      statusEl.innerHTML = `<p class="muted">Search for the product and tap it first, then scan its label.</p>`;
      return;
    }
    // The scanner may have typed into the field before its Enter arrived; use the clean scan.
    input.value = code;
    save(code);
  }

  listEl.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest(".barcode-form")) return;
    const card = target.closest<HTMLElement>("[data-product-id]");
    if (!card) return;
    const id = Number(card.dataset.productId);
    if (id === openId) return;
    statusEl.innerHTML = "";
    openProduct(id);
  });

  searchInput.addEventListener("input", () => {
    statusEl.innerHTML = "";
    openProduct(null);
  });

  searchInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    // Enter opens the top product match, so a unique part number or SL goes straight to the
    // barcode field; on the brand list with no product match, it opens the top brand.
    const first = visibleProducts()[0];
    if (first) {
      openProduct(first.id);
      return;
    }
    const brandRow = listEl.querySelector<HTMLAnchorElement>("a.result-row");
    if (brandRow) window.location.hash = brandRow.getAttribute("href")!.slice(1);
  });

  sortSelect.addEventListener("change", () => {
    sort = sortSelect.value as SortKey;
    writeSetting(SORT_STORAGE_KEY, sort);
    render();
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
      statusEl.innerHTML = `<p class="error">Camera unavailable: ${escapeHtml(
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

  cameraClose.addEventListener("click", closeCamera);

  const hidScanner = new HidScanner({ onScan: handleScan });
  hidScanner.attach();
  onLeavePage(() => {
    hidScanner.detach();
    closeCamera();
  });

  render();
  searchInput.focus();
}
