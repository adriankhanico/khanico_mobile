import type { Product } from "@khanico/shared";
import { apiGet, isAdmin } from "../lib/api-client";
import { createCameraScanner, type CameraScanner } from "../lib/scanner/camera-scanner";
import { HidScanner } from "../lib/scanner/hid-scanner";
import { icon } from "../lib/icons";
import { openProductInfoModal } from "./product-info-modal";

let debounceTimer: ReturnType<typeof setTimeout> | undefined;

function renderResults(container: HTMLElement, products: Product[]) {
  if (products.length === 0) {
    container.innerHTML = `<p class="muted">No matches.</p>`;
    return;
  }

  container.innerHTML = products
    .map(
      (p) => `
        <div class="product-card" data-product-id="${p.id}" data-product-name="${escapeHtml(p.name)}">
          <div class="product-card-top">
            <div class="product-name">${escapeHtml(p.name)}</div>
            <span class="stamp">${p.qtyAvailable}</span>
          </div>
          <div class="product-meta">
            <span>${escapeHtml(p.defaultCode ?? "—")}</span>
            <span>SL ${escapeHtml(p.sl ?? "—")}</span>
          </div>
          ${
            isAdmin()
              ? `<div class="product-price-row">
                  <span>$${p.listPrice.toFixed(2)}</span>
                  <span class="muted">$${p.priceWithVat.toFixed(2)} incl. VAT</span>
                </div>`
              : ""
          }
        </div>`
    )
    .join("");

  container.querySelectorAll<HTMLElement>("[data-product-id]").forEach((card) => {
    card.addEventListener("click", () => {
      const productId = Number(card.dataset.productId);
      const productName = card.dataset.productName ?? "";
      openProductInfoModal(productId, productName);
    });
  });
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

export function mountInventorySearch(root: HTMLElement) {
  root.innerHTML = `
    <section class="page">
      <h2>Search Inventory</h2>
      <div class="search-row">
        <input
          id="inventory-search-input"
          type="search"
          placeholder="Scan or type barcode / SKU / name"
          autocomplete="off"
          data-scan-target="true"
        />
        <button id="camera-scan-toggle" type="button" aria-label="Scan with camera">${icon("camera")}</button>
      </div>
      <div id="camera-panel" class="camera-panel hidden">
        <video id="camera-video" playsinline muted></video>
        <button id="camera-scan-close" type="button">Close</button>
      </div>
      <div id="inventory-results" class="results"></div>
    </section>
  `;

  const input = root.querySelector<HTMLInputElement>("#inventory-search-input")!;
  const results = root.querySelector<HTMLDivElement>("#inventory-results")!;
  const cameraPanel = root.querySelector<HTMLDivElement>("#camera-panel")!;
  const video = root.querySelector<HTMLVideoElement>("#camera-video")!;
  const cameraToggle = root.querySelector<HTMLButtonElement>("#camera-scan-toggle")!;
  const cameraClose = root.querySelector<HTMLButtonElement>("#camera-scan-close")!;

  let scanner: CameraScanner | null = null;

  async function runSearch(query: string) {
    if (!query.trim()) {
      results.innerHTML = "";
      return;
    }
    try {
      const products = await apiGet<Product[]>(`/inventory/search?q=${encodeURIComponent(query)}`);
      renderResults(results, products);
    } catch {
      results.innerHTML = `<p class="error">Search failed.</p>`;
    }
  }

  input.addEventListener("input", () => {
    const query = input.value;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runSearch(query), 250);
  });

  async function openCamera() {
    cameraPanel.classList.remove("hidden");
    scanner = createCameraScanner(video, (code) => {
      input.value = code;
      closeCamera();
      runSearch(code);
    });
    try {
      await scanner.start();
    } catch (err) {
      results.innerHTML = `<p class="error">Camera unavailable: ${escapeHtml(
        err instanceof Error ? err.message : String(err)
      )}</p>`;
      closeCamera();
    }
  }

  function closeCamera() {
    scanner?.stop();
    scanner = null;
    cameraPanel.classList.add("hidden");
  }

  cameraToggle.addEventListener("click", () => {
    if (cameraPanel.classList.contains("hidden")) {
      openCamera();
    } else {
      closeCamera();
    }
  });
  cameraClose.addEventListener("click", closeCamera);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) closeCamera();
  });

  const hidScanner = new HidScanner({
    onScan: (code) => {
      input.value = code;
      runSearch(code);
    },
  });
  hidScanner.attach();

  input.focus();
}
