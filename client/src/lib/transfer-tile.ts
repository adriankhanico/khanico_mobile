import { iconForPickingType } from "./picking-type-icon";

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

export interface TransferTileCounts {
  pickingTypeName: string;
  readyCount: number;
  waitingCount: number;
  lateCount: number;
}

/**
 * A transfer-type tile's contents, laid out like Odoo's Inventory Overview card: the big number
 * is what's ready to process, with waiting and late counts underneath.
 */
export function transferTileBody(c: TransferTileCounts): string {
  const extras = [
    c.waitingCount > 0 ? `<span>${c.waitingCount.toLocaleString()} waiting</span>` : "",
    c.lateCount > 0 ? `<span class="task-tile-late">${c.lateCount.toLocaleString()} late</span>` : "",
  ].filter(Boolean);
  return `
    <span class="task-tile-icon">${iconForPickingType(c.pickingTypeName)}</span>
    <span class="task-tile-count ${c.readyCount === 0 ? "task-tile-count-zero" : ""}">${c.readyCount.toLocaleString()}<span class="task-tile-count-unit">ready</span></span>
    <span class="task-tile-label">${escapeHtml(c.pickingTypeName)}</span>
    ${extras.length > 0 ? `<span class="task-tile-extras">${extras.join("")}</span>` : ""}`;
}
