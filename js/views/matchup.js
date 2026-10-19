// Matrice matchup (matchup × situazione, giocatore × matchup) e dettaglio di un matchup.
// Vista "Per mazzo" (un riga per archetipo) o "Per gruppo" (un riga per gruppo, espandibile negli archetipi).
(() => {
  "use strict";
  const A = window.App;
  const { $, esc, pct } = A;
  const canEdit = () => !A.canEdit || A.canEdit();
  const emptyView = (msg) => (canEdit() ? A.emptyState(msg) : `<div class="card empty-state"><p>${msg}</p></div>`);

  // Stili dei gruppi: iniettati una sola volta, solo variabili CSS (chiaro/scuro dal tema)
  (function injectGroupStats() {
    if (document.getElementById("groupstats-style")) return;
    const st = document.createElement("style");
    st.id = "groupstats-style";
    st.textContent = `
.gs-bar { margin: 0 0 12px; }
.gs-seg { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--surface); max-width: 100%; }
.gs-seg button { border: 0; background: transparent; color: var(--text); font: inherit; font-weight: 600; font-size: .9rem; padding: 8px 14px; min-height: 40px; cursor: pointer; }
.gs-seg button + button { border-left: 1px solid var(--border); }
.gs-seg button[aria-pressed="true"] { background: var(--text); color: var(--surface); }
.gs-tog { width: 28px; height: 28px; margin-right: 6px; padding: 0; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--text-2); font: inherit; line-height: 1; cursor: pointer; vertical-align: middle; }
.gs-tog:hover { background: var(--surface-2); color: var(--text); }
.gs-gname { border: 0; background: none; padding: 0; color: var(--text); font: inherit; font-weight: 600; text-align: left; cursor: pointer; text-decoration: underline dotted; text-underline-offset: 3px; }
.gs-gname:hover { color: var(--accent); }
.gs-sub th.rowh { padding-left: 38px; font-weight: 500; color: var(--text-2); }
.gs-sub td.cell { font-size: .84rem; }
.gs-sub td.cell small { font-size: .66rem; }
.gs-chip { display: inline-block; margin-top: 6px; padding: 2px 10px; border-radius: 999px; font-size: .8rem; font-weight: 600; background: var(--surface-2); border: 1px solid var(--border); color: var(--text-2); text-decoration: none; }
a.gs-chip:hover { color: var(--text); border-color: var(--text-3); }
.gs-bar-btn { display: grid; grid-template-columns: minmax(90px, 160px) 1fr 74px; gap: 10px; align-items: center; width: 100%; padding: 4px 6px; margin: 0 -6px; border: 0; border-radius: 8px; background: transparent; color: inherit; font: inherit; font-size: .88rem; text-align: left; cursor: pointer; }
.gs-bar-btn:hover { background: var(--surface-2); }
.gs-bar-btn .name { white-space: normal; display: flex; flex-direction: column; line-height: 1.25; min-width: 0; overflow-wrap: anywhere; }
.gs-bar-btn .rec { font-size: .76rem; color: var(--text-3); }
.gs-bar-btn .val { text-align: right; color: var(--text-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
@media (max-width: 480px) { .gs-bar-btn { grid-template-columns: minmax(80px, 110px) 1fr 64px; } }`;
    document.head.appendChild(st);
  })();

  const MODE_KEY = "matchupMode";
  // Chiave del gruppo di un match ("__none" = archetipo senza gruppo)
  const groupKeyOf = (m) => { const g = A.groupOf(m.archetype_id); return g ? g.id : "__none"; };
  const openGroups = new Set(); // gruppi espansi nella matrice (stato di sola interfaccia)

  function viewMatchup(root, archId) {
    if (archId) return viewMatchupDetail(root, archId);
    const ms = A.filtered();
    const byMazzo = A.byArchetype(ms);
    const hasGroups = A.S.groups.length > 0;
    const useGroups = hasGroups && A.lsGet(MODE_KEY, "mazzo") === "gruppo";
    const cols = [["wr", "Match", "W", "n"], ["gwr", "Game", "gW", "gN"], ["pre", "G1 (pre)", "preW", "preN"], ["post", "G2-3 (post)", "postW", "postN"], ["play", "On the play", "playW", "playN"], ["draw", "On the draw", "drawW", "drawN"]];
    const ps = A.players();
    const groupRows = useGroups ? A.byGroup(ms) : [];
    // Colonne della matrice giocatore × matchup: archetipi oppure gruppi, con la stessa chiave di raggruppamento
    const keyOf = useGroups ? groupKeyOf : (m) => m.archetype_id;
    const colDefs = useGroups
      ? groupRows.map((g) => ({ key: g.id, label: g.name }))
      : byMazzo.map((g) => ({ key: g.id, label: g.arch.name }));

    const cells = (s, title) => cols.map(([k, label, kk, nn]) => A.heatCell(s[k], s[kk], s[nn], `${title} · ${label}`, k === "wr" ? A.record(s) : null, s.n)).join("");
    const rowsHTML = () => {
      if (!useGroups) return byMazzo.map((g) => `<tr>
            <th class="rowh"><a href="#matchup/${encodeURIComponent(g.id)}">${esc(g.arch.name)}</a></th>
            <td class="r num muted">${g.s.n}</td>
            ${cells(g.s, g.arch.name)}
          </tr>`).join("");
      return groupRows.map((g) => {
        const open = openGroups.has(g.id);
        const head = `<tr class="gs-grp">
            <th class="rowh"><button type="button" class="gs-tog" data-tog="${esc(g.id)}" aria-expanded="${open}" aria-label="${open ? "Nascondi" : "Mostra"} archetipi di ${esc(g.name)}">${open ? "▾" : "▸"}</button><button type="button" class="gs-gname" data-gset="${esc(g.id)}" title="Filtra su questo gruppo">${esc(g.name)}</button></th>
            <td class="r num muted">${g.s.n}</td>
            ${cells(g.s, g.name)}
          </tr>`;
        if (!open) return head;
        const subs = A.byArchetype(g.list).map((x) => `<tr class="gs-sub">
            <th class="rowh"><a href="#matchup/${encodeURIComponent(x.id)}">${esc(x.arch.name)}</a></th>
            <td class="r num muted">${x.s.n}</td>
            ${cells(x.s, x.arch.name)}
          </tr>`).join("");
        return head + subs;
      }).join("");
    };

    root.innerHTML = `
      <div class="page-head"><h1>Matrice matchup <span class="muted" style="font-weight:500">· ${esc(A.currentDeck().name)}</span></h1></div>
      ${A.filtersHTML()}
      ${!byMazzo.length ? emptyView("Nessun match con questi filtri.") : `
      <div class="card">
        ${hasGroups ? `<div class="gs-bar"><div class="gs-seg" role="group" aria-label="Raggruppa i matchup">
          <button type="button" data-mode="mazzo" aria-pressed="${!useGroups}">Per mazzo</button>
          <button type="button" data-mode="gruppo" aria-pressed="${useGroups}">Per gruppo</button>
        </div></div>` : ""}
        <div class="section-head"><h2>Matchup × situazione</h2><span class="muted small">${useGroups ? "Clicca il nome per filtrare sul gruppo, ▸ per gli archetipi" : "Clicca un matchup per il dettaglio"}</span></div>
        <div class="table-wrap"><table class="heat">
          <thead><tr><th></th><th class="r">Match</th>${cols.map((c) => `<th style="text-align:center">${c[1]}</th>`).join("")}</tr></thead>
          <tbody>${rowsHTML()}
          ${(() => { const t = A.stats(ms); return `<tr><th class="rowh">Totale</th><td class="r num muted">${t.n}</td>${cols.map(([k, label, kk, nn]) => A.heatCell(t[k], t[kk], t[nn], `Totale · ${label}`, k === "wr" ? A.record(t) : null, t.n)).join("")}</tr>`; })()}
          </tbody></table></div>
        ${A.heatLegend()}
      </div>
      ${ps.length > 1 && colDefs.length ? `<div class="card">
        <div class="section-head"><h2>Giocatore × ${useGroups ? "gruppo" : "matchup"}</h2><span class="muted small">Match win rate</span></div>
        <div class="table-wrap"><table class="heat">
          <thead><tr><th></th>${colDefs.map((c) => `<th style="text-align:center;white-space:normal;min-width:74px">${esc(c.label)}</th>`).join("")}<th style="text-align:center">Totale</th></tr></thead>
          <tbody>${ps.map((p) => { const mine = ms.filter((m) => m.player === p); if (!mine.length) return ""; const tot = A.stats(mine); return `<tr><th class="rowh">${esc(p)}</th>${colDefs.map((c) => { const s = A.stats(mine.filter((m) => keyOf(m) === c.key)); return A.heatCell(s.wr, s.W, s.n, `${p} vs ${c.label}`, A.record(s), s.n); }).join("")}${A.heatCell(tot.wr, tot.W, tot.n, `${p} · totale`, A.record(tot), tot.n)}</tr>`; }).join("")}</tbody>
        </table></div>
        ${A.heatLegend()}
      </div>` : ""}`}`;
    A.bindFilters(root, () => viewMatchup(root));
    A.bindDemo(root);
    if (!byMazzo.length) return;
    A.$$("[data-mode]", root).forEach((b) => (b.onclick = () => { A.lsSet(MODE_KEY, b.dataset.mode); viewMatchup(root); }));
    A.$$("[data-tog]", root).forEach((b) => (b.onclick = () => {
      const id = b.dataset.tog;
      if (openGroups.has(id)) openGroups.delete(id); else openGroups.add(id);
      viewMatchup(root);
    }));
    A.$$("[data-gset]", root).forEach((b) => (b.onclick = () => {
      A.S.filters.group = b.dataset.gset; A.lsSet("filters", A.S.filters);
      viewMatchup(root);
    }));
  }

  function guideSummary(g, side) {
    const inn = A.parseList(g ? g[side + "_in"] : ""), out = A.parseList(g ? g[side + "_out"] : "");
    if (!inn.length && !out.length) return `<span class="muted small">—</span>`;
    return `<div class="sb-sum">${inn.map((c) => `<span class="sb-in">+${c.q} ${esc(c.name)}</span>`).join("")}${out.map((c) => `<span class="sb-out">−${c.q} ${esc(c.name)}</span>`).join("")}</div>`;
  }

  // Sidate registrate nelle game post-board di questo matchup (dal form o dalle note)
  function sidesHTML(ms) {
    const rows = [];
    for (const m of A.chrono(ms).reverse()) for (const g of A.gamesOf(m)) if (g.n >= 2 && g.sb) rows.push({ m, g });
    const missing = ms.reduce((n, m) => n + A.gamesOf(m).filter((g) => g.n >= 2 && !g.sb).length, 0);
    return `<div class="card"><div class="section-head"><h2>Sidate registrate</h2><a class="small" data-edit href="#sideboard/note">📝 Sidate dalle note →</a></div>
      ${rows.length ? `<div class="table-wrap"><table class="sides-table"><thead><tr><th>Data</th><th>Giocatore</th><th>Game</th><th>Lato</th><th>Esito</th><th>Sidata</th></tr></thead><tbody>
        ${rows.map(({ m, g }) => `<tr><td class="num">${A.fmtDate(m.played_at)}</td><td>${esc(m.player)}</td><td>G${g.n}</td>
          <td>${g.play === true ? "play" : g.play === false ? "draw" : "—"}</td><td><span class="pill ${g.r}">${g.r === "W" ? "V" : g.r === "L" ? "P" : "="}</span></td>
          <td style="white-space:normal">${A.sbSummaryHTML ? A.sbSummaryHTML(g.sb) : ""}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">Nessuna sidata registrata per questo matchup.</p>`}
      ${missing && canEdit() ? `<p class="small muted" style="margin-bottom:0">${missing} game post-board senza sidata: se l'avete scritta nelle note, recuperala da “Sidate dalle note”.</p>` : ""}
    </div>`;
  }

  function viewMatchupDetail(root, archId) {
    const a = A.archById(archId);
    if (!a) { root.innerHTML = `<p>Matchup non trovato. <a href="#matchup">Torna alla matrice</a></p>`; return; }
    const ms = A.filtered().filter((m) => m.archetype_id === archId);
    const s = A.stats(ms);
    const g = A.guideFor(archId);
    const gr = A.groupOf(archId);
    const chip = gr ? (canEdit()
      ? `<a class="gs-chip" href="#groups">Gruppo: ${esc(gr.name)}</a>`
      : `<span class="gs-chip">Gruppo: ${esc(gr.name)}</span>`) : "";
    root.innerHTML = `
      <div class="page-head"><div><a href="#matchup" class="small">← Matrice</a><h1>${esc(A.currentDeck().name)} vs ${esc(a.name)}</h1>${chip ? `<div>${chip}</div>` : ""}</div>
        <a class="btn primary" data-edit href="#add/${encodeURIComponent(a.id)}">+ Partita vs ${esc(a.name)}</a></div>
      ${A.filtersHTML()}
      <div class="kpis">
        ${A.kpi("Match win rate", pct(s.wr), `${A.record(s)}${s.ci ? ` · IC95 ${pct(s.ci[0])}–${pct(s.ci[1])}` : ""}`)}
        ${A.kpi("Game win rate", pct(s.gwr), `${s.gW}/${s.gN} game`)}
        ${A.kpi("Pre-board", pct(s.pre), `${s.preW}/${s.preN}`)}
        ${A.kpi("Post-board", pct(s.post), `${s.postW}/${s.postN}`)}
        ${A.kpi("On the play", pct(s.play), `${s.playW}/${s.playN}`)}
        ${A.kpi("On the draw", pct(s.draw), `${s.drawW}/${s.drawN}`)}
      </div>
      <div class="grid g2">
        <div class="card">
          <div class="section-head"><h2>Guida di sideboard</h2><a class="btn sm" href="#sideboard/${encodeURIComponent(a.id)}">${canEdit() ? "Apri / modifica →" : "Apri →"}</a></div>
          <h3>On the play</h3>${guideSummary(g, "play")}
          <h3 style="margin-top:10px">On the draw</h3>${guideSummary(g, "draw")}
          ${g && g.notes ? `<h3 style="margin-top:10px">Note</h3><pre class="plan">${esc(g.notes)}</pre>` : ""}
          ${a.notes ? `<h3 style="margin-top:10px">Note sull'avversario</h3><pre class="plan">${esc(a.notes)}</pre>` : ""}
        </div>
        <div class="card"><h2>G1 → risultato</h2>${A.confusionG1(s)}</div>
      </div>
      ${sidesHTML(ms)}
      <div class="card"><h2>Match</h2>${ms.length ? A.matchTable(A.chrono(ms).reverse()) : `<p class="muted">Nessun match.</p>`}</div>`;
    A.bindFilters(root, () => viewMatchupDetail(root, archId));
    A.bindMatchRows(root);
  }

  A.views.matchup = viewMatchup;
})();
