# Databas → Excel (webb)

Första statiska webbversionen av verktyget för att exportera:

- SQLite / DB3 (`.db3`, `.sqlite`, `.sqlite3`)
- Access / PEX (`.mdb`, `.accdb`)

till `.xlsx`.

## Säkerhetsmodell

Databasfilen väljs med webbläsarens File API och kopieras endast till Pyodides virtuella filsystem i den lokala webbläsarprocessen. Källfilen skickas inte till någon backend.

Webbappen hämtar däremot programkod/paket från internet:

- Pyodide från jsDelivr
- rena Python-paket via Pyodides `micropip`
- `access-parser`-källkod från ett pinnat GitHub-commit

Detta är alltså **lokal databearbetning**, inte en offline-app.

## GitHub Pages

Projektet är helt statiskt. Lägg filerna i repo-roten och aktivera GitHub Pages från `main`/root.

## Viktiga filer

- `index.html` – gränssnitt
- `styles.css` – visuell stil
- `app.js` – UI och filhantering
- `worker.js` – Pyodide/WebWorker
- `exporter.py` – gemensam Python-exportlogik
- `.nojekyll` – låter GitHub Pages servera projektet utan Jekyll-behandling

## Beroenden

- Pyodide 314.0.4
- openpyxl
- construct
- tabulate
- access-parser-källkod, pinnad till commit `7b733913a7a8076bfd289130a9f6113002059fe0`

`access-parser` är Apache-2.0-licensierat.
