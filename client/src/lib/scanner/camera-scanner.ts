export interface CameraScanner {
  start(): Promise<void>;
  stop(): void;
}

export type OnDetect = (code: string) => void;

declare global {
  interface Window {
    BarcodeDetector?: {
      new (options?: { formats?: string[] }): {
        detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
      };
    };
  }
}

const BARCODE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"];

function supportsBarcodeDetector(): boolean {
  return "BarcodeDetector" in window;
}

class NativeBarcodeScanner implements CameraScanner {
  private stream: MediaStream | null = null;
  private rafId: number | null = null;
  private detector: InstanceType<NonNullable<Window["BarcodeDetector"]>>;

  constructor(private video: HTMLVideoElement, private onDetect: OnDetect) {
    this.detector = new window.BarcodeDetector!({ formats: BARCODE_FORMATS });
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.tick();
  }

  private tick = () => {
    this.detector
      .detect(this.video)
      .then((results) => {
        if (results.length > 0) {
          this.onDetect(results[0].rawValue);
        }
      })
      .catch(() => {
        // transient decode errors are expected between frames; ignore
      })
      .finally(() => {
        this.rafId = requestAnimationFrame(this.tick);
      });
  };

  stop() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.video.srcObject = null;
  }
}

class ZXingBarcodeScanner implements CameraScanner {
  private controls: { stop(): void } | null = null;

  constructor(private video: HTMLVideoElement, private onDetect: OnDetect) {}

  async start() {
    const { BrowserMultiFormatReader } = await import("@zxing/browser");
    const reader = new BrowserMultiFormatReader();
    this.controls = await reader.decodeFromVideoDevice(undefined, this.video, (result) => {
      if (result) {
        this.onDetect(result.getText());
      }
    });
  }

  stop() {
    this.controls?.stop();
  }
}

export function createCameraScanner(video: HTMLVideoElement, onDetect: OnDetect): CameraScanner {
  return supportsBarcodeDetector()
    ? new NativeBarcodeScanner(video, onDetect)
    : new ZXingBarcodeScanner(video, onDetect);
}
