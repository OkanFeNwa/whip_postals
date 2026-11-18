fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name 'whip_postals'
description 'Postal codes (civici) on whip\'s pause map and HUD minimap, with their own look and map theme'
version '1.2.0'
dependency 'whip_core'

-- Layout:
--   nui/     the page extension, its config, the postal data and the language strings
--            (served under https://cfx-nui-whip_postals/nui/)
--   shared/  the Lua side of the language loader (reads the very same nui/locales.json)
--   server/  /gps: reads postals.json, resolves the code, sends the coordinates
--   client/  /gps: sets the GTA waypoint
--   tools/   MANUAL installer for whip_core's index.html: deliberately NOT declared in files {},
--            so the server never serves it and nothing in game can call it.
shared_script '@whip_core/lib/satellite.lua'
shared_script 'shared/locales.lua'
server_script 'server/gps.lua'
client_script 'client/gps.lua'

files {
    'nui/postals.json',
    'nui/config.js',
    'nui/locales.json',
    'nui/extension.js',
    'extension.js',   -- compat bridge for NUI pages still using the pre-reorg /extension.js hook
}
