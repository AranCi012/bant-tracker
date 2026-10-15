// Form per registrare / modificare un match (usato da #add e dal modal di modifica).
(() => {
  "use strict";
  const A = window.App;
  const { $, esc, today, lsGet, lsSet, S, DB, EVENTS } = A;

  function matchFormHTML(m) {
    const isEdit = !!m.id;
    const ad = A.activeVersion();
    const deckSel = isEdit ? m.decklist_id : (m.decklist_id || ad?.id || "");
    return `<form id="match-form" autocomplete="off">
      <div class="form-grid">
        <label class="field full">Avversario (archetipo)
          <div class="inline">
            <select name="archetype_id" required>
              <option value="">— scegli —</option>
              ${S.archetypes.map((a) => `<option value="${esc(a.id)}"${a.id === m.archetype_id ? " selected" : ""}>${esc(a.name)}</option>`).join("")}
            </select>
            <button type="button" class="btn" id="new-arch" title="Aggiungi archetipo">+ Nuovo</button>
          </div>
        </label>
        <div class="field full">
          <span class="small muted" style="font-weight:500">Game</span>
          <div class="games" id="games"></div>
          <div class="sb-area" id="sb-area"></div>
        </div>
        <label class="field">Giocatore
          <input name="player" list="pl-dl" value="${esc(m.player ?? S.me)}" required placeholder="Il tuo nome">
          <datalist id="pl-dl">${A.players().map((p) => `<option value="${esc(p)}">`).join("")}</datalist>
        </label>
        <label class="field">Data <input type="date" name="played_at" value="${esc(m.played_at || today())}" required></label>
        <label class="field">Evento
          <select name="event">${EVENTS.map((e) => `<option${e === (m.event ?? lsGet("lastEvent", EVENTS[0])) ? " selected" : ""}>${esc(e)}</option>`).join("")}</select>
        </label>
        <label class="field">Versione lista
          <select name="decklist_id"><option value="">—</option>${A.versions().map((d) => `<option value="${esc(d.id)}"${d.id === deckSel ? " selected" : ""}>${esc(d.name)}${d.is_active ? " (attiva)" : ""}</option>`).join("")}</select>
        </label>
        <label class="field">Nome avversario <span class="muted" style="font-weight:400">(opzionale)</span><input name="opponent" list="opp-dl" value="${esc(m.opponent || "")}" placeholder="nick MTGO, nome…"><datalist id="opp-dl">${[...new Set(S.matches.map((x) => (x.opponent || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)).map((o) => `<option value="${esc(o)}">`).join("")}</datalist></label>
        <label class="field full">Note <span class="muted" style="font-weight:400">(opzionale — se scrivi la sidata, es. “side otd: +2 priest −2 stifle”, la leggo da sola)</span><textarea name="notes" rows="2" class="notes-ta" placeholder="mulligan, carte chiave, errori, sidata…">${esc(m.notes || "")}</textarea></label>
        <div class="field full" id="notes-panel"></div>
      </div>
      <div class="row-actions" style="justify-content:space-between;align-items:center">
        <span class="result-preview" id="res-prev"></span>
        <div class="inline">
          ${isEdit ? `<button type="button" class="btn danger" id="del-match">Elimina</button>` : ""}
          <button class="btn primary" id="save-match">${isEdit ? "Salva modifiche" : "Salva partita"}</button>
        </div>
      </div>
    </form>`;
  }

  // ---------------------------------------------------------------------
  //  Editor di sideboarding (IN / OUT con stepper) — condiviso con la vista
  //  sideboard.js (A.sbEditor). Funziona inline, mai in un modal.
  //  opts: { version: () => versione|undefined, value: {in:[],out:[]},
  //          onChange(val), buttons: [{label, run(editor)}], onClose() }
  // ---------------------------------------------------------------------
  const MINUS = "−";
  const cleanList = (l) => (l || []).filter((c) => c && c.q > 0).map((c) => ({ q: c.q, name: c.name }));

  function sbSummaryHTML(sb, empty) {
    const i = cleanList(sb && sb.in), o = cleanList(sb && sb.out);
    if (!i.length && !o.length) return empty == null ? `<span class="muted small">—</span>` : empty;
    return `<span class="sb-sum">${i.map((c) => `<span class="sb-in" data-card="${esc(c.name)}">+${c.q} ${esc(c.name)}</span>`).join("")}${o.map((c) => `<span class="sb-out" data-card="${esc(c.name)}">${MINUS}${c.q} ${esc(c.name)}</span>`).join("")}</span>`;
  }

  function sbEditor(host, opts) {
    const st = { in: new Map(), out: new Map() };
    const load = (v) => { st.in = A.listMap(cleanList(v && v.in)); st.out = A.listMap(cleanList(v && v.out)); };
    load(opts.value);
    const src = (side) => {
      const v = opts.version && opts.version();
      return v ? A.listMap(A.parseList(side === "in" ? v.sideboard : v.maindeck)) : new Map();
    };
    const api = {
      get: () => ({ in: [...st.in.values()].filter((c) => c.q > 0).map((c) => ({ q: c.q, name: c.name })), out: [...st.out.values()].filter((c) => c.q > 0).map((c) => ({ q: c.q, name: c.name })) }),
      set(v) { load(v); render(); notify(); },
    };
    const notify = () => opts.onChange && opts.onChange(api.get());

    function col(side) {
      const s = src(side), cur = st[side];
      const keys = [...s.keys(), ...[...cur.keys()].filter((k) => !s.has(k))];
      const total = [...cur.values()].reduce((a, c) => a + c.q, 0);
      const rows = keys.map((k) => {
        const sc = s.get(k), c = cur.get(k), q = c ? c.q : 0, name = (sc || c).name, max = sc ? sc.q : 99;
        return `<div class="sbe-row${q ? " on" : ""}">
          <span class="sbe-name" data-card="${esc(name)}">${esc(name)}${sc ? "" : ` <em class="muted">(extra)</em>`}</span>
          <span class="sbe-max">${sc ? "/" + max : ""}</span>
          <span class="sbe-step">
            <button type="button" data-act="dec" data-side="${side}" data-k="${esc(k)}" aria-label="Meno"${q ? "" : " disabled"}>${MINUS}</button>
            <b>${q}</b>
            <button type="button" data-act="inc" data-side="${side}" data-k="${esc(k)}" aria-label="Più"${q >= max ? " disabled" : ""}>+</button>
          </span></div>`;
      }).join("");
      return `<div class="sbe-col ${side}">
        <h4>${side === "in" ? "IN (dalla sideboard)" : "OUT (dal main)"} <span class="num">${total}</span></h4>
        <div class="sbe-list">${rows || `<p class="muted small" style="margin:4px 0">${opts.version && opts.version() ? "Nessuna carta in lista." : "Nessuna lista collegata: aggiungi le carte a mano."}</p>`}</div>
        <div class="sbe-add"><input data-add="${side}" placeholder="Altra carta…" autocomplete="off"><button type="button" class="btn" data-act="add" data-side="${side}">+ Aggiungi</button></div>
      </div>`;
    }
    function render() {
      const inN = [...st.in.values()].reduce((a, c) => a + c.q, 0), outN = [...st.out.values()].reduce((a, c) => a + c.q, 0);
      const btns = (opts.buttons || []).map((b, i) => `<button type="button" class="btn" data-act="custom" data-i="${i}">${esc(b.label)}</button>`).join("");
      host.innerHTML = `<div class="sbe">
        <div class="sbe-cols">${col("in")}${col("out")}</div>
        ${inN !== outN ? `<p class="small warn" style="margin:6px 0">Attenzione: ${inN} IN ma ${outN} OUT.</p>` : ""}
        <div class="sbe-actions">${btns}<button type="button" class="btn" data-act="clear">Svuota</button>${opts.onClose ? `<button type="button" class="btn primary" data-act="close">Chiudi</button>` : ""}</div>
      </div>`;
      if (A.cards && A.cards.bindHover) A.cards.bindHover(host);
    }
    function add(side) {
      const inp = host.querySelector(`input[data-add="${side}"]`);
      const name = inp ? inp.value.trim().replace(/\s+/g, " ") : "";
      if (!name) return;
      const k = A.cardKey(name), s = src(side).get(k), cur = st[side].get(k);
      if (cur) { if (cur.q < (s ? s.q : 99)) cur.q++; }
      else st[side].set(k, { name: s ? s.name : name, q: 1 });
      render(); notify();
    }
    host.onclick = (e) => {
      const b = e.target.closest("button[data-act]"); if (!b || b.disabled || !host.contains(b)) return;
      const act = b.dataset.act, side = b.dataset.side, k = b.dataset.k;
      if (act === "inc" || act === "dec") {
        const s = src(side).get(k), cur = st[side].get(k);
        if (act === "inc") { const max = s ? s.q : 99; if (cur) { if (cur.q < max) cur.q++; } else st[side].set(k, { name: s.name, q: 1 }); }
        else if (cur) { cur.q--; if (cur.q <= 0) st[side].delete(k); }
        render(); notify();
      } else if (act === "add") add(side);
      else if (act === "clear") { st.in.clear(); st.out.clear(); render(); notify(); }
      else if (act === "close") opts.onClose && opts.onClose();
      else if (act === "custom") { const c = (opts.buttons || [])[+b.dataset.i]; if (c) c.run(api); }
    };
    host.onkeydown = (e) => {
      if (e.key === "Enter" && e.target.matches("input[data-add]")) { e.preventDefault(); add(e.target.dataset.add); }
    };
    render();
    return api;
  }

  // Sideboarding previsto dalla guida per (archetipo, play/draw)
  function guideSb(archId, play) {
    const g = archId ? A.guideFor(archId) : null;
    if (!g || play == null) return { in: [], out: [] };
    return { in: A.parseList(play ? g.play_in : g.draw_in), out: A.parseList(play ? g.play_out : g.draw_out) };
  }

  function bindMatchForm(root, m, onSaved) {
    const form = $("#match-form", root);
    // Stato delle game: r = W/L/D/null, p = true (play) / false (draw), auto = calcolato
    const G = [
      { r: m.g1 || null, p: m.p1 ?? true, auto: false },
      { r: m.g2 || null, p: m.p2 ?? null, auto: m.p2 == null },
      { r: m.g3 || null, p: m.p3 ?? null, auto: m.p3 == null },
    ];
    // Regola: chi perde la game precedente sceglie e va on the play; dopo un pareggio sceglie di nuovo lo stesso giocatore.
    const nextPlay = (prev) => (prev.r === "L" ? true : prev.r === "W" ? false : prev.p);
    // Sideboarding di G2/G3 (indici 1 e 2). manual = modificato a mano: la guida non lo sovrascrive.
    // touched = modificato a mano in questa sessione; notes = valori arrivati dall'interprete delle note ("dalle note")
    const mkSb = (sb) => ({ in: cleanList(sb && sb.in), out: cleanList(sb && sb.out), manual: !!m.id, orig: !!sb, open: false, touched: false, notes: false });
    const SB = [null, mkSb(m.sb2), mkSb(m.sb3)];
    function applyGuide() {
      for (let i = 1; i < 3; i++) {
        if (SB[i].manual || SB[i].notes) continue;
        const g = guideSb(form.archetype_id.value, G[i].p);
        SB[i].in = g.in; SB[i].out = g.out;
      }
    }
    // ---- Sidate dalle note ------------------------------------------------
    const NP = { res: null, prop: {}, undo: {}, suppress: null };
    const fakeMatch = () => ({ g1: G[0].r, p1: G[0].p, g2: G[1].r, p2: G[1].p, g3: G[2].r, p3: G[2].p });
    const sbKey = (v) => JSON.stringify([cleanList(v.in).map((c) => [c.q, c.name]), cleanList(v.out).map((c) => [c.q, c.name])]);
    const confOk = () => !!NP.res && (NP.res.confidence === "alta" || NP.res.confidence === "media");
    function putNotes(i, p) {
      const s = SB[i];
      if (!NP.undo[i]) NP.undo[i] = { in: s.in, out: s.out };
      s.in = cleanList(p.in); s.out = cleanList(p.out); s.notes = true;
    }
    function dropNotes(i) {
      const s = SB[i], u = NP.undo[i];
      s.notes = false; delete NP.undo[i];
      if (s.manual) { s.in = u ? u.in : []; s.out = u ? u.out : []; }
    }
    function notesSync() {
      const text = form.notes.value.trim();
      const ver = A.versionById(form.decklist_id.value);
      NP.res = text && A.notes ? A.notes.parse(text, { version: ver, aliases: A.aliases() }) : null;
      NP.prop = NP.res ? A.notes.forMatch(fakeMatch(), NP.res) : {};
      const auto = confOk() && NP.suppress !== text;
      for (const i of [1, 2]) {
        const p = NP.prop["sb" + (i + 1)], s = SB[i];
        if (s.notes) { if (G[i].r && p && auto) putNotes(i, p); else dropNotes(i); }
        else if (G[i].r && p && auto && !s.touched && !s.orig) putNotes(i, p);
      }
    }
    function renderNotesPanel() {
      const el = $("#notes-panel", root), r = NP.res;
      if (!el) return;
      if (!r || (r.confidence === "nessuna" && !r.unknown.length)) { el.innerHTML = ""; return; }
      const ver = A.versionById(form.decklist_id.value);
      const lines = [1, 2].filter((i) => G[i].r && NP.prop["sb" + (i + 1)]).map((i) => `<span class="np-g"><b>G${i + 1}</b> ${sbSummaryHTML(NP.prop["sb" + (i + 1)])}</span>`);
      if (!lines.length && r.plans.length) r.plans.forEach((p) => lines.push(`<span class="np-g"><b>${p.side === "play" ? "Play" : p.side === "draw" ? "Draw" : "Tutte"}</b> ${sbSummaryHTML(p)}</span>`));
      if (r.keep.length) lines.push(`<span class="np-g"><b>Tieni</b> ${r.keep.map((n) => `<span class="sb-in" data-card="${esc(n)}">${esc(n)}</span>`).join("")}</span>`);
      const names = ver ? [...A.listMap([...A.parseList(ver.maindeck), ...A.parseList(ver.sideboard)]).values()].map((c) => c.name).sort((a, b) => a.localeCompare(b)) : [];
      const teach = r.unknown.map((w) => `<span class="np-unk"><b>${esc(w)}</b> →
        ${names.length ? `<select><option value="">— carta —</option>${names.map((n) => `<option>${esc(n)}</option>`).join("")}</select>` : `<input placeholder="Nome carta">`}
        <button type="button" class="btn sm" data-act="teach" data-w="${esc(w)}">Insegna soprannome</button></span>`).join("");
      const applied = SB.some((s, i) => i && s.notes), canApply = [1, 2].some((i) => NP.prop["sb" + (i + 1)] && !(SB[i].notes && sbKey(NP.prop["sb" + (i + 1)]) === sbKey(SB[i])));
      el.innerHTML = `<div class="notes-panel">
        <div class="np-head"><span>📝 <b>Dalle note</b></span><span class="np-conf c-${esc(r.confidence)}">confidenza ${esc(r.confidence)}</span></div>
        ${lines.length ? `<div class="np-lines">${lines.join("")}</div>` : ""}
        ${r.warnings.length ? `<div class="warn">${r.warnings.map(esc).join("<br>")}</div>` : ""}
        ${teach ? `<div class="np-teach"><span class="muted small">Parole non riconosciute:</span>${teach}</div>` : ""}
        <div class="np-actions">${canApply ? `<button type="button" class="btn sm primary" data-act="apply">Applica</button>` : ""}${applied ? `<button type="button" class="btn sm" data-act="undo">Annulla</button>` : ""}</div>
      </div>`;
      if (A.cards && A.cards.bindHover) A.cards.bindHover(el);
    }
    $("#notes-panel", root).addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]"); if (!b) return;
      if (b.dataset.act === "apply") {
        for (const i of [1, 2]) { const p = NP.prop["sb" + (i + 1)]; if (G[i].r && p) putNotes(i, p); }
        NP.suppress = null; render();
      } else if (b.dataset.act === "undo") {
        for (const i of [1, 2]) if (SB[i].notes) dropNotes(i);
        NP.suppress = form.notes.value.trim(); render();
      } else if (b.dataset.act === "teach") {
        const card = (b.closest(".np-unk").querySelector("select,input").value || "").trim();
        if (!card) { A.toast("Scegli la carta"); return; }
        A.guard(async () => { await A.saveAliases({ ...A.aliases(), [b.dataset.w]: card }); A.toast(`“${b.dataset.w}” = ${card}`); render(); });
      }
    });
    let npTimer;
    form.notes.addEventListener("input", () => { clearTimeout(npTimer); npTimer = setTimeout(render, 400); });

    function renderSB() {
      const area = $("#sb-area", root);
      area.innerHTML = [1, 2].map((i) => (G[i].r ? `<div class="sb-box" data-sbi="${i}">
        <div class="sb-line"><span class="small muted"><b>G${i + 1}</b> Sideboard:</span>${SB[i].notes ? `<span class="nb-badge" title="Proposta dall'interprete delle note">dalle note</span>` : ""}
          <span data-sbsum>${sbSummaryHTML(SB[i], `<span class="muted small">Nessuna sidata registrata</span>`)}</span>
          <button type="button" class="btn sm" data-sbtoggle="${i}">${SB[i].open ? "Chiudi" : (SB[i].in.length || SB[i].out.length ? "Modifica" : "Aggiungi")}</button></div>
        <div class="sb-panel"${SB[i].open ? "" : " hidden"}></div></div>` : "")).join("");
      for (const i of [1, 2]) {
        const box = area.querySelector(`[data-sbi="${i}"]`);
        if (!box || !SB[i].open) continue;
        const side = G[i].p === false ? "draw" : "play";
        const buttons = [{ label: `Usa guida (${side})`, run(ed) { const g = guideSb(form.archetype_id.value, G[i].p); ed.set(g); SB[i].manual = false; SB[i].notes = false; delete NP.undo[i]; } }];
        if (i === 2) buttons.push({ label: "Uguale a G2", run(ed) { ed.set({ in: SB[1].in, out: SB[1].out }); } });
        sbEditor(box.querySelector(".sb-panel"), {
          version: () => A.versionById(form.decklist_id.value),
          value: SB[i],
          buttons,
          onChange(v) {
            SB[i].in = v.in; SB[i].out = v.out; SB[i].manual = true; SB[i].touched = true; if (SB[i].notes) { SB[i].notes = false; delete NP.undo[i]; box.querySelector(".nb-badge")?.remove(); }
            box.querySelector("[data-sbsum]").innerHTML = sbSummaryHTML(SB[i], `<span class="muted small">Nessuna sidata registrata</span>`);
          },
          onClose() { SB[i].open = false; renderSB(); },
        });
      }
    }
    $("#sb-area", root).addEventListener("click", (e) => {
      const b = e.target.closest("[data-sbtoggle]"); if (!b) return;
      const i = +b.dataset.sbtoggle; SB[i].open = !SB[i].open; renderSB();
    });
    form.decklist_id.addEventListener("change", render);
    form.archetype_id.addEventListener("change", () => {
      for (let i = 1; i < 3; i++) if (!SB[i].orig) SB[i].manual = false;
      render();
    });

    function recompute() {
      for (let i = 1; i < 3; i++) if (G[i].auto) G[i].p = G[i - 1].r ? nextPlay(G[i - 1]) : null;
    }
    function needed(i) {
      if (i === 0) return true;
      if (i === 1) return !!G[0].r;
      const w = [G[0].r, G[1].r].filter((r) => r === "W").length, l = [G[0].r, G[1].r].filter((r) => r === "L").length;
      return !!G[1].r && !(w === 2 || l === 2);
    }
    function render() {
      recompute();
      // Se una game non serve più (es. 2-0), azzera le successive
      for (let i = 1; i < 3; i++) if (!needed(i)) G[i].r = null;
      $("#games", root).innerHTML = G.map((g, i) => {
        const on = needed(i);
        return `<div class="game-row${on ? "" : " off"}">
          <span class="gname">G${i + 1}</span>
          <div class="seg" data-g="${i}">
            ${["W", "L", "D"].map((v) => `<button type="button" data-v="${v}" class="${g.r === v ? "on" : ""}"${on ? "" : " disabled"}>${v === "W" ? "Vinta" : v === "L" ? "Persa" : "Pari"}</button>`).join("")}
            ${i > 0 ? `<button type="button" data-v="" class="${!g.r ? "on" : ""}"${on ? "" : " disabled"} title="Non giocata">—</button>` : ""}
          </div>
          <div class="seg" data-gp="${i}">
            <button type="button" data-p="1" class="${g.p === true ? "on" : ""}"${on ? "" : " disabled"}>Play</button>
            <button type="button" data-p="0" class="${g.p === false ? "on" : ""}"${on ? "" : " disabled"}>Draw</button>
          </div>
        </div>`;
      }).join("") + `<span class="muted small">Play/draw di G2 e G3 si compilano da soli (chi perde va on the play): correggili se serve.</span>`;
      notesSync();
      applyGuide();
      renderSB();
      renderNotesPanel();
      const fake = { g1: G[0].r, g2: G[1].r, g3: G[2].r };
      const gs = A.gamesOf(fake);
      const prev = $("#res-prev", root);
      if (!gs.length) prev.textContent = "";
      else {
        const r = A.matchResult(fake), w = gs.filter((x) => x.r === "W").length, l = gs.filter((x) => x.r === "L").length;
        prev.innerHTML = `<span class="pill ${r}">${r === "W" ? "Vinto" : r === "L" ? "Perso" : "Pareggio"} ${w}-${l}</span>`;
      }
    }
    $("#games", root).addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b || b.disabled) return;
      const seg = b.parentElement;
      if (seg.dataset.g != null) { G[+seg.dataset.g].r = b.dataset.v || null; }
      if (seg.dataset.gp != null) { const i = +seg.dataset.gp; G[i].p = b.dataset.p === "1"; G[i].auto = false; }
      render();
    });
    render();

    $("#new-arch", root).onclick = () => {
      const name = prompt("Nome del nuovo archetipo:");
      if (!name || !name.trim()) return;
      A.guard(async () => {
        const ex = S.archetypes.find((a) => a.name.toLowerCase() === name.trim().toLowerCase());
        const a = ex || (await DB.insert("archetypes", { name: A.archName(name), sideboard_plan: "", notes: "" }));
        if (!ex) { S.archetypes.push(a); S.archetypes.sort((x, y) => x.name.localeCompare(y.name)); }
        const sel = form.archetype_id;
        sel.innerHTML = `<option value="">— scegli —</option>` + S.archetypes.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("");
        sel.value = a.id;
        sel.dispatchEvent(new Event("change"));
      });
    };

    const del = $("#del-match", root);
    if (del) del.onclick = () => {
      if (!confirm("Eliminare questo match?")) return;
      A.guard(async () => { await DB.remove("matches", m.id); S.matches = S.matches.filter((x) => x.id !== m.id); A.toast("Match eliminato"); onSaved(); });
    };

    form.onsubmit = (e) => {
      e.preventDefault();
      if (!G[0].r) { A.toast("Indica almeno il risultato di G1"); return; }
      if (!form.archetype_id.value) { A.toast("Scegli l'archetipo avversario"); return; }
      const row = {
        deck_id: m.deck_id || A.currentDeck().id,
        archetype_id: form.archetype_id.value,
        player: A.titleName(form.player.value),
        played_at: form.played_at.value,
        event: form.event.value,
        decklist_id: form.decklist_id.value || null,
        opponent: form.opponent.value.trim(),
        notes: form.notes.value.trim(),
        g1: G[0].r, p1: G[0].p,
        g2: G[1].r, p2: G[1].r ? G[1].p : null,
        g3: G[2].r, p3: G[2].r ? G[2].p : null,
        sb2: G[1].r && (SB[1].in.length || SB[1].out.length) ? { in: cleanList(SB[1].in), out: cleanList(SB[1].out) } : null,
        sb3: G[2].r && (SB[2].in.length || SB[2].out.length) ? { in: cleanList(SB[2].in), out: cleanList(SB[2].out) } : null,
      };
      if (!row.player) { A.toast("Scrivi il nome del giocatore"); return; }
      $("#save-match", root).disabled = true;
      A.guard(async () => {
        if (m.id) {
          const u = await DB.update("matches", m.id, row);
          S.matches = S.matches.map((x) => (x.id === m.id ? u : x));
        } else {
          S.matches.push(await DB.insert("matches", row));
        }
        if (!S.me) { S.me = row.player; lsSet("me", S.me); A.renderWho(); }
        lsSet("lastEvent", row.event);
        const a = A.archById(row.archetype_id);
        A.toast(m.id ? "Match aggiornato" : `Salvato: ${A.matchResult(row) === "W" ? "vittoria" : A.matchResult(row) === "L" ? "sconfitta" : "pareggio"} vs ${a ? a.name : ""}`);
        onSaved();
      }).finally(() => { const b = $("#save-match", root); if (b) b.disabled = false; });
    };
  }

  function viewAdd(root, archId) {
    const draft = { archetype_id: archId || "" };
    root.innerHTML = `<div style="max-width:720px;margin:0 auto">
      <div class="page-head"><h1>Registra partita</h1></div>
      <div class="card">${matchFormHTML(draft)}</div>
      <p class="muted small">Dopo il salvataggio il form resta aperto per registrare subito la prossima.</p></div>`;
    bindMatchForm(root, draft, () => viewAdd(root));
  }

  A.sbEditor = sbEditor;
  A.sbSummaryHTML = sbSummaryHTML;
  A.guideSb = guideSb;
  A.matchFormHTML = matchFormHTML;
  A.bindMatchForm = bindMatchForm;
  A.views.add = viewAdd;
})();
