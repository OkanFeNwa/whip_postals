# whip_postals

A WHIP satellite that draws **postal codes** on the maps: the **big pause-menu map**, the **Map window of `/whip`**, and the **HUD minimap**. Each label has its own style, and the map's own ground colours can be swapped for one of three presets or a custom palette.

It does not touch `whip_core`'s map logic: blips, the GPS line, the waypoint, 3D tilt, zoom, follow-player and every minimap setting keep working exactly as before. The resource only paints an extra layer over the map draw calls.

The numbers are painted on **one canvas per map**, not as 865 DOM elements: panning, zooming and the 3D glide stay smooth with every postal visible at once. `/gps <postal>` resolves the same data file, so the command and the labels can never disagree.

## Installation

The resource can live in **any folder under `resources/`**: `resources/[custom]/whip_postals`, `resources/[local]/whip_postals`, `resources/whip_postals`, etc. The folder name itself must be `whip_postals` (the NUI hook URL contains the resource name); the parent folder is not hardcoded anywhere.

Copy the `whip_postals` folder into your server's `resources` directory, then add this line to `server.cfg`, **after `whip_core`**:

```cfg
ensure whip_postals
```

- `dependency 'whip_core'` and `@whip_core/lib/satellite.lua` are already in the manifest.
- `shared/locales.lua`, `server/gps.lua` and `client/gps.lua` are declared too: nothing else to register.
- Unlike most satellites, this one also needs a single loader block in `whip_core/html/index.html` (see below).

Repository: https://github.com/OkanFeNwa/whip_postals

```bash
cd resources
git clone https://github.com/OkanFeNwa/whip_postals.git
```

### The manual hook

`whip_core` owns the page, so a satellite cannot inject itself into it. Run the installer **once by hand**: double-click `tools/install-core-hook.cmd`. It adds a retry loader right after `js/main.js` in `whip_core/html/index.html`, then in the server console:

```cfg
refresh
restart whip_core
```

- The loader fetches `https://cfx-nui-whip_postals/nui/extension.js` up to 60 times, 500 ms apart, because `whip_core` starts first and the NUI host may not exist yet.
- It is **strictly manual**: `install-core-hook.ps1` refuses to run without `-Manual`, which only the `.cmd` passes. It is not in `files {}`, is never served to NUI, and no Lua script or player action can reach it. No watcher, schedule or server hook.
- It is idempotent, migrates the old single-line hook, saves a timestamped backup in `tools/backups/`, and looks for `whip_core` in `[core]` first and then at the resources root.
- Stop with an error and change nothing if `js/main.js` is no longer found.

This is the **only** change made to `whip_core`. Delete the block and `restart whip_core` to go back to the stock map. After a `whip_core` update, run the installer again. The root `extension.js` is a three-line compatibility bridge: a NUI page cached before the `nui/` reorg still requests `/extension.js`, and it is forwarded to the real module.

## Languages

All visible text is translated. In `nui/locales.json` change a single line:

```json
"locale": "it"  // it, en, es, fr, de
```

Complete `it`, `en`, `es`, `fr`, `de` blocks are included in the same file, read by **both** the NUI and the Lua side (`shared/locales.lua`). Copy a block to add another language. The five languages cover:

- all `/gps` notifications and the server-console load message;
- every label of the optional in-game editor, including the comments of the exported `config.js`;
- the page language attribute.

Fallback is `en`, then `it`, then the key name. Not translated: the codes themselves (numbers) and CSS colour/font names. NUI picks up a change on the next `restart whip_core`; `/gps` on the next `restart whip_postals`.

## How to use

1. Open the map with **M**, or the **Map** window in `/whip`. Postal codes are drawn over the map in the `midnight` palette by default: dark blue sea, bright roads and motorways.
2. Pan and zoom as usual. With `declutter: false` (the default) **every** postal in view is drawn, overlaps included. Set it to `true` for the old one-label-per-grid-cell filter. Below `minPxPerMetre` the numbers hide so they do not turn into a smear at wide zoom.
3. Look at the HUD minimap: it has its own style and its own zoom threshold, and its labels also appear in the minimap preview in WHIP's **Settings**.
4. Set GTA's own waypoint with **`/gps 3001`**. The server resolves the code from `nui/postals.json` and sends only `x, y` to the client, which calls `SetNewWaypoint`. The waypoint shows on both the HUD minimap and the big map.

The command is available to everyone (no ACE permission), works while downed, and is rate-limited to 6 commands/second by WHIP. A missing or malformed code gets a localized notification; there is no client event that can set an arbitrary point.

### The postal data

