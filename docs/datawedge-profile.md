# Zebra DataWedge Profile Setup

This app reads hardware barcode scans via **keyboard-wedge (HID) output** — the scanner types the barcode into the focused field just like a keyboard, followed by an Enter keystroke. The PWA's `hid-scanner.ts` distinguishes this from human typing by keystroke timing, so DataWedge must be configured to behave consistently.

## Create a dedicated profile

Do not edit the default DataWedge profile — create a new one scoped only to the browser used to run this PWA, so scanner behavior doesn't leak into other apps on the device.

1. Open **DataWedge** on the Zebra device (usually pre-installed; if not, install from Zebra's site for the device model).
2. Tap **+ New profile**, name it e.g. `VentorMobilePWA`.
3. Under **Associated apps**, add the browser package used to launch the PWA (e.g. Chrome — `com.android.chrome`, or the specific browser/PWA-install package if using a installed home-screen shortcut). Restrict to this app only.

## Barcode Input plugin

- Enable **Barcode Input**.
- Under **Decoders**, enable the symbologies actually used on your product/location labels — at minimum:
  - Code 128
  - EAN-13 / UPC-A
  - QR Code (if used for locations/pallets)
- Leave scan parameters (aim duration, etc.) at defaults unless a specific device needs tuning.

## Keystroke output plugin

- Enable **Keystroke output**.
- **Action key character**: set to `ENTER` (this is the scan terminator the app listens for).
- **Send ENTER key**: Enabled, as an "action key" sent after each scan.
- **Inter-character delay**: `0` ms (no artificial delay between injected characters — keeps the scan burst fast enough for the app's timing-based detection to work).
- **Basic data formatting**: leave prefix/suffix empty unless your barcodes carry a check digit or fixed prefix that must be stripped — if so, configure that here rather than in app code.

## Intent output plugin

- **Disable Intent output.** This app is a website (PWA), not a native Android app that can register a broadcast receiver for Intents. Keyboard-wedge output is the only integration path available to a browser-based app.

## Verifying the setup

1. Open the PWA in the browser this profile is scoped to.
2. Focus the search field (or leave nothing focused, if scanning the picking screen).
3. Scan a known barcode label.
4. Expect: the field populates with the barcode value and a search/lookup fires automatically — no visible keystroke lag, no partial/garbled value.
5. Scan several barcodes back-to-back (~1 per second) to confirm each is captured as a discrete value, with no runs concatenating into one string.
6. Separately, manually type into a text field on the same page at normal typing speed and confirm it is *not* misinterpreted as a scan.

If scans arrive broken or concatenated, check:
- Inter-character delay is `0` in the profile.
- Only one DataWedge profile is active for the app (a second profile matching the same app package can cause duplicate/racing keystroke injection).
- The device isn't running a custom keyboard/IME that intercepts or delays keystrokes.
