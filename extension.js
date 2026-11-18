// Compat bridge: a NUI page cached before the nui/ reorg still loads /extension.js.
// Forward it to the real module; its own import.meta.url keeps config.js and postals.json
// resolving under /nui/. Harmless when the page already uses the new /nui/extension.js path.
import './nui/extension.js';
