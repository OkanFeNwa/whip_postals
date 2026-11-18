# whip_postals

Postal codes (**civici**) drawn on WHIP's maps: the **big pause-menu map**, the **Map window of `/whip`**,
and the **HUD minimap**. Each label can be styled independently, and the map's own ground colours can be
swapped for one of three presets or a custom palette.

`whip_core` itself is untouched: blips, the GPS line, the waypoint, 3D tilt, zoom, follow-player and all
minimap settings keep working exactly as before. This resource only paints an extra layer on top of the
map draw calls.

The numbers are painted on **one canvas per map**, not as 865 DOM elements, so panning and zooming stay
smooth with every postal visible at once.

[Italiano](README.it.md)

---

## Features

- 865 OCRP civici, loaded from `nui/postals.json` — replace that file with your own set (same shape) and
  nothing else changes.
- `declutter: false` by default: **every** postal in view is drawn, overlaps included. Set it to `true` for
  the old one-label-per-cell filter.
- Separate style for the pause map and for the HUD minimap.
- Three map palettes (`midnight`, `paper`, stock `whip`) plus a fully custom one.
- `/gps <postal>` for every player, resolved from the very same `postals.json`.
- Five languages (IT / EN / ES / FR / DE) for the server messages and the optional editor.
- The in-game style editor is present in the code but **disabled** (`EDITOR_ENABLED = false`).

## Requirements

- FiveM with `whip_core` installed and started before this resource.
- The resource folder must be named `whip_postals` (the NUI hook URL depends on it).

## Installation

1. Copy this folder to `resources/[custom]/whip_postals` (any category folder works, as long as the folder
   itself is `whip_postals`). `server.cfg` only needs the usual `ensure [custom]`, or add
   `ensure whip_postals` explicitly.
2. Run the **manual** hook installer once: double-click `tools/install-core-hook.cmd`. It adds a single
   loader block to `whip_core/html/index.html`, right after `js/main.js`. Then, in the server console:

   ```
   refresh
   restart whip_core
   ```

