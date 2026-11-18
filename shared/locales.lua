-- Languages for whip_postals - Lua side.
--
-- One source of truth: nui/locales.json, also read by the NUI (nui/extension.js).
-- Change the "locale" line at the top of that file to switch: it, en, es, fr, de.
-- Missing strings fall back to 'en', then 'it', then the key name itself.

WhipPostals = WhipPostals or {}

local LOCALE_FILE = 'nui/locales.json'
local cache = nil

local function getTable(t, key)
    if type(t) ~= 'table' then return nil end
    for part in tostring(key):gmatch('[^%.]+') do
        t = t[part]
        if type(t) ~= 'table' and type(t) ~= 'string' then return nil end
    end
    return t
end

local function data()
    if cache ~= nil then return cache end
    cache = false
    local raw = LoadResourceFile(GetCurrentResourceName(), LOCALE_FILE)
    if not raw then return false end
    local ok, parsed = pcall(json.decode, raw)
    if not ok or type(parsed) ~= 'table' then return false end
    cache = parsed
    return cache
end

--- Localized text. `key` uses dot notation, for example 'gps.notFound'.
--- Placeholders are those of string.format (%s, %d, ...).
function WhipPostals.locale(key, ...)
    local d = data()
    if not d then return tostring(key) end
    local lang = d[d.locale]
    local value = getTable(lang, key)
    if value == nil then value = getTable(d.en, key) end
    if value == nil then value = getTable(d.it, key) end
    if type(value) ~= 'string' then return tostring(key) end
    if select('#', ...) > 0 then
        local ok, formatted = pcall(string.format, value, ...)
        if ok then return formatted end
    end
    return value
end

--- Active language and display name, for logs and documentation.
function WhipPostals.localeInfo()
    local d = data()
    if not d then return 'it', 'Italiano' end
    local lang = d[d.locale] or d.en or d.it or {}
    local meta = type(lang.meta) == 'table' and lang.meta or {}
    return tostring(d.locale), tostring(meta.name or d.locale)
end
