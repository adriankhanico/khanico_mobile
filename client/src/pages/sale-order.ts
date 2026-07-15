import type { Partner, Product, SaleOrderLineInput, SaleOrderSummary } from "@ventor/shared";
import { apiErrorMessage, apiGet, apiPost, isAdmin } from "../lib/api-client";
import { icon } from "../lib/icons";
import { HidScanner } from "../lib/scanner/hid-scanner";
import { mountSaleOrderEdit } from "./sale-order-edit";

interface DraftLine extends SaleOrderLineInput {
  productName: string;
}

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

function navigateTo(path: string) {
  window.location.hash = path;
}

export function mountSaleOrderRoute(root: HTMLElement, segments: string[]) {
  const [id] = segments;
  if (!id) {
    mountSaleOrderList(root);
  } else if (id === "new") {
    mountSaleOrderForm(root);
  } else {
    mountSaleOrderEdit(root, Number(id));
  }
}

async function mountSaleOrderList(root: HTMLElement) {
  root.innerHTML = `<section class="page"><p class="muted">Loading orders…</p></section>`;

  let orders: SaleOrderSummary[] = [];
  try {
    orders = await apiGet<SaleOrderSummary[]>("/sale-orders");
  } catch {
    orders = [];
  }

  root.innerHTML = `
    <section class="page">
      <h2>Sale Orders</h2>
      <button id="new-order-btn" type="button" class="link-btn">+ New sale order</button>
      <input
        id="order-search-input"
        type="search"
        placeholder="Search by order # or customer"
        autocomplete="off"
      />
      <div id="order-results" class="results"></div>
    </section>
  `;

  const searchInput = root.querySelector<HTMLInputElement>("#order-search-input")!;
  const resultsEl = root.querySelector<HTMLDivElement>("#order-results")!;

  function renderInto(list: SaleOrderSummary[]) {
    resultsEl.innerHTML =
      list
        .map(
          (o) => `
            <div class="result-row order-card" data-order-id="${o.id}">
              <div class="order-card-title">
                <strong>${escapeHtml(o.name)}</strong>
                <span class="state-pill state-${escapeHtml(o.state)}">${escapeHtml(o.state)}</span>
              </div>
              <div class="product-card-top">
                <div class="order-card-customer">${escapeHtml(o.partnerName)}</div>
                ${isAdmin() ? `<span class="stamp order-total">$${o.amountTotal.toFixed(2)}</span>` : ""}
              </div>
              <div class="product-meta">
                <span>${formatDate(o.dateOrder)}</span>
                <span>${escapeHtml(o.salespersonName ?? "—")}</span>
              </div>
            </div>`
        )
        .join("") || `<p class="muted">No sale orders found.</p>`;

    resultsEl.querySelectorAll<HTMLElement>("[data-order-id]").forEach((row) => {
      row.addEventListener("click", () => {
        navigateTo(`/sale-order/${row.dataset.orderId}`);
      });
    });
  }

  renderInto(orders);

  let debounce: ReturnType<typeof setTimeout> | undefined;
  searchInput.addEventListener("input", () => {
    const query = searchInput.value;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(async () => {
      try {
        const filtered = await apiGet<SaleOrderSummary[]>(`/sale-orders?q=${encodeURIComponent(query)}`);
        renderInto(filtered);
      } catch {
        resultsEl.innerHTML = `<p class="error">Search failed.</p>`;
      }
    }, 250);
  });

  root.querySelector<HTMLButtonElement>("#new-order-btn")!.addEventListener("click", () => {
    navigateTo("/sale-order/new");
  });
}

