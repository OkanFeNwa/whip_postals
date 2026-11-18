-- /gps <postal> - server side.
--
-- The postal table is read from the same postals.json the NUI uses, so the command and the labels can
-- never disagree. The server resolves the code and sends only the coordinates to the player: a client
-- cannot ask for an arbitrary point through this command.

local postals = {}

local function loadPostals()
    local raw = LoadResourceFile(GetCurrentResourceName(), 'nui/postals.json')
    if not raw then
        print('^1[whip_postals] ' .. WhipPostals.locale('gps.missing') .. '^7')
        return false
    end

    local ok, list = pcall(json.decode, raw)
    if not ok or type(list) ~= 'table' then
        print('^1[whip_postals] ' .. WhipPostals.locale('gps.invalid') .. '^7')
        return false
    end

    postals = {}
    for _, p in pairs(list) do
        if type(p) == 'table' and p.code ~= nil and type(p.x) == 'number' and type(p.y) == 'number' then
            postals[tostring(p.code)] = p
        end
    end

    local n = 0
    for _ in pairs(postals) do n = n + 1 end
    print('^2[whip_postals] ' .. WhipPostals.locale('gps.loaded', n) .. '^7')
    return true
end

Whip.register(function()
    if not loadPostals() then return end

    -- No `ace` and no `dev`: everybody can use it. `whileDead` keeps it usable while downed too;
    -- whip still supplies the rate limit and all its error isolation.
    Whip.command('gps', {
        console = false,
        whileDead = true,
        rateLimit = { burst = 6, everyMs = 1000 },
    }, function(source, args)
        local code = args and args[1]
        if type(code) ~= 'string' then
            Whip.call('NotifyPlayer', source, WhipPostals.locale('gps.usage'), 'info')
            return
        end

        code = code:match('^%s*(.-)%s*$')
        if code == '' then
            Whip.call('NotifyPlayer', source, WhipPostals.locale('gps.usage'), 'info')
            return
        end

        local p = postals[code]
        if not p then
            Whip.call('NotifyPlayer', source, WhipPostals.locale('gps.notFound', code), 'error')
            return
        end

        -- Server -> client only: there is no matching server handler a player could call.
        TriggerClientEvent('whip_postals:setGps', source, p.x, p.y)
        Whip.call('NotifyPlayer', source, WhipPostals.locale('gps.set', code), 'success')
    end)
end)
