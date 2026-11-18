# whip_postals

I civici sulla mappa di WHIP — **mappa grande del menu pausa**, **finestra Map di `/whip`** e
**minimappa dell'HUD** — con uno stile tutto loro e un tema colori per la mappa.

`whip_core` non viene modificato: blip, GPS, waypoint, inclinazione 3D, zoom, "segui giocatore" e le
impostazioni della minimappa restano quelli di sempre. Questa risorsa aggiunge solo un livello sopra il
disegno della mappa.

I 865 numeri sono disegnati su **un canvas per mappa**, non come elementi HTML: trascinare e zoomare resta
fluido anche con tutti i civici in vista.

[English](README.md)

---

## Caratteristiche

- 865 civici OCRP da `nui/postals.json` — sostituisci il file con i tuoi (stessa forma) e basta.
- `declutter: false` di default: **tutti** i civici in vista, sovrapposizioni incluse. `true` riattiva il
  vecchio filtro a griglia (un'etichetta per cella).
- Stile separato per mappa grande e minimappa.
- Tre tavolozze (`midnight`, `paper`, `whip` originale) più una personalizzata.
- `/gps <civico>` per tutti i giocatori, risolto dallo stesso `postals.json`.
- Cinque lingue (IT / EN / ES / FR / DE) per messaggi server ed editor.
- L'editor in gioco è nel codice ma **disattivato** (`EDITOR_ENABLED = false`).

## Requisiti

- FiveM con `whip_core` installato e avviato prima di questa risorsa.
- La cartella deve chiamarsi `whip_postals` (l'URL dell'hook NUI dipende dal nome).

## Installazione

1. Copia la cartella in `resources/[custom]/whip_postals` (va bene qualsiasi cartella di categoria).
   In `server.cfg` basta il solito `ensure [custom]`, oppure aggiungi `ensure whip_postals`.
2. Esegui **a mano** l'installer dell'hook: doppio clic su `tools/install-core-hook.cmd`. Aggiunge un
   solo blocco loader a `whip_core/html/index.html`, subito dopo `js/main.js`. Poi in console:

   ```
   refresh
   restart whip_core
   ```

3. Apri la mappa con **M**. Se i numeri non compaiono, vedi [Risoluzione problemi](#risoluzione-problemi).

Il blocco caricato fa retry fino a 60 volte (ogni 500 ms) perché `whip_core` parte prima di
`whip_postals` e l'host NUI potrebbe non esistere ancora. È l'unica modifica a `whip_core`: cancellando
il blocco e facendo `restart whip_core` la mappa torna esattamente com'era.

Il `extension.js` nella root è un ponte di compatibilità di tre righe: una pagina NUI in cache che
richiede ancora `/extension.js` viene inoltrata al modulo vero in `nui/`.

### L'installer è strettamente manuale

`tools/install-core-hook.ps1` si rifiuta di girare senza `-Manual`, flag passato solo dal `.cmd`. Non è
in `files {}` dell'`fxmanifest.lua`, non è servito alla NUI e nessuno script Lua lo nomina: niente watcher,
pianificazioni, hook server o percorsi richiamabili da un giocatore.

- Idempotente: se il loader c'è già non tocca niente.
- Migra il vecchio hook a riga singola al loader con retry.
- Salva un backup con timestamp in `tools/backups/` prima di scrivere.
- Cerca `whip_core` prima in `[core]`, poi alla radice di `resources`.
- Si ferma con un errore senza modificare niente se non trova più `js/main.js`.

Dopo un aggiornamento di `whip_core` il blocco sparisce: riesegui l'installer.

## Lingue

Tutto è definito in **`nui/locales.json`**, letto sia dalla NUI sia dal lato Lua (`shared/locales.lua`).
Per cambiare lingua basta una riga:

```json
"locale": "it"
```

Valori supportati: `it`, `en`, `es`, `fr`, `de`. Le chiavi mancenti cadono su `en`, poi su `it`.

Tradotti: tutti i messaggi di `/gps` e della console server, ogni etichetta dell'editor opzionale (compresi
i commenti del `config.js` esportato) e l'attributo lingua della pagina. Non tradotti: i civici (numeri),
i nomi di colori/font CSS e questa documentazione (che ha una versione [English](README.md)).

Per aggiungere una lingua, copia un blocco in `nui/locales.json`, traducilo e imposta `locale` alla nuova
chiave. La NUI legge il cambiamento al prossimo `restart whip_core`; `/gps` al prossimo
`restart whip_postals`.

## Il comando `/gps`

**`/gps <civico>`** è disponibile a tutti, senza permessi, anche mentre sei a terra (rate limit:
6 comandi/secondo):

```
/gps 3001
```

Il server risolve il codice in `nui/postals.json` e manda solo `x, y` al client, che chiama
`SetNewWaypoint`. Nessun secondo file di dati da aggiornare e nessun evento client per impostare un punto
arbitrario. Il waypoint è quello di GTA: si vede sulla minimappa e sulla mappa grande.

## Personalizzare

Modifica **`nui/config.js`** e poi dai `restart whip_core` (la pagina carica il file quando si apre;
riavviare solo `whip_postals` non basta).

- `labels.pause` — stile della mappa grande / finestra Map di `/whip`.
- `labels.minimap` — stile della minimappa HUD.
- `declutter` — `false` (default) disegna tutti i civici in vista; `true` tiene un'etichetta per cella.
- `minPxPerMetre` — nasconde i numeri quando zoomi troppo indietro (`0.22` mappa grande ≈ zoom 3.4,
  `0.5` minimappa).
- `theme.enabled` / `theme.preset` / `theme.colours` — tavolozza; `custom` usa `theme.colours`.

Il codice dell'editor è ancora in `nui/extension.js`: per riavere il pannello porta a `true`
`EDITOR_ENABLED` in cima al file e fai `restart whip_core`. I suoi testi seguono la lingua attiva.

`tools/` non contiene codice eseguito in gioco: tutti i file runtime sono in `nui/`, `server/` e `client/`.

## Formato dati

`nui/postals.json` è un array; `code` può essere stringa o numero:

```json
[{ "code": "3001", "x": -1157.1995849609, "y": 4938.10546875 }]
```

## Risoluzione problemi

WHIP ingloba `console.error` nel suo log errori, quindi i diagnostici si leggono in console server con
`whiperrors` (o da F8 con modalità sviluppatore):

- `[whip_postals][BOOT]` — il loader è partito; `OK` significa che il modulo è stato importato.
- `[whip_postals][DIAG]` — modulo attivo, quanti civici ha caricato, flag di config, stato canvas.
- `[whip_postals][PAINT]` — etichette davvero disegnate, con conteggio e dimensione del canvas.

Come leggerli:

| Sintomo | Causa probabile |
| --- | --- |
| Solo `[BOOT] caricamento non riuscito: HTTP 404` | risorsa non avviata, o nome/URL dell'hook sbagliato |
| `[DIAG]` presente, nessun `[PAINT]` | `enabled: false`, zoom sotto `minPxPerMetre`, o mappa non ancora disegnata |
| `[PAINT]` presente ma non si vede niente | CSS/z-index del canvas, oppure opacità a 0 |
| Vecchio stile ancora applicato | vecchia save locale; `window.__whipPostals.reset()` la cancella (la chiave ora è `whip_postals.style.v2`) |
| Non compare il pulsante "Civici" | normale: l'editor è disattivato |

Da una console browser/dev, `window.__whipPostals` espone `count`, `config`, `editor`, `openEditor()`,
`closeEditor()`, `reset()` e `redraw()`.

## Struttura

```
whip_postals/
├── fxmanifest.lua
├── README.md / README.it.md
├── extension.js              ponte per il vecchio hook /extension.js
├── nui/
│   ├── extension.js          hook della mappa, renderer canvas, editor opzionale
│   ├── config.js             default del server per stile e tavolozza
│   ├── locales.json          stringhe IT / EN / ES / FR / DE (fonte unica)
│   └── postals.json          865 civici
├── shared/
│   └── locales.lua           lettore Lua di locales.json
├── server/gps.lua            comando /gps
├── client/gps.lua            handler SetNewWaypoint
└── tools/
    ├── install-core-hook.cmd
    ├── install-core-hook.ps1
    └── backups/              creato dall'installer (escluso da git)
```

## Crediti e licenza

Dati postali: set OCRP (865 voci). Realizzato per WHIP. Codice sotto licenza MIT — vedi [LICENSE](LICENSE).
