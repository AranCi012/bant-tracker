# Meta Tracker

Dashboard per registrare e analizzare le partite dei nostri mazzi di Magic (Legacy: Bant con Phelia & co., ma anche qualunque altro mazzo) contro i vari archetipi.

**Cosa fa**
- **Più mazzi**: dal selettore "Mazzo" in alto scegli quale dei vostri mazzi stai analizzando (Bant, Dimir, …). Ogni mazzo ha le sue liste, i suoi match, le sue guide di sideboard e le sue statistiche; gli archetipi avversari sono condivisi.
- **Registra partita** (bottone `+ Partita`): archetipo avversario, G1/G2/G3 vinta/persa, play/draw (G2 e G3 si compilano da soli), sidata usata in G2 e G3 (precompilata dalla guida), giocatore, evento, versione lista, note.
- **Dashboard**: win rate di match e di game, pre-board e post-board, on the play e on the draw, andamento nel tempo, win rate per matchup, quanto spesso incontrate ogni archetipo, matrice "G1 → esito del match".
- **Matchup**: matrice a colori matchup × situazione (match, game, G1, G2-3, play, draw), più la matrice giocatore × matchup. Cliccando un matchup vedi il dettaglio.
- **Sideboard**: guida di sideboard per ogni matchup, separata on the play e on the draw; statistiche delle sidate (win rate post-board per piano e per singola carta, guida seguita o no); export in Markdown, CSV e stampa/PDF.
- **Liste**: versioni della lista con win rate, differenze carta per carta fra una versione e l'altra, confronto fra due versioni, "impatto delle carte" (win rate con e senza ogni carta cambiata), vista a immagini da Scryfall.
- **Avversari**: archetipi modificabili con note.
- **Storico**: modifica ed eliminazione dei match, export CSV, backup e import JSON.
- **Telefono**: si installa come app (Aggiungi a Home) e il bottone "invita" genera un link o QR code che fa entrare gli amici senza digitare il codice.
- **Filtri** per giocatore, versione lista, evento e date.

Con pochi match le percentuali ballano parecchio: le celle con meno di 3 match sono tratteggiate e i tooltip mostrano l'intervallo di confidenza al 95%.

---

## Metterlo online gratis (circa 15 minuti)

Servono due servizi gratuiti:

| Pezzo | Servizio | A cosa serve |
|---|---|---|
| Database condiviso | **Supabase** (piano Free) | Salva le partite di tutti |
| Sito | **GitHub Pages** (oppure Netlify o Vercel) | Ospita le pagine |

### 1. Database su Supabase

1. Registrati su <https://supabase.com> e clicca **New project** (piano Free, regione `eu-central`).
2. Apri `supabase/schema.sql` e alla riga `CAMBIAMI-metti-una-password` metti il **codice del gruppo** che darai ai tuoi amici.
3. Su Supabase vai in **SQL Editor → New query**, incolla tutto il file e premi **Run**. Poi fai lo stesso con `supabase/migrations/002_multideck_sideboard.sql`.
4. Vai in **Project Settings → API** (o **Data API / API Keys**) e copia:
   - **Project URL** (`https://xxxx.supabase.co`)
   - la chiave **publishable** o **anon public** (non la `service_role` o `secret`!)
5. Incollale in `config.js`:
   ```js
   window.APP_CONFIG = {
     SUPABASE_URL: "https://xxxx.supabase.co",
     SUPABASE_KEY: "sb_publishable_...",
     APP_NAME: "Bant Meta Tracker",
   };
   ```

> **Sicurezza:** la chiave publishable/anon è fatta per stare nel sito pubblico. Senza il codice del gruppo non si legge e non si scrive niente, perché le policy RLS dello schema controllano il codice. Il codice non sta nel sito, solo nel database. Per cambiarlo, modifica la riga nello schema e riesegui lo script: i dati restano.

### 2. Sito su GitHub Pages

```bash
cd meta_analisi_bant
git init && git add . && git commit -m "Bant Meta Tracker"
```

1. Crea un repository su <https://github.com/new>, per esempio `bant-tracker`. Se è privato, Pages richiede GitHub Pro. Il repo pubblico va bene: il codice del gruppo non è nel repo.
2. Collegalo e fai push:
   ```bash
   git remote add origin https://github.com/TUO_UTENTE/bant-tracker.git
   git branch -M main && git push -u origin main
   ```
3. Su GitHub vai in **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`** e premi **Save**.
4. Dopo un minuto il sito è su `https://TUO_UTENTE.github.io/bant-tracker/`. Manda il link e il codice del gruppo agli amici.

**Alternativa senza git: Netlify Drop.** Vai su <https://app.netlify.com/drop> e trascina la cartella del progetto: il link arriva subito. Per aggiornare il sito devi trascinarla di nuovo.

### 3. Primo utilizzo
1. Apri il sito, inserisci il codice del gruppo e il tuo nome.
2. Vai in **La nostra lista → + Aggiungi lista** e incolla l'export di MTGO, Arena o Moxfield. La sideboard viene separata in automatico.
3. Registra le partite con **+ Partita**.

Consiglio: aggiungete il sito alla home del telefono (Safari: Condividi → Aggiungi a Home) per segnare il risultato subito dopo il match.

---

## Note

- **Supabase Free mette in pausa il progetto dopo 7 giorni senza attività.** I dati non si perdono: basta riattivarlo dalla dashboard di Supabase (un clic). Se giocate ogni settimana non succede.
- Ogni tanto fate un **Backup JSON** dallo Storico.
- **Senza Supabase** (`config.js` vuoto) l'app funziona in locale e salva i dati solo nel browser. In questa modalità c'è anche il bottone "Carica dati demo" per provarla.
- **Provarla in locale:** `python3 -m http.server 8000` nella cartella, poi apri <http://localhost:8000>.

## File

```
index.html                pagina (carica i moduli in ordine)
manifest.webmanifest      installazione come app sul telefono
icons/                    icone dell'app
config.js                 URL e chiave Supabase
css/styles.css            stile di base (tema chiaro e scuro automatico)
css/features.css          stile di sideboard e statistiche delle liste
css/mobile.css            stile per telefono (barra in basso, tabelle a schede)
js/core.js                database, stato, statistiche, router, gestione mazzi
js/cards.js               immagini e dati delle carte (Scryfall)
js/matchform.js           form per registrare un match (con sidate)
js/views/*.js             una vista per scheda (dashboard, matchup, sideboard, storico, liste, avversari)
js/mobile.js              link di invito, QR code, icone della barra in basso
js/boot.js                avvio
supabase/schema.sql       tabelle iniziali, sicurezza, archetipi iniziali
supabase/migrations/      modifiche successive al database (da eseguire in ordine)
```

Nessuna build e nessuna dipendenza da installare: sono file statici.
