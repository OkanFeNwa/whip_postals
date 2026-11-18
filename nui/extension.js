// ============================================
// whip_postals — postal codes on whip's maps
// ============================================
//
// whip_core's page loads this file from ONE line in html/index.html:
//
//     <script type="module" src="https://cfx-nui-whip_postals/nui/extension.js"></script>
//
// Nothing else in whip_core changes. This module imports whip_core's own map modules by the very address
// the page uses, so the browser hands it the same class objects, and adds on top of them:
//
//   pause map   js/pause-map.js's PauseMap: one label canvas under the blips, repainted on every draw()
//   minimap     js/map3d/map3d.js's MinimapCamera: a canvas inside the clip, following the map's own view
//   colours     ...WhipMap3D.setPalette: the theme in config.js
//   editor      the "Postals" panel, off by default (EDITOR_ENABLED near the top)
//
// Every hook calls the original first and only adds to it, so blips, the GPS line, the waypoint, the 3D
// tilt, zoom, follow and the minimap's own settings keep working exactly as they did.
//
// The numbers live in postals.json in this resource and are read once, over https (FiveM serves a
// resource's declared files at https://cfx-nui-<resource>/<path>).

import { NuiRouter } from 'https://cfx-nui-whip_core/html/js/router.js';
import { PauseMap, whenMap3D } from 'https://cfx-nui-whip_core/html/js/pause-map.js';
import { config } from './config.js';

const CFG = config;

// ---- languages ----
// One source of truth: nui/locales.json, read by the Lua side as well. `locale` picks the active
// language; missing keys fall back to en, then it, then the caller's default. The file is fetched at
// boot; the editor (off by default) and the export sheet read the strings when they are shown.
let LOCALES = null;
let LANG = 'it';

function localePath(obj, key) {
    if (!obj) return undefined;
    for (const part of key.split('.')) {
        if (obj == null || typeof obj !== 'object') return undefined;
        obj = obj[part];
    }
    return obj;
}

/** Translated string; %s / %d placeholders are replaced by the extra arguments. */
function tr(key, fallback, ...args) {
    let value = localePath(LOCALES && LOCALES[LANG], key);
    if (typeof value !== 'string') value = localePath(LOCALES && LOCALES.en, key);
    if (typeof value !== 'string') value = localePath(LOCALES && LOCALES.it, key);
    if (typeof value !== 'string') value = fallback !== undefined ? fallback : key;
    if (args.length) {
        let i = 0;
        value = value.replace(/%[sd]/g, () => (i < args.length ? String(args[i++]) : ''));
    }
    return value;
}

function loadLocales() {
    let url;
    try { url = new URL('locales.json', import.meta.url); }
    catch (e) { warn(e); return Promise.resolve(); }
    return fetch(url, { cache: 'no-store' })
        .then((r) => {
            if (!r.ok) throw new Error('HTTP ' + r.status + ' on ' + url);
            return r.json();
        })
        .then((j) => {
            if (!j || typeof j !== 'object') return;
            LOCALES = j;
            LANG = typeof j.locale === 'string' ? j.locale : 'it';
            if (typeof document !== 'undefined' && document.documentElement)
                document.documentElement.lang = LANG;
        })
        .catch(warn);
}

const DEG = Math.PI / 180;

/** screen px per world metre at zoom 0 (pause-map.js's K0: one px0 is 0.33 world m, 16 screen px). */
const PX0_PER_M = 0.33 / 16;

// How wide a label is, in em, so the declutter grid knows what it is spacing. Digits in Barlow 700 run
// about 0.60em; PAD is the horizontal padding + border the CSS adds either side.
const CHAR_EM = 0.60;
const PAD_EM = 0.95;
const HEIGHT_EM = 1.52;

const EMPTY = [];

/**
 * The in-game editor (the "Postals" button on the pause menu's map) is off for now. Nothing of it is built
 * and no key scope is registered, so the map looks and behaves as if it were not there. All the code is
 * still below: set this to true and `restart whip_core` (the page is fetched once per resource) to have it
 * back. The style is still read from config.js, so labels and colours keep working either way.
 */
const EDITOR_ENABLED = false;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

let warned = false;
let drawCount = 0;                   // diagnostics: how many labels were actually painted
let diagPause = false, diagMini = false;
function canvasPainted(cv) {
    if (!cv || !cv.width || !cv.height) return false;
    const ctx = cv.getContext('2d');
    if (!ctx) return false;
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 3; i < d.length; i += 4 * 37) if (d[i]) return true;
    return false;
}
function warn(err) {
    if (warned) return;
    warned = true;
    console.error('[whip_postals]', err);
}

// ---- the postals ----

let postals = [];                    // { code, x, y }
let PX = new Float32Array(0);        // per postal: the screen x/y of its last projection
let PY = new Float32Array(0);
let VIS = new Uint8Array(0);         // 1 when that projection was on screen
let MX = new Float32Array(0);        // the minimap's own scratch (it places a small, filtered set)
let MY = new Float32Array(0);

// ---- the page ----

let map3d = null;                    // the page's one WhipMap3D, once built
let paletteFn = null;                // the theme's palette fn, or null (whip's own)
let nativePalette = null;            // the palette whip itself last handed the 3D map (the theme off)
const pmaps = new Set();             // PauseMaps seen drawing
const lastMini = { cam: null, v: null };