`nui/postals.json` is an array, and `code` may be a string or a number:

```json
[{ "code": "3001", "x": -1157.1995849609, "y": 4938.10546875 }]
```

The included OCRP set has **865** entries. Replace the file with your own set of the same shape and nothing else changes: the renderer and `/gps` both read it. After replacing it, `restart whip_postals` for the command and `restart whip_core` for the map.

### Map colours

`theme.preset` accepts `midnight` (default), `paper`, `whip` (WHIP's stock palette, labels stay on) and `custom` (reads `theme.colours`). Each preset has eight families of the 2D map:

| Key | Where it shows |
| --- | --- |
| `deep` | deep sea and the background outside the island |
| `shore` | shallow water and coastlines |
| `land` | land |
| `build`, `build2` | buildings, two shades |
| `path` | paths, dirt roads, pavements |
| `road` | roads |
| `hwy` | motorways |

The values are RGB triples passed through the same luminance ramp `whip_core` uses. `paper` is bright (white roads on parchment): blips are white with a dark rim and still readable, but try it before keeping it.

### The style editor

The editor is present in the code but **disabled** (`EDITOR_ENABLED = false` near the top of `nui/extension.js`), so there is no extra button on the map. To get it back, set that flag to `true` and `restart whip_core`. It then appears as a **Postals** button on the map and edits the labels and palette live on that client. Its strings follow the active locale.

The panel also exports a complete `config.js` to save as `whip_postals/nui/config.js`: that is how a client-side choice becomes the server default.

## State and persistence

There is no server-side state. The player's own choices are kept in `localStorage` on the NUI page's origin and laid over `config.js` at boot, so they survive a reconnect and a restart. The key is `whip_postals.style.v2`; the old `v1` key is removed at boot. `window.__whipPostals.reset()` clears the saved values and goes back to the file.

`whip_core`'s page cannot receive `SendNUIMessage` or NUI callbacks from this resource, so the browser's own storage is the channel a satellite can rely on. `config.js` itself is a resource file the page cannot write: the editor exports its text for a server admin to copy.

## NUI

| File | Role |
| --- | --- |
| `nui/extension.js` | map hooks, canvas renderer, language loader, optional editor, diagnostics |
| `nui/config.js` | server defaults for the labels and the map palette |
| `nui/locales.json` | IT / EN / ES / FR / DE strings, single source for NUI and Lua |
| `nui/postals.json` | 865 postal codes, the same file for the map and `/gps` |
| `extension.js` | compat bridge for NUI pages cached with the old `/extension.js` hook |

`shared/locales.lua` is the Lua reader for `nui/locales.json`; `server/gps.lua` registers `/gps` and resolves the code; `client/gps.lua` sets the waypoint. `tools/` contains no runtime code.

## Events

| Name | Direction | Use |
| --- | --- | --- |
| `whip_postals:setGps` | server → client | `x, y` resolved from `postals.json`: sets the GTA waypoint |

`/gps` is a `Whip.command` on the server, not an event: a player cannot trigger it with arbitrary coordinates.

## Diagnostics

WHIP wraps `console.error` into its error log, so the diagnostics are readable in the server console with `whiperrors` (or from F8 with developer mode):

- `[whip_postals][BOOT]` — the loader ran; `OK (attempt N)` means the module was imported.
- `[whip_postals][DIAG]` — module running, postals loaded, config flags, canvas state.
- `[whip_postals][PAINT]` — labels actually drawn, with count and canvas size.

| Symptom | Likely cause |
| --- | --- |
| Only `[BOOT] load failed: HTTP 404` | resource not started, or the hook URL/name is wrong |
| `[DIAG]` present, no `[PAINT]` | `enabled: false`, zoom below `minPxPerMetre`, or no map drawn yet |
| `[PAINT]` present, nothing visible | canvas CSS/z-index, or opacity set to 0 |
| Old style still applied | old local save; `window.__whipPostals.reset()` clears it |

From a browser/dev console, `window.__whipPostals` exposes `count`, `config`, `editor`, `openEditor()`, `closeEditor()`, `reset()` and `redraw()`.

## Configuration

`nui/config.js` contains the postal file path, the two label blocks (`labels.pause` and `labels.minimap`: enabled, declutter, zoom threshold, size, weight, font, colour, background, border, radius, padding, shadow, opacity), and the theme block (enabled, preset, the three built-in palettes and the custom colours). The minimap block also has `max`, the per-frame ceiling used when `declutter` is on.

Edit the file, then `restart whip_core`: the page loads it once when it opens. Restarting `whip_postals` alone only affects the Lua side (`/gps` and the locale strings).
