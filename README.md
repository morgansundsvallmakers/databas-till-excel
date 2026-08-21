# Databas → Excel (webb)

Statisk webbapp för att exportera:

- SQLite / DB3 (`.db3`, `.sqlite`, `.sqlite3`)
- Access / PEX (`.mdb`, `.accdb`)

till `.xlsx` direkt i webbläsaren.

## Säkerhetsmodell

Databasfilen väljs med webbläsarens File API och kopieras endast till Pyodides virtuella filsystem i den lokala webbläsarprocessen. Källfilen skickas inte till någon backend.

Själva appen och dess runtime hämtas från GitHub Pages. Pyodide och de Python-paket som behövs byggs in i den statiska Pages-deploymenten via GitHub Actions, så databaskonverteringen behöver inte hämta kod från jsDelivr, PyPI eller `raw.githubusercontent.com` vid körning.

Detta är **lokal databearbetning i webbläsaren**. Appen är inte en fullständig offline-app eftersom webbplatsens filer fortfarande behöver kunna hämtas från GitHub Pages.

## GitHub Pages

Projektet byggs och deployas med GitHub Actions via `.github/workflows/pages.yml`.

Pages ska därför vara inställt på:

- **Source:** GitHub Actions

Workflowet bygger en kompakt statisk site och inkluderar endast de Pyodide-runtimefiler och Python-paket som appen behöver.

## Viktiga filer

- `index.html` – gränssnitt
- `styles.css` – visuell stil
- `app.js` – UI, filhantering och module worker-start
- `worker.js` – Pyodide/module Web Worker och lokal paketladdning
- `exporter.py` – gemensam Python-exportlogik
- `.github/workflows/pages.yml` – bygger den kompakta runtime-mappen och deployar GitHub Pages
- `.nojekyll` – låter GitHub Pages servera projektet utan Jekyll-behandling

## Beroenden

Bygget använder bland annat:

- Pyodide 314.0.4
- openpyxl 3.1.5
- et-xmlfile 2.0.0
- construct 2.10.70
- tabulate 0.10.0
- access-parser 0.0.6

`access-parser` är Apache-2.0-licensierat.

## Verifierade tester

Webbversionen har verifierats i Microsoft Edge på en arbetsdator där extern CDN-laddning av Pyodide var blockerad. Den självhostade GitHub Pages-runtimeversionen fungerade utan den externa CDN:n.

### SQLite / DB3

- Fil: `APRSetting.db3`
- Storlek: 204 288 000 byte (ca 204 MB)
- Identifiering: SQLite / DB3
- Tabeller: 15
- Resultat: lyckad export till `.xlsx`
- Observerad konverteringstid: ca 42 sekunder

### Access / PEX

- Fil: `pex_20180312-154659.mdb`
- Storlek: 3 162 112 byte (ca 3,2 MB)
- Identifiering: Access / PEX
- Tabeller: 62
- Resultat: lyckad export till `.xlsx`
- Observerad konverteringstid: ca 3 sekunder

Tiderna är endast praktiska observationer från dessa tester och ska inte ses som prestandagarantier.