/** The CSS the labels and the map's ground colour live by. Injected here, so it lands after every sheet. */
const CSS = `
.wp-postals {
    position: absolute;
    left: 0; top: 0; right: 0; bottom: 0;
    overflow: hidden;
    pointer-events: none;
}
.wp-postals .wp-label {
    position: absolute;
    left: 0; top: 0;
    display: none;
    margin: 0;
    padding: var(--wp-py, 0.16em) var(--wp-px, 0.44em);
    font-family: var(--wp-font, Barlow, 'Segoe UI', sans-serif);
    font-size: var(--wp-fs, 12px);
    font-weight: var(--wp-fw, 700);
    line-height: 1;
    letter-spacing: var(--wp-ls, 0.02em);
    color: var(--wp-color, #e8f0fb);
    background: var(--wp-bg, rgba(9, 15, 25, 0.74));
    border: var(--wp-bw, 1px) solid var(--wp-bc, rgba(150, 180, 220, 0.24));
    border-radius: var(--wp-radius, 4px);
    box-shadow: var(--wp-shadow, 0 1px 3px rgba(0, 0, 0, 0.5));
    text-shadow: var(--wp-tshadow, 0 1px 2px rgba(0, 0, 0, 0.85));
    opacity: var(--wp-opacity, 1);
    white-space: nowrap;
    text-align: center;
    text-transform: none;
    user-select: none;
    transform: translate(-50%, -50%);
}
.pmap { background: var(--wp-deep, rgb(8, 14, 23)); }
.mm { background: var(--wp-deep, rgb(8, 14, 23)); }

/* ---- the editor (pause map) ---- */

.wp-open {
    position: absolute;
    top: 28px;
    right: 28px;
    z-index: 6;
    display: none;
    align-items: center;
    gap: 9px;
    padding: 10px 16px;
    border-radius: 20px;
    background: var(--ui-surface-raised, rgba(18, 26, 38, 0.94));
    border: 1px solid var(--ui-border, rgba(255, 255, 255, 0.14));
    box-shadow: var(--ui-shadow, 0 8px 24px rgba(0, 0, 0, 0.45));
    color: var(--ui-text, #e9f0fa);
    font-family: var(--ui-font, system-ui, sans-serif);
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
}
#pause[data-mode="map"] .wp-open { display: flex; }
#pause.wp-editor-open .wp-open { display: none; }
#pause.wp-editor-open .pm-legend { display: none; }
.wp-open:hover { border-color: rgba(147, 197, 253, 0.55); color: #fff; }
.wp-open-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #8ec5ff;
    box-shadow: 0 0 10px rgba(142, 197, 255, 0.9);
}

.wp-ed {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 7;
    width: clamp(320px, 32vw, 420px);
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    background:
        radial-gradient(120% 50% at 100% 0%, rgba(96, 165, 250, 0.09), transparent 60%),
        var(--ui-surface-solid, rgb(10, 16, 26));
    border-left: 1px solid var(--ui-border, rgba(255, 255, 255, 0.12));
    box-shadow: -18px 0 48px rgba(0, 0, 0, 0.45);
    color: var(--ui-text, #e9f0fa);
    font-family: var(--ui-font, system-ui, sans-serif);
    transform: translateX(102%);
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition: transform 0.3s var(--ui-ease, cubic-bezier(0.2, 0.7, 0.2, 1)), opacity 0.22s ease,
        visibility 0s linear 0.3s;
}
#pause.wp-editor-open .wp-ed {
    transform: none;
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transition: transform 0.3s var(--ui-ease, cubic-bezier(0.2, 0.7, 0.2, 1)), opacity 0.22s ease,
        visibility 0s;
}

.wp-ed-head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 22px 22px 6px;
}
.wp-ed-title {
    flex: 1;
    font-family: var(--ui-font-display, var(--ui-font, system-ui, sans-serif));
    font-size: 24px;
    font-weight: 800;
    letter-spacing: -0.01em;
    color: #f4f7fb;
}
.wp-ed-close {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 1px solid var(--ui-border, rgba(255, 255, 255, 0.14));
    background: rgba(255, 255, 255, 0.06);
    color: #dce6f3;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
}
.wp-ed-close:hover { background: rgba(255, 255, 255, 0.13); color: #fff; }
.wp-ed-sub {
    padding: 0 22px 14px;
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--ui-text-mid, #93a5bc);
}

.wp-preview {
    display: flex;
    gap: 12px;
    padding: 0 22px 16px;
}
.wp-sample { flex: 1; min-width: 0; }
.wp-sample-host {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 62px;
    border-radius: 12px;
    background:
        linear-gradient(0deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.04)),
        rgb(13, 20, 31);
    border: 1px solid rgba(255, 255, 255, 0.08);
    overflow: hidden;
}
.wp-sample-host .wp-postals {
    position: static;
    inset: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: visible;
}
.wp-sample-host .wp-label {
    position: static;
    display: block;
    transform: none;
}
.wp-sample-tag {
    margin-top: 6px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(160, 180, 205, 0.75);
}

.wp-ed-tabs {
    display: flex;
    gap: 6px;
    padding: 0 22px 10px;
}
.wp-ed-tab {
    flex: 1;
    padding: 9px 4px;
    border-radius: 10px;
    border: 1px solid transparent;
    background: rgba(255, 255, 255, 0.05);
    color: var(--ui-text-mid, #93a5bc);
    font-family: inherit;
    font-size: 12.5px;
    font-weight: 700;
    cursor: pointer;
}
.wp-ed-tab:hover { background: rgba(255, 255, 255, 0.09); }
.wp-ed-tab.on {
    background: rgba(96, 165, 250, 0.2);
    border-color: rgba(96, 165, 250, 0.5);
    color: #fff;
}

.wp-ed-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 22px 18px;
}
.wp-ed-pane { display: none; }
.wp-ed-pane.on { display: block; }

.wp-sec-head {
    margin: 16px 0 4px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.11em;
    text-transform: uppercase;
    color: rgba(150, 175, 205, 0.8);
}
.wp-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.055);
    font-size: 13px;
}
.wp-row:last-child { border-bottom: 0; }
.wp-lab {
    flex: 1;
    min-width: 96px;
    color: #dce6f3;
}
.wp-val {
    min-width: 58px;
    text-align: right;
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 11.5px;
    color: #8fc0ff;
}
.wp-range {
    width: 100%;
    margin: 2px 0 0;
    height: 18px;
    accent-color: #6aa9f5;
    cursor: pointer;
}
.wp-select {
    min-width: 132px;
    max-width: 60%;
    padding: 6px 8px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(255, 255, 255, 0.06);
    color: #e9f0fa;
    font-family: inherit;
    font-size: 12.5px;
    cursor: pointer;
}
.wp-select option { background: #131c28; color: #e9f0fa; }
.wp-check {
    width: 42px;
    height: 24px;
    flex: none;
    accent-color: #6aa9f5;
    cursor: pointer;
}
.wp-colours {
    display: flex;
    align-items: center;
    gap: 8px;
}
.wp-color {
    width: 34px;
    height: 26px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 7px;
    background: none;
    cursor: pointer;
}
.wp-alpha {
    width: 86px;
    accent-color: #6aa9f5;
    cursor: pointer;
}

.wp-ed-foot {
    display: flex;
    gap: 8px;
    padding: 12px 22px 18px;
    border-top: 1px solid var(--ui-border, rgba(255, 255, 255, 0.1));
}
.wp-btn {
    flex: 1;
    padding: 11px 10px;
    border-radius: 11px;
    border: 1px solid var(--ui-border, rgba(255, 255, 255, 0.14));
    background: rgba(255, 255, 255, 0.06);
    color: #e9f0fa;
    font-family: inherit;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
}
.wp-btn:hover { background: rgba(255, 255, 255, 0.12); }
.wp-btn.primary {
    background: rgba(96, 165, 250, 0.2);
    border-color: rgba(96, 165, 250, 0.55);
}
.wp-btn.primary:hover { background: rgba(96, 165, 250, 0.3); }

.wp-export {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: none;
    flex-direction: column;
    padding: 22px;
    box-sizing: border-box;
    background: var(--ui-surface-solid, rgb(10, 16, 26));
}
.wp-export.on { display: flex; }
.wp-export-head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
    font-size: 18px;
    font-weight: 800;
}
.wp-export-head .wp-ed-close { margin-left: auto; }
.wp-export-text {
    flex: 1;
    min-height: 0;
    width: 100%;
    box-sizing: border-box;
    padding: 12px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(0, 0, 0, 0.35);
    color: #cfe0f5;
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 11.5px;
    line-height: 1.5;
    resize: none;
}
.wp-export-note {
    margin: 10px 0;
    font-size: 12px;
    line-height: 1.45;
    color: var(--ui-text-mid, #93a5bc);
}
`;

function injectStyle() {
    if (document.getElementById('whip-postals-style')) return;
    const el = document.createElement('style');
    el.id = 'whip-postals-style';
    el.textContent = CSS;
    document.head.appendChild(el);
}

/** A label style's rules, as the custom properties the CSS above reads. */
function styleVars(s) {
    s = s || {};
    const out = [];
    const add = (name, v) => { if (v !== undefined && v !== null && v !== '') out.push('--wp-' + name + ':' + v); };
    add('font', s.font);
    add('fw', s.weight);
    add('ls', s.letterSpacing);
    add('color', s.colour);
    add('bg', s.background);
    add('bw', s.borderWidth);
    add('bc', s.borderColour);
    add('radius', s.radius);
    add('py', s.padY);
    add('px', s.padX);
    add('shadow', s.shadow);
    add('tshadow', s.textShadow);
    add('opacity', s.opacity);
    return out.join(';');
}

// ---- labels: one canvas per map ----
//
// 865 postal numbers as DOM elements mean 865 boxes to place and paint on every pan, zoom and glide -
// the map, which draws on change, ends up waiting for the browser. They are painted on a canvas
// instead: one element per map, one paint, and panning re-runs only measureText/fillText. The look
// (font, colours, border, radius, paddings, shadows, opacity) is the same config the editor writes.

const widthCache = new Map();

function parsePx(v, fallback) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
}

/** The config writes CSS ('0.02em', '1px'); the canvas wants px. Unitless counts as em. */
function spacingPx(v, fs) {
    if (v === undefined || v === null || v === '') return 0;
    if (typeof v === 'number') return v * fs;
    const n = parseFloat(v);
    if (!Number.isFinite(n)) return 0;
    return /px\s*$/.test(v) ? n : n * fs;
}

function roundedPath(ctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    if (!rr) { ctx.rect(x, y, w, h); return; }
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}

/** `0 1px 3px rgba(0, 0, 0, 0.5)` -> { dx, dy, colour }, or null. Blur is not used: an offset copy is
 *  indistinguishable at these sizes and costs a fraction of canvas's shadow rasteriser. */
