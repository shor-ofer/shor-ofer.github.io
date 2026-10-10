# Space Invaders 2 — PWABuilder kit

## 1. Add to your repo (shor-ofer/space-invaders2)
Copy into the repo root, next to `space-invaders.html`:
- `manifest.webmanifest`
- `sw.js`
- `icons/` folder

Then paste the two blocks from `head-snippet.html` into `space-invaders.html`. Commit and push, wait ~1 minute for GitHub Pages.

## 2. Check it
Open https://shor-ofer.github.io/space-invaders2/manifest.webmanifest — you should see the JSON.

## 3. PWABuilder
1. pwabuilder.com → paste https://shor-ofer.github.io/space-invaders2/space-invaders.html → Start.
2. Manifest / Service worker should show green.
3. Package for stores → **Android** → Generate.
   - Package ID: `io.github.shor_ofer.invaders2`
   - App name: `Space Invaders 2`
   - Signing key: "Create new"
4. Download the zip, unzip, copy the `.apk` to your phone and install (allow "install unknown apps" when asked).

Keep the `signing.keystore` and `signing-key-info.txt` from that zip — you need the same key for any future update.

## Tweaks
- Orientation: `"orientation": "any"` in the manifest. Change to `"portrait"` or `"landscape"` to lock it.
- After changing the game, bump `CACHE` in `sw.js` (v1 → v2) so phones pick up the new version.
