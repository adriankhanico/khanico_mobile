import type { DashboardSummary } from "@khanico/shared";
import { apiGet, getCurrentUserName } from "./api-client";
import { icon, type IconName } from "./icons";

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

type Theme = "light" | "dark";

export interface AppMenuOptions {
  getTheme: () => Theme;
  toggleTheme: () => void;
  logout: () => void;
}

interface MenuItem {
  /** Route hash without the leading "#/", e.g. "picking". */
  route: string;
  label: string;
  icon: IconName;
  /** Badge text from the dashboard summary, or null for no badge. */
  badge?: (summary: DashboardSummary) => string | null;
}

function countBadge(n: number): string | null {
  return n > 0 ? n.toLocaleString() : null;
}

const HOME: MenuItem = { route: "dashboard", label: "Home", icon: "home" };

const SECTIONS: { title: string; items: MenuItem[] }[] = [
  {
    title: "Warehouse",
    items: [
      {
        route: "picking",
        label: "Transfers",
        icon: "truck",
        badge: (s) => countBadge(s.pendingByCategory.reduce((sum, c) => sum + c.readyCount, 0)),
      },
      { route: "counts", label: "Stock Counts", icon: "clipboard-list", badge: (s) => countBadge(s.myCountsToDo) },
      { route: "inventory", label: "Inventory Search", icon: "search" },
      {
        route: "barcodes",
        label: "Missing Barcodes",
        icon: "scan-barcode",
        badge: (s) => countBadge(s.missingBarcodeCount),
      },
    ],
  },
  {
    title: "Sales",
    items: [
      { route: "sale-order", label: "Sale Orders", icon: "file-text", badge: (s) => countBadge(s.draftOrderCount) },
      { route: "sale-order/new", label: "New Sale Order", icon: "plus" },
    ],
  },
];

const ALL_ITEMS = [HOME, ...SECTIONS.flatMap((s) => s.items)];

/** The menu item for the current page: the longest route that prefixes the hash. */
function activeRoute(): string {
  const hash = window.location.hash.replace(/^#\//, "") || "dashboard";
  const matches = ALL_ITEMS.filter((item) => hash === item.route || hash.startsWith(`${item.route}/`));
  matches.sort((a, b) => b.route.length - a.route.length);
  return matches[0]?.route ?? "";
}

/**
 * Side drawer listing every function in the app, opened from the header's menu button.
 * The bottom nav stays the quick route for everyday tasks; this is the complete list.
 */
export function mountAppMenu(button: HTMLButtonElement, options: AppMenuOptions) {
  const overlay = document.createElement("div");
  overlay.className = "app-menu-overlay";
  const drawer = document.createElement("nav");
  drawer.className = "app-menu";
  drawer.id = "app-menu";
  drawer.setAttribute("aria-label", "Menu");
  drawer.setAttribute("aria-hidden", "true");
  document.body.append(overlay, drawer);

  button.setAttribute("aria-controls", "app-menu");
  button.setAttribute("aria-expanded", "false");

  let summary: DashboardSummary | null = null;
  let isOpen = false;

  function renderItem(item: MenuItem): string {
    const badge = summary && item.badge ? item.badge(summary) : null;
    const active = activeRoute() === item.route;
    return `
      <a href="#/${item.route}" class="app-menu-item ${active ? "active" : ""}" ${active ? 'aria-current="page"' : ""}>
        <span class="app-menu-item-icon">${icon(item.icon)}</span>
        <span class="app-menu-item-label">${escapeHtml(item.label)}</span>
        ${badge ? `<span class="badge">${escapeHtml(badge)}</span>` : ""}
      </a>`;
  }

  function render() {
    const theme = options.getTheme();
    const userName = getCurrentUserName();
    drawer.innerHTML = `
      <div class="app-menu-head">
        <img class="app-menu-wordmark" src="/images/khanico-logo-blue.png" alt="Khanico" />
        <button type="button" class="app-menu-close" aria-label="Close menu">${icon("x")}</button>
      </div>
      <div class="app-menu-body">
        ${renderItem(HOME)}
        ${SECTIONS.map(
          (section) => `
            <div class="app-menu-section-title">${escapeHtml(section.title)}</div>
            ${section.items.map(renderItem).join("")}`
        ).join("")}
      </div>
      <div class="app-menu-foot">
        ${userName ? `<div class="app-menu-user">Signed in as <strong>${escapeHtml(userName)}</strong></div>` : ""}
        <button type="button" class="app-menu-item" data-menu-action="theme">
          <span class="app-menu-item-icon">${icon(theme === "dark" ? "sun" : "moon")}</span>
          <span class="app-menu-item-label">${theme === "dark" ? "Light mode" : "Dark mode"}</span>
        </button>
        <button type="button" class="app-menu-item" data-menu-action="logout">
          <span class="app-menu-item-icon">${icon("log-out")}</span>
          <span class="app-menu-item-label">Log out</span>
        </button>
      </div>`;
  }

  async function loadCounts() {
    try {
      summary = await apiGet<DashboardSummary>("/dashboard");
      if (isOpen) render();
    } catch {
      // badges are a nicety — the menu works without them
    }
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    render();
    overlay.classList.add("open");
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    button.setAttribute("aria-expanded", "true");
    drawer.querySelector<HTMLElement>(".app-menu-item.active, .app-menu-item")?.focus();
    loadCounts();
  }

  function close(returnFocus = true) {
    if (!isOpen) return;
    isOpen = false;
    overlay.classList.remove("open");
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    button.setAttribute("aria-expanded", "false");
    if (returnFocus) button.focus();
  }

  button.addEventListener("click", () => (isOpen ? close() : open()));
  overlay.addEventListener("click", () => close());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) close();
  });
  // Following a link (or any navigation) closes the drawer.
  window.addEventListener("hashchange", () => close(false));

  drawer.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest(".app-menu-close")) {
      close();
      return;
    }
    const action = target.closest<HTMLElement>("[data-menu-action]")?.dataset.menuAction;
    if (action === "theme") {
      options.toggleTheme();
      render();
      drawer.querySelector<HTMLElement>('[data-menu-action="theme"]')?.focus();
    } else if (action === "logout") {
      close(false);
      options.logout();
    } else if (target.closest("a.app-menu-item")) {
      // Tapping the page you're already on doesn't fire hashchange; close anyway.
      close(false);
    }
  });
}
