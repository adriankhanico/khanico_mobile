import type {
  BackorderDecisionResult,
  Picking,
  PickingLine,
  PickingStatusFilter,
  PickingTypeGroup,
  ValidatePickingResult,
} from "@khanico/shared";
import { apiErrorMessage, apiGet, apiPost } from "../lib/api-client";
import { HidScanner } from "../lib/scanner/hid-scanner";
import { createCameraScanner, type CameraScanner } from "../lib/scanner/camera-scanner";
import { icon } from "../lib/icons";
import { openProductInfoModal } from "./product-info-modal";

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function navigateTo(path: string) {
  window.location.hash = path;
}

export function mountPickingRoute(root: HTMLElement, segments: string[]) {
  const [typeId, pickingId] = segments;
  if (!typeId) {
    loadCategoryList(root);
  } else if (!pickingId) {
    loadPickingListByTypeId(root, Number(typeId));
  } else {
    loadPickingDetailById(root, Number(typeId), Number(pickingId));
  }
}

function renderPickingRow(p: Picking): string {
  return `
    <div class="result-row" data-picking-id="${p.id}">
      <div class="product-card-top">
        <strong>${escapeHtml(p.name)}</strong>
        <span class="state-pill state-${escapeHtml(p.state)}">${escapeHtml(p.state)}</span>
      </div>
      <div class="product-meta">
        <span>${escapeHtml(p.origin ?? "—")}</span>
        <span>${escapeHtml(p.partnerName ?? "—")}</span>
      </div>
    </div>`;
}

async function loadCategoryList(root: HTMLElement) {
  root.innerHTML = `<section class="page"><p class="muted">Loading transfer types…</p></section>`;

  let groups: PickingTypeGroup[] = [];
  try {
    groups = await apiGet<PickingTypeGroup[]>("/pickings/grouped");
  } catch {
    root.innerHTML = `<section class="page"><p class="error">Failed to load transfer types.</p></section>`;
    return;
  }

  root.innerHTML = `
    <section class="page">
      <h2>Transfers</h2>
      <input
        id="transfer-search-input"
        type="search"
        placeholder="Search by transfer #, source doc, or name"
        autocomplete="off"
      />
      <div id="category-results" class="results"></div>
      <div id="search-results" class="results hidden"></div>
    </section>
  `;

  const searchInput = root.querySelector<HTMLInputElement>("#transfer-search-input")!;
  const categoryResultsEl = root.querySelector<HTMLDivElement>("#category-results")!;
  const searchResultsEl = root.querySelector<HTMLDivElement>("#search-results")!;

  function renderCategories() {
    categoryResultsEl.innerHTML =
      groups
        .map(
          (g) => `
            <div class="result-row category-row" data-picking-type-id="${g.pickingTypeId}">
              <strong>${escapeHtml(g.pickingTypeName)}</strong>
              <span class="badge">${g.pickings.length}</span>
            </div>`
        )
        .join("") || `<p class="muted">No open transfers.</p>`;

    categoryResultsEl.querySelectorAll<HTMLElement>("[data-picking-type-id]").forEach((row) => {
      row.addEventListener("click", () => {
        navigateTo(`/picking/${row.dataset.pickingTypeId}`);
      });
    });
  }

  function bindSearchResultClicks(pickings: Picking[]) {
    searchResultsEl.querySelectorAll<HTMLElement>("[data-picking-id]").forEach((row) => {
      row.addEventListener("click", () => {
        const picking = pickings.find((p) => p.id === Number(row.dataset.pickingId))!;
        navigateTo(`/picking/${picking.pickingTypeId}/${picking.id}`);
      });
    });
  }

  renderCategories();

  let debounce: ReturnType<typeof setTimeout> | undefined;
  searchInput.addEventListener("input", () => {
    const query = searchInput.value;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(async () => {
      if (!query.trim()) {
        categoryResultsEl.classList.remove("hidden");
        searchResultsEl.classList.add("hidden");
        return;
      }
      categoryResultsEl.classList.add("hidden");
      searchResultsEl.classList.remove("hidden");
      try {
        const pickings = await apiGet<Picking[]>(`/pickings?q=${encodeURIComponent(query)}`);
        searchResultsEl.innerHTML =
          pickings.map(renderPickingRow).join("") || `<p class="muted">No matching transfers.</p>`;
        bindSearchResultClicks(pickings);
      } catch {
        searchResultsEl.innerHTML = `<p class="error">Search failed.</p>`;
      }
    }, 250);
  });
}

const STATUS_FILTERS: { value: PickingStatusFilter; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "done", label: "Done" },
  { value: "all", label: "All" },
];