function shadowOf(css) {
    if (!css || css === 'none') return null;
    const m = /(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px\s+(.+)$/.exec(css);
    if (!m) return null;
    return { dx: +m[1], dy: +m[2], colour: m[4].trim() };
}

function makeCanvas(cls) {
    const cv = document.createElement('canvas');
    cv.className = 'wp-postals ' + cls;
    cv.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none';
    return cv;
}

function labelCanvas(map) {
    let cv = map.__wpCanvas;
    if (cv && cv.isConnected) return cv;
    cv = makeCanvas('wp-postals-pause');
    map.root.insertBefore(cv, map.marks || null);   // under the blips, over the map's picture
    map.__wpCanvas = cv;
    return cv;
}

function paintLabels(cv, W, H, idxs, xs, ys, cfg, fs) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const dw = Math.max(1, Math.round(W * dpr)), dh = Math.max(1, Math.round(H * dpr));
    if (cv.width !== dw || cv.height !== dh) { cv.width = dw; cv.height = dh; }
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!idxs.length) return;

    const weight = Number(cfg.weight) || 700;
    const font = weight + ' ' + fs + 'px ' + (cfg.font || 'sans-serif');
    const padX = parsePx(cfg.padX, 0.44) * fs;
    const padY = parsePx(cfg.padY, 0.16) * fs;
    const radius = parsePx(cfg.radius, 4);
    const bw = Math.max(0, parsePx(cfg.borderWidth, 1));
    const alpha = cfg.opacity === undefined ? 1 : Number(cfg.opacity);
    ctx.globalAlpha = Number.isFinite(alpha) ? clamp(alpha, 0, 1) : 1;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Letter spacing: canvas exposes it on recent CEF builds, and the label's padding covers it. Where it
    // is missing (older clients) the labels are simply a little narrower.
    const ls = spacingPx(cfg.letterSpacing, fs);
    let lsTag = '';
    if ('letterSpacing' in ctx) {
        try {
            ctx.letterSpacing = (ls ? ls : 0) + 'px';
            if (ls) lsTag = '|' + ls;
        } catch (e) { /* no spacing here */ }
    }

    const n = idxs.length;
    const codes = new Array(n);
    const ws = new Array(n);
    const hs = fs + padY * 2;
    for (let i = 0; i < n; i++) {
        const k = idxs[i];
        const code = postals[k].code;
        codes[i] = code;
        const key = font + lsTag + '|' + code;
        let tw = widthCache.get(key);
        if (tw === undefined) {
            tw = ctx.measureText(code).width;
            if (widthCache.size > 6000) widthCache.clear();
            widthCache.set(key, tw);
        }
        ws[i] = tw + padX * 2;
    }

    const shadow = shadowOf(cfg.shadow);
    const tshadow = shadowOf(cfg.textShadow);

    if (shadow) {
        ctx.fillStyle = shadow.colour;
        for (let i = 0; i < n; i++) {
            const k = idxs[i];
            roundedPath(ctx, xs[k] - ws[i] / 2 + shadow.dx, ys[k] - hs / 2 + shadow.dy, ws[i], hs, radius);
            ctx.fill();
        }
    }

    ctx.fillStyle = cfg.background || 'rgba(9, 15, 25, 0.74)';
    for (let i = 0; i < n; i++) {
        const k = idxs[i];
        roundedPath(ctx, xs[k] - ws[i] / 2, ys[k] - hs / 2, ws[i], hs, radius);
        ctx.fill();
    }

    if (bw > 0) {
        ctx.strokeStyle = cfg.borderColour || 'rgba(150, 180, 220, 0.24)';
        ctx.lineWidth = bw;
        for (let i = 0; i < n; i++) {
            const k = idxs[i];
            roundedPath(ctx, xs[k] - ws[i] / 2, ys[k] - hs / 2, ws[i], hs, radius);
            ctx.stroke();
        }
    }

    if (tshadow) {
        ctx.fillStyle = tshadow.colour;
        for (let i = 0; i < n; i++) {
            const k = idxs[i];
            ctx.fillText(codes[i], Math.round(xs[k]) + tshadow.dx, Math.round(ys[k]) + tshadow.dy);
        }
    }

    ctx.fillStyle = cfg.colour || '#e8f0fb';
    for (let i = 0; i < n; i++) {
        const k = idxs[i];
        ctx.fillText(codes[i], Math.round(xs[k]), Math.round(ys[k]));
    }
}

// ---- the pause map ----

const origDraw = PauseMap.prototype.draw;
PauseMap.prototype.draw = function () {
    origDraw.call(this);
    try { drawPause(this); } catch (e) { warn(e); }
};

function drawPause(map) {
    if (!map.__wpSeen) { map.__wpSeen = true; pmaps.add(map); }
    const cv = labelCanvas(map);
    const cfg = CFG.labels.pause;
    const W = map.root.clientWidth, H = map.root.clientHeight;
    // The zoom-dependent size, worked out before any early return so a cleared canvas is still sized right.
    const base = Number(cfg.size) || 12;
    const fs = Math.round(Math.max(8, base * clamp(0.58 + 0.11 * map.zoom, 0.72, 1.7)) * 2) / 2;
    if (!postals.length || !cfg.enabled || !W || !H || map.hidden) { paintLabels(cv, W, H, EMPTY, PX, PY, cfg, fs); return; }

    const s = 2 ** map.zoom;
    const pxm = PX0_PER_M * s;

    // Zoomed out, the whole state fits on screen and 865 numbers turn into a smear. Hide them below the
    // configured scale, exactly like the minimap does; the rest of the map keeps drawing as usual.
    const minPx = Number(cfg.minPxPerMetre) || 0;
    if (pxm < minPx) { paintLabels(cv, W, H, EMPTY, PX, PY, cfg, fs); return; }

    // Straight down and north up (the common case) is plain arithmetic — toPx0's line, no allocation.
    // Turned or tilted, the 3D map's own camera says where each point lands.
    const flat = map.flat();
    const mx = W / 2 + (map.offsetX || 0), my = H / 2;
    const margin = fs * 1.5;
    for (let i = 0; i < postals.length; i++) {
        const p = postals[i];
        let sx, sy;
        if (flat) {
            sx = ((1877.5 + 0.33 * p.x) / 16 - map.cx) * s + mx;
            sy = ((2762 - 0.33 * p.y) / 16 - map.cy) * s + my;
        } else {
            const q = map.screenOf(p.x, p.y);
            sx = q[0]; sy = q[1];
        }
        PX[i] = sx; PY[i] = sy;
        VIS[i] = (sx > -margin && sx < W + margin && sy > -margin && sy < H + margin) ? 1 : 0;
    }

    // Every postal in view is drawn. `declutter` — off by default — brings back the anti-overlap grid: one
    // label per world-anchored cell, the cell growing until the labels fit. With it off the labels may
    // overlap when the map is zoomed out, which is the point: no postal is left out.
    let picks;
    if (cfg.declutter) {
        const maxN = clamp(Math.round((W * H) / (fs * fs * 50)), 24, 380);
        const sinP = Math.max(0.08, Math.sin((map.pitch || 90) * DEG));
        let cw = fs * (4 * CHAR_EM + PAD_EM), ch = fs * HEIGHT_EM;
        picks = EMPTY;
        for (let pass = 0; pass < 5; pass++) {
            const stepX = cw / pxm, stepY = ch / (pxm * sinP);
            const used = new Set();
            picks = [];
            for (let i = 0; i < postals.length; i++) {
                if (!VIS[i]) continue;
                const p = postals[i];
                const key = Math.floor(p.x / stepX) * 1000003 + Math.floor(p.y / stepY);
                if (used.has(key)) continue;
                used.add(key);
                picks.push(i);
            }
            if (picks.length <= maxN) break;
            const grow = Math.max(1.25, Math.sqrt(picks.length / maxN));
            cw *= grow; ch *= grow;
        }
    } else {
        picks = [];
        for (let i = 0; i < postals.length; i++) if (VIS[i]) picks.push(i);
    }
    paintLabels(cv, W, H, picks, PX, PY, cfg, fs);
    if (picks.length) {
        drawCount += picks.length;
        if (!diagPause) {
            diagPause = true;
            console.error('[whip_postals][PAINT] pause labels=' + picks.length + ' box=' + W + 'x' + H
                + ' painted=' + canvasPainted(cv) + ' canvas=' + !!cv + ' zoom=' + map.zoom);
        }
    }
}

// ---- the minimap ----

/** The .mm element this camera belongs to: its box is the size the 3D map was just resized to. */
function miniRoot(cam, gl) {
    const W = Math.round(gl.W), H = Math.round(gl.H || cam.o.boxH);
    let best = null;
    const list = document.querySelectorAll('.mm');
    for (let i = 0; i < list.length; i++) {
        const el = list[i];
        if (Math.abs(el.clientWidth - W) > 1 || Math.abs(el.clientHeight - H) > 1) continue;
        if (el.id === 'minimap3d' && el.classList.contains('on')) return el;
        if (!best) best = el;
    }
    return best;
}

function miniCanvas(root) {
    let cv = root.__wpCanvas;
    if (cv && cv.isConnected) return cv;
    const clip = root.querySelector('.mm-clip') || root;
    cv = makeCanvas('wp-postals-mini');
    clip.appendChild(cv);              // inside the clip: the numbers are cut to the box's shape
    root.__wpCanvas = cv;
    return cv;
}

/** The player's own scale for this minimap (--mm-k: 1 on the HUD, more in the Settings preview). Cached per
 *  width: it only changes when the box does, and reading it costs a style recalc. */
