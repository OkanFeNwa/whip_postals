-- Lingue di whip_postals — lato Lua.
--
-- Una sola fonte: nui/locales.json, letto anche dalla NUI (nui/extension.js).
-- Per cambiare lingua basta la riga "locale" in cima a quel file: it, en, es, fr, de.
-- Le stringhe mancanti cadono su 'en', poi su 'it', poi sul nome della chiave.

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

--- Testo localizzato. `key` usa la notazione con punti, per esempio 'gps.notFound'.
--- I segnaposto sono quelli di string.format (%s, %d, ...).
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

--- Lingua attiva e nome leggibile, per la documentazione e i log.
function WhipPostals.localeInfo()
    local d = data()
    if not d then return 'it', 'Italiano' end
    local lang = d[d.locale] or d.en or d.it or {}
    local meta = type(lang.meta) == 'table' and lang.meta or {}
    return tostring(d.locale), tostring(meta.name or d.locale)
end