async function loadPickingListByTypeId(root: HTMLElement, pickingTypeId: number) {
  root.innerHTML = `<section class="page"><p class="muted">Loading…</p></section>`;

  let groups: PickingTypeGroup[] = [];
  try {
    groups = await apiGet<PickingTypeGroup[]>("/pickings/grouped");
  } catch {
    root.innerHTML = `<section class="page"><p class="error">Failed to load transfers.</p></section>`;
    return;
  }

  const group = groups.find((g) => g.pickingTypeId === pickingTypeId);
  if (!group) {
    root.innerHTML = `<section class="page"><p class="error">Transfer type not found.</p></section>`;
    return;
  }

  loadPickingList(root, group);
}

function loadPickingList(root: HTMLElement, group: PickingTypeGroup) {
  root.innerHTML = `
    <section class="page">
      <button id="back-to-categories" type="button" class="link-btn">← Back to transfer types</button>
      <h2>${escapeHtml(group.pickingTypeName)}</h2>
      <div class="status-filter-row">
        ${STATUS_FILTERS.map(
          (f) =>
            `<button type="button" class="status-filter-btn ${f.value === "pending" ? "active" : ""}" data-status="${f.value}">${f.label}</button>`
        ).join("")}
      </div>
      <input
        id="group-search-input"
        type="search"
        placeholder="Search by transfer #, source doc, or name"
        autocomplete="off"
      />
      <div id="group-results" class="results"></div>
    </section>
  `;

  const searchInput = root.querySelector<HTMLInputElement>("#group-search-input")!;
  const resultsEl = root.querySelector<HTMLDivElement>("#group-results")!;
  const filterButtons = root.querySelectorAll<HTMLButtonElement>("[data-status]");

  let currentPickings: Picking[] = group.pickings;
  let currentStatus: PickingStatusFilter = "pending";

  function renderInto(pickings: Picking[]) {
    resultsEl.innerHTML =
      pickings.map(renderPickingRow).join("") || `<p class="muted">No matching transfers.</p>`;

    resultsEl.querySelectorAll<HTMLElement>("[data-picking-id]").forEach((row) => {
      row.addEventListener("click", () => {
        navigateTo(`/picking/${group.pickingTypeId}/${row.dataset.pickingId}`);
      });
    });
  }

  function applySearch() {
    const query = searchInput.value.trim().toLowerCase();
    if (!query) {
      renderInto(currentPickings);
      return;
    }
    const filtered = currentPickings.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        (p.origin ?? "").toLowerCase().includes(query) ||
        (p.partnerName ?? "").toLowerCase().includes(query)
    );
    renderInto(filtered);
  }

  renderInto(currentPickings);

  root.querySelector<HTMLButtonElement>("#back-to-categories")!.addEventListener("click", () => {
    history.back();
  });

  searchInput.addEventListener("input", applySearch);

  filterButtons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const status = btn.dataset.status as PickingStatusFilter;
      if (status === currentStatus) return;
      currentStatus = status;
      filterButtons.forEach((b) => b.classList.toggle("active", b === btn));

      if (status === "pending") {
        currentPickings = group.pickings;
        applySearch();
        return;
      }

      resultsEl.innerHTML = `<p class="muted">Loading…</p>`;
      try {
        currentPickings = await apiGet<Picking[]>(
          `/pickings?picking_type_id=${group.pickingTypeId}&status=${status}`
        );
        applySearch();
      } catch {
        resultsEl.innerHTML = `<p class="error">Failed to load transfers.</p>`;
      }
    });
  });
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

async function loadPickingDetailById(root: HTMLElement, pickingTypeId: number, pickingId: number) {
  root.innerHTML = `<section class="page"><p class="muted">Loading…</p></section>`;

  let groups: PickingTypeGroup[] = [];
  try {
    groups = await apiGet<PickingTypeGroup[]>("/pickings/grouped");
  } catch {
    root.innerHTML = `<section class="page"><p class="error">Failed to load transfer.</p></section>`;
    return;
  }

  const group = groups.find((g) => g.pickingTypeId === pickingTypeId);
  let picking = group?.pickings.find((p) => p.id === pickingId);

  if (!picking) {
    // Not in the pending set (e.g. already done/cancelled, or filtered) — fetch directly.
    try {
      const all = await apiGet<Picking[]>(`/pickings?picking_type_id=${pickingTypeId}&status=all`);
      picking = all.find((p) => p.id === pickingId);
    } catch {
      // fall through to not-found below
    }
  }

  if (!picking) {
    root.innerHTML = `<section class="page"><p class="error">Transfer not found.</p></section>`;
    return;
  }

  mountPickingDetail(root, picking);
}