function miniScale(root) {
    const w = root.clientWidth;
    if (root.__wpScaleAt === w) return root.__wpScale;
    root.__wpScaleAt = w;
    const v = parseFloat(getComputedStyle(root).getPropertyValue('--mm-k'));
    root.__wpScale = Number.isFinite(v) && v > 0 ? v : 1;
    return root.__wpScale;
}

function drawMini(cam, v) {
    const gl = map3d;
    if (!gl || !v) return;
    // The 3D map must still be showing this view: the pause map may have taken it since the frame.
    const w = gl.view;
    if (!(Math.abs(w.pxPerMetre - v.pxPerMetre) < 1e-6
        && Math.abs(w.x - v.x) < 0.01 && Math.abs(w.y - v.y) < 0.01
        && Math.abs(w.yaw - v.yaw) < 1e-6 && Math.abs(w.pitch - v.pitch) < 1e-6
        && Math.abs((w.offsetX || 0) - (v.offsetX || 0)) < 0.01
        && Math.abs((w.offsetY || 0) - (v.offsetY || 0)) < 0.01)) return;

    const root = miniRoot(cam, gl);
    if (!root) return;
    const cv = miniCanvas(root);
    const cfg = CFG.labels.minimap;
    const W = gl.W, H = gl.H;
    const fs = Math.round(Math.max(7, (Number(cfg.size) || 9) * miniScale(root)) * 2) / 2;
    const minPx = Number(cfg.minPxPerMetre) || 0;
    if (!postals.length || !cfg.enabled || v.pxPerMetre < minPx) { paintLabels(cv, W, H, EMPTY, MX, MY, cfg, fs); return; }

    // Only the postals that can be in the box are projected: the box's half-diagonal, plus a margin.
    const R = Math.hypot(W, H) / v.pxPerMetre * 0.55 + 40;
    const R2 = R * R;
    const margin = fs;
    const sinP = Math.max(0.08, Math.sin((v.pitch || 90) * DEG));
    const decl = !!cfg.declutter;
    const stepX = decl ? (fs * (4 * CHAR_EM + PAD_EM)) / v.pxPerMetre : 0;
    const stepY = decl ? (fs * HEIGHT_EM) / (v.pxPerMetre * sinP) : 0;
    const maxN = decl ? clamp(Math.round((W * H) / (fs * fs * 22)), 6, Number(cfg.max) || 80) : Infinity;
    const used = decl ? new Set() : null;
    const picks = [];
    for (let i = 0; i < postals.length && picks.length < maxN; i++) {
        const p = postals[i];
        const dx = p.x - v.x, dy = p.y - v.y;
        if (dx * dx + dy * dy > R2) continue;
        const q = gl.project(p.x, p.y);
        if (q.sx < -margin || q.sx > W + margin || q.sy < -margin || q.sy > H + margin) continue;
        if (decl) {
            const key = Math.floor(p.x / stepX) * 1000003 + Math.floor(p.y / stepY);
            if (used.has(key)) continue;
            used.add(key);
        }
        MX[i] = q.sx; MY[i] = q.sy;
        picks.push(i);
    }
    paintLabels(cv, W, H, picks, MX, MY, cfg, fs);
    if (picks.length) {
        drawCount += picks.length;
        if (!diagMini) {
            diagMini = true;
            console.error('[whip_postals][PAINT] minimap labels=' + picks.length + ' box=' + W + 'x' + H
                + ' painted=' + canvasPainted(cv) + ' canvas=' + !!cv + ' px/m=' + v.pxPerMetre);
        }
    }
}

// ---- the 3D map: the palette, and the minimap's camera ----

/** The theme's palette, in whip_core's own shape: the 2D map's colour table -> the colour drawn. */
function makePalette(t) {
    const mix = (a, b, u) => [
        Math.round(a[0] + (b[0] - a[0]) * clamp(u, 0, 1)),
        Math.round(a[1] + (b[1] - a[1]) * clamp(u, 0, 1)),
        Math.round(a[2] + (b[2] - a[2]) * clamp(u, 0, 1)),
    ];
    // whip's luminance ramp: below 35 is land, 65 buildings, 99 their second tone, 130 paths,
    // 180 roads, 220 motorways. Anything bluer than its red is sea.
    const stops = [
        [35, t.land], [65, t.build], [99, t.build2], [130, t.path], [180, t.road], [220, t.hwy],
    ];
    return (c) => {
        const r = c[0], g = c[1], b = c[2];
        if (b > r + 6) return mix(t.deep, t.shore, ((r + g + b) / 765 - 0.25) / 0.62);
        const v = (r + g + b) / 3;
        if (v <= stops[0][0]) return stops[0][1];
        for (let i = 1; i < stops.length; i++) {
            if (v <= stops[i][0]) return mix(stops[i - 1][1], stops[i][1], (v - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
        }
        return t.hwy;
    };
}

function applyTheme() {
    const t = CFG.theme;
    if (!t || !t.enabled) {
        // Back to whip's own palette, if we had changed it (the editor's off switch). If whip's own fn was
        // never seen — it can paint before this module is handed the map — the stock preset is the same ramp.
        if (paletteFn) {
            paletteFn = null;
            const stock = CFG.theme.presets && CFG.theme.presets.whip;
            const fn = nativePalette || (stock ? makePalette(stock) : null);
            if (map3d && fn) map3d.setPalette(fn);
        }
        document.documentElement.style.removeProperty('--wp-deep');
        return;
    }
    const p = (t.preset && t.preset !== 'custom' && t.presets && t.presets[t.preset]) || t.colours;
    if (!p) return;
    for (const key of ['deep', 'shore', 'land', 'build', 'build2', 'path', 'road', 'hwy']) {
        const c = p[key];
        if (!Array.isArray(c) || c.length < 3 || c.some((v) => typeof v !== 'number')) return;
    }
    const fn = makePalette(p);
    fn.__whipPostals = true;
    paletteFn = fn;
    document.documentElement.style.setProperty('--wp-deep', 'rgb(' + p.deep.join(',') + ')');
    if (map3d) map3d.setPalette(fn);
}

let patched3d = false;               // the classes take the hooks once

function patchMap3D(mod) {
    // (A module's namespace object cannot be written to: the guard is ours.)
    if (!mod || patched3d) return;
    patched3d = true;

    // A theme is recolouring, not rebuilding: setPalette swaps the palette's uniforms and the sea.
    const P = mod.WhipMap3D.prototype;
    const setPalette = P.setPalette;
    P.setPalette = function (fn) {
        // Ours on, whip's own off (the editor turning the theme back off).
        if (paletteFn && fn !== paletteFn) return setPalette.call(this, paletteFn);
        if (!paletteFn) nativePalette = fn;
        return setPalette.call(this, fn);
    };

    // The minimap's view is decided by its camera a moment before the frame draws with it. Catch it
    // there, and place the labels in a microtask: by then gl.setView/render have run, so the 3D map's
    // own projection (gl.project) is the minimap's, heights and all.
    const C = mod.MinimapCamera.prototype;
    const viewAt = C.viewAt;
    C.viewAt = function (now) {
        const v = viewAt.call(this, now);
        if (v) {
            lastMini.cam = this;
            lastMini.v = v;
            if (postals.length) {
                queueMicrotask(() => { try { drawMini(this, v); } catch (e) { warn(e); } });
            }
        }
        return v;
    };
}

// ============================================
// THE EDITOR — the same numbers, with a face
// ============================================
//
// Opened from the pause menu's map ("Postals", top right). Everything is live: the labels on the map
// behind the panel and the sample chips at its top change as a control moves.
//
// WHAT IT WRITES, AND WHERE. The player's own choices go to localStorage (this NUI page's origin,
// which is per player): loadSaved() lays them over `config.js` at boot, so they survive a reconnect
// and a restart. config.js itself is a resource file the page cannot write, so the panel also
// produces the whole file to copy — that is how a choice becomes the server's default.
//
// WHY localStorage: the page belongs to whip_core, so SendNUIMessage and NUI callbacks from this
// resource cannot reach it. The browser's own storage is the channel a satellite can rely on.

const STORE = 'whip_postals.style.v2';
const LEGACY_STORE = 'whip_postals.style.v1';
const KEYS = ['deep', 'shore', 'land', 'build', 'build2', 'path', 'road', 'hwy'];
const clone = (o) => JSON.parse(JSON.stringify(o));

// The file's own values, before this client's saved ones: what Reset goes back to.
const FILE_CFG = clone({ labels: CFG.labels, theme: CFG.theme });

function loadSaved() {
    // A v1 save can carry `enabled: false` or the old `declutter: true`: those were the settings behind
    // the sparse/hidden labels. The editor is off now, so drop that key once and start from config.js.
    try { localStorage.removeItem(LEGACY_STORE); } catch (e) { /* storage off: nothing to clear */ }
    let s = null;
    try { s = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { s = null; }
    if (!s) return;
    if (s.pause) Object.assign(CFG.labels.pause, s.pause);
    if (s.minimap) Object.assign(CFG.labels.minimap, s.minimap);
    if (s.theme) {
        if (typeof s.theme.enabled === 'boolean') CFG.theme.enabled = s.theme.enabled;
        if (typeof s.theme.preset === 'string') CFG.theme.preset = s.theme.preset;
        if (s.theme.colours) Object.assign(CFG.theme.colours, s.theme.colours);
    }
}

function save() {
    try {
        localStorage.setItem(STORE, JSON.stringify({
            pause: CFG.labels.pause,
            minimap: CFG.labels.minimap,
            theme: { enabled: CFG.theme.enabled, preset: CFG.theme.preset, colours: CFG.theme.colours },
        }));
    } catch (e) { warn(e); }
}

let saveTimer = 0;
function saveSoon() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = 0; save(); }, 160);
}

