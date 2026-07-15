export interface HidScannerOptions {
  /** Max ms between keystrokes to still count as part of the same hardware burst. */
  maxInterKeyDelayMs?: number;
  /** Minimum characters before a buffered burst is treated as a scan. */
  minBarcodeLength?: number;
  /** Called with the captured barcode value once a burst is terminated. */
  onScan: (code: string) => void;
}

const DEFAULT_MAX_INTER_KEY_DELAY_MS = 80;
const DEFAULT_MIN_BARCODE_LENGTH = 4;

/**
 * Distinguishes Zebra DataWedge keyboard-wedge bursts from normal typing by
 * inter-keystroke timing: a hardware scan injects a full barcode in well under
 * 30-50ms total, while even fast human typing runs 100ms+ per character.
 */
export class HidScanner {
  private buffer = "";
  private lastKeyTime = 0;
  private readonly maxInterKeyDelayMs: number;
  private readonly minBarcodeLength: number;
  private readonly onScan: (code: string) => void;
  private readonly handler = (event: KeyboardEvent) => this.handleKeydown(event);

  constructor(options: HidScannerOptions) {
    this.maxInterKeyDelayMs = options.maxInterKeyDelayMs ?? DEFAULT_MAX_INTER_KEY_DELAY_MS;
    this.minBarcodeLength = options.minBarcodeLength ?? DEFAULT_MIN_BARCODE_LENGTH;
    this.onScan = options.onScan;
  }

  attach() {
    document.addEventListener("keydown", this.handler, true);
  }

  detach() {
    document.removeEventListener("keydown", this.handler, true);
  }

  private handleKeydown(event: KeyboardEvent) {
    const now = performance.now();
    const delta = now - this.lastKeyTime;
    this.lastKeyTime = now;

    const target = event.target as HTMLElement | null;
    const isScanTarget = target?.dataset?.scanTarget === "true";
    const hasFocusedField = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

    // Only hijack input when nothing is focused, or the focused field opted in.
    const eligible = !hasFocusedField || isScanTarget;

    if (delta > this.maxInterKeyDelayMs) {
      this.buffer = "";
    }

    const isTerminator = event.key === "Enter" || event.key === "Tab";

    if (isTerminator) {
      const candidate = this.buffer;
      this.buffer = "";
      if (eligible && candidate.length >= this.minBarcodeLength) {
        event.preventDefault();
        this.onScan(candidate);
      }
      return;
    }

    if (event.key.length === 1) {
      this.buffer += event.key;
    }
  }
}