async function mountReadOnlyPickingDetail(root: HTMLElement, picking: Picking) {
  root.innerHTML = `<section class="page"><p class="muted">Loading…</p></section>`;

  let lines: PickingLine[] = [];
  try {
    lines = await apiGet<PickingLine[]>(`/pickings/${picking.id}/lines`);
  } catch {
    lines = [];
  }

  const isCancelled = picking.state === "cancel";

  root.innerHTML = `
    <section class="page">
      <button id="back-to-list" type="button" class="link-btn">← Back to list</button>
      <h2>${escapeHtml(picking.name)}</h2>
      <p class="muted">${escapeHtml(picking.origin ?? "—")} · ${escapeHtml(picking.partnerName ?? "—")}</p>

      <div class="completed-banner ${isCancelled ? "cancelled" : ""}">
        <div class="completed-icon">${isCancelled ? icon("x") : icon("check")}</div>
        <div>
          <div class="completed-title">${isCancelled ? "Transfer cancelled" : "Validated"}</div>
          ${
            !isCancelled
              ? `<div class="completed-detail">${escapeHtml(formatDateTime(picking.dateDone))}</div>`
              : ""
          }
        </div>
      </div>

      <div class="order-lines">
        ${lines
          .map(
            (line) => `
              <div class="order-line-card picking-line-card picked">
                <div class="picking-line-row">
                  <div>
                    <span class="line-name" data-info-line-id="${line.id}">${escapeHtml(line.productName)}</span>
                    ${
                      line.productDescription && line.productDescription !== line.productName
                        ? `<div class="line-description">${escapeHtml(line.productDescription)}</div>`
                        : ""
                    }
                    <div class="muted line-locations">${escapeHtml(line.locationName)} → ${escapeHtml(
          line.locationDestName
        )}</div>
                  </div>
                  <span class="stamp">${line.quantity}</span>
                </div>
              </div>`
          )
          .join("")}
      </div>
    </section>
  `;

  root.querySelector<HTMLButtonElement>("#back-to-list")!.addEventListener("click", () => history.back());

  root.querySelectorAll<HTMLElement>("[data-info-line-id]").forEach((el) => {
    el.addEventListener("click", () => {
      const lineId = Number(el.dataset.infoLineId);
      const line = lines.find((l) => l.id === lineId)!;
      openProductInfoModal(line.productId, line.productName);
    });
  });
}

