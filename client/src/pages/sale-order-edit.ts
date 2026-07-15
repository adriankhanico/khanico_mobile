import type { Product, SaleOrderDetail } from "@khanico/shared";
import { apiDelete, apiErrorMessage, apiGet, apiPost, apiPut, isAdmin } from "../lib/api-client";
import { icon } from "../lib/icons";
import { HidScanner } from "../lib/scanner/hid-scanner";

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function hoseStatusLabel(status: string): string {
  switch (status) {
    case "ok":
      return "Quantities Match";
    case "mismatch":
      return "Quantity Mismatch";
    default:
      return "No Snapshot";
  }
}

export async function mountSaleOrderEdit(root: HTMLElement, orderId: number) {
  root.innerHTML = `<section class="page"><p class="muted">Loading order…</p></section>`;

  let order: SaleOrderDetail;
  try {
    order = await apiGet<SaleOrderDetail>(`/sale-orders/${orderId}`);
  } catch {
    root.innerHTML = `<section class="page"><p class="error">Failed to load order.</p></section>`;
    return;
  }

  let productHidScanner: HidScanner | null = null;

  render();

  function render() {
    productHidScanner?.detach();
    productHidScanner = null;

    root.innerHTML = `
      <section class="page">
        <button id="back-btn" type="button" class="link-btn">← Back to orders</button>
        <div class="product-card-top">
          <h2 style="margin-bottom: 0;">${escapeHtml(order.name)}</h2>
          <span class="state-pill state-${escapeHtml(order.state)}">${escapeHtml(order.state)}</span>
        </div>
        <p class="muted">
          ${escapeHtml(order.partnerName)}
          ${
            order.isHoseOrder && order.hoseIntegrityStatus
              ? `<span class="integrity-status ${order.hoseIntegrityStatus}">${escapeHtml(
                  hoseStatusLabel(order.hoseIntegrityStatus)
                )}</span>`
              : ""
          }
        </p>
        <p class="muted">${formatDate(order.dateOrder)} · ${escapeHtml(order.salespersonName ?? "—")}</p>

        <label>PO #</label>
        <input id="po-number" type="text" placeholder="Customer PO number" autocomplete="off" value="${escapeHtml(
          order.poNumber ?? ""
        )}" ${order.editable ? "" : "disabled"} />

        <label class="checkbox-label">
          <input id="is-hose-order" type="checkbox" ${order.isHoseOrder ? "checked" : ""} ${
      order.editable && order.hoseCanToggle ? "" : "disabled"
    } />
          Hose Assembly Order?
        </label>

        ${
          !order.editable
            ? `<p class="error">This order is no longer a draft and cannot be edited.</p>`
            : `
              <label>Add product</label>
              <div class="search-row">
                <input id="product-search" type="search" placeholder="Search product / scan barcode" autocomplete="off" data-scan-target="true" />
              </div>
              <div id="product-scan-status"></div>
              <div id="product-results" class="results"></div>
            `
        }

        <div id="order-lines" class="order-lines"></div>

        ${
          isAdmin()
            ? `<div class="order-totals">
                <div class="order-totals-row">
                  <span>Untaxed Amount</span>
                  <span>$${order.amountUntaxed.toFixed(2)}</span>
                </div>
                <div class="order-totals-row">
                  <span>VAT</span>
                  <span>$${order.amountTax.toFixed(2)}</span>
                </div>
                <div class="order-totals-row order-totals-final">
                  <span>Total</span>
                  <span>$${order.amountTotal.toFixed(2)}</span>
                </div>
              </div>`
            : ""
        }

        <div id="edit-status"></div>
      </section>
    `;

    root.querySelector<HTMLButtonElement>("#back-btn")!.addEventListener("click", () => history.back());

    renderLines();

    if (order.editable) {
      const poNumberInput = root.querySelector<HTMLInputElement>("#po-number")!;
      poNumberInput.addEventListener("change", async () => {
        try {
          await apiPut(`/sale-orders/${order.id}/fields`, { poNumber: poNumberInput.value.trim() });
          order.poNumber = poNumberInput.value.trim() || null;
          setStatus("PO # updated.", false);
        } catch (err) {
          setStatus(apiErrorMessage(err, "Failed to update PO #."), true);
        }
      });

      const hoseCheckbox = root.querySelector<HTMLInputElement>("#is-hose-order")!;
      if (order.hoseCanToggle) {
        hoseCheckbox.addEventListener("change", async () => {
          try {
            await apiPut(`/sale-orders/${order.id}/fields`, { isHoseOrder: hoseCheckbox.checked });
            order.isHoseOrder = hoseCheckbox.checked;
            setStatus("Hose Assembly Order updated.", false);
          } catch (err) {
            setStatus(apiErrorMessage(err, "Failed to update Hose Assembly Order."), true);
            hoseCheckbox.checked = !hoseCheckbox.checked;
          }
        });
      }

      const productSearch = root.querySelector<HTMLInputElement>("#product-search")!;
      const productResults = root.querySelector<HTMLDivElement>("#product-results")!;
      let debounce: ReturnType<typeof setTimeout> | undefined;

      productSearch.addEventListener("input", () => {
        const query = productSearch.value;
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(async () => {
          if (!query.trim()) {
            productResults.innerHTML = "";
            return;
          }
          try {
            const products = await apiGet<Product[]>(`/inventory/search?q=${encodeURIComponent(query)}`);
            productResults.innerHTML = products
              .map(
                (p) => `
                  <div class="result-row" data-product-id="${p.id}" data-product-name="${escapeHtml(p.name)}">
                    <div>${escapeHtml(p.name)}</div>
                    <div class="product-meta">
                      <span>${escapeHtml(p.defaultCode ?? "—")}</span>
                      <span>SL ${escapeHtml(p.sl ?? "—")}</span>
                      <span>Qty ${p.qtyAvailable}</span>
                    </div>
                  </div>`
              )
              .join("");
          } catch {
            productResults.innerHTML = `<p class="error">Product search failed.</p>`;
          }
        }, 250);
      });

      async function addProductLine(productId: number): Promise<boolean> {
        try {
          await apiPost(`/sale-orders/${order.id}/lines`, { productId, quantity: 1 });
          order = (await apiGet<SaleOrderDetail>(`/sale-orders/${order.id}`)) as SaleOrderDetail;
          return true;
        } catch (err) {
          setStatus(apiErrorMessage(err, "Failed to add line."), true);
          return false;
        }
      }

      productResults.addEventListener("click", async (e) => {
        const row = (e.target as HTMLElement).closest<HTMLElement>("[data-product-id]");
        if (!row) return;
        const productId = Number(row.dataset.productId);
        productResults.innerHTML = "";
        productSearch.value = "";
        if (await addProductLine(productId)) {
          render();
        }
      });

      const productScanStatus = root.querySelector<HTMLDivElement>("#product-scan-status")!;

      async function handleProductScan(barcode: string) {
        try {
          const products = await apiGet<Product[]>(`/inventory/search?q=${encodeURIComponent(barcode)}`);
          const match = products.find((p) => p.barcode === barcode) ?? products[0];
          if (!match) {
            productScanStatus.innerHTML = `<span class="error">No product found for barcode ${escapeHtml(barcode)}</span>`;
            return;
          }
          if (await addProductLine(match.id)) {
            render();
          }
        } catch (err) {
          productScanStatus.innerHTML = `<span class="error">${escapeHtml(
            apiErrorMessage(err, `No product found for barcode ${barcode}`)
          )}</span>`;
        }
      }

      productHidScanner = new HidScanner({ onScan: handleProductScan });
      productHidScanner.attach();
    }
  }

  function setStatus(message: string, isError: boolean) {
    const statusEl = root.querySelector<HTMLDivElement>("#edit-status");
    if (!statusEl) return;
    statusEl.innerHTML = `<span class="${isError ? "error" : "success"}">${escapeHtml(message)}</span>`;
  }

  function renderLines() {
    const linesEl = root.querySelector<HTMLDivElement>("#order-lines")!;
    linesEl.innerHTML = order.lines
      .map(
        (line) => `
          <div class="order-line-card">
            <div class="order-line-head">
              <div>
                <div class="product-name">${escapeHtml(line.productName)}</div>
                <div class="product-meta">SL ${escapeHtml(line.sl ?? "—")}</div>
                ${
                  line.description && line.description !== line.productName
                    ? `<div class="line-description">${escapeHtml(line.description)}</div>`
                    : ""
                }
              </div>
              ${order.editable ? `<button data-remove-line-id="${line.lineId}" type="button">${icon("x")}</button>` : ""}
            </div>
            <div class="order-line-fields">
              <label class="inline-field">
                <span>Qty</span>
                ${
                  order.editable
                    ? `<input type="number" class="qty-input" data-line-id="${line.lineId}" value="${line.quantity}" min="0" step="any" />`
                    : `<span class="stamp">${line.quantity}</span>`
                }
              </label>
              ${
                isAdmin()
                  ? `<label class="inline-field">
                      <span>Price</span>
                      ${
                        order.editable
                          ? `<span class="price-input-prefix">$<input type="number" class="qty-input" data-price-line-id="${line.lineId}" value="${line.priceUnit}" min="0" step="0.01" /></span>`
                          : `<span class="stamp">$${line.priceUnit.toFixed(2)}</span>`
                      }
                    </label>`
                  : ""
              }
            </div>
            ${
              isAdmin()
                ? `<div class="price-warning ${line.priceUnit < line.costPrice ? "" : "hidden"}" data-price-warning-id="${
                    line.lineId
                  }">${line.priceUnit < line.costPrice ? `Below cost ($${line.costPrice.toFixed(2)})` : ""}</div>`
                : ""
            }
          </div>`
      )
      .join("");

    if (!order.editable) return;

    linesEl.querySelectorAll<HTMLInputElement>("[data-line-id]").forEach((input) => {
      input.addEventListener("change", async () => {
        const lineId = Number(input.dataset.lineId);
        const quantity = Number(input.value);
        if (!Number.isFinite(quantity) || quantity < 0) return;
        try {
          await apiPut(`/sale-orders/${order.id}/lines/${lineId}`, { quantity });
          order = (await apiGet<SaleOrderDetail>(`/sale-orders/${order.id}`)) as SaleOrderDetail;
          render();
          setStatus("Updated.", false);
        } catch (err) {
          setStatus(apiErrorMessage(err, "Failed to update quantity."), true);
        }
      });
    });

    linesEl.querySelectorAll<HTMLInputElement>("[data-price-line-id]").forEach((input) => {
      input.addEventListener("change", async () => {
        const lineId = Number(input.dataset.priceLineId);
        const priceUnit = Number(input.value);
        if (!Number.isFinite(priceUnit) || priceUnit < 0) return;
        try {
          await apiPut(`/sale-orders/${order.id}/lines/${lineId}/price`, { priceUnit });
          order = (await apiGet<SaleOrderDetail>(`/sale-orders/${order.id}`)) as SaleOrderDetail;
          render();
          setStatus("Updated.", false);
        } catch (err) {
          setStatus(apiErrorMessage(err, "Failed to update price."), true);
        }
      });
    });

    linesEl.querySelectorAll<HTMLButtonElement>("[data-remove-line-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const lineId = Number(btn.dataset.removeLineId);
        try {
          await apiDelete(`/sale-orders/${order.id}/lines/${lineId}`);
          order = (await apiGet<SaleOrderDetail>(`/sale-orders/${order.id}`)) as SaleOrderDetail;
          render();
          setStatus("Line removed.", false);
        } catch (err) {
          setStatus(apiErrorMessage(err, "Failed to remove line."), true);
        }
      });
    });
  }
}
