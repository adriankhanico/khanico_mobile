import type { LocationOption, ProductDetail } from "@khanico/shared";
import { apiErrorMessage, apiGet, apiPost, isAdmin } from "../lib/api-client";
import { icon } from "../lib/icons";
import { HidScanner } from "../lib/scanner/hid-scanner";

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

export async function openProductInfoModal(productId: number, fallbackName: string) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-panel">
      <button type="button" class="modal-close" aria-label="Close">${icon("x")}</button>
      <h3>${escapeHtml(fallbackName)}</h3>
      <p class="muted">Loading details…</p>
    </div>
  `;
  document.body.appendChild(overlay);

  function close() {
    destHidScanner?.detach();
    overlay.remove();
  }

  overlay.querySelector<HTMLButtonElement>(".modal-close")!.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  const body = overlay.querySelector<HTMLDivElement>(".modal-panel")!;

  let detail: ProductDetail;
  try {
    detail = await apiGet<ProductDetail>(`/inventory/${productId}/detail`);
  } catch {
    body.innerHTML = `
      <button type="button" class="modal-close" aria-label="Close">${icon("x")}</button>
      <h3>${escapeHtml(fallbackName)}</h3>
      <p class="error">Failed to load product details.</p>
    `;
    body.querySelector<HTMLButtonElement>(".modal-close")!.addEventListener("click", close);
    return;
  }

  let openMoveLocationId: number | null = null;
  let destHidScanner: HidScanner | null = null;

  async function refreshDetail() {
    detail = await apiGet<ProductDetail>(`/inventory/${productId}/detail`);
    render();
  }

  function render() {
    destHidScanner?.detach();
    destHidScanner = null;

    body.innerHTML = `
      <button type="button" class="modal-close" aria-label="Close">${icon("x")}</button>
      <h3>${escapeHtml(detail.name)}</h3>
      <div class="modal-meta">
        <div><span class="muted">SKU</span> ${escapeHtml(detail.defaultCode ?? "—")}</div>
        <div><span class="muted">Barcode</span> ${escapeHtml(detail.barcode ?? "—")}</div>
        <div><span class="muted">SL</span> ${escapeHtml(detail.sl ?? "—")}</div>
        ${
          isAdmin()
            ? `<div><span class="muted">List price</span> $${detail.listPrice.toFixed(2)}</div>
               <div><span class="muted">Price incl. VAT</span> $${detail.priceWithVat.toFixed(2)}</div>`
            : ""
        }
        <div><span class="muted">Total on hand</span> ${detail.qtyAvailable}</div>
      </div>
      ${detail.description ? `<p>${escapeHtml(detail.description)}</p>` : ""}
      <h4>On hand by location</h4>
      <div class="modal-locations">
        ${
          detail.locations.length > 0
            ? detail.locations
                .map((loc) => {
                  const isOpen = openMoveLocationId === loc.locationId;
                  return `
                    <div class="location-row-wrap">
                      <div class="location-row">
                        <span>${escapeHtml(loc.locationName)}</span>
                        <span class="location-row-actions">
                          <span>${loc.quantity}</span>
                          <button type="button" class="link-btn move-toggle-btn" data-move-toggle-location-id="${
                            loc.locationId
                          }">${isOpen ? "Cancel" : "Move"}</button>
                        </span>
                      </div>
                      ${isOpen ? renderMoveForm(loc.locationId, loc.quantity) : ""}
                    </div>`;
                })
                .join("")
            : `<p class="muted">No stock at any location.</p>`
        }
      </div>
    `;

    body.querySelector<HTMLButtonElement>(".modal-close")!.addEventListener("click", close);

    body.querySelectorAll<HTMLButtonElement>("[data-move-toggle-location-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const locationId = Number(btn.dataset.moveToggleLocationId);
        openMoveLocationId = openMoveLocationId === locationId ? null : locationId;
        render();
      });
    });

    if (openMoveLocationId !== null) {
      bindMoveForm(openMoveLocationId);
    }
  }

  function renderMoveForm(sourceLocationId: number, availableQty: number): string {
    return `
      <div class="move-form" data-move-form-location-id="${sourceLocationId}">
        <label>Move to</label>
        <input type="search" class="move-dest-search" placeholder="Search or scan destination location" autocomplete="off" data-scan-target="true" />
        <div class="move-dest-status"></div>
        <div class="results move-dest-results"></div>
        <div class="move-dest-selected hidden"></div>
        <label>Quantity</label>
        <input type="number" class="qty-input move-qty-input" value="${availableQty}" min="0.01" max="${availableQty}" step="any" />
        <button type="button" class="btn-primary move-submit-btn" disabled>Move stock</button>
        <div class="move-status"></div>
      </div>
    `;
  }

  function bindMoveForm(sourceLocationId: number) {
    const form = body.querySelector<HTMLDivElement>(`[data-move-form-location-id="${sourceLocationId}"]`);
    if (!form) return;

    const destSearch = form.querySelector<HTMLInputElement>(".move-dest-search")!;
    const destResults = form.querySelector<HTMLDivElement>(".move-dest-results")!;
    const destSelectedEl = form.querySelector<HTMLDivElement>(".move-dest-selected")!;
    const destStatusEl = form.querySelector<HTMLDivElement>(".move-dest-status")!;
    const qtyInput = form.querySelector<HTMLInputElement>(".move-qty-input")!;
    const submitBtn = form.querySelector<HTMLButtonElement>(".move-submit-btn")!;
    const statusEl = form.querySelector<HTMLDivElement>(".move-status")!;

    let selectedDest: LocationOption | null = null;

    function updateSubmitEnabled() {
      const qty = Number(qtyInput.value);
      submitBtn.disabled = !selectedDest || !Number.isFinite(qty) || qty <= 0;
    }

    function selectDestination(location: LocationOption) {
      selectedDest = location;
      destResults.innerHTML = "";
      destSearch.value = "";
      destStatusEl.innerHTML = "";
      destSelectedEl.classList.remove("hidden");
      destSelectedEl.innerHTML = `Destination: <strong>${escapeHtml(location.name)}</strong>`;
      updateSubmitEnabled();
    }

    let debounce: ReturnType<typeof setTimeout> | undefined;
    destSearch.addEventListener("input", () => {
      const query = destSearch.value;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(async () => {
        if (!query.trim()) {
          destResults.innerHTML = "";
          return;
        }
        try {
          const locations = await apiGet<LocationOption[]>(
            `/inventory/locations/search?q=${encodeURIComponent(query)}`
          );
          destResults.innerHTML = locations
            .filter((loc) => loc.id !== sourceLocationId)
            .map((loc) => `<div class="result-row" data-location-id="${loc.id}">${escapeHtml(loc.name)}</div>`)
            .join("");
        } catch {
          destResults.innerHTML = `<p class="error">Location search failed.</p>`;
        }
      }, 250);
    });

    destResults.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>("[data-location-id]");
      if (!row) return;
      selectDestination({ id: Number(row.dataset.locationId), name: row.textContent ?? "", barcode: null });
    });

    async function handleDestScan(barcode: string) {
      try {
        const locations = await apiGet<LocationOption[]>(
          `/inventory/locations/search?q=${encodeURIComponent(barcode)}`
        );
        const match = locations.find((loc) => loc.barcode === barcode) ?? locations[0];
        if (!match || match.id === sourceLocationId) {
          destStatusEl.innerHTML = `<span class="error">No destination location found for barcode ${escapeHtml(
            barcode
          )}</span>`;
          return;
        }
        selectDestination(match);
      } catch (err) {
        destStatusEl.innerHTML = `<span class="error">${escapeHtml(
          apiErrorMessage(err, `No destination location found for barcode ${barcode}`)
        )}</span>`;
      }
    }

    destHidScanner = new HidScanner({ onScan: handleDestScan });
    destHidScanner.attach();

    qtyInput.addEventListener("input", updateSubmitEnabled);

    submitBtn.addEventListener("click", async () => {
      if (!selectedDest) return;
      const quantity = Number(qtyInput.value);
      submitBtn.disabled = true;
      statusEl.textContent = "Moving…";
      try {
        await apiPost(`/inventory/${productId}/move`, {
          sourceLocationId,
          destLocationId: selectedDest.id,
          quantity,
        });
        openMoveLocationId = null;
        await refreshDetail();
      } catch (err) {
        statusEl.innerHTML = `<span class="error">${escapeHtml(
          apiErrorMessage(err, "Failed to move stock.")
        )}</span>`;
        submitBtn.disabled = false;
      }
    });
  }

  render();
}
