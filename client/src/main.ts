import "./styles/app.css";
import { apiGet, apiPost, setCurrentUserIsAdmin, setCurrentUserName } from "./lib/api-client";
import { mountAppMenu } from "./lib/app-menu";
import { icon } from "./lib/icons";
import { mountCountsRoute } from "./pages/counts";
import { mountDashboard } from "./pages/dashboard";
import { mountInventorySearch } from "./pages/inventory-search";
import { mountLogin } from "./pages/login";
import { mountMissingBarcodesRoute } from "./pages/missing-barcodes";
import { mountProductHistory } from "./pages/product-history";
import { mountSaleOrderRoute } from "./pages/sale-order";
import { mountPickingRoute } from "./pages/scan-picking";

const app = document.querySelector<HTMLDivElement>("#app")!;

const THEME_STORAGE_KEY = "khanico-theme";

function currentTheme(): "light" | "dark" {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function applyTheme(theme: "light" | "dark") {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // storage unavailable — the theme just won't be remembered
  }
}

function initTheme() {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // storage unavailable — fall back to light
  }
  applyTheme(stored === "dark" ? "dark" : "light");
}

async function logout() {
  try {
    await apiPost("/auth/logout", {});
  } catch {
    // ignore — redirect regardless
  }
  window.location.hash = "/login";
  window.location.reload();
}

interface Route {
  mount: (root: HTMLElement, segments: string[]) => void;
}

const routes: { prefix: string; route: Route }[] = [
  { prefix: "dashboard", route: { mount: (root) => mountDashboard(root) } },
  { prefix: "inventory", route: { mount: (root) => mountInventorySearch(root) } },
  { prefix: "sale-order", route: { mount: mountSaleOrderRoute } },
  { prefix: "picking", route: { mount: mountPickingRoute } },
  { prefix: "product-history", route: { mount: mountProductHistory } },
  { prefix: "counts", route: { mount: mountCountsRoute } },
  { prefix: "barcodes", route: { mount: mountMissingBarcodesRoute } },
];

function currentSegments(): string[] {
  const hash = window.location.hash.replace(/^#\//, "");
  return hash ? hash.split("/") : ["dashboard"];
}

function render() {
  const segments = currentSegments();
  const [prefix, ...rest] = segments;

  if (prefix === "login") {
    document.querySelector<HTMLElement>(".app-header")?.classList.add("hidden");
    document.querySelector<HTMLElement>(".bottom-nav")?.classList.add("hidden");
    mountLogin(app);
    return;
  }
  document.querySelector<HTMLElement>(".app-header")?.classList.remove("hidden");
  document.querySelector<HTMLElement>(".bottom-nav")?.classList.remove("hidden");

  const match = routes.find((r) => r.prefix === prefix) ?? routes[0];
  match.route.mount(app, rest);
  updateNavActive(match.prefix);
}

function updateNavActive(prefix: string) {
  document.querySelectorAll<HTMLAnchorElement>(".bottom-nav-item").forEach((a) => {
    a.classList.toggle("active", a.dataset.navPrefix === prefix);
  });
}

function mountHeader() {
  const header = document.createElement("header");
  header.className = "app-header";
  header.innerHTML = `
    <div class="app-header-top">
      <button id="menu-btn" type="button" class="app-menu-btn" aria-label="Open menu">${icon("menu")}</button>
      <a href="#/dashboard" class="app-wordmark-link" aria-label="Home">
        <img class="app-wordmark" src="/images/khanico-logo-blue.png" alt="Khanico" />
      </a>
      <div class="app-header-right" aria-hidden="true"></div>
    </div>
  `;
  document.body.prepend(header);

  initTheme();
  mountAppMenu(header.querySelector<HTMLButtonElement>("#menu-btn")!, {
    getTheme: currentTheme,
    toggleTheme: () => applyTheme(currentTheme() === "dark" ? "light" : "dark"),
    logout,
  });
}

function mountBottomNav() {
  const nav = document.createElement("nav");
  nav.className = "bottom-nav";
  nav.innerHTML = `
    <a href="#/dashboard" data-nav-prefix="dashboard" class="bottom-nav-item">
      <span class="bottom-nav-icon">${icon("home")}</span>
      <span>Home</span>
    </a>
    <a href="#/inventory" data-nav-prefix="inventory" class="bottom-nav-item">
      <span class="bottom-nav-icon">${icon("package")}</span>
      <span>Inventory</span>
    </a>
    <button type="button" class="bottom-nav-scan-btn" aria-label="Scan barcode">
      <span class="bottom-nav-scan-icon">${icon("scan-barcode")}</span>
    </button>
    <a href="#/sale-order" data-nav-prefix="sale-order" class="bottom-nav-item">
      <span class="bottom-nav-icon">${icon("file-text")}</span>
      <span>Orders</span>
    </a>
    <a href="#/picking" data-nav-prefix="picking" class="bottom-nav-item">
      <span class="bottom-nav-icon">${icon("truck")}</span>
      <span>Transfers</span>
    </a>
  `;
  document.body.appendChild(nav);

  nav.querySelector<HTMLButtonElement>(".bottom-nav-scan-btn")!.addEventListener("click", () => {
    window.location.hash = "/inventory";
  });
}

async function boot() {
  mountHeader();
  mountBottomNav();

  const onLoginRoute = currentSegments()[0] === "login";
  try {
    const me = await apiGet<{ uid: number; login: string; name: string; isAdmin: boolean }>("/auth/me");
    setCurrentUserIsAdmin(me.isAdmin);
    setCurrentUserName(me.name);
    if (onLoginRoute) {
      window.location.hash = "/dashboard";
    }
  } catch {
    if (!onLoginRoute) {
      window.location.hash = "/login";
    }
  }

  render();
  window.addEventListener("hashchange", render);
}

boot();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("Service worker registration failed", err);
    });
  });
}
