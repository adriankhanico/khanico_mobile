# Device Certificate Setup (HTTPS)

Khanico Mobile runs at **`https://10.6.0.77`**. Because it's only on the local network and has no public domain, its HTTPS certificate is issued by Khanico's own certificate authority (run by the Caddy container on the server; see `Caddyfile`). Each device has to trust that authority **once**. After that, the site loads with a padlock, the camera scan button works, and the app can be installed.

Until a device trusts the certificate, it shows **"Not secure"** or **"Your connection is not private"** at `https://10.6.0.77`.

## 1. Download the certificate

On the device, open:

**`http://10.6.0.77/khanico-ca.crt`**

This address uses plain `http://` on purpose: the HTTPS site can't be opened until the device trusts the certificate. The file is `khanico-ca.crt`, issued as **"Caddy Local Authority - 2026 ECC Root"** and valid until 2036.

## 2. Install it as a trusted root

### Zebra scanners

Add `khanico-ca.crt` to the device's **StageNow** (or MDM) profile as a **trusted CA certificate** (StageNow's **CertMgr** setting, certificate type **CA**). Every device staged with that profile, including new ones, then trusts it automatically.

To set up a single scanner by hand, follow the Android steps below.

### Android phones

1. Download the file (step 1).
2. Go to **Settings → Security → Encryption & credentials → Install a certificate → CA certificate**. The exact menu names vary by manufacturer; search Settings for "certificate" if needed.
3. Tap **Install anyway** at the warning, then choose `khanico-ca.crt` from Downloads.
4. Fully close Chrome (swipe it away from recent apps) and reopen it.

Choose **CA certificate**. "VPN & app user certificate" and "Wi-Fi certificate" won't work.

### iPhone / iPad

1. Open the download link in **Safari**. Other browsers can't install profiles. Tap **Allow**.
2. Go to **Settings → Profile Downloaded → Install** and enter the passcode.
3. Go to **Settings → General → About → Certificate Trust Settings** and turn on full trust for **Caddy Local Authority - 2026 ECC Root**.

Step 3 is easy to miss. Without it, the profile is installed but the certificate still isn't trusted.

### Windows PCs (Chrome / Edge)

1. Double-click `khanico-ca.crt` and choose **Install Certificate**.
2. Choose **Local Machine** (this needs admin) and click Next.
3. Choose **Place all certificates in the following store**, then Browse and select **Trusted Root Certification Authorities**.
4. Click Finish, then close **every** Chrome/Edge window and reopen the browser.

Don't let Windows pick the store automatically, because it often puts the certificate in the wrong one.

### Firefox (any OS)

Firefox ignores the system certificate store. Either:
- go to **Settings → Privacy & Security → Certificates → View Certificates → Authorities → Import**, choose `khanico-ca.crt`, and tick **Trust this CA to identify websites**, or
- open `about:config` and set `security.enterprise_roots.enabled` to `true`. This works on Windows after the Windows steps above.

## 3. Check it

Open **`https://10.6.0.77`**. It should load with a padlock and no warning. Log in once; the HTTPS address keeps its own login, separate from the old one.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Still says "Not secure" | Check the address bar says `https://10.6.0.77`. The old `http://10.6.0.77:3001`, and any bookmark or home-screen shortcut pointing to it, is never secure. |
| Warning persists after installing | The browser wasn't restarted. Close every window or swipe the app away, then reopen. |
| Windows: still untrusted | The certificate went into the wrong store. Reinstall it, choosing **Local Machine → Trusted Root Certification Authorities** explicitly. |
| Android: still untrusted | It was installed as a user or Wi-Fi certificate. Reinstall it as a **CA certificate**. |
| iPhone: still untrusted | Full trust isn't turned on in **Certificate Trust Settings**. |
| "Issued by" isn't *Caddy Local Authority - 2026 ECC Intermediate* | Something else on the network is intercepting the connection. Check the certificate details (tap "Not secure" → certificate) and report the issuer. |

## For IT

- The authority lives in the `caddy_data` Docker volume on 10.6.0.77. **Don't delete it.** A new authority means re-trusting the certificate on every device. The site certificate under it renews automatically.
- If the server's IP changes, update `Caddyfile` (it names `10.6.0.77`) and this document. Devices keep trusting the same authority, so nothing needs reinstalling.
- See [DEPLOY.md](../DEPLOY.md#https) for the server-side setup.