function resetAll() {
    CFG.labels.pause = clone(FILE_CFG.labels.pause);
    CFG.labels.minimap = clone(FILE_CFG.labels.minimap);
    CFG.theme.enabled = FILE_CFG.theme.enabled;
    CFG.theme.preset = FILE_CFG.theme.preset;
    CFG.theme.presets = clone(FILE_CFG.theme.presets);
    CFG.theme.colours = clone(FILE_CFG.theme.colours);
    try { localStorage.removeItem(STORE); } catch (e) { /* storage off: nothing to clear */ }
    refreshAll();
    applyAll();
}

/** A colour from CSS, however it was written: { r, g, b, a } with a in 0..1. */
function parseColour(str, fallback) {
    const fb = fallback || { r: 9, g: 15, b: 25, a: 1 };
    if (typeof str !== 'string') return fb;
    const s = str.trim();
    let m = /^#([0-9a-f]{3,8})$/i.exec(s);
    if (m) {
        let h = m[1];
        if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
        if (h.length === 6 || h.length === 8) {
            return {
                r: parseInt(h.slice(0, 2), 16),
                g: parseInt(h.slice(2, 4), 16),
                b: parseInt(h.slice(4, 6), 16),
                a: h.length === 8 ? Math.round((parseInt(h.slice(6, 8), 16) / 255) * 100) / 100 : 1,
            };
        }
    }
    m = /^rgba?\(([^)]+)\)$/i.exec(s);
    if (m) {
        const p = m[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
        if (p.length >= 3 && p.slice(0, 3).every((v) => Number.isFinite(v))) {
            return {
                r: clamp(Math.round(p[0]), 0, 255),
                g: clamp(Math.round(p[1]), 0, 255),
                b: clamp(Math.round(p[2]), 0, 255),
                a: Number.isFinite(p[3]) ? clamp(p[3], 0, 1) : 1,
            };
        }
    }
    if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    return fb;
}

const hex2 = (n) => (n < 16 ? '0' : '') + clamp(Math.round(n), 0, 255).toString(16);

function cssColour(c) {
    const rgb = c.r + ', ' + c.g + ', ' + c.b;
    return c.a >= 1 ? 'rgb(' + rgb + ')' : 'rgba(' + rgb + ', ' + (Math.round(c.a * 100) / 100) + ')';
}

/** Redraw everything that shows labels. The style is read from the config on every paint, so a change
 *  only needs a redraw — there is nothing to restyle element by element. */
function syncLayers() {
    for (const m of pmaps) {
        if (typeof m.render === 'function') m.render();
        else drawPause(m);                // a host without render() (tests, older maps)
    }
    if (lastMini.cam) drawMini(lastMini.cam, lastMini.v);
}

function applyAll() {
    if (CFG.theme.enabled || paletteFn) applyTheme();
    syncLayers();
    paintSamples();
}

// ---- the panel ----

let ui = null;                       // built once
let editorOpen = false;
const refreshers = [];               // each control's "read the config back into me"

// Functions, not constants: the editor (when enabled) builds them after locales.json has loaded.
const FONTS = () => [
    ["'Barlow', 'Segoe UI', system-ui, sans-serif", 'Barlow'],
    ["'Segoe UI', system-ui, sans-serif", 'Segoe UI'],
    ['system-ui, sans-serif', tr('ui.fontSystem', 'System')],
    ["'Trebuchet MS', 'Segoe UI', sans-serif", 'Trebuchet'],
    ['Georgia, serif', 'Georgia'],
    ["'Courier New', monospace", 'Courier'],
    ['Impact, sans-serif', 'Impact'],
];

const WEIGHTS = () => [
    ['400', tr('weight.thin', 'Thin · 400')],
    ['500', tr('weight.normal', 'Normal · 500')],
    ['600', tr('weight.medium', 'Medium · 600')],
    ['700', tr('weight.bold', 'Bold · 700')],
    ['800', tr('weight.heavy', 'Heavy · 800')],
    ['900', tr('weight.black', 'Black · 900')],
];

const SHADOWS = () => [
    ['none', tr('shadow.none', 'None')],
    ['0 1px 2px rgba(0, 0, 0, 0.55)', tr('shadow.light', 'Light')],
    ['0 1px 3px rgba(0, 0, 0, 0.5)', tr('shadow.soft', 'Soft')],
    ['0 2px 6px rgba(0, 0, 0, 0.7)', tr('shadow.medium', 'Medium')],
    ['0 3px 10px rgba(0, 0, 0, 0.85)', tr('shadow.strong', 'Strong')],
];

const TSHADOWS = () => [
    ['none', tr('tshadow.none', 'None')],
    ['0 1px 2px rgba(0, 0, 0, 0.8)', tr('tshadow.light', 'Light')],
    ['0 1px 2px rgba(0, 0, 0, 0.85)', tr('tshadow.crisp', 'Crisp')],
    ['0 1px 3px rgba(0, 0, 0, 0.95), 0 0 8px rgba(0, 0, 0, 0.6)', tr('tshadow.medium', 'Medium')],
];

const PRESETS = () => [
    ['midnight', tr('preset.midnight', 'Midnight · dark blue')],
    ['paper', tr('preset.paper', 'Paper · light atlas')],
    ['whip', tr('preset.whip', 'Whip · default')],
    ['custom', tr('preset.custom', 'Custom')],
];

function makeEl(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
}

function secHead(text) {
    return makeEl('div', 'wp-sec-head', text);
}

function rowToggle(text, get, set) {
    const row = makeEl('label', 'wp-row');
    row.appendChild(makeEl('span', 'wp-lab', text));
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'wp-check';
    input.addEventListener('change', () => { set(!!input.checked); changed(); });
    row.appendChild(input);
    refreshers.push(() => { input.checked = !!get(); });
    return row;
}

function rowRange(text, min, max, step, get, set, fmt) {
    const row = makeEl('div', 'wp-row wp-row-range');
    const lab = makeEl('span', 'wp-lab', text);
    const val = makeEl('span', 'wp-val');
    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'wp-range';
    input.min = min; input.max = max; input.step = step;
    const show = (v) => { val.textContent = fmt ? fmt(v) : String(v); };
    input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        show(v);
        set(v);
        changed();
    });
    row.append(lab, val, input);
    refreshers.push(() => {
        const v = Number(get());
        input.value = Number.isFinite(v) ? v : min;
        show(Number.isFinite(v) ? v : min);
    });
    return row;
}

function rowSelect(text, options, get, set) {
    const row = makeEl('div', 'wp-row');
    row.appendChild(makeEl('span', 'wp-lab', text));
    const sel = document.createElement('select');
    sel.className = 'wp-select';
    for (const [value, label] of options) {
        const o = document.createElement('option');
        o.value = value;
        o.textContent = label;
        sel.appendChild(o);
    }
    sel.addEventListener('change', () => { set(sel.value); changed(); });
    row.appendChild(sel);
    refreshers.push(() => {
        const v = String(get());
        let found = false;
        for (let i = 0; i < sel.options.length; i++) {
            if (sel.options[i].value === v) { found = true; break; }
        }
        if (!found) {
            const o = document.createElement('option');
            o.value = v;
            o.textContent = tr('ui.custom', 'Custom');
            sel.appendChild(o);
        }
        sel.value = v;
    });
    return row;
}