async function mountPickingDetail(root: HTMLElement, picking: Picking) {
  if (picking.state === "done" || picking.state === "cancel") {
    await mountReadOnlyPickingDetail(root, picking);
    return;
  }

  root.innerHTML = `
    <section class="page">
      <button id="back-to-list" type="button" class="link-btn">← Back to list</button>
      <h2>${escapeHtml(picking.name)}</h2>
      <p class="muted">${escapeHtml(picking.origin ?? "—")} · ${escapeHtml(picking.partnerName ?? "—")}</p>

      <div class="search-row">
        <input
          id="scan-input"
          type="search"
          placeholder="Scan or type barcode"
          autocomplete="off"
          data-scan-target="true"
        />
        <button id="camera-scan-toggle" type="button" aria-label="Scan with camera">${icon("camera")}</button>
      </div>
      <div id="camera-panel" class="camera-panel hidden">
        <video id="camera-video" playsinline muted></video>
        <button id="camera-scan-close" type="button">Close</button>
      </div>

      <div id="scan-status"></div>
      <div id="picking-lines" class="order-lines"></div>

      <button id="validate-picking" type="button">Validate Picking</button>
      <div id="validate-status"></div>
    </section>
  `;

  const backBtn = root.querySelector<HTMLButtonElement>("#back-to-list")!;
  const scanInput = root.querySelector<HTMLInputElement>("#scan-input")!;
  const scanStatus = root.querySelector<HTMLDivElement>("#scan-status")!;
  const linesEl = root.querySelector<HTMLDivElement>("#picking-lines")!;
  const validateBtn = root.querySelector<HTMLButtonElement>("#validate-picking")!;
  const validateStatus = root.querySelector<HTMLDivElement>("#validate-status")!;
  const cameraPanel = root.querySelector<HTMLDivElement>("#camera-panel")!;
  const video = root.querySelector<HTMLVideoElement>("#camera-video")!;
  const cameraToggle = root.querySelector<HTMLButtonElement>("#camera-scan-toggle")!;
  const cameraClose = root.querySelector<HTMLButtonElement>("#camera-scan-close")!;

  backBtn.addEventListener("click", () => {
    hidScanner.detach();
    history.back();
  });

  let currentLines: PickingLine[] = [];
  const invalidLineIds = new Set<number>();
  const pendingQtyByLineId = new Map<number, number>();

  async function refreshLines() {
    currentLines = await apiGet<PickingLine[]>(`/pickings/${picking.id}/lines`);
    invalidLineIds.clear();
    pendingQtyByLineId.clear();
    renderLines();
  }

  function updateValidateEnabled() {
    validateBtn.disabled = invalidLineIds.size > 0;
  }

  function renderLines() {
    linesEl.innerHTML = currentLines
      .map((line) => {
        const isInvalid = invalidLineIds.has(line.id);
        const displayQty = pendingQtyByLineId.get(line.id) ?? line.quantity;
        return `
          <div class="order-line-card picking-line-card ${line.picked ? "picked" : ""} ${
          isInvalid ? "qty-error" : ""
        }" data-line-id="${line.id}">
            <div class="picking-line-row">
              <div>
                <span class="line-name" data-info-line-id="${line.id}">${escapeHtml(line.productName)}</span>
                ${
                  line.productDescription && line.productDescription !== line.productName
                    ? `<div class="line-description">${escapeHtml(line.productDescription)}</div>`
                    : ""
                }
                <div class="muted line-locations">${escapeHtml(line.locationName)} → ${escapeHtml(
          line.locationDestName
        )}</div>
              </div>
              <button
                type="button"
                class="pick-check"
                data-toggle-picked-id="${line.id}"
                aria-label="${line.picked ? "Mark not picked" : "Mark picked"}"
              >${line.picked ? icon("check") : ""}</button>
            </div>
            <div class="picking-qty-row">
              <input
                type="number"
                class="qty-input"
                data-qty-line-id="${line.id}"
                data-requested-qty="${line.requestedQty}"
                value="${displayQty}"
                min="0"
                step="any"
              />
              <span class="requested-qty ${line.quantity < line.requestedQty ? "shortfall" : ""}">
                Requested: ${line.requestedQty}
              </span>
            </div>
            ${
              isInvalid
                ? `<div class="qty-error-message">Quantity cannot exceed the requested amount (${line.requestedQty}). Correct it to continue.</div>`
                : ""
            }
          </div>`;
      })
      .join("");

    linesEl.querySelectorAll<HTMLElement>("[data-info-line-id]").forEach((el) => {
      el.addEventListener("click", () => {
        const lineId = Number(el.dataset.infoLineId);
        const line = currentLines.find((l) => l.id === lineId)!;
        openProductInfoModal(line.productId, line.productName);
      });
    });

    linesEl.querySelectorAll<HTMLInputElement>("[data-qty-line-id]").forEach((input) => {
      input.addEventListener("change", async () => {
        const lineId = Number(input.dataset.qtyLineId);
        const newQty = Number(input.value);
        const requestedQty = Number(input.dataset.requestedQty);
        if (!Number.isFinite(newQty) || newQty < 0) return;
        if (newQty > requestedQty) {
          invalidLineIds.add(lineId);
          pendingQtyByLineId.set(lineId, newQty);
          updateValidateEnabled();
          renderLines();
          return;
        }
        try {
          await apiPost(`/pickings/${picking.id}/lines/${lineId}/quantity`, { quantity: newQty });
          const line = currentLines.find((l) => l.id === lineId);
          if (line) line.quantity = newQty;
          invalidLineIds.delete(lineId);
          pendingQtyByLineId.delete(lineId);
          updateValidateEnabled();
          renderLines();
        } catch (err) {
          scanStatus.innerHTML = `<span class="error">${escapeHtml(
            apiErrorMessage(err, "Failed to update quantity.")
          )}</span>`;
          await refreshLines();
        }
      });
    });

    linesEl.querySelectorAll<HTMLButtonElement>("[data-toggle-picked-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const lineId = Number(btn.dataset.togglePickedId);
        const line = currentLines.find((l) => l.id === lineId);
        if (!line) return;
        const nextPicked = !line.picked;
        try {
          await apiPost(`/pickings/${picking.id}/lines/${lineId}/picked`, { picked: nextPicked });
          line.picked = nextPicked;
          renderLines();
        } catch (err) {
          scanStatus.innerHTML = `<span class="error">${escapeHtml(
            apiErrorMessage(err, "Failed to update pick status.")
          )}</span>`;
        }
      });
    });
  }

  async function scanBarcode(barcode: string) {
    scanStatus.textContent = "Scanning…";
    try {
      await apiPost(`/pickings/${picking.id}/scan`, { barcode });
      scanStatus.innerHTML = `<span class="success">Confirmed ${escapeHtml(barcode)}</span>`;
      scanInput.value = "";
      await refreshLines();
    } catch (err) {
      scanStatus.innerHTML = `<span class="error">${escapeHtml(
        apiErrorMessage(err, `No match for ${barcode}`)
      )}</span>`;
    }
  }

  scanInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && scanInput.value.trim()) {
      scanBarcode(scanInput.value.trim());
    }
  });

  let scanner: CameraScanner | null = null;

  async function openCamera() {
    cameraPanel.classList.remove("hidden");
    scanner = createCameraScanner(video, (code) => {
      scanInput.value = code;
      closeCamera();
      scanBarcode(code);
    });
    try {
      await scanner.start();
    } catch (err) {
      scanStatus.innerHTML = `<span class="error">Camera unavailable</span>`;
      closeCamera();
    }
  }

  function closeCamera() {
    scanner?.stop();
    scanner = null;
    cameraPanel.classList.add("hidden");
  }

  cameraToggle.addEventListener("click", () => {
    if (cameraPanel.classList.contains("hidden")) openCamera();
    else closeCamera();
  });
  cameraClose.addEventListener("click", closeCamera);

  const hidScanner = new HidScanner({ onScan: scanBarcode });
  hidScanner.attach();

  validateBtn.addEventListener("click", async () => {
    if (invalidLineIds.size > 0) return;
    validateBtn.disabled = true;
    validateStatus.textContent = "Validating…";
    try {
      const result = await apiPost<ValidatePickingResult>(`/pickings/${picking.id}/validate`, {});
      if (result.validated) {
        showCompleted(null);
      } else if (result.backorder) {
        updateValidateEnabled();
        renderBackorderPrompt(result.backorder.wizardId);
      } else {
        validateStatus.innerHTML = `<span class="error">Validation failed.</span>`;
        updateValidateEnabled();
      }
    } catch (err) {
      validateStatus.innerHTML = `<span class="error">${escapeHtml(
        apiErrorMessage(err, "Validation failed.")
      )}</span>`;
      updateValidateEnabled();
    }
  });

  function showCompleted(backorderName: string | null) {
    hidScanner.detach();
    closeCamera();

    scanInput.disabled = true;
    cameraToggle.disabled = true;
    validateBtn.remove();

    validateStatus.innerHTML = `
      <div class="completed-banner">
        <div class="completed-icon">${icon("check")}</div>
        <div>
          <div class="completed-title">Transfer completed</div>
          ${
            backorderName
              ? `<div class="completed-detail">Backorder ${escapeHtml(backorderName)} created for the remaining items.</div>`
              : ""
          }
        </div>
      </div>
    `;

    setTimeout(() => history.back(), 1600);
  }

  function renderBackorderPrompt(wizardId: number) {
    const outstanding = currentLines.filter((l) => !l.picked || l.quantity < l.requestedQty);
    const summary =
      outstanding.length > 0
        ? `<strong>${outstanding.length}</strong> item${outstanding.length === 1 ? "" : "s"} on this transfer
           ${outstanding.length === 1 ? "is" : "are"} short of what was requested.`
        : `This transfer isn't fully fulfilled as planned.`;

    validateStatus.innerHTML = `
      <div class="backorder-prompt">
        <p>
          ${summary}
          Create a backorder for what's outstanding, or complete this transfer as-is?
        </p>
        <div class="backorder-actions">
          <button type="button" id="create-backorder-btn" class="btn-primary">Create backorder</button>
          <button type="button" id="skip-backorder-btn" class="btn-secondary">Complete without backorder</button>
        </div>
      </div>
    `;

    validateStatus.querySelector<HTMLButtonElement>("#create-backorder-btn")!.addEventListener("click", () =>
      resolveBackorder(wizardId, true)
    );
    validateStatus.querySelector<HTMLButtonElement>("#skip-backorder-btn")!.addEventListener("click", () =>
      resolveBackorder(wizardId, false)
    );
  }

  async function resolveBackorder(wizardId: number, createBackorder: boolean) {
    validateStatus.textContent = "Processing…";
    try {
      const result = await apiPost<BackorderDecisionResult>(
        `/pickings/${picking.id}/backorder/${wizardId}`,
        { createBackorder }
      );
      showCompleted(result.backorderName);
    } catch (err) {
      validateStatus.innerHTML = `<span class="error">${escapeHtml(
        apiErrorMessage(err, "Failed to resolve backorder.")
      )}</span>`;
    }
  }

  await refreshLines();
}
