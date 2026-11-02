// Giocatori avversari: raggruppa i match per nome dell'avversario (m.opponent) e mostra le statistiche contro ciascuno.
// Route: #players = elenco, #players/<encodeURIComponent(key)> = dettaglio.
(() => {
  "use strict";
  const A = window.App;
  const { $, $$, esc, pct, fmtDate } = A;

  const CSS = `
.pl-top { margin: 0 0 12px; }
.seg a { display: inline-block; padding: 8px 14px; min-width: 44px; text-align: center; font-weight: 600; color: var(--text); text-decoration: none; }
.seg a + a { border-left: 1px solid var(--border); }
.seg a.on { background: var(--text); color: var(--surface); }
.seg a:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.pl-bar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin: 0 0 10px; }
.pl-search { min-width: 220px; max-width: 100%; }
.pl-table td.cell { text-align: center; font-weight: 700; min-width: 84px; }
.pl-table td.cell small { display: block; font-weight: 500; font-size: .72rem; opacity: .85; }
.pl-table td.cell.empty { color: var(--text-3); background: transparent; font-weight: 400; }
.pl-table td.cell.low { background-image: repeating-linear-gradient(45deg, transparent 0 5px, rgba(127,127,127,.18) 5px 6px); }
.pl-table .pl-name a { color: var(--accent); font-weight: 700; text-decoration: none; }
.pl-table .pl-name a:hover { text-decoration: underline; }
.pl-table tr.click { cursor: pointer; }
.pl-table tr.click:hover td { background: var(--surface-2); }
.pl-table tr[hidden] { display: none !important; }
.pl-small { font-size: .8rem; }
.pl-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.pl-chip { display: inline-block; font-size: .8rem; padding: 2px 8px; border-radius: 999px; background: var(--surface-2); color: var(--text-2); border: 1px solid var(--border); white-space: nowrap; }
.pl-chip b { color: var(--accent); }
.pl-low { opacity: .75; }
.pl-note { margin: 0 0 12px; }
.pl-back { display: inline-block; margin-bottom: 4px; }
/* Bravura dei giocatori avversari */
.rt-intro { margin: 0 0 10px; }
.rt-filters { gap: 6px; }
.rt-chip { font: inherit; font-size: .85rem; padding: 6px 12px; min-height: 36px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--text-2); cursor: pointer; white-space: nowrap; }
.rt-chip b { font-weight: 600; opacity: .8; }
.rt-chip.on { background: var(--text); color: var(--surface); border-color: var(--text); }
.rt-chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.rt-count { margin-left: auto; font-size: .85rem; }
.rt-badge { display: inline-block; font-size: .78rem; font-weight: 700; padding: 2px 9px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text-2); white-space: nowrap; }
.rt-badge.rt-forte { color: var(--win); border-color: color-mix(in srgb, var(--win) 40%, transparent); background: color-mix(in srgb, var(--win) 14%, transparent); }
.rt-badge.rt-scarso { color: var(--loss); border-color: color-mix(in srgb, var(--loss) 40%, transparent); background: color-mix(in srgb, var(--loss) 12%, transparent); }
.rt-badge.rt-none { color: var(--text-3); background: transparent; font-weight: 600; }
.rt-seg { display: inline-flex; max-width: 100%; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--surface); }
.rt-seg button { font: inherit; font-size: .8rem; font-weight: 600; padding: 6px 8px; min-width: 40px; min-height: 36px; border: 0; background: transparent; color: var(--text-2); cursor: pointer; white-space: nowrap; }
.rt-seg button + button { border-left: 1px solid var(--border); }
.rt-seg button:hover { background: var(--surface-2); }
.rt-seg button.on { background: var(--text); color: var(--surface); }
.rt-seg button.on.rt-forte { background: var(--win); color: #fff; }
.rt-seg button.on.rt-scarso { background: var(--loss); color: #fff; }
.rt-seg button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.rt-card { display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; }
.rt-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }
.rt-label { font-weight: 700; color: var(--text-2); font-size: .9rem; }
.rt-hint { margin: 0; }
.rt-notes { width: 100%; box-sizing: border-box; min-height: 72px; font-family: inherit; font-size: .95rem; }
.rt-notes-row { display: flex; justify-content: flex-end; gap: 8px; }
.rt-ro { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--surface-2); border-radius: 8px; padding: 8px 10px; margin: 0; }
@media (max-width: 640px) {
  .pl-search { min-width: 0; width: 100%; }
  .pl-table, .pl-table tbody { display: block; width: 100%; }
  .pl-table thead { display: none; }
  .pl-table tr { display: block; margin-bottom: 10px; padding: 6px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; }
  .pl-table tr.click:hover td { background: transparent; }
  .pl-table td { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--border); text-align: right; white-space: normal; max-width: none; }
  .pl-table td:last-child { border-bottom: 0; }
  .pl-table td::before { content: attr(data-label); flex-shrink: 0; text-align: left; font-size: .8rem; font-weight: 600; color: var(--text-2); }
  .pl-table td.pl-name { display: block; text-align: left; font-size: 1.05rem; padding-bottom: 8px; }
  .pl-table td.pl-name::before { display: none; }
  .pl-table td.cell { border-radius: 8px; padding: 6px 10px; margin: 4px 0; border-bottom: 0; }
  .pl-table td.cell small { display: inline; margin-left: 6px; }
  .pl-chips { justify-content: flex-end; }
  .pl-table td.pl-chipcell { flex-wrap: wrap; }
  .pl-table td.rt-cell { align-items: center; }
  .rt-seg button { padding: 6px 7px; min-height: 40px; }
  .rt-count { margin-left: 0; width: 100%; }
}
@media (max-width: 560px) {
  .seg a { flex: 1; }
}
`;
  function injectCss() {
    if (document.getElementById("players-style")) return;
    const s = document.createElement("style");
    s.id = "players-style";
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  injectCss();

  // ---- Identità -----------------------------------------------------------
  const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  const keyOf = (s) => clean(s).toLowerCase();
  const archName = (id) => { const a = A.archById(id); return a ? a.name : "?"; };
  const withLabel = (cellHtml, label) => cellHtml.replace("<td ", `<td data-label="${esc(label)}" `);

  // Grafia più frequente di un nome (a parità, ordine alfabetico)
  function topSpelling(spell) {
    return [...spell.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  }

  // Raggruppa i match con nome avversario per chiave normalizzata
  function groupPlayers(ms) {
    const map = new Map();
    for (const m of ms) {
      const name = clean(m.opponent);
      if (!name) continue;
      const k = name.toLowerCase();
      if (!map.has(k)) map.set(k, { key: k, spell: new Map(), ms: [] });
      const g = map.get(k);
      g.ms.push(m);
      g.spell.set(name, (g.spell.get(name) || 0) + 1);
    }
    return [...map.values()].map((g) => ({ key: g.key, name: topSpelling(g.spell), ms: g.ms }));
  }

  const recordShort = (s) => `${s.W}–${s.L}${s.D ? `–${s.D}` : ""}`;
  const lastDate = (ms) => ms.reduce((acc, m) => ((m.played_at || "") > acc ? m.played_at : acc), "");

  function archChips(ms) {
    const c = new Map();
    for (const m of ms) c.set(m.archetype_id, (c.get(m.archetype_id) || 0) + 1);
    return [...c.entries()]
      .sort((a, b) => b[1] - a[1] || archName(a[0]).localeCompare(archName(b[0])))
      .map(([id, n]) => `<span class="pl-chip">${esc(archName(id))} <b>×${n}</b></span>`)
      .join("");
  }

  // ---- Bravura (-1 scarso, 0 medio, 1 forte, null = non valutato) ---------
  const RT = [
    { v: 1, label: "Forte", cls: "forte" },
    { v: 0, label: "Medio", cls: "medio" },
    { v: -1, label: "Scarso", cls: "scarso" },
  ];
  const ratingOf = (name) => { const r = A.oppRating(name); return r == null || r === "" ? null : Number(r); };
  const notesOf = (name) => {
    const k = A.oppKey(name);
    const row = A.S.oppRatings.find((x) => x.key === k);
    return row && row.notes ? String(row.notes) : "";
  };
  const ratingBadge = (r) => {
    const x = RT.find((y) => y.v === r);
    return x ? `<span class="rt-badge rt-${x.cls}">${x.label}</span>` : `<span class="rt-badge rt-none" title="Non valutato">—</span>`;
  };
  // Controllo segmentato (solo per chi può modificare)
  const ratingControl = (name, r) => `<div class="rt-seg" role="group" aria-label="Bravura di ${esc(name)}" data-name="${esc(name)}" data-cur="${r == null ? "" : r}">
    ${RT.map((x) => `<button type="button" class="rt-${x.cls}${r === x.v ? " on" : ""}" data-r="${x.v}" aria-pressed="${r === x.v}">${x.label}</button>`).join("")}
    <button type="button" class="rt-none${r == null ? " on" : ""}" data-r="" aria-pressed="${r == null}" title="Non valutato">—</button>
  </div>`;

  // Salva la bravura (null = togli). Con conferma se si cancellano anche le note. Poi ridisegna.
  function saveRating(name, next, redraw) {
    if (!A.canEdit()) { A.toast("Sola lettura: non puoi modificare"); return; }
    if (next == null && notesOf(name) && !window.confirm("Togliere la bravura cancella anche le note. Continuare?")) return;
    A.guard(async () => { await A.saveOppRating(name, next); A.toast("Salvato"); redraw(); });
  }
  function bindRating(root, redraw) {
    $$(".rt-seg", root).forEach((seg) => $$("button", seg).forEach((b) => (b.onclick = (e) => {
      e.stopPropagation();
      const next = b.dataset.r === "" ? null : Number(b.dataset.r);
      if (String(next ?? "") === seg.dataset.cur) return;
      saveRating(seg.dataset.name, next, redraw);
    })));
  }

  // ---- Elenco ---------------------------------------------------------------
  // Filtri della lista: conservati tra un ridisegno e l'altro
  let rtFilter = "all"; // all | 1 | 0 | -1 | none
  let plQ = "";

  function viewList(root) {
    const all = A.deckMatches();
    const ms = A.filtered();
    const groups = groupPlayers(ms)
      .map((g) => ({ ...g, s: A.stats(g.ms), r: ratingOf(g.name) }))
      .sort((x, y) => y.s.n - x.s.n || x.name.localeCompare(y.name));
    const unnamed = ms.filter((m) => !clean(m.opponent)).length;
    const anyNamed = all.some((m) => clean(m.opponent));

    const cnt = { all: groups.length, "1": 0, "0": 0, "-1": 0, none: 0 };
    for (const g of groups) { if (g.r == null) cnt.none++; else cnt[String(g.r)]++; }
    const rated = groups.length - cnt.none;
    const shown = groups.filter((g) => rtFilter === "all" || (rtFilter === "none" ? g.r == null : g.r === Number(rtFilter)));
    const editable = A.canEdit();

    const chips = [["all", "Tutti", cnt.all], ["1", "Forti", cnt["1"]], ["0", "Medi", cnt["0"]], ["-1", "Scarsi", cnt["-1"]], ["none", "Non valutati", cnt.none]];
    const chipsHtml = chips.map(([k, label, n]) => `<button type="button" class="rt-chip${rtFilter === k ? " on" : ""}" data-rf="${k}" aria-pressed="${rtFilter === k}">${label} <b>${n}</b></button>`).join("");
    const ratedTxt = `${rated} ${rated === 1 ? "avversario valutato" : "avversari valutati"} su ${groups.length}`;

    const body = !anyNamed
      ? `<div class="card empty-state"><p>Nessun nome avversario registrato.</p>
          <p class="muted small">Apri un match dallo Storico e compila il campo “Nome avversario” (nick MTGO o nome): qui vedrai ogni avversario con le statistiche contro di lui.</p>
          <a class="btn" href="#history">Vai allo Storico</a></div>`
      : `<div class="card">
          <p class="muted rt-intro">Indica quanto è forte ogni avversario: le statistiche delle sidate peseranno di più le vittorie contro i forti e le sconfitte contro gli scarsi.</p>
          <div class="pl-bar"><input type="search" id="pl-q" class="pl-search" placeholder="Cerca giocatore…" aria-label="Cerca giocatore" autocomplete="off" value="${esc(plQ)}"></div>
          <div class="pl-bar rt-filters" role="group" aria-label="Filtra per bravura">${chipsHtml}<span class="muted rt-count" id="rt-count">${ratedTxt}</span></div>
          ${shown.length ? `<div class="table-wrap"><table class="pl-table">
            <thead><tr><th>Giocatore</th><th>Bravura</th><th class="r">Match</th><th class="r">V–P</th><th style="text-align:center">Win rate</th><th>Mazzi giocati</th><th>Ultima volta</th><th>Incontrato da</th></tr></thead>
            <tbody>${shown.map((g) => {
              const low = g.s.n < A.LOW_N;
              const href = `#players/${encodeURIComponent(g.key)}`;
              const ours = [...new Set(g.ms.map((m) => m.player).filter(Boolean))].sort((a, b) => a.localeCompare(b));
              return `<tr class="click pl-row" data-search="${esc(g.key)}" data-href="${esc(href)}">
                <td class="pl-name" data-label="Giocatore"><a href="${esc(href)}">${esc(g.name)}</a></td>
                <td class="rt-cell" data-label="Bravura">${editable ? ratingControl(g.name, g.r) : ratingBadge(g.r)}</td>
                <td class="r num" data-label="Match">${g.s.n}${low ? ` <span class="muted small">pochi dati</span>` : ""}</td>
                <td class="r num" data-label="V–P">${recordShort(g.s)}</td>
                ${withLabel(A.heatCell(g.s.wr, g.s.W, g.s.n, g.name, A.record(g.s), g.s.n), "Win rate")}
                <td class="pl-chipcell" data-label="Mazzi giocati"><div class="pl-chips">${archChips(g.ms)}</div></td>
                <td class="num" data-label="Ultima volta">${fmtDate(lastDate(g.ms)) || "—"}</td>
                <td class="small" data-label="Incontrato da">${ours.length ? ours.map(esc).join(", ") : "—"}</td>
              </tr>`;
            }).join("")}</tbody></table></div>
            <p class="muted" id="pl-nores" hidden>Nessun giocatore corrisponde alla ricerca.</p>`
          : `<p class="muted">Nessun giocatore con questi filtri.</p>`}
          ${unnamed ? `<p class="muted small" style="margin:12px 0 0">${unnamed} match senza nome dell'avversario: aggiungilo aprendo il match dallo Storico (campo 'Nome avversario').</p>` : ""}
        </div>`;

    root.innerHTML = `
      <div class="pl-top"><nav class="seg" aria-label="Sezione avversari"><a href="#opponents">Mazzi</a><a href="#players" class="on" aria-current="page">Giocatori</a><a href="#groups">Gruppi</a></nav></div>
      <div class="page-head"><h1>Giocatori avversari <span class="muted" style="font-weight:500">· ${esc(A.currentDeck().name)}</span></h1></div>
      ${A.filtersHTML()}
      ${body}`;

    A.bindFilters(root, () => viewList(root));

    // Ricerca per nome: aggiorna solo le righe (così il campo non perde il focus)
    const q = $("#pl-q", root);
    const applySearch = () => {
      const needle = keyOf(plQ);
      let hits = 0;
      $$(".pl-row", root).forEach((tr) => {
        const hit = !needle || tr.dataset.search.includes(needle);
        tr.hidden = !hit;
        if (hit) hits++;
      });
      const nores = $("#pl-nores", root);
      if (nores) nores.hidden = hits > 0;
    };
    if (q) q.oninput = () => { plQ = q.value; applySearch(); };
    applySearch();

    $$(".rt-chip", root).forEach((b) => (b.onclick = () => { rtFilter = b.dataset.rf; viewList(root); }));
    bindRating(root, () => viewList(root));

    $$(".pl-row", root).forEach((tr) => (tr.onclick = (e) => {
      if (!e.target.closest("a, button")) location.hash = tr.dataset.href;
    }));
  }

  // ---- Dettaglio ------------------------------------------------------------
  function viewDetail(root, arg) {
    const key = keyOf(arg);
    const known = groupPlayers(A.deckMatches()).find((g) => g.key === key);
    if (!known) {
      root.innerHTML = `<div class="pl-top"><a href="#players" class="small pl-back">← Giocatori</a></div>
        <div class="card empty-state"><p>Giocatore non trovato: nessun match registrato con questo avversario.</p>
        <a class="btn" href="#players">Torna ai giocatori</a></div>`;
      return;
    }
    const name = known.name;
    const ms = A.chrono(A.filtered().filter((m) => keyOf(m.opponent) === key));
    const s = A.stats(ms);
    const low = s.n < A.LOW_N;

    const r = ratingOf(name);
    const notes = notesOf(name);
    const editable = A.canEdit();

    const archs = A.byArchetype(ms);
    const mine = new Map();
    for (const m of ms) {
      const p = m.player || "—";
      if (!mine.has(p)) mine.set(p, []);
      mine.get(p).push(m);
    }
    const minePlayers = [...mine.entries()]
      .map(([p, list]) => ({ p, list, s: A.stats(list) }))
      .sort((x, y) => y.s.n - x.s.n || x.p.localeCompare(y.p));

    root.innerHTML = `
      <div class="pl-top"><a href="#players" class="small pl-back">← Giocatori</a></div>
      <div class="page-head"><h1>vs ${esc(name)} <span class="muted" style="font-weight:500">· ${esc(A.currentDeck().name)}</span></h1></div>
      <div class="card rt-card">
        <div class="rt-head">
          <span class="rt-label">Bravura</span>
          ${editable ? ratingControl(name, r) : ratingBadge(r)}
        </div>
        ${editable
          ? (r == null
            ? `<p class="muted small rt-hint">Assegna una bravura per poter scrivere le note.</p>`
            : `<textarea class="rt-notes" id="rt-notes" aria-label="Note su ${esc(name)}" placeholder="Note: perché è forte o scarso, come gioca…">${esc(notes)}</textarea>
               <div class="rt-notes-row"><button type="button" class="btn" id="rt-save" disabled>Salva note</button></div>`)
          : (notes ? `<p class="rt-ro">${esc(notes)}</p>` : "")}
      </div>
      ${A.filtersHTML()}
      ${!ms.length ? `<div class="card empty-state"><p>Nessun match contro ${esc(name)} con questi filtri.</p></div>` : `
        ${low ? `<p class="muted small pl-note">Pochi dati: meno di ${A.LOW_N} match, le percentuali sono indicative.</p>` : ""}
        <div class="kpis${low ? " pl-low" : ""}">
          ${A.kpi("Match win rate", pct(s.wr), `${A.record(s)}${s.ci ? ` · IC95 ${pct(s.ci[0])}–${pct(s.ci[1])}` : ""}`, s.wr)}
          ${A.kpi("Game win rate", pct(s.gwr), `${s.gW}/${s.gN} game`, s.gwr)}
          ${A.kpi("On the play", pct(s.play), `${s.playW}/${s.playN}`, s.play)}
          ${A.kpi("On the draw", pct(s.draw), `${s.drawW}/${s.drawN}`, s.draw)}
        </div>
        <div class="grid g2">
          <div class="card">
            <div class="section-head"><h2>Mazzi giocati</h2><span class="muted small">Record con ciascun mazzo</span></div>
            ${archs.length ? `<div class="table-wrap"><table class="pl-table">
              <thead><tr><th>Mazzo</th><th class="r">Match</th><th class="r">V–P</th><th style="text-align:center">Win rate</th></tr></thead>
              <tbody>${archs.map((g) => `<tr>
                <td data-label="Mazzo"><a href="#matchup/${encodeURIComponent(g.id)}">${esc(g.arch.name)}</a></td>
                <td class="r num" data-label="Match">${g.s.n}</td>
                <td class="r num" data-label="V–P">${recordShort(g.s)}</td>
                ${withLabel(A.heatCell(g.s.wr, g.s.W, g.s.n, `${name} · ${g.arch.name}`, A.record(g.s), g.s.n), "Win rate")}
              </tr>`).join("")}</tbody></table></div>` : `<p class="muted">Nessun mazzo registrato.</p>`}
          </div>
          <div class="card">
            <div class="section-head"><h2>Nostri giocatori</h2><span class="muted small">Chi l'ha affrontato</span></div>
            <div class="table-wrap"><table class="pl-table">
              <thead><tr><th>Giocatore</th><th class="r">Match</th><th class="r">V–P</th><th style="text-align:center">Win rate</th></tr></thead>
              <tbody>${minePlayers.map((x) => `<tr>
                <td data-label="Giocatore">${esc(x.p)}</td>
                <td class="r num" data-label="Match">${x.s.n}</td>
                <td class="r num" data-label="V–P">${recordShort(x.s)}</td>
                ${withLabel(A.heatCell(x.s.wr, x.s.W, x.s.n, `${x.p} vs ${name}`, A.record(x.s), x.s.n), "Win rate")}
              </tr>`).join("")}</tbody></table></div>
          </div>
        </div>
        <div class="card"><h2>Match</h2>${A.matchTable(A.chrono(ms).reverse())}</div>`}`;

    bindRating(root, () => viewDetail(root, arg));
    const ta = $("#rt-notes", root), sv = $("#rt-save", root);
    if (ta && sv) {
      const saved = notes.trim();
      ta.oninput = () => { sv.disabled = ta.value.trim() === saved; };
      sv.onclick = () => {
        if (!A.canEdit()) { A.toast("Sola lettura: non puoi modificare"); return; }
        A.guard(async () => {
          await A.saveOppRating(name, r, ta.value.trim());
          A.toast("Salvato");
          viewDetail(root, arg);
        });
      };
    }
    A.bindFilters(root, () => viewDetail(root, arg));
    A.bindMatchRows(root);
  }

  A.views.players = (root, arg) => (arg ? viewDetail(root, arg) : viewList(root));
})();
