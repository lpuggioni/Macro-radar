# Macro Radar — GitHub Hybrid MVP

Questa versione è pensata per:
- aprire la dashboard via **GitHub Pages** (HTTPS) senza installare nulla lato utente
- aggiornare i dati in modo automatico tramite **GitHub Actions** che genera file JSON in `docs/data/`
- mantenere la UI “Bloomberg-like” con news tagging + monitoring drawer

## 1) Pubblicazione su GitHub Pages (UI)
1. Crea un nuovo repo su GitHub (es. `macro-radar`)
2. Copia il contenuto di questo zip nel repo (mantieni la cartella `docs/`)
3. Vai su **Settings → Pages**
4. Source: **Deploy from a branch**
5. Branch: `main` (o `master`) e folder: **/docs**
6. Salva: dopo 1-2 minuti avrai un URL tipo `https://<user>.github.io/<repo>/`

Apri quell'URL in Chrome: vedrai i dati (il problema del “file://” sparisce).

## 2) Abilitare l’update automatico dati (Actions)
Nel repo: **Actions** devono essere abilitati.
Il workflow è in `.github/workflows/update-data.yml`.

- Frequenza: ogni 15 minuti + manuale (`workflow_dispatch`)

## 3) (Opzionale) Attivare serie FRED (credit stress / US rates/vol)
Per scaricare serie FRED in Actions devi impostare un secret:
- Settings → Secrets and variables → Actions → New repository secret
- Name: `FRED_API_KEY`
- Value: la tua key (gratuita)

Se non lo imposti, la UI mostrerà “Credit Stress” come non disponibile e lo elencherà in “Dati rimossi”.

## 4) File dati generati
- `docs/data/snapshot.json` — tiles + timestamp
- `docs/data/eu_curves.json` — DE/IT/ES/FR 10Y + spread
- `docs/data/fx_top_movers.json` — top movers FX vs EUR (FX-only)
- `docs/data/credit.json` — opzionale (FRED)

## Note
- Alcuni dati (MOVE, consensus, CB probabilities) non sono open: restano esclusi.
