import { icon, type IconName } from "./icons";

const CATEGORY_ICONS: { match: RegExp; icon: IconName }[] = [
  { match: /deliver/i, icon: "truck" },
  { match: /pick/i, icon: "shopping-cart" },
  { match: /return/i, icon: "undo-2" },
  { match: /internal|quarantine/i, icon: "refresh-cw" },
  { match: /receipt/i, icon: "inbox" },
  { match: /put ?away|pack/i, icon: "package" },
];

export function iconForPickingType(pickingTypeName: string): string {
  const match = CATEGORY_ICONS.find((c) => c.match.test(pickingTypeName))?.icon ?? "package";
  return icon(match);
}
