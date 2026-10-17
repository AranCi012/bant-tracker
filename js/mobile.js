// Funzioni per il telefono: link d'invito, QR code, icone della barra in basso.
// Questo file è caricato prima di boot.js, quindi il codice di primo livello
// gira prima dell'avvio dell'app.
(() => {
  "use strict";

  const A = window.App;
  const { esc } = A;

  // ---- 1) Link d'invito: #invito=<codice> ------------------------------
  // Salva il codice di gruppo e ripulisce l'URL, poi core fa il login da solo.
  const INVITE_PREFIX = "#invito=";
  if (location.hash.startsWith(INVITE_PREFIX)) {
    let key = "";
    try { key = decodeURIComponent(location.hash.slice(INVITE_PREFIX.length)); } catch { key = ""; }
    if (key) A.lsSet("groupKey", key);
    history.replaceState(null, "", location.pathname + location.search + "#dashboard");
  }

  // ---- 2) Modal "invita" ------------------------------------------------
  const QR_SRC = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
  let qrPromise = null;

  // Carica la libreria QR una sola volta; se fallisce riprova alla prossima apertura.
  function loadQr() {
    if (window.QRCode) return Promise.resolve(true);
    if (!qrPromise) {
      qrPromise = new Promise((resolve) => {
        const s = document.createElement("script");
        s.src = QR_SRC;
        s.async = true;
        s.onload = () => resolve(!!window.QRCode);
        s.onerror = () => { s.remove(); resolve(false); };
        document.head.appendChild(s);
      }).then((ok) => { if (!ok) qrPromise = null; return ok; });
    }
    return qrPromise;
  }

  function keyUrl(key) {
    const base = location.origin + location.pathname;
    return key ? base + INVITE_PREFIX + encodeURIComponent(key) : base;
  }

  function inviteUrl() {
    return keyUrl(A.lsGet("groupKey", ""));
  }

  // Blocco di un link: QR, campo di testo, Copia link e (se disponibile) Condividi.
  // `id` rende unici gli elementi di ogni sezione; `noteHtml` è già HTML sicuro.
  function linkBlock(id, url, noteHtml) {
    const canShare = typeof navigator.share === "function";
    return `
      <div id="${id}-wrap" style="text-align:center;margin:8px 0">
        <div id="${id}-qr" style="display:flex;justify-content:center;min-height:220px" aria-label="QR code del link"></div>
      </div>
      <label class="field full" style="margin-top:12px">Link
        <input id="${id}-url" type="text" readonly value="${esc(url)}" onfocus="this.select()">
      </label>
      <div class="inline invite-actions">
        <button class="btn primary" id="${id}-copy">Copia link</button>
        ${canShare ? `<button class="btn" id="${id}-share">Condividi</button>` : ""}
      </div>
      ${noteHtml}`;
  }

  // Collega i pulsanti del blocco e monta il QR.
  function bindLink(body, id, url) {
    const input = body.querySelector(`#${id}-url`);
    const copyBtn = body.querySelector(`#${id}-copy`);
    if (copyBtn) copyBtn.onclick = async () => {
      try {
        if (!navigator.clipboard) throw new Error("no clipboard");
        await navigator.clipboard.writeText(url);
        A.toast("Link copiato");
      } catch {
        if (input) { input.focus(); input.select(); }
        A.toast("Copia il link manualmente");
      }
    };
    const shareBtn = body.querySelector(`#${id}-share`);
    if (shareBtn) shareBtn.onclick = async () => {
      try { await navigator.share({ title: "Meta Tracker", url }); }
      catch { /* annullato dall'utente */ }
    };
    mountQr(body, id, url);
  }

  const INSTALL_HTML = `
      <details class="invite-install" open>
        <summary><b>Installa come app</b></summary>
        <p class="small"><b>iPhone:</b> apri il link in Safari, tocca Condividi e poi “Aggiungi alla schermata Home”.</p>
        <p class="small"><b>Android:</b> apri il link in Chrome, tocca il menu ⋮ e scegli “Installa app” (o “Aggiungi a schermata Home”).</p>
      </details>`;

  const NOTE_EDIT = `<p class="warn small invite-warn">Chiunque abbia questo link può registrare partite e modificare i dati del gruppo: condividilo solo con gli amici.</p>`;
  const NOTE_VIEW = `<p class="muted small invite-warn">Chi ha questo link vede tutte le statistiche ma non può modificare nulla.</p>`;
  const NOTE_VIEW_UNAVAILABLE = `<p class="muted small">Il link di sola visione non è disponibile (database non aggiornato?)</p>`;

  // Il QR è accessorio: se la libreria non si carica si nasconde l'area.
  // `id` è il prefisso della sezione (wrap e qr hanno id derivati).
  function mountQr(body, id, url) {
    loadQr().then((ok) => {
      const wrap = body.querySelector(`#${id}-wrap`);
      const el = body.querySelector(`#${id}-qr`);
      if (!wrap || !el) return; // modal chiuso o sezione sostituita nel frattempo
      if (!ok || !window.QRCode) { wrap.hidden = true; return; }
      try {
        el.innerHTML = "";
        new window.QRCode(el, { text: url, width: 220, height: 220 });
      } catch {
        wrap.hidden = true;
      }
    });
  }

  // Modal "invita" in modalità locale o se il core non espone ancora le API di condivisione.
  function openLegacyInvite(url, local) {
    A.openModal(`
      <h2>Invita un amico</h2>
      ${local ? `<p class="muted small">Sei in <b>modalità locale</b>: questo link apre solo il sito, i dati restano in questo browser e non vengono condivisi. Per condividerli configura Supabase in <code>config.js</code>.</p>` : ""}
      ${linkBlock("invite", url, NOTE_EDIT)}
      ${INSTALL_HTML}`,
      (body) => bindLink(body, "invite", url));
  }

  // Viewer (entrato con il codice di sola visione): solo il proprio link.
  function openViewerInvite(url) {
    A.openModal(`
      <h2>Condividi in sola lettura</h2>
      <p class="muted small">Il link apre l'app in sola lettura: chi lo usa vede tutte le statistiche ma non può registrare né modificare nulla.</p>
      ${linkBlock("invite", url, NOTE_VIEW)}
      ${INSTALL_HTML}`,
      (body) => bindLink(body, "invite", url));
  }

  // Editor: due sezioni (gruppo e sola visione) con un selettore; una sola QR alla volta.
  function openEditorInvite(url) {
    let token = 0;             // invalida i render di tab precedenti
    let viewKeyP = null;       // il codice di sola visione si chiede una sola volta per apertura

    const getViewKeyOnce = () => {
      if (!viewKeyP) {
        viewKeyP = Promise.resolve()
          .then(() => A.getViewKey())
          .then((k) => k || null)
          .catch(() => null);
      }
      return viewKeyP;
    };

    A.openModal(`
      <h2>Invita un amico</h2>
      <div class="inline invite-tabs" role="tablist" style="gap:6px;margin:8px 0">
        <button class="btn primary" role="tab" aria-selected="true" data-tab="friends" id="invite-tab-friends" style="flex:1">Amici (modifica)</button>
        <button class="btn" role="tab" aria-selected="false" data-tab="view" id="invite-tab-view" style="flex:1">Solo visione</button>
      </div>
      <div id="invite-panel"></div>
      ${INSTALL_HTML}`,
      (body) => {
        const tabs = body.querySelectorAll(".invite-tabs [data-tab]");
        const panel = () => body.querySelector("#invite-panel");

        const renderFriends = (mine) => {
          const p = panel();
          if (!p || mine !== token) return;
          p.innerHTML = `
            <p class="small"><b>👥 Per gli amici del gruppo</b> — possono registrare partite e modificare</p>
            ${linkBlock("invite-friends", url, NOTE_EDIT)}`;
          bindLink(body, "invite-friends", url);
        };

        const renderView = (mine) => {
          const p = panel();
          if (!p || mine !== token) return;
          p.innerHTML = `
            <p class="small"><b>👀 Solo visione</b> — vedono tutte le statistiche ma non possono modificare nulla</p>
            <p class="muted small" id="invite-view-loading">Caricamento…</p>`;
          getViewKeyOnce().then((key) => {
            if (mine !== token) return; // l'utente ha cambiato tab nel frattempo
            const cur = panel();
            if (!cur) return;
            if (!key) {
              cur.querySelector("#invite-view-loading").outerHTML = NOTE_VIEW_UNAVAILABLE;
              return;
            }
            cur.querySelector("#invite-view-loading").remove();
            const viewUrl = keyUrl(key);
            cur.insertAdjacentHTML("beforeend", linkBlock("invite-view", viewUrl, NOTE_VIEW));
            bindLink(body, "invite-view", viewUrl);
          });
        };

        const setTab = (name) => {
          tabs.forEach((b) => {
            const on = b.dataset.tab === name;
            b.classList.toggle("primary", on);
            b.setAttribute("aria-selected", on ? "true" : "false");
          });
          const mine = ++token; // invalida eventuali render in corso
          if (name === "view") renderView(mine); else renderFriends(mine);
        };

        tabs.forEach((b) => { b.onclick = () => setTab(b.dataset.tab); });
        renderFriends(token);
      });
  }

  function openInvite() {
    const local = !A.lsGet("groupKey", "");
    const url = inviteUrl();
    const coreReady = typeof A.canEdit === "function" && typeof A.getViewKey === "function";

    if (local || !coreReady) return openLegacyInvite(url, local);
    if (!A.canEdit()) return openViewerInvite(url);
    return openEditorInvite(url);
  }

  A.mobile = { openInvite };

  // ---- 3) Icone della barra di navigazione in basso --------------------
  const svg = (paths) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
  const ICONS = {
    dashboard: svg(`<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>`),
    matchup: svg(`<path d="M5 5l14 14M19 5L5 19"/>`),
    sideboard: svg(`<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>`),
    history: svg(`<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`),
    deck: svg(`<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>`),
    opponents: svg(`<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.4 3.3-5.5 6.5-5.5s5.9 2.1 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.7c1.6.9 2.6 2.8 3 5.3"/>`),
  };

  // Icona + etichetta: l'icona è nascosta su desktop (attributo hidden),
  // mobile.css la mostra solo sui telefoni.
  document.querySelectorAll("#tabs a").forEach((a) => {
    const icon = ICONS[a.dataset.view];
    if (!icon || a.querySelector(".tab-ico")) return;
    const label = a.textContent.trim();
    a.innerHTML = `<span class="tab-ico" hidden>${icon}</span><span class="tab-lbl">${esc(label)}</span>`;
  });
})();
