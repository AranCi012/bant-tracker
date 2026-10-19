// Dashboard: KPI, andamento, win rate per matchup, quote del meta, matrice G1.
(() => {
  "use strict";
  const A = window.App;
  const { $, esc, pct, fmtDate, S, LOW_N } = A;
  const canEdit = () => !A.canEdit || A.canEdit();
  const emptyView = (msg) => (canEdit() ? A.emptyState(msg) : `<div class="card empty-state"><p>${msg}</p></div>`);

  function viewDashboard(root) {
    const ms = A.filtered();
    const all = A.deckMatches();
    const s = A.stats(ms);
    const groups = A.byArchetype(ms);
    const deck = A.currentDeck();
    // Card "per gruppo" solo se almeno un archetipo appartiene a un gruppo
    const withGroups = A.S.groups.length > 0 && A.S.archetypes.some((a) => a.group_id && A.groupById(a.group_id));
    root.innerHTML = `
      ${heroHTML(deck, s, ms, all)}
      ${A.filtersHTML()}
      ${!ms.length ? emptyView(all.length ? "Nessun match con questi filtri." : canEdit() ? `Ancora nessuna partita registrata con ${esc(deck.name)}.` : "Nessun match ancora.") : `
      <div class="kpis">
        ${A.kpi("Match win rate", pct(s.wr), `${A.record(s)}${s.ci ? ` · IC95 ${pct(s.ci[0])}–${pct(s.ci[1])}` : ""}`, s.wr)}
        ${A.kpi("Game win rate", pct(s.gwr), `${s.gW}-${s.gL}${s.gD ? "-" + s.gD : ""} in ${s.gN} game`, s.gwr)}
        ${A.kpi("Pre-board (G1)", pct(s.pre), `${s.preW}/${s.preN} game`, s.pre)}
        ${A.kpi("Post-board (G2/G3)", pct(s.post), `${s.postW}/${s.postN} game`, s.post)}
        ${A.kpi("On the play", pct(s.play), `${s.playW}/${s.playN} game`, s.play)}
        ${A.kpi("On the draw", pct(s.draw), `${s.drawW}/${s.drawN} game`, s.draw)}
      </div>
      <div class="card">
        <div class="section-head"><h2>Andamento win rate</h2>
          <div class="legend" style="margin:0">
            <span><i class="sw" style="background:var(--series-1)"></i>Cumulativo</span>
            <span><i class="sw" style="background:var(--series-2)"></i>Ultimi 10 match</span>
            <span><i class="sw" style="background:var(--text-3);height:1px"></i>50%</span>
          </div></div>
        <div id="trend"></div>
      </div>
      <div class="grid g2" style="margin-top:16px">
        ${withGroups ? groupCard(A.byGroup(ms)) : ""}
        <div class="card">
          <div class="section-head"><h2>Win rate per matchup</h2><a href="#matchup" class="small">Matrice completa →</a></div>
          ${wrBars(groups)}
          <div class="legend"><span>Barra = distanza da 50%</span><span>sbiadito = meno di ${LOW_N} match</span></div>
        </div>
        <div class="card"${withGroups ? ` style="grid-column:1 / -1"` : ""}>
          <div class="section-head"><h2>Chi incontriamo</h2><span class="muted small">% dei match</span></div>
          ${shareBars(groups, ms.length)}
        </div>
      </div>
      <div class="grid g2" style="margin-top:16px">
        <div class="card">
          <h2>G1 → risultato del match</h2>
          <p class="muted small" style="margin-top:0">Quanto pesa vincere/perdere la prima game.</p>
          ${A.confusionG1(s)}
        </div>
        <div class="card">
          <div class="section-head"><h2>Ultimi match</h2><a href="#history" class="small">Storico →</a></div>
          ${A.matchTable(A.chrono(ms).reverse().slice(0, 6), true)}
        </div>
      </div>`}`;
    A.bindFilters(root, () => viewDashboard(root));
    A.bindDemo(root);
    A.bindMatchRows(root);
    // Clic su una barra di gruppo: imposta il filtro gruppo e ridisegna la pagina
    A.$$("[data-gset]", root).forEach((b) => (b.onclick = () => { S.filters.group = b.dataset.gset; A.lsSet("filters", S.filters); viewDashboard(root); }));
    if (ms.length) trendChart($("#trend", root), A.chrono(ms));
    paintHero(root, deck);
  }

  // ---- Win rate per gruppo: stessa grafica di "Win rate per matchup", una barra per gruppo
  function groupCard(list) {
    const rows = [...list].sort((a, b) => (a.id === "__none") - (b.id === "__none") || b.s.wr - a.s.wr || b.s.n - a.s.n);
    return `<div class="card">
      <div class="section-head"><h2>Win rate per gruppo</h2><span class="muted small">Clicca per filtrare</span></div>
      ${rows.length ? `<div class="bars">${rows.map((g) => {
        const d = g.s.wr - 0.5, w = Math.abs(d) * 100;
        const cls = (d >= 0 ? "pos" : "neg") + (g.s.n < LOW_N ? " low" : "");
        const style = d >= 0 ? `left:50%;width:${w}%` : `left:${50 - w}%;width:${w}%`;
        const tipHtml = `<b>${esc(g.name)}</b>` + A.ttRows([["Match", `${A.record(g.s)} (${pct(g.s.wr)})`], ["Game", pct(g.s.gwr)], ["Pre / Post", `${pct(g.s.pre)} / ${pct(g.s.post)}`], ["IC 95%", g.s.ci ? `${pct(g.s.ci[0])}–${pct(g.s.ci[1])}` : "—"], ["Archetipi", String(g.archIds.length)]]);
        return `<button type="button" class="bar-row gs-bar-btn" data-gset="${esc(g.id)}" data-tip="${esc(tipHtml)}">
          <span class="name">${esc(g.name)}<span class="rec">${A.record(g.s)}</span></span>
          <span class="track"><span class="axis"></span><span class="fill ${cls}" style="${style};${w < 0.5 ? "min-width:2px" : ""}"></span></span>
          <span class="val">${pct(g.s.wr)} <span class="muted small">(${g.s.n})</span></span></button>`;
      }).join("")}</div>` : `<p class="muted">—</p>`}
      <div class="legend"><span>Barra = distanza da 50%</span><span>sbiadito = meno di ${LOW_N} match</span></div>
    </div>`;
  }

  // ---- Hero: nome del mazzo + win rate, sull'illustrazione della carta di copertina
  function heroHTML(deck, s, ms, all) {
    const last = A.chrono(ms).pop();
    const nPlayers = new Set(ms.map((m) => m.player)).size;
    const chips = [
      `${ms.length} match${ms.length !== all.length ? ` (filtrati su ${all.length})` : ""}`,
      nPlayers ? `${nPlayers} ${nPlayers === 1 ? "giocatore" : "giocatori"}` : "",
      A.versions().length ? `${A.versions().length} ${A.versions().length === 1 ? "lista" : "liste"}` : "",
      last ? `ultima: ${fmtDate(last.played_at)}` : "",
    ].filter(Boolean);
    return `<section class="hero">
      <div class="hero-art" id="hero-art"></div>
      <a class="hero-credit" id="hero-credit" target="_blank" rel="noopener" hidden></a>
      <div class="hero-body">
        <div class="hero-kicker">Il nostro mazzo</div>
        <h1 class="hero-title">${esc(deck.name)}</h1>
        <div class="hero-meta">${chips.map((c) => `<span class="hero-chip">${esc(c)}</span>`).join("")}</div>
      </div>
      ${s.n ? `<div class="hero-stat">
        <div class="hero-wr num">${pct(s.wr)}</div>
        ${A.meter(s.wr)}
        <div class="hero-sub">match win rate · ${A.record(s)}</div>
      </div>` : ""}
    </section>`;
  }
  async function paintHero(root, deck) {
    const art = $("#hero-art", root);
    if (!art) return;
    const name = await A.coverCard(deck);
    if (!name || !art.isConnected) return;
    const img = new Image();
    img.onload = () => {
      if (!art.isConnected) return;
      art.style.backgroundImage = `url("${img.src}")`;
      art.classList.add("on");
      const cr = $("#hero-credit", root);
      if (cr) { cr.textContent = name; cr.href = A.cards ? A.cards.pageUrl(name) : "#"; cr.title = "Illustrazione da Scryfall"; cr.hidden = false; }
    };
    img.src = A.artUrl(name);
  }

  function wrBars(groups) {
    if (!groups.length) return `<p class="muted">—</p>`;
    const sorted = [...groups].sort((a, b) => b.s.wr - a.s.wr || b.s.n - a.s.n);
    return `<div class="bars">${sorted.map((g) => {
      const d = g.s.wr - 0.5, w = Math.abs(d) * 100; // % della traccia (metà = 50 punti)
      const cls = (d >= 0 ? "pos" : "neg") + (g.s.n < LOW_N ? " low" : "");
      const style = d >= 0 ? `left:50%;width:${w}%` : `left:${50 - w}%;width:${w}%`;
      const tipHtml = `<b>${esc(g.arch.name)}</b>` + A.ttRows([["Match", `${A.record(g.s)} (${pct(g.s.wr)})`], ["Game", pct(g.s.gwr)], ["Pre / Post", `${pct(g.s.pre)} / ${pct(g.s.post)}`], ["IC 95%", g.s.ci ? `${pct(g.s.ci[0])}–${pct(g.s.ci[1])}` : "—"]]);
      return `<a class="bar-row" href="#matchup/${encodeURIComponent(g.id)}" style="color:inherit;text-decoration:none" data-tip="${esc(tipHtml)}">
        <span class="name">${esc(g.arch.name)}</span>
        <span class="track"><span class="axis"></span><span class="fill ${cls}" style="${style};${w < 0.5 ? "min-width:2px" : ""}"></span></span>
        <span class="val">${pct(g.s.wr)} <span class="muted small">(${g.s.n})</span></span></a>`;
    }).join("")}</div>`;
  }
  function shareBars(groups, total) {
    if (!groups.length) return `<p class="muted">—</p>`;
    const max = Math.max(...groups.map((g) => g.s.n));
    return `<div class="bars">${groups.map((g) => `
      <div class="bar-row" data-tip="${esc(`<b>${esc(g.arch.name)}</b>` + A.ttRows([["Match", g.s.n], ["Quota", pct(g.s.n / total, 1)]]))}">
        <span class="name">${esc(g.arch.name)}</span>
        <span class="track"><span class="fill share" style="width:${(g.s.n / max) * 100}%"></span></span>
        <span class="val">${pct(g.s.n / total)} <span class="muted small">(${g.s.n})</span></span></div>`).join("")}</div>`;
  }

  // Line chart SVG: WR cumulativo + rolling 10, con crosshair e tooltip
  function trendChart(el, ms) {
    const W = 760, H = 240, P = { l: 36, r: 12, t: 10, b: 24 };
    const pts = []; let w = 0;
    ms.forEach((m, i) => {
      const r = A.matchResult(m); if (r === "W") w++;
      const win = ms.slice(Math.max(0, i - 9), i + 1);
      pts.push({ i, m, r, cum: w / (i + 1), roll: win.filter((x) => A.matchResult(x) === "W").length / win.length });
    });
    const n = pts.length;
    const x = (i) => P.l + (n === 1 ? (W - P.l - P.r) / 2 : (i / (n - 1)) * (W - P.l - P.r));
    const y = (v) => P.t + (1 - v) * (H - P.t - P.b);
    const path = (k) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.i).toFixed(1)},${y(p[k]).toFixed(1)}`).join("");
    const grid = [0, 0.25, 0.5, 0.75, 1].map((v) => `<line class="${v === 0.5 ? "ref" : "gridline"}" x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${P.l - 6}" y="${y(v) + 4}" text-anchor="end">${v * 100}%</text>`).join("");
    const ticks = [...new Set([0, Math.floor((n - 1) / 2), n - 1])].map((i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">#${i + 1}</text>`).join("");
    el.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" data-chart role="img" aria-label="Andamento del win rate">
      ${grid}${ticks}
      <path d="${path("roll")}" fill="none" stroke="var(--series-2)" stroke-width="2" stroke-linejoin="round"/>
      <path d="${path("cum")}" fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linejoin="round"/>
      <line id="xh" class="ref" y1="${P.t}" y2="${H - P.b}" visibility="hidden"/>
      <circle id="d1" r="4" fill="var(--series-1)" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>
      <circle id="d2" r="4" fill="var(--series-2)" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>
      <rect x="${P.l}" y="0" width="${W - P.l - P.r}" height="${H}" fill="transparent" id="hit"/>
    </svg>`;
    const svg = $("svg", el), hit = $("#hit", el);
    const show = (e) => {
      const r = svg.getBoundingClientRect();
      const sx = ((e.clientX - r.left) / r.width) * W;
      const i = n === 1 ? 0 : Math.round(((sx - P.l) / (W - P.l - P.r)) * (n - 1));
      const p = pts[Math.max(0, Math.min(n - 1, i))];
      const xh = $("#xh", el); xh.setAttribute("x1", x(p.i)); xh.setAttribute("x2", x(p.i)); xh.setAttribute("visibility", "visible");
      [["#d1", "cum"], ["#d2", "roll"]].forEach(([id, k]) => { const c = $(id, el); c.setAttribute("cx", x(p.i)); c.setAttribute("cy", y(p[k])); c.setAttribute("visibility", "visible"); });
      const a = A.archById(p.m.archetype_id);
      A.showTip(`<b>Match #${p.i + 1} · ${fmtDate(p.m.played_at)}</b>` + A.ttRows([["vs", a ? a.name : "?"], ["Risultato", p.r === "W" ? "Vinto" : p.r === "L" ? "Perso" : "Pari"], ["Cumulativo", pct(p.cum)], ["Ultimi 10", pct(p.roll)]]), e.clientX, e.clientY);
    };
    hit.addEventListener("mousemove", show);
    hit.addEventListener("mouseleave", () => { A.hideTip(); ["#xh", "#d1", "#d2"].forEach((id) => $(id, el).setAttribute("visibility", "hidden")); });
  }

  A.views.dashboard = viewDashboard;
})();
