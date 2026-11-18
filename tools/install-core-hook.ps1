<#
    install-core-hook.ps1 — aggiunge (o aggiorna) a whip_core/html/index.html il blocco che carica
    nui/extension.js. Il blocco e' un loader con retry: whip_core parte prima di whip_postals, quindi
    l'host NUI della risorsa dei civici potrebbe non esistere ancora quando la pagina si apre.

    MANUALE, NESSUNA automatica: non e' dichiarato in fxmanifest.lua, non e' servito dalla NUI e non e'
    caricato dal server. Non c'e' watcher, pianificazione o evento: il file non fa niente finche' non
    lo esegui tu con install-core-hook.cmd (che passa il flag -Manual).
#>

[CmdletBinding()]
param(
    [switch]$Manual
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $Manual) {
    Write-Host 'Nessuna modifica eseguita.'
    Write-Host 'Questo script si lancia solo a mano: fai doppio clic su tools/install-core-hook.cmd'
    exit 1
}

$loaderMarker = '[whip_postals][BOOT]'
$hook = @'
<!-- Postal codes (civici) on the pause map and the minimap, and the map's colours: [custom]/whip_postals.
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
            .then(function () { note('OK (tentativo ' + tries + ')'); })
            .catch(function (e) {
                var m = (e && (e.stack || e.message)) || String(e);
                note('caricamento non riuscito: ' + m);
                if (tries < 60) setTimeout(boot, 500);
            });
    }
    setTimeout(boot, 300);
})();
</script>
'@

# tools/ -> whip_postals/ -> [custom]/ -> resources/ -> poi whip_core, dentro [core] o alla radice.
# Proviamo entrambe le posizioni: l'utente puo' aver raggruppato i resource WHIP in [core].
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
    throw ("Non trovo whip_core/html/index.html in: " + ($candidates -join ', '))
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
    Write-Host "Backup del vecchio index.html: $backup"
    Write-Host ''
    Write-Host 'Ora dagli in console: restart whip_core'
}

# Gia' corretto: non tocca niente (anche dopo piu' aggiornamenti).
if ($text.IndexOf($loaderMarker, [System.StringComparison]::Ordinal) -ge 0) {
    Write-Host 'Hook gia presente con il loader con retry. Nessuna modifica.'
    exit 0
}

# Rimuove qualsiasi versione precedente dell'hook (module line, diagnostic temporaneo, ecc.).
$lines = $text -split "`r?`n"
$clean = New-Object 'System.Collections.Generic.List[string]'
$skipping = $false
foreach ($line in $lines) {
    if ($line -match 'Postal codes \(civici\)' -or $line -match 'DIAGNOSTICO TEMPORANEO') {
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

# Installazione: subito dopo il modulo entry di whip_core.
$rx = '(?m)^(?<indent>[ \t]*)<script[ \t]+type="module"[ \t]+src="js/main\.js"[ \t]*></script>[ \t]*(?=\r?$)'
$m = [regex]::Match($cleanText, $rx)
if (-not $m.Success) {
    throw 'Non trovo la riga di js/main.js: la struttura di whip_core e cambiata. Controlla a mano.'
}

$anchorLine = $m.Value.TrimEnd("`r")
$insert = $anchorLine + $nl + $m.Groups['indent'].Value + $hook
$newText = $cleanText.Substring(0, $m.Index) + $insert + $cleanText.Substring($m.Index + $m.Length)
Save-WithBackup $newText 'Hook inserito/aggiornato'
