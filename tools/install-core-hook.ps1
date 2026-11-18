<#
    install-core-hook.ps1 - adds (or updates) the loader block in whip_core/html/index.html that loads
    nui/extension.js. It is a retry loader: whip_core starts before whip_postals, so the resource's NUI
    host may not exist yet when the page opens.

    MANUAL ONLY: it is not declared in fxmanifest.lua, is not served to NUI and is not loaded by the
    server. There is no watcher, schedule or event: the file does nothing until you run it with -Manual,
    which only install-core-hook.cmd passes.
#>

[CmdletBinding()]
param(
    [switch]$Manual
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $Manual) {
    Write-Host 'No changes made.'
    Write-Host 'This script only runs by hand: double-click tools/install-core-hook.cmd'
    exit 1
}

# Present only in the current English loader, so an older hook is migrated instead of skipped.
$loaderMarker = "OK (attempt '"
$hook = @'
<!-- Postal codes on the pause map and the minimap, plus the map colours, from the whip_postals resource.
     whip_core starts before whip_postals in server.cfg, so the NUI host may not exist yet: retry until it does.
     Delete this block to go back to the stock map; the resource can then be stopped too. -->
<script>
(function () {
    var url = 'https://cfx-nui-whip_postals/nui/extension.js';
    var tries = 0;
    var seen = {};
    function note(msg) {
        if (seen[msg]) return;
        seen[msg] = true;
        console.error('[whip_postals][BOOT] ' + msg);
    }
    function boot() {
        if (window.__whipPostals) return;
        tries++;
        fetch(url, { cache: 'no-store' })
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return import(url);
            })
            .then(function () { note('OK (attempt ' + tries + ')'); })
            .catch(function (e) {
                var m = (e && (e.stack || e.message)) || String(e);
                note('load failed: ' + m);
                if (tries < 60) setTimeout(boot, 500);
            });
    }
    setTimeout(boot, 300);
})();
</script>
'@

# tools/ -> whip_postals/ -> parent folder -> resources/ -> whip_core, inside [core] or at the root.
# Check both positions: a server may group WHIP resources in [core] or keep them at the root.
$candidates = @(
    (Join-Path $PSScriptRoot '..\..\..\[core]\whip_core\html\index.html'),
    (Join-Path $PSScriptRoot '..\..\..\whip_core\html\index.html')
)
$core = $null
foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
        $core = (Resolve-Path -LiteralPath $candidate).Path
        break
    }
}
if (-not $core) {
    throw ("Cannot find whip_core/html/index.html in: " + ($candidates -join ', '))
}

$text = [IO.File]::ReadAllText($core)
$nl = if ($text.IndexOf("`r`n", [System.StringComparison]::Ordinal) -ge 0) { "`r`n" } else { "`n" }
$hook = $hook.Replace("`n", $nl)

function Save-WithBackup([string]$newText, [string]$why) {
    $backupDir = Join-Path $PSScriptRoot 'backups'
    if (-not (Test-Path -LiteralPath $backupDir)) { New-Item -ItemType Directory -Path $backupDir | Out-Null }
    $backup = Join-Path $backupDir ('index.html.bak.' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($backup, $script:text, $utf8)
    [IO.File]::WriteAllText($script:core, $newText, $utf8)
    Write-Host "$why in: $($script:core)"
    Write-Host "Backup of the previous index.html: $backup"
    Write-Host ''
    Write-Host 'Now run in the server console: restart whip_core'
}

# Already current: touch nothing, create no backup.
if ($text.IndexOf($loaderMarker, [System.StringComparison]::Ordinal) -ge 0) {
    Write-Host 'Hook already present with the retry loader. No changes.'
    exit 0
}

# Remove any previous version of the hook (old single-line module tag, temporary diagnostics, etc.).
$lines = $text -split "`r?`n"
$clean = New-Object 'System.Collections.Generic.List[string]'
$skipping = $false
foreach ($line in $lines) {
    if ($line -match 'Postal codes .*on the pause map' -or $line -match 'DIAGNOSTICO TEMPORANEO' -or $line -match 'TEMPORARY DIAGNOSTIC') {
        $skipping = $true
        continue
    }
    if ($skipping) {
        if ($line -match '</script>') { $skipping = $false }
        continue
    }
    if ($line -match 'cfx-nui-whip_postals') { continue }
    $clean.Add($line) | Out-Null
}
$cleanText = [string]::Join($nl, $clean)

# Install right after whip_core's own entry module.
$rx = '(?m)^(?<indent>[ \t]*)<script[ \t]+type="module"[ \t]+src="js/main\.js"[ \t]*></script>[ \t]*(?=\r?$)'
$m = [regex]::Match($cleanText, $rx)
if (-not $m.Success) {
    throw 'Cannot find the js/main.js line: whip_core layout changed. Check manually.'
}

$anchorLine = $m.Value.TrimEnd("`r")
$insert = $anchorLine + $nl + $m.Groups['indent'].Value + $hook
$newText = $cleanText.Substring(0, $m.Index) + $insert + $cleanText.Substring($m.Index + $m.Length)
Save-WithBackup $newText 'Hook inserted/updated'
