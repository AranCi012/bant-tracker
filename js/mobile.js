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

  function inviteUrl() {
    const key = A.lsGet("groupKey", "");
    const base = location.origin + location.pathname;
    return key ? base + INVITE_PREFIX + encodeURIComponent(key) : base;
  }

  function openInvite() {
    const local = !A.lsGet("groupKey", "");
    const url = inviteUrl();
    const canShare = typeof navigator.share === "function";

    A.openModal(`
      <h2>Invita un amico</h2>
      ${local ? `<p class="muted small">Sei in <b>modalità locale</b>: questo link apre solo il sito, i dati restano in questo browser e non vengono condivisi. Per condividerli configura Supabase in <code>config.js</code>.</p>` : ""}
      <div id="invite-qr-wrap" style="text-align:center;margin:8px 0">
        <div id="invite-qr" style="display:flex;justify-content:center;min-height:220px" aria-label="QR code del link"></div>
      </div>
      <label class="field full" style="margin-top:12px">Link
        <input id="invite-url" type="text" readonly value="${esc(url)}" onfocus="this.select()">
      </label>
      <div class="inline invite-actions">
        <button class="btn primary" id="invite-copy">Copia link</button>
        ${canShare ? `<button class="btn" id="invite-share">Condividi</button>` : ""}
      </div>
      <p class="warn small invite-warn">Chiunque abbia questo link può vedere e modificare i dati del gruppo: condividilo solo con gli amici.</p>
      <details class="invite-install" open>
        <summary><b>Installa come app</b></summary>
        <p class="small"><b>iPhone:</b> apri il link in Safari, tocca Condividi e poi “Aggiungi alla schermata Home”.</p>
        <p class="small"><b>Android:</b> apri il link in Chrome, tocca il menu ⋮ e scegli “Installa app” (o “Aggiungi a schermata Home”).</p>
      </details>`,
      (body) => {
        const input = body.querySelector("#invite-url");
        body.querySelector("#invite-copy").onclick = async () => {
          try {
            if (!navigator.clipboard) throw new Error("no clipboard");
            await navigator.clipboard.writeText(url);
            A.toast("Link copiato");
          } catch {
            input.focus(); input.select();
            A.toast("Copia il link manualmente");
          }
        };
        const shareBtn = body.querySelector("#invite-share");
        if (shareBtn) shareBtn.onclick = async () => {
          try { await navigator.share({ title: "Meta Tracker", url }); }
          catch { /* annullato dall'utente */ }
        };
        mountQr(body, url);
      });
  }

  // Il QR è accessorio: se la libreria non si carica si nasconde l'area.
  function mountQr(body, url) {
    loadQr().then((ok) => {
      const wrap = body.querySelector("#invite-qr-wrap");
      const el = body.querySelector("#invite-qr");
      if (!wrap || !el) return; // modal chiuso nel frattempo
      if (!ok || !window.QRCode) { wrap.hidden = true; return; }
      try {
        el.innerHTML = "";
        new window.QRCode(el, { text: url, width: 220, height: 220 });
      } catch {
        wrap.hidden = true;
      }
    });
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
