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

  // ---- Elenco ---------------------------------------------------------------
  function viewList(root) {
    const all = A.deckMatches();
    const ms = A.filtered();
    const groups = groupPlayers(ms)
      .map((g) => ({ ...g, s: A.stats(g.ms) }))
      .sort((x, y) => y.s.n - x.s.n || x.name.localeCompare(y.name));
    const unnamed = ms.filter((m) => !clean(m.opponent)).length;
    const anyNamed = all.some((m) => clean(m.opponent));

    const body = !anyNamed
      ? `<div class="card empty-state"><p>Nessun nome avversario registrato.</p>
          <p class="muted small">Apri un match dallo Storico e compila il campo “Nome avversario” (nick MTGO o nome): qui vedrai ogni avversario con le statistiche contro di lui.</p>
          <a class="btn" href="#history">Vai allo Storico</a></div>`
      : `<div class="card">
          <div class="pl-bar"><input type="search" id="pl-q" class="pl-search" placeholder="Cerca giocatore…" aria-label="Cerca giocatore" autocomplete="off"></div>
          ${groups.length ? `<div class="table-wrap"><table class="pl-table">
            <thead><tr><th>Giocatore</th><th class="r">Match</th><th class="r">V–P</th><th style="text-align:center">Win rate</th><th>Mazzi giocati</th><th>Ultima volta</th><th>Incontrato da</th></tr></thead>
            <tbody>${groups.map((g) => {
              const low = g.s.n < A.LOW_N;
              const href = `#players/${encodeURIComponent(g.key)}`;
              const ours = [...new Set(g.ms.map((m) => m.player).filter(Boolean))].sort((a, b) => a.localeCompare(b));
              return `<tr class="click pl-row" data-search="${esc(g.key)}" data-href="${esc(href)}">
                <td class="pl-name" data-label="Giocatore"><a href="${esc(href)}">${esc(g.name)}</a></td>
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
      <div class="pl-top"><nav class="seg" aria-label="Sezione avversari"><a href="#opponents">Mazzi</a><a href="#players" class="on" aria-current="page">Giocatori</a></nav></div>
      <div class="page-head"><h1>Giocatori avversari <span class="muted" style="font-weight:500">· ${esc(A.currentDeck().name)}</span></h1></div>
      ${A.filtersHTML()}
      ${body}`;

    A.bindFilters(root, () => viewList(root));

    const q = $("#pl-q", root);
    if (q) q.oninput = () => {
      const needle = keyOf(q.value);
      let shown = 0;
      $$(".pl-row", root).forEach((tr) => {
        const hit = !needle || tr.dataset.search.includes(needle);
        tr.hidden = !hit;
        if (hit) shown++;
      });
      const nores = $("#pl-nores", root);
      if (nores) nores.hidden = shown > 0;
    };
    $$(".pl-row", root).forEach((tr) => (tr.onclick = (e) => {
      if (!e.target.closest("a")) location.hash = tr.dataset.href;
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

    A.bindFilters(root, () => viewDetail(root, arg));
    A.bindMatchRows(root);
  }

  A.views.players = (root, arg) => (arg ? viewDetail(root, arg) : viewList(root));
})();
