-- /gps <postal> - client side: only sets the GTA waypoint on the player's own map.
-- The coordinates always come from server/gps.lua, which looked them up in nui/postals.json.

RegisterNetEvent('whip_postals:setGps', function(x, y)
    x, y = tonumber(x), tonumber(y)
    if not x or not y then return end
    SetNewWaypoint(x, y)
end)
