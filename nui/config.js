// ============================================
// whip_postals — CONFIG
// ============================================
//
// Postal codes on whip's maps, and how they look.
//
// Read once, when whip_core's page loads. After an edit run `restart whip_core` (the NUI page reloads
// with the resource); restarting whip_postals on its own only takes effect after a reconnect.
//
// Two jobs, each switched off on its own with `enabled: false` (whip's stock look comes back):
//   labels  the numbers on the pause menu's map and on the HUD's minimap
//   theme   the map's colours: sea, land, buildings, paths, roads, motorways
//
// THE NUMBERS come from postals.json beside this file:
//     [{ "code": "3001", "x": -1157.2, "y": 4938.1 }, ...]
// (the OCRP set, 865 of them). Swap that file for your own, same shape, and nothing else changes.

export const config = {
    // postals.json in this resource; an absolute URL (another resource's file) works too
    postals: 'postals.json',

    labels: {
        // ---- the big map: the pause menu and /whip's Map window ----
        pause: {
            enabled: true,
            // false = every postal in view is drawn (labels may overlap when zoomed out).
            // true  = hide the ones that would overlap: at most one label per world grid cell.
            declutter: false,
            // Below this many screen px per metre the map shows too much ground and the numbers turn into
            // a smear: all pause-map labels are hidden until you zoom back in. 0.22 is roughly zoom 3.4
            // (whip's default is 3.5), so they disappear after a couple of scroll-downs, not immediately.
            // Set 0 to always show them.
            minPxPerMetre: 0.22,
            size: 12,                 // px at the middle zoom; it grows a little as you zoom in
            weight: 700,
            font: "'Barlow', 'Segoe UI', system-ui, sans-serif",
            letterSpacing: '0.02em',
            colour: '#e8f0fb',
            background: 'rgba(9, 15, 25, 0.74)',
            borderWidth: '1px',
            borderColour: 'rgba(150, 180, 220, 0.24)',
            radius: '4px',
            padY: '0.16em',
            padX: '0.44em',
            shadow: '0 1px 3px rgba(0, 0, 0, 0.5)',
            textShadow: '0 1px 2px rgba(0, 0, 0, 0.85)',
            opacity: 1,
        },

        // ---- the HUD's minimap (and its preview in Settings) ----
        minimap: {
            enabled: true,
            declutter: false,         // as above: off shows them all, overlapping included
            size: 9,                  // px on the HUD; the Settings preview is bigger, and so are its labels
            weight: 700,
            font: "'Barlow', 'Segoe UI', system-ui, sans-serif",
            letterSpacing: '0.02em',
            colour: '#e8f0fb',
            background: 'rgba(9, 15, 25, 0.76)',
            borderWidth: '1px',
            borderColour: 'rgba(150, 180, 220, 0.22)',
            radius: '3px',
            padY: '0.14em',
            padX: '0.4em',
            shadow: '0 1px 2px rgba(0, 0, 0, 0.55)',
            textShadow: '0 1px 2px rgba(0, 0, 0, 0.8)',
            opacity: 1,
            // Below this many screen px per metre the minimap shows too much ground and the numbers turn
            // into a smear: they are hidden. 0.5 is about 660 m across a 330 px box, i.e. fast driving.
            minPxPerMetre: 0.5,
            max: 80,                  // ceiling per frame, when declutter is on
        },
    },

    theme: {
        enabled: true,
        // 'midnight' | 'paper' | 'whip' | 'custom' ('whip' is the stock palette; 'custom' reads `colours`)
        preset: 'midnight',

        // The five families of the 2D map, mapped through the same luminance ramp whip_core uses.
        // The sea (deep, shore) is the map's outside and the water; land/build/path/road/hwy the rest.
        presets: {
            // cool, high-contrast dark: roads and motorways pop, the sea is deep blue
            midnight: {
                deep: [4, 9, 18], shore: [16, 42, 68],
                land: [21, 27, 37], build: [56, 66, 82], build2: [71, 83, 101],
                path: [99, 114, 135], road: [154, 169, 194], hwy: [222, 233, 249],
            },
            // GTA's own printed atlas: parchment land, white roads, sand motorways. Blips are white with a
            // dark rim, so they read, but the map is bright — try it before keeping it.
            paper: {
                deep: [36, 63, 85], shore: [90, 126, 150],
                land: [218, 209, 189], build: [198, 187, 165], build2: [182, 170, 147],
                path: [158, 147, 128], road: [252, 250, 244], hwy: [250, 231, 172],
            },
            // whip's stock palette, exactly (colour only: labels stay on)
            whip: {
                deep: [8, 14, 23], shore: [24, 39, 58],
                land: [17, 20, 25], build: [43, 48, 58], build2: [53, 59, 71],
                path: [76, 83, 96], road: [126, 134, 147], hwy: [164, 172, 186],
            },
        },

        // used when preset is 'custom'
        colours: {
            deep: [4, 9, 18], shore: [16, 42, 68],
            land: [21, 27, 37], build: [56, 66, 82], build2: [71, 83, 101],
            path: [99, 114, 135], road: [154, 169, 194], hwy: [222, 233, 249],
        },
    },
};