3. Open the map with **M**. If the numbers do not show up, see [Troubleshooting](#troubleshooting).

### What the hook does

The loader in `index.html` fetches `https://cfx-nui-whip_postals/nui/extension.js` with retries (up to 60,
half a second apart), because `whip_core` starts before `whip_postals` and its NUI host may not exist yet.

```html
<script>
(function () {
    var url = 'https://cfx-nui-whip_postals/nui/extension.js';
    var tries = 0, seen = {};
    function note(msg) { if (!seen[msg]) { seen[msg] = true; console.error('[whip_postals][BOOT] ' + msg); } }
    function boot() {
        if (window.__whipPostals) return;
        tries++;
        fetch(url, { cache: 'no-store' })
            .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return import(url); })
            .then(function () { note('OK (tentativo ' + tries + ')'); })
            .catch(function (e) {
                note('caricamento non riuscito: ' + ((e && (e.stack || e.message)) || String(e)));
                if (tries < 60) setTimeout(boot, 500);
            });
    }
    setTimeout(boot, 300);
})();
</script>
```

This is the **only** change made to `whip_core`. To revert, delete the block and `restart whip_core`; the
map goes back to stock.

The root `extension.js` is a three-line compatibility bridge. A NUI page cached before the `nui/` reorg
still requests `/extension.js`; the bridge forwards it to the real module. It does nothing for pages using
the current path.

### The installer is strictly manual

`tools/install-core-hook.ps1` refuses to run without `-Manual`, which only the `.cmd` passes. It is not
listed in `files {}` in `fxmanifest.lua`, is never served to NUI, and is not referenced by any Lua script:
there is no watcher, schedule, server hook or player-callable path. It just edits `index.html` when you
double-click the `.cmd`.

- Idempotent: if the loader is already there, it exits without touching anything.
- Migrates the old single-line hook to the retry loader.
- Saves a timestamped backup to `tools/backups/` before writing.
- Looks for `whip_core` in `[core]` first, then at the resources root.
- Stops with an error and changes nothing if `js/main.js` is no longer found.

After a `whip_core` update the block is overwritten — just run the installer again.

## Languages

Everything is defined in **`nui/locales.json`**, read both by the NUI and by the Lua side
(`shared/locales.lua`). Change one line to switch:

```json
"locale": "it"
```

Supported values: `it`, `en`, `es`, `fr`, `de`. Missing keys fall back to `en`, then `it`.

Translated:

- all `/gps` notifications and server-console messages;
- every label of the optional in-game editor, including the comments of the exported `config.js`;
- the page language attribute.

Not translated: postal codes (numbers), CSS colour/font names, and this documentation (see
[README.it.md](README.it.md) for Italian).

To add a language, copy one of the language objects in `nui/locales.json`, translate its strings, and set
`locale` to the new key. NUI picks up the change on the next `restart whip_core`; `/gps` picks it up on the
next `restart whip_postals`.

## `/gps <postal>`

Available to everyone, no permissions, usable while downed (rate limit: 6 commands/second):

```
/gps 3001
```

The server looks the code up in `nui/postals.json` and sends **only `x, y`** to the client, which calls
`SetNewWaypoint`. There is no second data file to keep in sync, and no client event that can set an
arbitrary point. The waypoint is GTA's own: it shows on the HUD minimap and on the big map.

## Configuration

Edit **`nui/config.js`**, then `restart whip_core` (the page loads the file when it opens; restarting
`whip_postals` alone is not enough).

- `labels.pause` — style of the big map / `/whip` Map window.
- `labels.minimap` — style of the HUD minimap.
- `declutter` — `false` (default) draws every postal in view; `true` keeps one label per grid cell.
- `minPxPerMetre` — hide the numbers when zoomed out too far (`0.22` big map ≈ zoom 3.4, `0.5` minimap).
- `theme.enabled` / `theme.preset` / `theme.colours` — map palette; `custom` uses `theme.colours`.

The editor code is still in `nui/extension.js`. To get the panel back, set `EDITOR_ENABLED = true` near
the top and `restart whip_core`. It then appears as a **Civici** button on the map; choices stay on that
client and can be exported as a new `config.js`. Its control texts follow the active locale.

`tools/` contains no runtime code. Every game-side file lives in `nui/`, `server/` or `client/`.

## Data format

`nui/postals.json` is an array; `code` can be a string or a number:

```json
[{ "code": "3001", "x": -1157.1995849609, "y": 4938.10546875 }]
```

## Troubleshooting

WHIP wraps `console.error` into its error log, so the diagnostics are readable in the server console with
`whiperrors` (or from F8 with developer mode):

- `[whip_postals][BOOT]` — the loader ran; `OK` means the module was imported.
- `[whip_postals][DIAG]` — module running, number of postals loaded, config flags, canvas/paint state.
- `[whip_postals][PAINT]` — labels actually drawn, with count and canvas size.

Reading them:

| Symptom | Likely cause |
| --- | --- |
| Only `[BOOT] caricamento non riuscito: HTTP 404` | resource not started, or the hook URL/name is wrong |
| `[DIAG]` present, no `[PAINT]` | `enabled: false`, zoom below `minPxPerMetre`, or no map drawn yet |
| `[PAINT]` present, nothing visible | canvas CSS/z-index, or opacity set to 0 |
| Old style still applied | old local save; `window.__whipPostals.reset()` clears it (storage key is now `whip_postals.style.v2`) |
| No **Civici** button | expected: the editor is disabled |

From a browser/dev console, `window.__whipPostals` exposes `count`, `config`, `editor`, `openEditor()`,
`closeEditor()`, `reset()` and `redraw()`.

## Project layout

```
whip_postals/
├── fxmanifest.lua
├── README.md / README.it.md
├── extension.js              compat bridge for the old /extension.js hook
├── nui/
│   ├── extension.js          map hooks, canvas renderer, optional editor
│   ├── config.js             server defaults for style and palette
│   ├── locales.json          IT / EN / ES / FR / DE strings (single source)
│   └── postals.json          865 civici
├── shared/
│   └── locales.lua           Lua reader for locales.json
├── server/gps.lua            /gps command
├── client/gps.lua            SetNewWaypoint handler
└── tools/
    ├── install-core-hook.cmd
    ├── install-core-hook.ps1
    └── backups/              created by the installer (gitignored)
```

## Credits

Postal data: OCRP set (865 entries). Built for WHIP.

## License

MIT — see [LICENSE](LICENSE). The postal dataset is included as-is; check its own terms before
redistributing it separately.
