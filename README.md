# Vikey Auto Export

Automatizza il passaggio manuale "Prenotazioni > Esporta > Lista Prenotazioni"
su my.vikey.it. Gira ogni giorno alle 05:00 (ora di Roma) su GitHub Actions,
prima che parta il trigger di Apps Script che legge l'email con il CSV.

Vikey continua a mandare il CSV via email esattamente come nel flusso manuale:
questo script si limita a cliccare i bottoni al posto tuo. Non tocca
`vikey_sync.gs`, che resta invariato.

## Setup (una tantum)

1. **Crea un repository GitHub** (può essere privato) e carica questi file
   mantenendo la struttura delle cartelle (in particolare `.github/workflows/`
   deve restare dov'è).

2. **Aggiungi i secrets**: nel repository vai su
   `Settings > Secrets and variables > Actions > New repository secret`
   e crea:
   - `VIKEY_EMAIL` → la tua email di login Vikey
   - `VIKEY_PASSWORD` → la tua password di login Vikey

   Non mettere mai queste credenziali direttamente nel codice.

3. **Verifica i selettori in locale prima di affidarti al job automatico.**
   I selettori dello script (nomi di campi e bottoni) sono basati sulla
   descrizione del flusso, ma non ho potuto ispezionare l'interfaccia reale
   di Vikey (è dietro login). Prima del primo run automatico:

   ```bash
   npm install
   npx playwright install chromium
   VIKEY_EMAIL="tua@email.it" VIKEY_PASSWORD="tuapassword" HEADLESS=false node vikey-export.js
   ```

   Questo apre un browser visibile e ti fa vedere passo passo dove si blocca,
   se si blocca. Se un selettore non trova l'elemento giusto, dimmi a che
   punto si ferma (login, click su "Esporta", selezione "Lista Prenotazioni",
   compilazione date, bottone finale) e sistemiamo quella parte.

4. **Testa il workflow manualmente su GitHub** prima di fidarti dello
   schedule: nel repository vai su `Actions > Export Vikey giornaliero >
   Run workflow`. Questo lo lancia subito, ignorando l'orario, così puoi
   vedere se fallisce senza aspettare le 05:00.

## Come sapere se qualcosa si rompe

Se il job fallisce, GitHub manda automaticamente un'email al proprietario del
repository (se le notifiche per Actions sono attive nelle tue impostazioni
GitHub — di solito lo sono di default). In più, lo screenshot dell'errore
viene salvato come artifact del run, scaricabile dalla pagina del job per
capire a che punto si è bloccato.

## Se Vikey cambia interfaccia

Se in futuro Vikey aggiorna il pannello e lo script smette di funzionare,
il modo più veloce per sistemarlo è rilanciare il test in locale con
`HEADLESS=false` come al punto 3, vedere dove si ferma, e correggere il
selettore corrispondente in `vikey-export.js`.

## Nota sui Termini di Servizio

Vikey vende l'accesso alle API a pagamento, separato dall'export manuale via
pannello. Automatizzare il click sul pannello è una zona grigia rispetto ai
loro ToS — non è di per sé pericoloso, ma vale la pena dare un'occhiata ai
ToS del tuo account se vuoi escludere problemi.