/** A colour control: the picker, and — for the label's background and border — its alpha. */
function rowColour(text, get, set, withAlpha) {
    const row = makeEl('div', 'wp-row');
    row.appendChild(makeEl('span', 'wp-lab', text));
    const wrap = makeEl('span', 'wp-colours');
    const sw = document.createElement('input');
    sw.type = 'color';
    sw.className = 'wp-color';
    const al = document.createElement('input');
    al.type = 'range';
    al.className = 'wp-alpha';
    al.min = 0; al.max = 100; al.step = 1;
    if (!withAlpha) al.style.display = 'none';
    const commit = () => {
        const c = parseColour(sw.value);
        set(cssColour({ r: c.r, g: c.g, b: c.b, a: withAlpha ? al.value / 100 : 1 }));
        changed();
    };
    sw.addEventListener('input', commit);
    al.addEventListener('input', commit);
    wrap.append(sw, al);
    row.appendChild(wrap);
    refreshers.push(() => {
        const c = parseColour(get());
        sw.value = '#' + hex2(c.r) + hex2(c.g) + hex2(c.b);
        al.value = Math.round((c.a === undefined ? 1 : c.a) * 100);
    });
    return row;
}

/** One of the theme's [r, g, b] colours. */
function rowThemeColour(key, text) {
    const row = makeEl('div', 'wp-row');
    row.appendChild(makeEl('span', 'wp-lab', text));
    const sw = document.createElement('input');
    sw.type = 'color';
    sw.className = 'wp-color';
    sw.addEventListener('input', () => {
        const c = parseColour(sw.value);
        CFG.theme.colours[key] = [c.r, c.g, c.b];
        CFG.theme.preset = 'custom';
        CFG.theme.enabled = true;
        refreshAll();          // the preset select says "Personalizzato" now
        changed();
    });
    row.appendChild(sw);
    refreshers.push(() => {
        const c = CFG.theme.colours && CFG.theme.colours[key];
        if (Array.isArray(c) && c.length >= 3) sw.value = '#' + hex2(c[0]) + hex2(c[1]) + hex2(c[2]);
    });
    return row;
}

function changed() {
    saveSoon();
    applyAll();
}

function refreshAll() {
    for (let i = 0; i < refreshers.length; i++) {
        try { refreshers[i](); } catch (e) { warn(e); }
    }
}

function paintSamples() {
    if (!ui) return;
    const p = CFG.labels.pause, m = CFG.labels.minimap;
    const pv = styleVars(p), mv = styleVars(m);
    ui.samplePause.style.cssText = pv + (pv ? ';' : '') + '--wp-fs:' + (Number(p.size) || 12) + 'px';
    ui.sampleMini.style.cssText = mv + (mv ? ';' : '') + '--wp-fs:' + (Number(m.size) || 9) + 'px';
}

function setEditor(on) {
    if (on && !EDITOR_ENABLED) return;
    editorOpen = !!on;
    const root = document.getElementById('pause');
    if (root) root.classList.toggle('wp-editor-open', editorOpen);
    if (editorOpen) {
        refreshAll();
        paintSamples();
        if (ui) ui.body.scrollTop = 0;
    } else if (ui) {
        ui.export.classList.remove('on');
        save();
    }
    NuiRouter.syncNavScope(true);
}

function showTab(i) {
    if (!ui) return;
    for (let k = 0; k < ui.tabs.length; k++) ui.tabs[k].classList.toggle('on', k === i);
    for (let k = 0; k < ui.panes.length; k++) ui.panes[k].classList.toggle('on', k === i);
    ui.body.scrollTop = 0;
}

