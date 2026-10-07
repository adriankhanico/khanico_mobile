import type { LocationOption, ProductDetail } from "@khanico/shared";
import { apiDelete, apiErrorMessage, apiGet, apiPost, apiPut, isAdmin } from "../lib/api-client";
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
    barcodeHidScanner?.detach();
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
  let editingBarcode = false;
  let addingExtraBarcode = false;
  /** Result of the last additional-barcode action, shown above the list until the next render-changing action. */
  let extraBarcodeStatus = "";
  let destHidScanner: HidScanner | null = null;
  let barcodeHidScanner: HidScanner | null = null;

  async function refreshDetail() {
    detail = await apiGet<ProductDetail>(`/inventory/${productId}/detail`);
    render();
  }

  function render() {
    destHidScanner?.detach();
    destHidScanner = null;
    barcodeHidScanner?.detach();
    barcodeHidScanner = null;

    body.innerHTML = `
      <button type="button" class="modal-close" aria-label="Close">${icon("x")}</button>
      <h3>${escapeHtml(detail.name)}</h3>
      <div class="modal-meta">
        <div><span class="muted">Part #</span> <strong class="part-number-value">${escapeHtml(detail.defaultCode ?? "—")}</strong></div>
        <div>
          <span class="muted">Barcode</span> ${escapeHtml(detail.barcode ?? "—")}
          ${editingBarcode || addingExtraBarcode ? "" : `<button type="button" class="link-btn barcode-edit-btn" id="edit-barcode-btn">Edit</button>`}
        </div>
        <div><span class="muted">SL</span> ${escapeHtml(detail.sl ?? "—")}</div>
        ${
          isAdmin()
            ? `<div><span class="muted">List price</span> $${detail.listPrice.toFixed(2)}</div>
               <div><span class="muted">Price incl. VAT</span> $${detail.priceWithVat.toFixed(2)}</div>`
            : ""
        }
        <div><span class="muted">Total on hand</span> ${detail.qtyAvailable}</div>
      </div>
      ${
        editingBarcode
          ? `
            <div class="move-form" id="barcode-edit-form">
              <label>Barcode</label>
              <input type="text" id="barcode-input" autocomplete="off" value="${escapeHtml(
                detail.barcode ?? ""
              )}" data-scan-target="true" />
              <div id="barcode-status"></div>
              <div class="backorder-actions">
                <button type="button" class="btn-primary" id="save-barcode-btn">Save</button>
                <button type="button" class="btn-secondary" id="cancel-barcode-btn">Cancel</button>
              </div>
            </div>
          `
          : ""
      }
      ${renderExtraBarcodes()}
      ${detail.description ? `<p>${escapeHtml(detail.description)}</p>` : ""}
      <button type="button" id="view-history-btn" class="link-btn">View move history</button>
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

    body.querySelector<HTMLButtonElement>("#view-history-btn")!.addEventListener("click", () => {
      close();
      window.location.hash = `/product-history/${productId}/${encodeURIComponent(detail.name)}`;
    });

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

    const editBarcodeBtn = body.querySelector<HTMLButtonElement>("#edit-barcode-btn");
    if (editBarcodeBtn) {
      editBarcodeBtn.addEventListener("click", () => {
        editingBarcode = true;
        addingExtraBarcode = false;
        render();
      });
    }

    if (editingBarcode) {
      bindBarcodeForm();
    }
    bindExtraBarcodes();
  }

  /** Additional barcodes from the khanico_multi_barcode Odoo module; nothing when it isn't installed. */
  function renderExtraBarcodes(): string {
    const multi = detail.multiBarcode;
    if (!multi) return "";
    const rows = multi.barcodes
      .map(
        (b) => `
          <div class="extra-barcode-row">
            <div class="extra-barcode-text">
              <span class="extra-barcode-code">${escapeHtml(b.barcode)}</span>
              ${b.note ? `<span class="muted extra-barcode-note">${escapeHtml(b.note)}</span>` : ""}
            </div>
            <span class="extra-barcode-actions">
              ${multi.canMakeMain ? `<button type="button" class="link-btn" data-make-main-id="${b.id}">Make main</button>` : ""}
              ${multi.canRemove ? `<button type="button" class="link-btn link-btn-danger" data-remove-barcode-id="${b.id}">Remove</button>` : ""}
            </span>
          </div>`
      )
      .join("");
    return `
      <div class="extra-barcodes">
        <div class="extra-barcodes-head">
          <span class="muted">Additional barcodes</span>
          ${
            addingExtraBarcode || editingBarcode
              ? ""
              : `<button type="button" class="link-btn" id="add-extra-barcode-btn">${icon("plus")} Add</button>`
          }
        </div>
        ${extraBarcodeStatus}
        ${rows || `<p class="muted extra-barcodes-empty">None yet.</p>`}
        ${
          addingExtraBarcode
            ? `
              <div class="move-form" id="extra-barcode-form">
                <label for="extra-barcode-input">New barcode</label>
                <input type="text" id="extra-barcode-input" autocomplete="off" placeholder="Scan or type" data-scan-target="true" />
                <label for="extra-barcode-note">Note (optional)</label>
                <input type="text" id="extra-barcode-note" autocomplete="off" placeholder="e.g. Supplier: Parker" data-scan-target="true" />
                <div id="extra-barcode-form-status"></div>
                <div class="backorder-actions">
                  <button type="button" class="btn-primary" id="save-extra-barcode-btn">Add barcode</button>
                  <button type="button" class="btn-secondary" id="cancel-extra-barcode-btn">Cancel</button>
                </div>
              </div>`
            : ""
        }
      </div>`;
  }

  function bindExtraBarcodes() {
    const multi = detail.multiBarcode;
    if (!multi) return;

    body.querySelector<HTMLButtonElement>("#add-extra-barcode-btn")?.addEventListener("click", () => {
      addingExtraBarcode = true;
      extraBarcodeStatus = "";
      render();
    });

    body.querySelectorAll<HTMLButtonElement>("[data-make-main-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const entry = multi.barcodes.find((b) => b.id === Number(btn.dataset.makeMainId));
        if (!entry) return;
        const keepNote = detail.barcode ? ` ${detail.barcode} will be kept as an additional barcode.` : "";
        if (!window.confirm(`Make ${entry.barcode} the main barcode?${keepNote}`)) return;
        await runExtraBarcodeAction(
          btn,
          () => apiPost(`/inventory/${productId}/barcodes/${entry.id}/make-main`, {}),
          `${entry.barcode} is now the main barcode.`,
          "Failed to change the main barcode."
        );
      });
    });

    body.querySelectorAll<HTMLButtonElement>("[data-remove-barcode-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const entry = multi.barcodes.find((b) => b.id === Number(btn.dataset.removeBarcodeId));
        if (!entry) return;
        if (!window.confirm(`Remove additional barcode ${entry.barcode}?`)) return;
        await runExtraBarcodeAction(
          btn,
          () => apiDelete(`/inventory/${productId}/barcodes/${entry.id}`),
          `Removed ${entry.barcode}.`,
          "Failed to remove barcode."
        );
      });
    });

    const form = body.querySelector<HTMLDivElement>("#extra-barcode-form");
    if (!form) return;
    const input = form.querySelector<HTMLInputElement>("#extra-barcode-input")!;
    const noteInput = form.querySelector<HTMLInputElement>("#extra-barcode-note")!;
    const statusEl = form.querySelector<HTMLDivElement>("#extra-barcode-form-status")!;
    const saveBtn = form.querySelector<HTMLButtonElement>("#save-extra-barcode-btn")!;
    const cancelBtn = form.querySelector<HTMLButtonElement>("#cancel-extra-barcode-btn")!;

    async function save() {
      const barcode = input.value.trim();
      if (!barcode) {
        statusEl.innerHTML = `<span class="error">Scan or type a barcode first.</span>`;
        return;
      }
      saveBtn.disabled = true;
      statusEl.textContent = "Saving…";
      try {
        await apiPost(`/inventory/${productId}/barcodes`, { barcode, note: noteInput.value });
        addingExtraBarcode = false;
        extraBarcodeStatus = `<p class="success">Added ${escapeHtml(barcode)}.</p>`;
        await refreshDetail();
      } catch (err) {
        statusEl.innerHTML = `<span class="error">${escapeHtml(apiErrorMessage(err, "Failed to add barcode."))}</span>`;
        saveBtn.disabled = false;
        input.select();
      }
    }

    saveBtn.addEventListener("click", save);
    input.addEventListener("keydown", (e) => {
      // A scanner's Enter is consumed by the HID scanner below, which fills the field and moves on to the note.
      if (e.key === "Enter" && !e.defaultPrevented) save();
    });
    noteInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") save();
    });
    cancelBtn.addEventListener("click", () => {
      addingExtraBarcode = false;
      render();
    });

    barcodeHidScanner = new HidScanner({
      onScan: (code) => {
        // A scan always fills the barcode field and saves (the note is optional). If the note field
        // had focus, the scanner typed the code into it first — take that back out.
        if (document.activeElement === noteInput && noteInput.value.endsWith(code)) {
          noteInput.value = noteInput.value.slice(0, -code.length);
        }
        input.value = code;
        save();
      },
    });
    barcodeHidScanner.attach();
    input.focus();
  }

  async function runExtraBarcodeAction(
    btn: HTMLButtonElement,
    action: () => Promise<unknown>,
    success: string,
    fallbackError: string
  ) {
    btn.disabled = true;
    try {
      await action();
      extraBarcodeStatus = `<p class="success">${escapeHtml(success)}</p>`;
      await refreshDetail();
    } catch (err) {
      extraBarcodeStatus = `<p class="error">${escapeHtml(apiErrorMessage(err, fallbackError))}</p>`;
      render();
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

  function bindBarcodeForm() {
    const form = body.querySelector<HTMLDivElement>("#barcode-edit-form");
    if (!form) return;

    const input = form.querySelector<HTMLInputElement>("#barcode-input")!;
    const statusEl = form.querySelector<HTMLDivElement>("#barcode-status")!;
    const saveBtn = form.querySelector<HTMLButtonElement>("#save-barcode-btn")!;
    const cancelBtn = form.querySelector<HTMLButtonElement>("#cancel-barcode-btn")!;

    input.focus();
    input.select();

    async function save(value: string) {
      const trimmed = value.trim();
      if (!trimmed) {
        statusEl.innerHTML = `<span class="error">Barcode cannot be empty.</span>`;
        return;
      }
      saveBtn.disabled = true;
      statusEl.textContent = "Saving…";
      try {
        await apiPut(`/inventory/${productId}/barcode`, { barcode: trimmed });
        editingBarcode = false;
        await refreshDetail();
      } catch (err) {
        statusEl.innerHTML = `<span class="error">${escapeHtml(
          apiErrorMessage(err, "Failed to save barcode.")
        )}</span>`;
        saveBtn.disabled = false;
      }
    }

    saveBtn.addEventListener("click", () => save(input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") save(input.value);
    });
    cancelBtn.addEventListener("click", () => {
      editingBarcode = false;
      render();
    });

    barcodeHidScanner = new HidScanner({
      onScan: (code) => {
        input.value = code;
        save(code);
      },
    });
    barcodeHidScanner.attach();
  }

  render();
}