function mountSaleOrderForm(root: HTMLElement) {
  root.innerHTML = `
    <section class="page">
      <button id="back-to-orders" type="button" class="link-btn">← Back to orders</button>
      <h2>New Sale Order</h2>

      <label>Customer</label>
      <input id="customer-search" type="search" placeholder="Search customer name" autocomplete="off" />
      <div id="customer-results" class="results"></div>
      <div id="selected-customer" class="selected-chip hidden"></div>

      <label>PO #</label>
      <input id="po-number" type="text" placeholder="Customer PO number" autocomplete="off" />

      <label class="checkbox-label">
        <input id="is-hose-order" type="checkbox" />
        Hose Assembly Order?
      </label>

      <label>Add product</label>
      <input id="product-search" type="search" placeholder="Search product / scan barcode" autocomplete="off" data-scan-target="true" />
      <div id="product-scan-status"></div>
      <div id="product-results" class="results"></div>

      <div id="order-lines" class="order-lines"></div>

      <button id="submit-order" type="button" disabled>Create Sale Order</button>
      <div id="order-status"></div>
    </section>
  `;

  const customerSearch = root.querySelector<HTMLInputElement>("#customer-search")!;
  const customerResults = root.querySelector<HTMLDivElement>("#customer-results")!;
  const selectedCustomerEl = root.querySelector<HTMLDivElement>("#selected-customer")!;
  const poNumberInput = root.querySelector<HTMLInputElement>("#po-number")!;
  const isHoseOrderInput = root.querySelector<HTMLInputElement>("#is-hose-order")!;
  const productSearch = root.querySelector<HTMLInputElement>("#product-search")!;
  const productScanStatus = root.querySelector<HTMLDivElement>("#product-scan-status")!;
  const productResults = root.querySelector<HTMLDivElement>("#product-results")!;
  const orderLinesEl = root.querySelector<HTMLDivElement>("#order-lines")!;
  const submitBtn = root.querySelector<HTMLButtonElement>("#submit-order")!;
  const statusEl = root.querySelector<HTMLDivElement>("#order-status")!;

  let selectedCustomer: Partner | null = null;
  const lines: DraftLine[] = [];

  function renderSelectedCustomer() {
    if (!selectedCustomer) {
      selectedCustomerEl.classList.add("hidden");
      return;
    }
    selectedCustomerEl.classList.remove("hidden");
    selectedCustomerEl.innerHTML = `Selected: <strong>${escapeHtml(selectedCustomer.name)}</strong>`;
  }

  function renderLines() {
    if (lines.length === 0) {
      orderLinesEl.innerHTML = `<p class="muted">No lines added yet.</p>`;
    } else {
      orderLinesEl.innerHTML = lines
        .map(
          (line, i) => `
            <div class="order-line-card">
              <div class="order-line-head">
                <div class="product-name">${escapeHtml(line.productName)}</div>
                <button data-remove-line="${i}" type="button">${icon("x")}</button>
              </div>
              <div class="order-line-fields">
                <label class="inline-field">
                  <span>Qty</span>
                  <input type="number" class="qty-input" data-line-index="${i}" value="${line.quantity}" min="0" step="any" />
                </label>
                ${
                  isAdmin()
                    ? `<label class="inline-field">
                        <span>Price</span>
                        <span class="price-input-prefix">$<input type="number" class="qty-input" data-price-line-index="${i}" value="${(
                        line.priceUnit ?? 0
                      ).toFixed(2)}" min="0" step="0.01" /></span>
                      </label>`
                    : ""
                }
              </div>
            </div>`
        )
        .join("");

      orderLinesEl.querySelectorAll<HTMLInputElement>("[data-line-index]").forEach((input) => {
        input.addEventListener("change", () => {
          const index = Number(input.dataset.lineIndex);
          const quantity = Number(input.value);
          if (!Number.isFinite(quantity) || quantity < 0) return;
          lines[index].quantity = quantity;
        });
      });

      orderLinesEl.querySelectorAll<HTMLInputElement>("[data-price-line-index]").forEach((input) => {
        input.addEventListener("change", () => {
          const index = Number(input.dataset.priceLineIndex);
          const priceUnit = Number(input.value);
          if (!Number.isFinite(priceUnit) || priceUnit < 0) return;
          lines[index].priceUnit = priceUnit;
        });
      });
    }
    updateSubmitEnabled();
  }

  function updateSubmitEnabled() {
    submitBtn.disabled = !selectedCustomer || lines.length === 0;
  }

  let customerDebounce: ReturnType<typeof setTimeout> | undefined;
  customerSearch.addEventListener("input", () => {
    const query = customerSearch.value;
    if (customerDebounce) clearTimeout(customerDebounce);
    customerDebounce = setTimeout(async () => {
      if (!query.trim()) {
        customerResults.innerHTML = "";
        return;
      }
      try {
        const customers = await apiGet<Partner[]>(`/customers?q=${encodeURIComponent(query)}`);
        customerResults.innerHTML = customers
          .map((c) => `<div class="result-row" data-customer-id="${c.id}">${escapeHtml(c.name)}</div>`)
          .join("");
      } catch {
        customerResults.innerHTML = `<p class="error">Customer search failed.</p>`;
      }
    }, 250);
  });

  customerResults.addEventListener("click", async (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-customer-id]");
    if (!row) return;
    const id = Number(row.dataset.customerId);
    const customers = await apiGet<Partner[]>(`/customers?q=${encodeURIComponent(customerSearch.value)}`);
    selectedCustomer = customers.find((c) => c.id === id) ?? { id, name: row.textContent ?? "", email: null };
    customerResults.innerHTML = "";
    customerSearch.value = "";
    renderSelectedCustomer();
    updateSubmitEnabled();
  });

  let lastSearchResults = new Map<number, Product>();

  let productDebounce: ReturnType<typeof setTimeout> | undefined;
  productSearch.addEventListener("input", () => {
    const query = productSearch.value;
    if (productDebounce) clearTimeout(productDebounce);
    productDebounce = setTimeout(async () => {
      if (!query.trim()) {
        productResults.innerHTML = "";
        return;
      }
      try {
        const products = await apiGet<Product[]>(`/inventory/search?q=${encodeURIComponent(query)}`);
        lastSearchResults = new Map(products.map((p) => [p.id, p]));
        productResults.innerHTML = products
          .map(
            (p) => `
              <div class="result-row" data-product-id="${p.id}">
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

  function addProductToLines(product: Product) {
    const existing = lines.find((l) => l.productId === product.id);
    if (existing) {
      existing.quantity += 1;
    } else {
      lines.push({ productId: product.id, productName: product.name, quantity: 1, priceUnit: product.priceWithVat });
    }
    productResults.innerHTML = "";
    productSearch.value = "";
    renderLines();
  }

  productResults.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-product-id]");
    if (!row) return;
    const product = lastSearchResults.get(Number(row.dataset.productId));
    if (!product) return;
    addProductToLines(product);
  });

  async function handleProductScan(barcode: string) {
    try {
      const products = await apiGet<Product[]>(`/inventory/search?q=${encodeURIComponent(barcode)}`);
      const match = products.find((p) => p.barcode === barcode) ?? products[0];
      if (!match) {
        productScanStatus.innerHTML = `<span class="error">No product found for barcode ${escapeHtml(barcode)}</span>`;
        return;
      }
      addProductToLines(match);
      productScanStatus.innerHTML = `<span class="success">Added ${escapeHtml(match.name)}</span>`;
    } catch (err) {
      productScanStatus.innerHTML = `<span class="error">${escapeHtml(
        apiErrorMessage(err, `No product found for barcode ${barcode}`)
      )}</span>`;
    }
  }

  const productHidScanner = new HidScanner({ onScan: handleProductScan });
  productHidScanner.attach();

  root.querySelector<HTMLButtonElement>("#back-to-orders")!.addEventListener("click", () => {
    productHidScanner.detach();
    history.back();
  });

  orderLinesEl.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-remove-line]");
    if (!btn) return;
    const index = Number(btn.dataset.removeLine);
    lines.splice(index, 1);
    renderLines();
  });

  submitBtn.addEventListener("click", async () => {
    if (!selectedCustomer || lines.length === 0) return;
    submitBtn.disabled = true;
    statusEl.textContent = "Creating order…";
    try {
      const result = await apiPost<{ id: number }>("/sale-orders", {
        partnerId: selectedCustomer.id,
        lines: lines.map(({ productId, quantity, priceUnit }) => ({ productId, quantity, priceUnit })),
        poNumber: poNumberInput.value.trim() || undefined,
        isHoseOrder: isHoseOrderInput.checked,
      });
      statusEl.innerHTML = `<span class="success">Order #${result.id} created.</span>`;
      productHidScanner.detach();
      setTimeout(() => navigateTo(`/sale-order/${result.id}`), 800);
    } catch (err) {
      statusEl.innerHTML = `<p class="error">${escapeHtml(
        apiErrorMessage(err, "Failed to create order.")
      )}</p>`;
      updateSubmitEnabled();
    }
  });

  renderLines();
  renderSelectedCustomer();
}
