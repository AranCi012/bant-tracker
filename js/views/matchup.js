// Matrice matchup (matchup × situazione, giocatore × matchup) e dettaglio di un matchup.
(() => {
  "use strict";
  const A = window.App;
  const { $, esc, pct } = A;

  function viewMatchup(root, archId) {
    if (archId) return viewMatchupDetail(root, archId);
    const ms = A.filtered();
    const groups = A.byArchetype(ms);
    const cols = [["wr", "Match", "W", "n"], ["gwr", "Game", "gW", "gN"], ["pre", "G1 (pre)", "preW", "preN"], ["post", "G2-3 (post)", "postW", "postN"], ["play", "On the play", "playW", "playN"], ["draw", "On the draw", "drawW", "drawN"]];
    const ps = A.players();
    root.innerHTML = `
      <div class="page-head"><h1>Matrice matchup <span class="muted" style="font-weight:500">· ${esc(A.currentDeck().name)}</span></h1></div>
      ${A.filtersHTML()}
      ${!groups.length ? A.emptyState("Nessun match con questi filtri.") : `
      <div class="card">
        <div class="section-head"><h2>Matchup × situazione</h2><span class="muted small">Clicca un matchup per il dettaglio</span></div>
        <div class="table-wrap"><table class="heat">
          <thead><tr><th></th><th class="r">Match</th>${cols.map((c) => `<th style="text-align:center">${c[1]}</th>`).join("")}</tr></thead>
          <tbody>${groups.map((g) => `<tr>
            <th class="rowh"><a href="#matchup/${encodeURIComponent(g.id)}">${esc(g.arch.name)}</a></th>
            <td class="r num muted">${g.s.n}</td>
            ${cols.map(([k, label, kk, nn]) => A.heatCell(g.s[k], g.s[kk], g.s[nn], `${g.arch.name} · ${label}`, k === "wr" ? A.record(g.s) : null, g.s.n)).join("")}
          </tr>`).join("")}
          ${(() => { const t = A.stats(ms); return `<tr><th class="rowh">Totale</th><td class="r num muted">${t.n}</td>${cols.map(([k, label, kk, nn]) => A.heatCell(t[k], t[kk], t[nn], `Totale · ${label}`, k === "wr" ? A.record(t) : null, t.n)).join("")}</tr>`; })()}
          </tbody></table></div>
        ${A.heatLegend()}
      </div>
      ${ps.length > 1 ? `<div class="card">
        <div class="section-head"><h2>Giocatore × matchup</h2><span class="muted small">Match win rate</span></div>
        <div class="table-wrap"><table class="heat">
          <thead><tr><th></th>${groups.map((g) => `<th style="text-align:center;white-space:normal;min-width:74px">${esc(g.arch.name)}</th>`).join("")}<th style="text-align:center">Totale</th></tr></thead>
          <tbody>${ps.map((p) => { const mine = ms.filter((m) => m.player === p); if (!mine.length) return ""; const tot = A.stats(mine); return `<tr><th class="rowh">${esc(p)}</th>${groups.map((g) => { const s = A.stats(mine.filter((m) => m.archetype_id === g.id)); return A.heatCell(s.wr, s.W, s.n, `${p} vs ${g.arch.name}`, A.record(s), s.n); }).join("")}${A.heatCell(tot.wr, tot.W, tot.n, `${p} · totale`, A.record(tot), tot.n)}</tr>`; }).join("")}</tbody>
        </table></div>
        ${A.heatLegend()}
      </div>` : ""}`}`;
    A.bindFilters(root, () => viewMatchup(root));
    A.bindDemo(root);
  }

  function guideSummary(g, side) {
    const inn = A.parseList(g ? g[side + "_in"] : ""), out = A.parseList(g ? g[side + "_out"] : "");
    if (!inn.length && !out.length) return `<span class="muted small">—</span>`;
    return `<div class="sb-sum">${inn.map((c) => `<span class="sb-in">+${c.q} ${esc(c.name)}</span>`).join("")}${out.map((c) => `<span class="sb-out">−${c.q} ${esc(c.name)}</span>`).join("")}</div>`;
  }

  function viewMatchupDetail(root, archId) {
    const a = A.archById(archId);
    if (!a) { root.innerHTML = `<p>Matchup non trovato. <a href="#matchup">Torna alla matrice</a></p>`; return; }
    const ms = A.filtered().filter((m) => m.archetype_id === archId);
    const s = A.stats(ms);
    const g = A.guideFor(archId);
    root.innerHTML = `
      <div class="page-head"><div><a href="#matchup" class="small">← Matrice</a><h1>${esc(A.currentDeck().name)} vs ${esc(a.name)}</h1></div>
        <a class="btn primary" href="#add/${encodeURIComponent(a.id)}">+ Partita vs ${esc(a.name)}</a></div>
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
          <div class="section-head"><h2>Guida di sideboard</h2><a class="btn sm" href="#sideboard/${encodeURIComponent(a.id)}">Apri / modifica →</a></div>
          <h3>On the play</h3>${guideSummary(g, "play")}
          <h3 style="margin-top:10px">On the draw</h3>${guideSummary(g, "draw")}
          ${g && g.notes ? `<h3 style="margin-top:10px">Note</h3><pre class="plan">${esc(g.notes)}</pre>` : ""}
          ${a.notes ? `<h3 style="margin-top:10px">Note sull'avversario</h3><pre class="plan">${esc(a.notes)}</pre>` : ""}
        </div>
        <div class="card"><h2>G1 → risultato</h2>${A.confusionG1(s)}</div>
      </div>
      <div class="card"><h2>Match</h2>${ms.length ? A.matchTable(A.chrono(ms).reverse()) : `<p class="muted">Nessun match.</p>`}</div>`;
    A.bindFilters(root, () => viewMatchupDetail(root, archId));
    A.bindMatchRows(root);
  }

  A.views.matchup = viewMatchup;
})();
