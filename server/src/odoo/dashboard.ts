import type { DashboardSummary } from "@ventor/shared";
import type { OdooClient } from "./client.js";
import { listOpenPickingsGrouped } from "./picking.js";
import { countDraftSaleOrders, searchSaleOrders } from "./sales.js";

/**
 * Dashboard tiles surface the categories staff act on most, in a fixed order,
 * ahead of whatever else the user happens to have access to (by sequence_code,
 * since display names vary by warehouse prefix): Delivery Orders, Pick,
 * Customer Returns, then Internal Transfers (which also covers "Quarantine to
 * Stock" — both share sequence_code "INT" in this Odoo instance).
 */
const PRIORITY_SEQUENCE_CODES = ["OUT", "PICK", "RET", "INT"];

export async function getDashboardSummary(client: OdooClient): Promise<DashboardSummary> {
  const [groups, draftOrderCount, recentOrders] = await Promise.all([
    listOpenPickingsGrouped(client),
    countDraftSaleOrders(client),
    searchSaleOrders(client, "", 5),
  ]);

  const pickingTypeIds = groups.map((g) => g.pickingTypeId);
  const sequenceCodeById = new Map<number, string>();
  if (pickingTypeIds.length > 0) {
    const typeRows = await client.searchRead(
      "stock.picking.type",
      [["id", "in", pickingTypeIds]],
      ["id", "sequence_code"]
    );
    for (const row of typeRows) {
      sequenceCodeById.set(row.id, row.sequence_code);
    }
  }

  const categories = groups.map((g) => ({
    pickingTypeId: g.pickingTypeId,
    pickingTypeName: g.pickingTypeName,
    count: g.pickings.length,
  }));

  categories.sort((a, b) => {
    const aPriority = PRIORITY_SEQUENCE_CODES.indexOf(sequenceCodeById.get(a.pickingTypeId) ?? "");
    const bPriority = PRIORITY_SEQUENCE_CODES.indexOf(sequenceCodeById.get(b.pickingTypeId) ?? "");
    const aRank = aPriority === -1 ? PRIORITY_SEQUENCE_CODES.length : aPriority;
    const bRank = bPriority === -1 ? PRIORITY_SEQUENCE_CODES.length : bPriority;
    if (aRank !== bRank) return aRank - bRank;
    return a.pickingTypeName.localeCompare(b.pickingTypeName);
  });

  return {
    pendingByCategory: categories,
    draftOrderCount,
    recentOrders,
  };
}