function buildEditor() {
    const root = document.getElementById('pause');
    if (!root || document.getElementById('wp-editor')) return;

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'wp-open';
    openBtn.title = tr('ui.buttonTitle', 'Postal codes and map colours');
    openBtn.appendChild(makeEl('span', 'wp-open-dot'));
    openBtn.appendChild(makeEl('span', '', tr('ui.button', 'Postals')));
    openBtn.addEventListener('click', () => setEditor(true));

    const panel = makeEl('div', 'wp-ed');
    panel.id = 'wp-editor';

    const head = makeEl('div', 'wp-ed-head');
    head.appendChild(makeEl('div', 'wp-ed-title', tr('ui.title', 'Postals and map')));
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'wp-ed-close';
    closeBtn.textContent = '×';
    closeBtn.title = tr('ui.close', 'Close');
    closeBtn.addEventListener('click', () => setEditor(false));
    head.appendChild(closeBtn);
    panel.appendChild(head);
    panel.appendChild(makeEl('div', 'wp-ed-sub',
        tr('ui.subtitle', 'Your choices here apply at once and stay on this client. To make them the server default, export the file.')));

    // The two sample labels: the styles, at their real size.
    const prev = makeEl('div', 'wp-preview');
    const sample = (tag) => {
        const box = makeEl('div', 'wp-sample');
        const host = makeEl('div', 'wp-sample-host');
        const wrap = makeEl('div', 'wp-postals');
        wrap.appendChild(makeEl('div', 'wp-label', '3001'));
        host.appendChild(wrap);
        box.append(host, makeEl('div', 'wp-sample-tag', tag));
        prev.appendChild(box);
        return wrap;
    };
    const samplePause = sample(tr('ui.samplePause', 'Big map'));
    const sampleMini = sample(tr('ui.sampleMini', 'Minimap'));
    panel.appendChild(prev);

    // Tabs and their panes.
    const tabsEl = makeEl('div', 'wp-ed-tabs');
    const tabs = [];
    const panes = [];
    [tr('ui.samplePause', 'Big map'), tr('ui.sampleMini', 'Minimap'), tr('ui.colours', 'Colours')].forEach((name, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'wp-ed-tab';
        b.textContent = name;
        b.addEventListener('click', () => showTab(i));
        tabsEl.appendChild(b);
        tabs.push(b);
        const pane = makeEl('div', 'wp-ed-pane');
        panes.push(pane);
    });
    panel.appendChild(tabsEl);

    const body = makeEl('div', 'wp-ed-body');
    panes.forEach((p) => body.appendChild(p));
    panel.appendChild(body);

    // ---- big map ----
    const p0 = panes[0];
    p0.appendChild(secHead(tr('ui.labels', 'Labels')));
    p0.appendChild(rowToggle(tr('ui.show', 'Show postal codes'), () => CFG.labels.pause.enabled,
        (v) => { CFG.labels.pause.enabled = v; }));
    p0.appendChild(rowToggle(tr('ui.declutter', 'Avoid overlaps'), () => !!CFG.labels.pause.declutter,
        (v) => { CFG.labels.pause.declutter = v; }));
    p0.appendChild(rowRange(tr('ui.size', 'Size'), 7, 24, 0.5,
        () => CFG.labels.pause.size, (v) => { CFG.labels.pause.size = v; },
        (v) => v.toFixed(1) + ' px'));
    p0.appendChild(rowSelect(tr('ui.weight', 'Font weight'), WEIGHTS(),
        () => CFG.labels.pause.weight, (v) => { CFG.labels.pause.weight = Number(v); }));
    p0.appendChild(rowSelect(tr('ui.font', 'Font'), FONTS(),
        () => CFG.labels.pause.font, (v) => { CFG.labels.pause.font = v; }));
    p0.appendChild(secHead(tr('ui.colourAndShape', 'Colour and shape')));
    p0.appendChild(rowColour(tr('ui.text', 'Text'), () => CFG.labels.pause.colour,
        (v) => { CFG.labels.pause.colour = v; }, false));
    p0.appendChild(rowColour(tr('ui.background', 'Background'), () => CFG.labels.pause.background,
        (v) => { CFG.labels.pause.background = v; }, true));
    p0.appendChild(rowColour(tr('ui.border', 'Border'), () => CFG.labels.pause.borderColour,
        (v) => { CFG.labels.pause.borderColour = v; }, true));
    p0.appendChild(rowRange(tr('ui.borderWidth', 'Border width'), 0, 3, 0.5,
        () => parseFloat(CFG.labels.pause.borderWidth) || 0,
        (v) => { CFG.labels.pause.borderWidth = v + 'px'; }, (v) => v.toFixed(1) + ' px'));
    p0.appendChild(rowRange(tr('ui.radius', 'Radius'), 0, 16, 1,
        () => parseFloat(CFG.labels.pause.radius) || 0,
        (v) => { CFG.labels.pause.radius = v + 'px'; }, (v) => v.toFixed(0) + ' px'));
    p0.appendChild(rowRange(tr('ui.padX', 'Horizontal padding'), 0, 1.2, 0.02,
        () => parseFloat(CFG.labels.pause.padX) || 0,
        (v) => { CFG.labels.pause.padX = v.toFixed(2) + 'em'; }, (v) => v.toFixed(2) + ' em'));
    p0.appendChild(rowRange(tr('ui.padY', 'Vertical padding'), 0, 1, 0.02,
        () => parseFloat(CFG.labels.pause.padY) || 0,
        (v) => { CFG.labels.pause.padY = v.toFixed(2) + 'em'; }, (v) => v.toFixed(2) + ' em'));
    p0.appendChild(rowRange(tr('ui.opacity', 'Opacity'), 0, 1, 0.05,
        () => Number(CFG.labels.pause.opacity), (v) => { CFG.labels.pause.opacity = v; },
        (v) => Math.round(v * 100) + '%'));
    p0.appendChild(rowSelect(tr('ui.shadow', 'Shadow'), SHADOWS(),
        () => CFG.labels.pause.shadow, (v) => { CFG.labels.pause.shadow = v; }));
    p0.appendChild(rowSelect(tr('ui.textShadow', 'Text shadow'), TSHADOWS(),
        () => CFG.labels.pause.textShadow, (v) => { CFG.labels.pause.textShadow = v; }));

    // ---- minimap ----
    const p1 = panes[1];
    p1.appendChild(secHead(tr('ui.labels', 'Labels')));
    p1.appendChild(rowToggle(tr('ui.show', 'Show postal codes'), () => CFG.labels.minimap.enabled,
        (v) => { CFG.labels.minimap.enabled = v; }));
    p1.appendChild(rowToggle(tr('ui.declutter', 'Avoid overlaps'), () => !!CFG.labels.minimap.declutter,
        (v) => { CFG.labels.minimap.declutter = v; }));
    p1.appendChild(rowRange(tr('ui.size', 'Size'), 6, 16, 0.5,
        () => CFG.labels.minimap.size, (v) => { CFG.labels.minimap.size = v; },
        (v) => v.toFixed(1) + ' px'));
    p1.appendChild(rowSelect(tr('ui.weight', 'Font weight'), WEIGHTS(),
        () => CFG.labels.minimap.weight, (v) => { CFG.labels.minimap.weight = Number(v); }));
    p1.appendChild(rowSelect(tr('ui.font', 'Font'), FONTS(),
        () => CFG.labels.minimap.font, (v) => { CFG.labels.minimap.font = v; }));
    p1.appendChild(secHead(tr('ui.colourAndShape', 'Colour and shape')));
    p1.appendChild(rowColour(tr('ui.text', 'Text'), () => CFG.labels.minimap.colour,
        (v) => { CFG.labels.minimap.colour = v; }, false));
    p1.appendChild(rowColour(tr('ui.background', 'Background'), () => CFG.labels.minimap.background,
        (v) => { CFG.labels.minimap.background = v; }, true));
    p1.appendChild(rowColour(tr('ui.border', 'Border'), () => CFG.labels.minimap.borderColour,
        (v) => { CFG.labels.minimap.borderColour = v; }, true));
    p1.appendChild(rowRange(tr('ui.borderWidth', 'Border width'), 0, 3, 0.5,
        () => parseFloat(CFG.labels.minimap.borderWidth) || 0,
        (v) => { CFG.labels.minimap.borderWidth = v + 'px'; }, (v) => v.toFixed(1) + ' px'));
    p1.appendChild(rowRange(tr('ui.radius', 'Radius'), 0, 12, 1,
        () => parseFloat(CFG.labels.minimap.radius) || 0,
        (v) => { CFG.labels.minimap.radius = v + 'px'; }, (v) => v.toFixed(0) + ' px'));
    p1.appendChild(rowRange(tr('ui.padX', 'Horizontal padding'), 0, 1, 0.02,
        () => parseFloat(CFG.labels.minimap.padX) || 0,
        (v) => { CFG.labels.minimap.padX = v.toFixed(2) + 'em'; }, (v) => v.toFixed(2) + ' em'));
    p1.appendChild(rowRange(tr('ui.padY', 'Vertical padding'), 0, 1, 0.02,
        () => parseFloat(CFG.labels.minimap.padY) || 0,
        (v) => { CFG.labels.minimap.padY = v.toFixed(2) + 'em'; }, (v) => v.toFixed(2) + ' em'));
    p1.appendChild(rowRange(tr('ui.opacity', 'Opacity'), 0, 1, 0.05,
        () => Number(CFG.labels.minimap.opacity), (v) => { CFG.labels.minimap.opacity = v; },
        (v) => Math.round(v * 100) + '%'));
    p1.appendChild(secHead(tr('ui.when', 'When to show them')));
    p1.appendChild(rowRange(tr('ui.minPx', 'Visible above'), 0.2, 1.5, 0.05,
        () => Number(CFG.labels.minimap.minPxPerMetre),
        (v) => { CFG.labels.minimap.minPxPerMetre = v; },
        (v) => v.toFixed(2) + ' px/m · ' + Math.round(330 / v) + ' m'));
    p1.appendChild(rowRange(tr('ui.max', 'Maximum per frame'), 20, 160, 10,
        () => Number(CFG.labels.minimap.max), (v) => { CFG.labels.minimap.max = v; },
        (v) => v.toFixed(0)));
    p1.appendChild(makeEl('div', 'wp-ed-sub',
        tr('ui.miniNote', 'The minimap sits behind the menu: watch the sample above, and the HUD when you close.')));

    // ---- colours ----
    const p2 = panes[2];
    p2.appendChild(secHead(tr('ui.theme', 'Theme')));
    p2.appendChild(rowToggle(tr('ui.themeEnabled', 'Theme colours on'), () => CFG.theme.enabled,
        (v) => { CFG.theme.enabled = v; }));
    p2.appendChild(rowSelect(tr('ui.preset', 'Preset'), PRESETS(),
        () => CFG.theme.preset,
        (v) => {
            CFG.theme.preset = v;
            const pre = CFG.theme.presets && CFG.theme.presets[v];
            if (v !== 'custom' && pre) for (const k of KEYS) CFG.theme.colours[k] = pre[k].slice();
            CFG.theme.enabled = true;
            refreshAll();
        }));
    p2.appendChild(secHead(tr('ui.colours', 'Colours')));
    const labels = {
        deep: tr('colour.deep', 'Deep sea'), shore: tr('colour.shore', 'Coast'), land: tr('colour.land', 'Land'), build: tr('colour.build', 'Buildings'), build2: tr('colour.build2', 'Buildings (tone 2)'),
        path: tr('colour.path', 'Paths'), road: tr('colour.road', 'Roads'), hwy: tr('colour.hwy', 'Motorways'),
    };
    for (const k of KEYS) p2.appendChild(rowThemeColour(k, labels[k]));
    p2.appendChild(makeEl('div', 'wp-ed-sub',
        tr('ui.colourNote', 'Changing a colour switches the preset to Custom. The result shows on the map behind the panel.')));

    // ---- footer ----
    const foot = makeEl('div', 'wp-ed-foot');
    const resetBtn = makeEl('button', 'wp-btn', tr('ui.reset', 'Reset'));
    resetBtn.type = 'button';
    let arm = 0;
    resetBtn.addEventListener('click', () => {
        if (!arm) {
            resetBtn.textContent = tr('ui.resetConfirm', 'Sure?');
            arm = setTimeout(() => { arm = 0; resetBtn.textContent = tr('ui.reset', 'Reset'); }, 3000);
            return;
        }
        clearTimeout(arm);
        arm = 0;
        resetBtn.textContent = tr('ui.reset', 'Reset');
        resetAll();
    });
    const expBtn = makeEl('button', 'wp-btn primary', tr('ui.export', 'Export config.js'));
    expBtn.type = 'button';
    foot.append(resetBtn, expBtn);
    panel.appendChild(foot);

    // ---- the export sheet ----
    const exp = makeEl('div', 'wp-export');
    const expHead = makeEl('div', 'wp-export-head', 'config.js');
    const expClose = document.createElement('button');
    expClose.type = 'button';
    expClose.className = 'wp-ed-close';
    expClose.textContent = '×';
    expClose.addEventListener('click', () => exp.classList.remove('on'));
    expHead.appendChild(expClose);
    const ta = document.createElement('textarea');
    ta.className = 'wp-export-text';
    ta.spellcheck = false;
    ta.readOnly = true;
    const expNote = makeEl('div', 'wp-export-note',
        tr('ui.exportNote', 'Save it as whip_postals/nui/config.js (replacing the file), then run restart whip_core. Restarting whip_postals alone is not enough: the page loads the file when it opens.'));
    const expActs = makeEl('div', 'wp-ed-foot');
    const copyBtn = makeEl('button', 'wp-btn primary', tr('ui.copy', 'Copy'));
    copyBtn.type = 'button';
    const doneBtn = makeEl('button', 'wp-btn', tr('ui.close', 'Close'));
    doneBtn.type = 'button';
    doneBtn.addEventListener('click', () => exp.classList.remove('on'));
    expActs.append(copyBtn, doneBtn);
    exp.append(expHead, ta, expNote, expActs);
    panel.appendChild(exp);

    expBtn.addEventListener('click', () => {
        ta.value = exportText();
        copyBtn.textContent = tr('ui.copy', 'Copy');
        exp.classList.add('on');
    });
    copyBtn.addEventListener('click', () => {
        ta.focus();
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        if (navigator.clipboard) navigator.clipboard.writeText(ta.value).catch(() => {});
        copyBtn.textContent = ok ? tr('ui.copied', 'Copied') : tr('ui.selected', 'Selected · Ctrl+C');
        setTimeout(() => { copyBtn.textContent = tr('ui.copy', 'Copy'); }, 1800);
    });

    root.append(openBtn, panel);

    // Leaving the map (Back, Escape, the menu) closes the editor with it.
    new MutationObserver(() => {
        if (root.dataset.mode !== 'map' && editorOpen) setEditor(false);
    }).observe(root, { attributes: true, attributeFilter: ['data-mode'] });

    ui = { panel, body, tabs, panes, samplePause, sampleMini, export: exp };
    showTab(0);
    refreshAll();
    paintSamples();
}

