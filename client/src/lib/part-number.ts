function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

/** The product's part number (Odoo internal reference) as a labelled chip, so it stands out from SL and qty. */
export function partNumberHtml(code: string | null): string {
  if (!code) return `<span class="part-number part-number-missing">No part #</span>`;
  return `<span class="part-number"><span class="part-number-label">Part #</span>${escapeHtml(code)}</span>`;
}

/**
 * Splits an Odoo product display name ("[CODE] Name") into its part number and name.
 * Names without a leading [CODE] come back unchanged with a null code.
 */
export function splitProductDisplayName(displayName: string): { code: string | null; name: string } {
  const match = /^\[([^\]]+)\]\s*(.*)$/s.exec(displayName);
  return match ? { code: match[1], name: match[2] } : { code: null, name: displayName };
}