/** The whole config.js, reflecting what is on screen. */
function exportText() {
    const p = CFG.labels.pause, m = CFG.labels.minimap, t = CFG.theme;
    const q = (v) => {
        const s = String(v);
        const dq = s.indexOf("'") >= 0 && s.indexOf('"') < 0;
        const esc = dq ? s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
            : s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        return (dq ? '"' : "'") + esc + (dq ? '"' : "'");
    };
    const n = (v) => (typeof v === 'string' ? q(v) : String(v));
    const tri = (c) => '[' + [c[0], c[1], c[2]].join(', ') + ']';
    const block = (obj, fields, indent) => fields
        .map((k) => indent + k + ': ' + n(obj[k]) + ',')
        .join('\n');
    const presets = t.presets || {};
    const presetText = Object.keys(presets).map((name) => {
        const c = presets[name];
        return '            ' + name + ': {\n'
            + KEYS.map((k) => '                ' + k + ': ' + tri(c[k]) + ',').join('\n')
            + '\n            },';
    }).join('\n');
    const colourText = KEYS.map((k) => '            ' + k + ': ' + tri(t.colours[k]) + ',').join('\n');

    return `// ============================================
// whip_postals — CONFIG
// ============================================
//
// ${tr('export.from', "Exported from the in-game pause-menu editor (Map > Postals).")}
// ${tr('export.save', 'Save it as whip_postals/nui/config.js, then: restart whip_core')}
//
// ${tr('export.labels', 'labels  the numbers on the big map and the minimap')}
// ${tr('export.theme', 'theme   the map\'s colours: sea, land, buildings, paths, roads, motorways')}

export const config = {
    postals: ${q(CFG.postals)},

    labels: {
        // ---- ${tr('export.pause', 'the pause menu and /whip\'s Map window')} ----
        pause: {
${block(p, ['enabled', 'declutter', 'minPxPerMetre', 'size', 'weight', 'font', 'letterSpacing', 'colour', 'background',
        'borderWidth', 'borderColour', 'radius', 'padY', 'padX', 'shadow', 'textShadow', 'opacity'], '            ')}
        },

        // ---- ${tr('export.hudMinimap', "the HUD minimap (and its preview in Settings)")} ----
        minimap: {
${block(m, ['enabled', 'declutter', 'size', 'weight', 'font', 'letterSpacing', 'colour', 'background',
        'borderWidth', 'borderColour', 'radius', 'padY', 'padX', 'shadow', 'textShadow', 'opacity',
        'minPxPerMetre', 'max'], '            ')}
        },
    },

    theme: {
        enabled: ${n(t.enabled)},
        // 'midnight' | 'paper' | 'whip' | 'custom'
        preset: ${q(t.preset)},

        presets: {
${presetText}
        },

        // ${tr('export.themeModes', "used when preset is 'custom'")}
        colours: {
${colourText}
        },
    },
};
`;
}

// ---- boot ----

injectStyle();
loadSaved();
applyTheme();
// The editor is built after locales.json is available. With EDITOR_ENABLED=false this is a no-op.
loadLocales().then(() => { if (EDITOR_ENABLED) buildEditor(); });

whenMap3D((gl, mod) => {
    try {
        map3d = gl;
        patchMap3D(mod);
        if (paletteFn) gl.setPalette(paletteFn);
        if (lastMini.cam) drawMini(lastMini.cam, lastMini.v);
    } catch (e) { warn(e); }
});

(function loadPostals() {
    let url;
    try {
        url = new URL(CFG.postals || 'postals.json', import.meta.url);
    } catch (e) { warn(e); return; }
    fetch(url, { cache: 'no-store' })
        .then((r) => {
            if (!r.ok) throw new Error('HTTP ' + r.status + ' on ' + url);
            return r.json();
        })
        .then((list) => {
            const rows = Array.isArray(list) ? list : [];
            const out = [];
            for (const p of rows) {
                if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') continue;
                if (p.code === undefined || p.code === null || p.code === '') continue;
                out.push({ code: String(p.code), x: p.x, y: p.y });
            }
            postals = out;
            const n = postals.length;
            PX = new Float32Array(n); PY = new Float32Array(n); VIS = new Uint8Array(n);
            MX = new Float32Array(n); MY = new Float32Array(n);
            for (const m of pmaps) { if (typeof m.render === 'function') m.render(); else drawPause(m); }
            if (lastMini.cam) drawMini(lastMini.cam, lastMini.v);

            // WHIP's page-tools wraps console.error into GetErrorLog, so this one line lands in
            // `whiperrors`: it says whether the module ran and which part, if any, is still dark.
            setTimeout(() => {
                const cvP = document.querySelector('.wp-postals-pause');
                const cvM = document.querySelector('.wp-postals-mini');
                console.error('[whip_postals][DIAG] ' + JSON.stringify({
                    module: true,
                    postals: postals.length,
                    handle: !!window.__whipPostals,
                    pauseEnabled: CFG.labels.pause.enabled,
                    pauseMinPx: Number(CFG.labels.pause.minPxPerMetre) || 0,
                    declutter: CFG.labels.pause.declutter,
                    minimapEnabled: CFG.labels.minimap.enabled,
                    themeEnabled: CFG.theme.enabled,
                    pmap: !!document.querySelector('.pmap'),
                    pauseCanvas: !!cvP,
                    pausePainted: canvasPainted(cvP),
                    miniCanvas: !!cvM,
                    miniPainted: canvasPainted(cvM),
                    draws: drawCount,
                }));
            }, 1500);
        })
        .catch(warn);
})();

// A small handle for poking at it from the F8 console / a dev tool.
window.__whipPostals = {
    get count() { return postals.length; },
    get config() { return CFG; },
    get editor() { return EDITOR_ENABLED; },
    openEditor() { setEditor(true); },
    closeEditor() { setEditor(false); },
    reset: resetAll,
    redraw() { applyAll(); },
};

// ---- the pause menu ----

// Everything below is the editor's wiring, which is off unless EDITOR_ENABLED is true.
//
// pauseOpen/pauseClose are multi-subscriber (router.js): whip's own handler stays as it is, and this
// one only closes the editor with the menu. The editor's key scope sits just above the pause menu's
// (priority 4): while it is open the panel keeps the keys, so a typed "e" is a letter and not a zoom,
// and Escape closes the panel rather than the map.
if (EDITOR_ENABLED) {
    NuiRouter.register('pauseOpen', () => { buildEditor(); });   // the page's #pause exists by now; this is a guard
    NuiRouter.register('pauseClose', () => setEditor(false));

    NuiRouter.registerKeyScope({
        name: 'postal-editor',
        priority: 3.9,
        isOpen: () => editorOpen,
        onKey: (e) => {
            if (e.type && e.type !== 'keydown') return;
            if (e.key !== 'Escape') return;      // everything else belongs to the field being typed in
            e.preventDefault();
            if (ui && ui.export.classList.contains('on')) ui.export.classList.remove('on');
            else setEditor(false);
        },
        onNav: (nav) => {
            if (nav !== 'back') return;
            if (ui && ui.export.classList.contains('on')) ui.export.classList.remove('on');
            else setEditor(false);
        },
        padHints: () => [['b', tr('ui.close', 'Close')]],
    });
}
