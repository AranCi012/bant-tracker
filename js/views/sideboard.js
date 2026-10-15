// Guide di sideboard (#sideboard, #sideboard/<archetipo>) e statistiche delle sidate.
(() => {
  "use strict";
  const A = window.App;
  const { $, $$, esc, pct, S } = A;
  const MINUS = "−";

  // ---------------------------------------------------------------------
  //  Helpers
  // ---------------------------------------------------------------------
  const SIDES = [["play", "On the play"], ["draw", "On the draw"]];
  const sideOf = (g) => (g.play === true ? "play" : g.play === false ? "draw" : null);
  const cleanList = (l) => (l || []).filter((c) => c && c.q > 0);

  // Game post-board (G2/G3) dei match, con mappe delle carte se la sidata è registrata
  function postGames(ms) {
    const out = [];
    for (const m of ms) {
      for (const g of A.gamesOf(m)) {
        if (g.n < 2) continue;
        const o = { ...g, m, side: sideOf(g), sb: null, maps: null };
        if (g.sb && (cleanList(g.sb.in).length || cleanList(g.sb.out).length)) {
          o.sb = { in: cleanList(g.sb.in), out: cleanList(g.sb.out) };
          o.maps = { in: A.listMap(o.sb.in), out: A.listMap(o.sb.out) };
        }
        out.push(o);
      }
    }
    return out;
  }
  function wrStat(gs) {
    const n = gs.length, k = gs.filter((g) => g.r === "W").length;
    return { n, k, wr: n ? k / n : null, ci: A.wilson(k, n) };
  }
  // Firma di un piano: carte (chiave+quantità) IN e OUT ordinate
  const sigOf = (inMap, outMap) => {
    const f = (mp) => [...mp].map(([k, c]) => `${k}x${c.q}`).sort().join(",");
    return `${f(inMap)}|${f(outMap)}`;
  };
  const planLabel = (inMap, outMap) => {
    const f = (mp, sign) => [...mp.values()].map((c) => `${sign}${c.q} ${c.name}`).join(", ");
    return [f(inMap, "+"), f(outMap, MINUS)].filter(Boolean).join(" / ") || "—";
  };
  const guideLists = (g, side) => ({ in: A.parseList(g ? g[side + "_in"] : ""), out: A.parseList(g ? g[side + "_out"] : "") });
  const guideSig = (g, side) => {
    const l = guideLists(g, side);
    return l.in.length || l.out.length ? sigOf(A.listMap(l.in), A.listMap(l.out)) : "";
  };
  const hasGuide = (g) => !!g && ["play_in", "play_out", "draw_in", "draw_out", "notes"].some((f) => (g[f] || "").trim());

  // Statistiche per carta: per ogni carta IN/OUT, WR con vs senza (stesso lato, sidata registrata)
  function cardStats(rec) {
    const rows = [];
    for (const dir of ["in", "out"]) {
      const names = new Map();
      for (const g of rec) for (const [k, c] of g.maps[dir]) if (!names.has(k)) names.set(k, c.name);
      for (const [k, name] of names) {
        const w = wrStat(rec.filter((g) => g.maps[dir].has(k))), wo = wrStat(rec.filter((g) => !g.maps[dir].has(k)));
        rows.push({ dir, key: k, name, w, wo, delta: w.n && wo.n ? w.wr - wo.wr : null });
      }
    }
    return rows.sort((a, b) => b.w.n - a.w.n || a.name.localeCompare(b.name));
  }
  // Piano più usato (tra le game con sidata registrata)
  function topPlan(rec) {
    const by = new Map();
    for (const g of rec) {
      const s = sigOf(g.maps.in, g.maps.out);
      if (!by.has(s)) by.set(s, { label: planLabel(g.maps.in, g.maps.out), list: [] });
      by.get(s).list.push(g);
    }
    return [...by.values()].sort((a, b) => b.list.length - a.list.length);
  }

  const wrCell = (s, title) => A.heatCell(s.wr, s.k, s.n, title, null, s.n);
  const deltaCell = (d, low) => (d == null ? `<td class="muted">—</td>` : `<td class="num${low ? " lowrow" : ""}" style="color:${d >= 0 ? "var(--win)" : "var(--loss)"}">${d >= 0 ? "+" : MINUS}${Math.abs(d * 100).toFixed(0)} pp</td>`);

  async function copyText(text, okMsg) {
    try { await navigator.clipboard.writeText(text); A.toast(okMsg || "Copiato negli appunti"); }
    catch { A.download("guida-sideboard.txt", text, "text/plain"); A.toast("Appunti non disponibili: scaricato come file"); }
  }
  const csvCell = (v) => { const s = String(v ?? ""); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csvLine = (a) => a.map(csvCell).join(",");
  const slug = (s) => String(s || "mazzo").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  // ---------------------------------------------------------------------
  //  Statistiche medie (A.sbstats): componente "carte più sidate"
  // ---------------------------------------------------------------------
  const TIER_LABEL = { chiave: "Chiave", routine: "Routine", occasionale: "Occasionale" };
  const SIDE_TABS = [["all", "Tutte"], ["play", "On the play"], ["draw", "On the draw"]];
  const boardSide = { v: "all" }; // lato scelto, condiviso tra le viste

  function cardItemHTML(c, dir, scope, n) {
    const r = (sd) => { const st = scope.sides[sd]; if (!st.n) return "—"; const f = st.cards[dir].find((x) => x.key === c.key); return `${f ? Math.round(f.rate * 100) : 0}%`; };
    const p = Math.round(c.rate * 100);
    return `<li class="sbs-card"><div class="sbs-top"><span class="sbs-name" data-card="${esc(c.name)}">${esc(c.name)}</span><span class="sbs-tier t-${esc(c.tier)}">${TIER_LABEL[c.tier]}</span></div>
      <div class="sbs-bar" role="img" aria-label="${p}%"><i style="width:${p}%"></i></div>
      <div class="sbs-meta"><b>${p}%</b> <span class="muted">(${c.games} su ${n})</span> · otp ${r("play")} · otd ${r("draw")} · di solito ${c.modeQ} ${c.modeQ === 1 ? "copia" : "copie"}</div></li>`;
  }
  function cardColHTML(title, dir, scope, st) {
    const cs = st.cards[dir], LIM = 8;
    const list = (xs) => `<ul class="sbs-list">${xs.map((c) => cardItemHTML(c, dir, scope, st.n)).join("")}</ul>`;
    return `<div class="sbs-col ${dir}"><h3>${title}</h3>${cs.length ? list(cs.slice(0, LIM)) : `<p class="muted small">Nessuna carta.</p>`}
      ${cs.length > LIM ? `<details><summary class="muted small">Altre ${cs.length - LIM} carte</summary>${list(cs.slice(LIM))}</details>` : ""}</div>`;
  }
  function boardInnerHTML(scope) {
    const st = scope.sides[boardSide.v];
    const lab = boardSide.v === "play" ? " on the play" : boardSide.v === "draw" ? " on the draw" : "";
    if (!st.n) return `<p class="muted">Nessuna sidata registrata${lab || " con questi filtri"}.${boardSide.v === "all" ? " Registra o conferma qualche sidata (anche dalle note) per vedere le statistiche." : " Prova con “Tutte”."}</p>`;
    return `<p class="muted small sbs-note">${st.n} ${st.n === 1 ? "sidata" : "sidate"} registrat${st.n === 1 ? "a" : "e"}${lab}${st.n < 3 ? " · ancora pochi dati: le percentuali vanno prese con cautela" : ""}.
      Chiave = quasi sempre (almeno ${Math.round(A.sbstats.TIERS.chiave * 100)}%) · Routine = spesso (almeno ${Math.round(A.sbstats.TIERS.routine * 100)}%) · Occasionale = più raramente.</p>
      <div class="sbs-cols">${cardColHTML("Entrano", "in", scope, st)}${cardColHTML("Escono", "out", scope, st)}</div>`;
  }
  // Monta toggle Tutte/play/draw + liste in host
  function mountBoard(host, scope) {
    host.innerHTML = `<div class="seg sbs-seg" role="group" aria-label="Lato">${SIDE_TABS.map(([v, l]) => `<button type="button" data-side="${v}" class="${boardSide.v === v ? "on" : ""}" data-p="1">${l}</button>`).join("")}</div><div class="sbs-body"></div>`;
    const body = $(".sbs-body", host);
    const draw = () => {
      body.innerHTML = boardInnerHTML(scope);
      $$(".sbs-seg button", host).forEach((b) => b.classList.toggle("on", b.dataset.side === boardSide.v));
      if (A.cards && A.cards.bindHover) A.cards.bindHover(body);
    };
    $$(".sbs-seg button", host).forEach((b) => { b.onclick = () => { boardSide.v = b.dataset.side; draw(); }; });
    draw();
  }
  const sentencesHTML = (xs) => `<ul class="sbs-sentences">${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;

  // Riassunto in testo semplice (WhatsApp)
  function summaryText(report, deck) {
    const out = [`*Sidate · ${deck.name}*`, `(${A.today()})`, ""];
    for (const h of A.sbstats.highlights(report, { max: 8 })) out.push(`• ${h}`);
    for (const e of report.byArch) {
      out.push("", `*${e.name}*`);
      for (const s of A.sbstats.archSummary(report, e.archId)) out.push(s);
    }
    return out.join("\n");
  }

  // ---------------------------------------------------------------------
  //  Dati della panoramica
  // ---------------------------------------------------------------------
  function overviewRows(ms) {
    const deck = A.currentDeck();
    const byA = new Map();
    for (const m of ms) { if (!byA.has(m.archetype_id)) byA.set(m.archetype_id, []); byA.get(m.archetype_id).push(m); }
    const ids = new Set();
    for (const [id, list] of byA) if (postGames(list).length) ids.add(id);
    for (const g of S.guides) if (g.deck_id === deck.id && hasGuide(g)) ids.add(g.archetype_id);
    return [...ids].map((id) => {
      const arch = A.archById(id); if (!arch) return null;
      const pg = postGames(byA.get(id) || []);
      const sides = {};
      for (const [sd] of SIDES) {
        const gs = pg.filter((g) => g.side === sd), rec = gs.filter((g) => g.sb);
        sides[sd] = { gs, rec, s: wrStat(gs), top: topPlan(rec)[0] || null };
      }
      return { id, arch, guide: A.guideFor(id), pg, sides, recorded: pg.filter((g) => g.sb).length };
    }).filter(Boolean).sort((a, b) => b.pg.length - a.pg.length || a.arch.name.localeCompare(b.arch.name));
  }

  // ---------------------------------------------------------------------
  //  Export
  // ---------------------------------------------------------------------
  const listTxt = (l) => (l.length ? l.map((c) => `${c.q} ${c.name}`).join(", ") : "—");
  function guideMarkdown(rows) {
    const deck = A.currentDeck();
    const out = [`# Guida sideboard — ${deck.name}`, "", `Generata il ${A.today()}.`, ""];
    for (const r of rows) {
      out.push(`## ${r.arch.name}`, "");
      for (const [sd, label] of SIDES) {
        const l = guideLists(r.guide, sd);
        out.push(`### ${label}`, `- IN: ${listTxt(l.in)}`, `- OUT: ${listTxt(l.out)}`, "");
      }
      if (r.guide && (r.guide.notes || "").trim()) out.push(`**Note:** ${r.guide.notes.trim().replace(/\n/g, "\n> ")}`, "");
      const st = (sd) => { const s = r.sides[sd].s; return s.n ? `${pct(s.wr)} (${s.k}/${s.n} game)` : "nessun dato"; };
      out.push(`_Win rate post-board: on the play ${st("play")}, on the draw ${st("draw")}._`, "");
    }
    return out.join("\n");
  }
  function statsCsv(rows) {
    const out = [csvLine(["archetipo", "lato", "game_post_board", "vittorie", "win_rate_pct", "con_sidata_registrata", "piano_piu_usato", "volte_piano"])];
    for (const r of rows) for (const [sd, label] of SIDES) {
      const x = r.sides[sd], tp = x.top;
      out.push(csvLine([r.arch.name, label, x.s.n, x.s.k, x.s.n ? (x.s.wr * 100).toFixed(1) : "", x.rec.length, tp ? tp.label : "", tp ? tp.list.length : ""]));
    }
    return out.join("\n");
  }
  function cardsCsv(rows) {
    const out = [csvLine(["archetipo", "lato", "direzione", "carta", "game_con", "vittorie_con", "wr_con_pct", "game_senza", "vittorie_senza", "wr_senza_pct", "delta_pp"])];
    for (const r of rows) for (const [sd, label] of SIDES) {
      if (!r.sides[sd].rec.length) continue;
      for (const c of cardStats(r.sides[sd].rec)) {
        out.push(csvLine([r.arch.name, label, c.dir === "in" ? "IN" : "OUT", c.name, c.w.n, c.w.k, c.w.n ? (c.w.wr * 100).toFixed(1) : "", c.wo.n, c.wo.k, c.wo.n ? (c.wo.wr * 100).toFixed(1) : "", c.delta == null ? "" : (c.delta * 100).toFixed(1)]));
      }
    }
    return out.join("\n");
  }

  // ---------------------------------------------------------------------
  //  Vista: panoramica
  // ---------------------------------------------------------------------
  function viewOverview(root) {
    const deck = A.currentDeck();
    const rows = overviewRows(A.filtered());
    const report = A.sbstats.analyze(A.filtered());
    const guideCell = (r, sd) => {
      const l = guideLists(r.guide, sd);
      return l.in.length || l.out.length ? A.sbSummaryHTML(l) : `<span class="muted small">—</span>`;
    };
    root.innerHTML = `
      <div class="page-head"><h1>Sideboard <span class="muted" style="font-weight:500">· ${esc(deck.name)}</span></h1>
        <div class="inline no-print sb-actions">
          <a class="btn primary" href="#report" id="sb-report">📄 Report leggibile</a>
          <button class="btn" id="sb-sum">📋 Copia riassunto</button>
          <button class="btn sm" id="sb-print">Stampa / PDF</button>
        </div></div>
      <details class="no-print sb-more"><summary class="muted small">Altri formati (per smanettoni)</summary>
        <div class="inline" style="margin-top:8px;flex-wrap:wrap">
          <button class="btn sm" id="sb-md">Esporta guida (.md)</button>
          <button class="btn sm" id="sb-copy">Copia guida</button>
          <button class="btn sm" id="sb-csv">Esporta statistiche (.csv)</button>
          <button class="btn sm" id="sb-csv2">Esporta carte (.csv)</button>
        </div></details>
      ${A.notes ? `<div class="card nt-link no-print"><span>Le sidate si possono leggere dalle note dei match.</span><a class="btn primary" href="#sideboard/note">📝 Sidate dalle note (${reviewCount()} da rivedere)</a></div>` : ""}
      <div class="no-print">${A.filtersHTML()}</div>
      <div class="card" id="sb-summary">
        <div class="section-head"><h2>Riassunto sidate</h2><span class="muted small">In media, sulle sidate registrate</span></div>
        ${sentencesHTML(A.sbstats.highlights(report, { max: 8 }))}
        <h3 class="sbs-h">Carte più sidate</h3><div id="sb-board"></div>
      </div>
      ${!rows.length ? `<div class="card empty-state"><p>Ancora nessuna guida né game post-board per questo mazzo.<br>Apri un matchup dalla <a href="#matchup">matrice</a> oppure scegli un archetipo qui sotto per scrivere la prima guida.</p>
        <div class="inline" style="justify-content:center;flex-wrap:wrap">${S.archetypes.slice(0, 12).map((a) => `<a class="btn sm" href="#sideboard/${encodeURIComponent(a.id)}">${esc(a.name)}</a>`).join("")}</div></div>` : `
      <div class="card">
        <div class="section-head"><h2>Guide e risultati post-board</h2><span class="muted small">Clicca un archetipo per modificare la guida e vedere le statistiche</span></div>
        <div class="table-wrap"><table class="heat sb-table">
          <thead><tr><th>Archetipo</th><th>Guida on the play</th><th>Guida on the draw</th><th style="text-align:center">Post-board play</th><th style="text-align:center">Post-board draw</th><th style="text-align:center">Sidate registrate</th></tr></thead>
          <tbody>${rows.map((r) => `<tr>
            <th class="rowh"><a href="#sideboard/${encodeURIComponent(r.id)}">${esc(r.arch.name)}</a></th>
            <td class="sb-cell">${guideCell(r, "play")}</td>
            <td class="sb-cell">${guideCell(r, "draw")}</td>
            ${wrCell(r.sides.play.s, `${r.arch.name} · post-board on the play`)}
            ${wrCell(r.sides.draw.s, `${r.arch.name} · post-board on the draw`)}
            <td class="num" style="text-align:center">${r.pg.length ? `${r.recorded}<span class="muted small">/${r.pg.length}</span>` : `<span class="muted">—</span>`}</td>
          </tr>`).join("")}</tbody></table></div>
        <div class="legend"><span>Percentuali = win rate delle <b>game</b> post-board (G2-G3).</span><span class="lowsw"></span><span>tratteggiato = meno di ${A.LOW_N} game</span></div>
        <p class="muted small no-print" style="margin-bottom:0">Per aggiungere una guida a un archetipo che non compare qui, aprilo da <a href="#matchup">Matchup</a> oppure usa l'elenco: ${S.archetypes.filter((a) => !rows.some((r) => r.id === a.id)).slice(0, 40).map((a) => `<a href="#sideboard/${encodeURIComponent(a.id)}">${esc(a.name)}</a>`).join(" · ") || "tutti gli archetipi hanno già una riga"}.</p>
      </div>`}`;
    A.bindFilters(root, () => viewOverview(root));
    if (A.cards && A.cards.bindHover) A.cards.bindHover(root);
    mountBoard($("#sb-board", root), report.overall);
    const b = (id, fn) => { const el = $(id, root); if (el) el.onclick = fn; };
    const base = `sideboard-${slug(deck.name)}`;
    b("#sb-sum", () => copyText(summaryText(report, deck), "Riassunto copiato: incollalo dove vuoi"));
    b("#sb-md", () => A.download(`${base}.md`, guideMarkdown(rows), "text/markdown"));
    b("#sb-copy", () => copyText(guideMarkdown(rows), "Guida copiata"));
    b("#sb-csv", () => A.download(`${base}-statistiche.csv`, statsCsv(rows), "text/csv"));
    b("#sb-csv2", () => A.download(`${base}-carte.csv`, cardsCsv(rows), "text/csv"));
    b("#sb-print", () => window.print());
    if (!report.totalPost) { const el = $("#sb-sum", root); if (el) el.disabled = true; }
    if (!rows.length) ["#sb-md", "#sb-copy", "#sb-csv", "#sb-csv2", "#sb-print"].forEach((id) => { const el = $(id, root); if (el) el.disabled = true; });
  }

  // ---------------------------------------------------------------------
  //  Vista: dettaglio archetipo (editor guida + statistiche)
  // ---------------------------------------------------------------------
  let draft = null; // bozza della guida: sopravvive ai re-render (es. cambio filtri)

  function viewDetail(root, archId) {
    const arch = A.archById(archId);
    if (!arch) { root.innerHTML = `<p class="muted">Archetipo non trovato. <a href="#sideboard">← Tutte le guide</a></p>`; return; }
    const deck = A.currentDeck(), ver = A.activeVersion(), g0 = A.guideFor(archId);
    if (!draft || draft.arch !== archId || draft.deck !== deck.id) {
      draft = { arch: archId, deck: deck.id, notes: g0 ? g0.notes || "" : "", play: guideLists(g0, "play"), draw: guideLists(g0, "draw") };
    }
    const ms = A.filtered().filter((m) => m.archetype_id === archId);
    root.innerHTML = `
      <div class="page-head"><div><a class="small" href="#sideboard">← Tutte le guide</a><h1 style="margin-top:4px">Sideboard vs ${esc(arch.name)} <span class="muted" style="font-weight:500">· ${esc(deck.name)}</span></h1></div>
        <div class="inline no-print"><button class="btn sm" id="sd-print">Stampa / PDF</button></div></div>
      <div class="card">
        <div class="section-head"><h2>Guida</h2>
          <span class="muted small">${ver ? `Carte proposte dalla lista attiva: <b>${esc(ver.name)}</b>` : `Nessuna lista salvata per questo mazzo: puoi comunque aggiungere le carte a mano.`}</span></div>
        <h3>On the play</h3><div id="ed-play"></div>
        <h3 style="margin-top:18px">On the draw</h3><div id="ed-draw"></div>
        <label class="field" style="margin-top:14px">Note <textarea id="sd-notes" rows="4" placeholder="es. tieni dentro Stifle solo se…">${esc(draft.notes)}</textarea></label>
        <div class="row-actions no-print">
          <button class="btn" id="sd-copy-pd">Copia da play a draw</button>
          <button class="btn primary" id="sd-save">Salva guida</button>
        </div>
      </div>
      <div class="card" id="sd-media"></div>
      <div class="no-print">${A.filtersHTML()}</div>
      <div id="sd-stats"></div>`;

    const ed = {};
    for (const [sd] of SIDES) {
      ed[sd] = A.sbEditor($(`#ed-${sd}`, root), {
        version: () => ver,
        value: draft[sd],
        onChange(v) { draft[sd] = v; },
      });
    }
    $("#sd-notes", root).oninput = (e) => { draft.notes = e.target.value; };
    $("#sd-copy-pd", root).onclick = () => { ed.draw.set({ in: draft.play.in, out: draft.play.out }); A.toast("Copiato da play a draw (ricorda di salvare)"); };
    $("#sd-print", root).onclick = () => window.print();
    $("#sd-save", root).onclick = () => A.guard(async () => {
      await A.saveGuide(archId, {
        play_in: A.listToText(cleanList(draft.play.in)), play_out: A.listToText(cleanList(draft.play.out)),
        draw_in: A.listToText(cleanList(draft.draw.in)), draw_out: A.listToText(cleanList(draft.draw.out)),
        notes: draft.notes.trim(),
      });
      draft = null;
      A.toast("Guida salvata");
      viewDetail(root, archId);
    });
    A.bindFilters(root, () => viewDetail(root, archId));
    renderMedia($("#sd-media", root), ms, archId);
    renderStats($("#sd-stats", root), ms, archId);
  }

  // Card "In media": frasi, sidata tipica per lato, carte per fascia
  function renderMedia(el, ms, archId) {
    const report = A.sbstats.analyze(ms), e = report.byArch.find((x) => x.archId === archId);
    let h = `<div class="section-head"><h2>In media</h2><span class="muted small">Sidate registrate contro questo archetipo · filtri applicati</span></div>`;
    if (!e) {
      h += `<p class="muted">${report.totalPost ? "Nessuna sidata registrata con questi filtri. Registra o conferma qualche sidata (anche dalle note) per vedere le statistiche." : "Nessuna game post-board (G2/G3) con questi filtri."}</p>`;
      el.innerHTML = h; return;
    }
    h += sentencesHTML(A.sbstats.archSummary(report, archId));
    for (const [sd, label] of SIDES) {
      const st = e.scope.sides[sd];
      if (!st.n || !(st.typical.in.length || st.typical.out.length)) continue;
      const used = Math.round(st.typical.support * st.n);
      h += `<div class="sbs-typ"><b>${label}</b> ${A.sbSummaryHTML(st.typical)}<span class="muted small">${used ? `usata in ${used} su ${st.n}` : `nessuna sidata identica alla tipica (${st.n} registrate)`}</span></div>`;
    }
    h += `<h3 class="sbs-h">Carte per fascia</h3><div class="sbs-board"></div>`;
    el.innerHTML = h;
    mountBoard($(".sbs-board", el), e.scope);
    if (A.cards && A.cards.bindHover) A.cards.bindHover(el);
  }

  function renderStats(el, ms, archId) {
    const pg = postGames(ms);
    if (!pg.length) {
      el.innerHTML = `<div class="card"><h2>Statistiche post-board</h2><p class="muted">Nessuna game post-board (G2/G3) con questi filtri. Quando registri una partita, la sidata di G2/G3 viene precompilata da questa guida.</p></div>`;
      return;
    }
    const g = A.guideFor(archId);
    const rec = pg.filter((x) => x.sb), unrec = pg.length - rec.length, noSide = pg.filter((x) => !x.side).length;
    const sideStat = SIDES.map(([sd, label]) => {
      const gs = pg.filter((x) => x.side === sd), s = wrStat(gs), r = gs.filter((x) => x.sb).length;
      return `<tr><th class="rowh">${label}</th><td class="num" style="text-align:center">${s.n}</td>${wrCell(s, label + " · post-board")}
        <td class="num small">${s.n ? `${A.pct(s.ci[0])}–${A.pct(s.ci[1])}` : "—"}</td><td class="num small">${r}<span class="muted">/${s.n}</span></td></tr>`;
    }).join("");

    // Piani usati
    const plans = SIDES.map(([sd, label]) => {
      const rr = rec.filter((x) => x.side === sd);
      if (!rr.length) return "";
      return `<h3>${label}</h3><div class="table-wrap"><table class="heat"><thead><tr><th>Piano (IN / OUT)</th><th class="r">Game</th><th style="text-align:center">WR</th></tr></thead><tbody>
        ${topPlan(rr).map((p) => `<tr><td style="white-space:normal;min-width:220px">${esc(p.label)}</td><td class="r num">${p.list.length}</td>${wrCell(wrStat(p.list), p.label)}</tr>`).join("")}</tbody></table></div>`;
    }).join("");

    // Carte
    const cardRows = SIDES.flatMap(([sd, label]) => {
      const rr = rec.filter((x) => x.side === sd);
      return rr.length ? cardStats(rr).map((c) => ({ ...c, sd, label })) : [];
    });
    const cardTable = (dir, title) => {
      const rows = cardRows.filter((c) => c.dir === dir);
      if (!rows.length) return "";
      return `<h3>${title}</h3><div class="table-wrap"><table class="heat"><thead><tr><th>Lato</th><th>Carta</th><th style="text-align:center">Con la carta</th><th style="text-align:center">Senza</th><th class="r">Δ</th></tr></thead><tbody>
        ${rows.map((c) => { const low = c.w.n < A.LOW_N || c.wo.n < A.LOW_N; return `<tr class="${low ? "lowrow" : ""}"><td class="small">${c.label}</td><td style="white-space:normal"><span data-card="${esc(c.name)}">${esc(c.name)}</span></td>
          ${wrCell(c.w, `${c.name} · con`)}${wrCell(c.wo, `${c.name} · senza`)}${deltaCell(c.delta, low)}</tr>`; }).join("")}</tbody></table></div>`;
    };

    // Guida seguita vs non seguita
    const followRows = SIDES.map(([sd, label]) => {
      const sig = guideSig(g, sd), rr = rec.filter((x) => x.side === sd);
      if (!sig) return `<tr><th class="rowh">${label}</th><td colspan="3" class="muted small" style="white-space:normal">Nessuna guida scritta per questo lato.</td></tr>`;
      if (!rr.length) return `<tr><th class="rowh">${label}</th><td colspan="3" class="muted small" style="white-space:normal">Nessuna sidata registrata.</td></tr>`;
      const f = rr.filter((x) => sigOf(x.maps.in, x.maps.out) === sig), nf = rr.filter((x) => sigOf(x.maps.in, x.maps.out) !== sig);
      const sf = wrStat(f), snf = wrStat(nf);
      return `<tr><th class="rowh">${label}</th>${wrCell(sf, label + " · guida seguita")}${wrCell(snf, label + " · guida non seguita")}${deltaCell(sf.n && snf.n ? sf.wr - snf.wr : null, sf.n < A.LOW_N || snf.n < A.LOW_N)}</tr>`;
    }).join("");

    el.innerHTML = `
      <div class="card">
        <div class="section-head"><h2>Statistiche post-board</h2><span class="muted small">Game G2-G3 · filtri della barra applicati</span></div>
        <div class="table-wrap"><table class="heat"><thead><tr><th></th><th style="text-align:center">Game</th><th style="text-align:center">Win rate</th><th>IC 95%</th><th>Sidate reg.</th></tr></thead><tbody>${sideStat}</tbody></table></div>
        <p class="small muted" style="margin-bottom:0">${rec.length} game con sidata registrata, <b>${unrec}</b> senza (escluse da piani e carte)${noSide ? `; ${noSide} senza play/draw noto (escluse dal conteggio per lato)` : ""}.</p>
      </div>
      <div class="card"><h2>Piani effettivamente usati</h2>${plans || `<p class="muted">Nessuna sidata registrata: compilala nel form della partita (sotto G2/G3).</p>`}</div>
      <div class="card"><h2>Guida seguita vs non seguita</h2>
        <div class="table-wrap"><table class="heat"><thead><tr><th></th><th style="text-align:center">Seguita</th><th style="text-align:center">Non seguita</th><th class="r">Δ</th></tr></thead><tbody>${followRows}</tbody></table></div>
        <p class="small muted" style="margin-bottom:0">“Seguita” = stesse carte e stesse quantità della guida salvata per quel lato.</p></div>
      <div class="card"><h2>Carte</h2>
        ${cardRows.length ? `${cardTable("in", "Carte entrate (IN)")}${cardTable("out", "Carte uscite (OUT)")}
        <p class="small muted" style="margin-bottom:0">Confronto fra game dello stesso lato con sidata registrata. Carte che entrano o escono insieme si confondono tra loro, e con pochi dati le differenze sono rumore: le righe tratteggiate hanno meno di ${A.LOW_N} game da un lato.</p>` : `<p class="muted">Nessuna sidata registrata da analizzare.</p>`}</div>`;
    if (A.cards && A.cards.bindHover) A.cards.bindHover(el);
  }

  // ---------------------------------------------------------------------
  //  Vista: sidate dalle note (#sideboard/note)
  // ---------------------------------------------------------------------
  const ntState = { showAll: false, showIgn: false, editing: {} };
  const hasSb = (sb) => !!sb && (cleanList(sb.in).length > 0 || cleanList(sb.out).length > 0);
  const ignoredIds = () => new Set(A.lsGet("notesIgnored", []));

  // Una riga per match con note e game post-board; targets = game per cui c'è una proposta da rivedere
  function noteRows(ms, showAll) {
    const ign = ignoredIds(), ver0 = A.activeVersion(), alias = A.aliases(), rows = [];
    for (const m of ms) {
      if (!(m.notes || "").trim()) continue;
      const post = A.gamesOf(m).filter((g) => g.n >= 2);
      if (!post.length) continue;
      if (!showAll && post.every((g) => hasSb(g.sb))) continue;
      const ver = A.versionById(m.decklist_id) || ver0;
      const res = A.notes.parse(m.notes, { version: ver, aliases: alias });
      const prop = A.notes.forMatch(m, res);
      const targets = post.filter((g) => prop["sb" + g.n] && (showAll || !hasSb(g.sb)));
      rows.push({ m, ver, res, prop, post, targets, ignored: ign.has(m.id) });
    }
    return rows.sort((a, b) => (b.m.played_at || "").localeCompare(a.m.played_at || ""));
  }
  const reviewCount = () => noteRows(A.filtered(), false).filter((r) => !r.ignored && r.targets.length).length;

  // Testo della nota con le parti interpretate evidenziate (tutto escapato)
  function highlight(text, res) {
    const rs = [...res.evidence.map((e) => ({ s: e.start, e: e.end, c: "ev-" + e.dir })),
      ...res.ignored.filter((x) => x.reason !== "punteggio").map((x) => ({ s: x.start, e: x.end, c: "ev-ign" }))]
      .filter((r) => r.s != null).sort((a, b) => a.s - b.s);
    let pos = 0, h = "";
    for (const r of rs) {
      if (r.s < pos) continue;
      h += esc(text.slice(pos, r.s)) + `<mark class="${r.c}">${esc(text.slice(r.s, r.e))}</mark>`;
      pos = r.e;
    }
    return h + esc(text.slice(pos));
  }
  const confClass = (c) => `<span class="np-conf c-${esc(c)}">confidenza ${esc(c)}</span>`;
  // Nomi unici per carta (stessa carta scritta con maiuscole diverse = una sola voce)
  const cardNames = () => [...A.listMap(A.versions().flatMap((v) => [...A.parseList(v.maindeck), ...A.parseList(v.sideboard)])).values()].map((c) => c.name).sort((a, b) => a.localeCompare(b));

  function noteRowHTML(r) {
    const { m, res } = r, arch = A.archById(m.archetype_id), all = A.gamesOf(m);
    const editing = ntState.editing[m.id];
    const pills = all.map((g) => `<span class="pill ${g.r}">G${g.n} ${g.r === "W" ? "V" : g.r === "L" ? "P" : "="}${g.play === true ? " play" : g.play === false ? " draw" : ""}</span>`).join(" ");
    const games = r.post.map((g) => {
      const p = r.prop["sb" + g.n], rec = hasSb(g.sb);
      return `<div class="np-g"><b>G${g.n}</b>${rec ? `<span class="muted small">registrata:</span>${A.sbSummaryHTML(g.sb)}` : ""}${p ? `${rec ? `<span class="muted small">→ proposta:</span>` : ""}${A.sbSummaryHTML(p)}` : (rec ? "" : `<span class="muted small">nessuna proposta</span>`)}</div>`;
    }).join("");
    let body;
    if (editing) {
      body = `<div class="nt-edit">${r.post.map((g) => `<h4>G${g.n}</h4><div data-ed="${m.id ? esc(m.id) : ""}" data-n="${g.n}"></div>`).join("")}</div>
        <div class="nt-actions"><button class="btn primary" data-act="save" data-id="${esc(m.id)}">Salva</button><button class="btn" data-act="cancel" data-id="${esc(m.id)}">Annulla</button></div>`;
    } else {
      const overwrite = r.targets.some((g) => hasSb(g.sb));
      body = `<div class="nt-games">${games}</div>
        ${r.res.warnings.length ? `<div class="warn">${r.res.warnings.map(esc).join("<br>")}</div>` : ""}
        <div class="nt-actions">
          ${r.targets.length ? `<button class="btn primary" data-act="confirm" data-id="${esc(m.id)}">${overwrite ? "Conferma (sovrascrive)" : "Conferma"}</button>` : ""}
          <button class="btn" data-act="edit" data-id="${esc(m.id)}">Modifica</button>
          <button class="btn" data-act="${r.ignored ? "unignore" : "ignore"}" data-id="${esc(m.id)}">${r.ignored ? "Ripristina" : "Ignora"}</button>
        </div>`;
    }
    return `<div class="card nt-item">
      <div class="nt-head"><b>${esc(A.fmtDate(m.played_at))}</b><span>${esc(m.player)}</span><span class="muted">vs ${esc(arch ? arch.name : "?")}${m.opponent ? ` (${esc(m.opponent)})` : ""}</span>${pills}${confClass(res.confidence)}</div>
      <div class="nt-note">${highlight(m.notes, res)}</div>
      ${body}</div>`;
  }

  function viewNotes(root) {
    const deck = A.currentDeck();
    const all = noteRows(A.filtered(), ntState.showAll);
    const ign = all.filter((r) => r.ignored), act = all.filter((r) => !r.ignored);
    const review = act.filter((r) => r.targets.length), none = act.filter((r) => !r.targets.length);
    const high = review.filter((r) => r.res.confidence === "alta" && !ntState.editing[r.m.id]);
    // parole non riconosciute, aggregate
    const unk = new Map();
    for (const r of act) for (const w of r.res.unknown) unk.set(w, (unk.get(w) || 0) + 1);
    const names = cardNames();
    root.innerHTML = `
      <div class="page-head"><div><a class="small" href="#sideboard">← Tutte le guide</a><h1 style="margin-top:4px">Sidate dalle note <span class="muted" style="font-weight:500">· ${esc(deck.name)}</span></h1></div></div>
      <div class="no-print">${A.filtersHTML()}</div>
      <div class="nt-bar">
        <label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="nt-all"${ntState.showAll ? " checked" : ""}> mostra anche già registrate</label>
        ${high.length ? `<button class="btn primary" id="nt-bulk">Conferma tutte quelle ad alta confidenza (${high.length})</button>` : ""}
        ${ign.length ? `<button class="btn sm" id="nt-ign">${ntState.showIgn ? "Nascondi" : "Mostra"} ignorate (${ign.length})</button>` : ""}
      </div>
      ${unk.size ? `<div class="card"><h3 style="margin-top:0">Parole non riconosciute</h3>
        <p class="muted small">Insegna un soprannome: tutte le note vengono rilette.</p>
        <div class="np-teach">${[...unk].map(([w, n]) => `<span class="np-unk"><b>${esc(w)}</b><span class="muted small">(${n})</span> →
          <select><option value="">— carta —</option>${names.map((c) => `<option>${esc(c)}</option>`).join("")}</select>
          <button class="btn sm" data-act="teach" data-w="${esc(w)}">Insegna soprannome</button></span>`).join("")}</div></div>` : ""}
      ${!review.length && !none.length ? `<div class="card empty-state"><p>Niente da rivedere: nessun match con note e game post-board senza sidata registrata${ign.length ? " (ci sono note ignorate)" : ""}.</p></div>` : ""}
      ${review.map(noteRowHTML).join("")}
      ${none.length ? `<details style="margin-top:16px"><summary class="muted">Senza sidata riconosciuta (${none.length})</summary><div style="margin-top:8px">${none.map(noteRowHTML).join("")}</div></details>` : ""}
      ${ntState.showIgn ? ign.map(noteRowHTML).join("") : ""}`;
    A.bindFilters(root, () => viewNotes(root));
    if (A.cards && A.cards.bindHover) A.cards.bindHover(root);
    const rowOf = (id) => all.find((r) => r.m.id === id);
    // Salva la sidata sul match e, se la guida di quel matchup per quel lato (play/draw) è ancora vuota, la compila.
    const filled = [];
    const upd = async (m, patch) => {
      const u = await A.DB.update("matches", m.id, patch); S.matches = S.matches.map((x) => (x.id === m.id ? u : x));
      for (const g of A.gamesOf(u)) {
        if (g.n < 2 || !g.sb || g.play == null) continue;
        const side = g.play ? "play" : "draw", cur = A.guideFor(u.archetype_id);
        if (cur && ((cur[side + "_in"] || "").trim() || (cur[side + "_out"] || "").trim())) continue;
        await A.saveGuide(u.archetype_id, { [side + "_in"]: A.listToText(g.sb.in || []), [side + "_out"]: A.listToText(g.sb.out || []) });
        const a = A.archById(u.archetype_id); filled.push(`${a ? a.name : "?"} (${side === "play" ? "on the play" : "on the draw"})`);
      }
    };
    const guideMsg = () => (filled.length ? ` · guida compilata: ${filled.splice(0).join(", ")}` : "");
    const patchOf = (r) => { const p = {}; for (const g of r.targets) p["sb" + g.n] = r.prop["sb" + g.n]; return p; };
    // editor inline
    for (const id of Object.keys(ntState.editing)) {
      const r = rowOf(id); if (!r) continue;
      for (const host of root.querySelectorAll(`[data-ed="${CSS.escape(id)}"]`)) {
        const n = host.dataset.n, ed = ntState.editing[id];
        A.sbEditor(host, { version: () => r.ver, value: ed["sb" + n] || { in: [], out: [] }, onChange(v) { ed["sb" + n] = v; } });
      }
    }
    const $a = $("#nt-all", root); if ($a) $a.onchange = () => { ntState.showAll = $a.checked; viewNotes(root); };
    const $i = $("#nt-ign", root); if ($i) $i.onclick = () => { ntState.showIgn = !ntState.showIgn; viewNotes(root); };
    const $b = $("#nt-bulk", root);
    if ($b) $b.onclick = () => {
      if (!confirm(`Confermare ${high.length} match ad alta confidenza?`)) return;
      A.guard(async () => { for (const r of high) await upd(r.m, patchOf(r)); A.toast(`${high.length} sidate salvate${guideMsg()}`); viewNotes(root); });
    };
    root.onclick = (e) => {
      const b = e.target.closest("button[data-act]"); if (!b || b.disabled) return;
      const act = b.dataset.act, id = b.dataset.id, r = id ? rowOf(id) : null;
      if (act === "teach") {
        const card = (b.closest(".np-unk").querySelector("select").value || "").trim();
        if (!card) { A.toast("Scegli la carta"); return; }
        A.guard(async () => { await A.saveAliases({ ...A.aliases(), [b.dataset.w]: card }); A.toast(`“${b.dataset.w}” = ${card}`); viewNotes(root); });
      } else if (!r) return;
      else if (act === "confirm") A.guard(async () => { await upd(r.m, patchOf(r)); A.toast(`Sidata salvata${guideMsg()}`); viewNotes(root); });
      else if (act === "edit") {
        const ed = {};
        for (const g of r.post) ed["sb" + g.n] = r.prop["sb" + g.n] || (hasSb(g.sb) ? g.sb : { in: [], out: [] });
        ntState.editing[id] = ed; viewNotes(root);
      } else if (act === "cancel") { delete ntState.editing[id]; viewNotes(root); }
      else if (act === "save") A.guard(async () => {
        const ed = ntState.editing[id], p = {};
        for (const g of r.post) { const v = ed["sb" + g.n]; p["sb" + g.n] = v && (cleanList(v.in).length || cleanList(v.out).length) ? { in: cleanList(v.in), out: cleanList(v.out) } : null; }
        await upd(r.m, p); delete ntState.editing[id]; A.toast(`Sidata salvata${guideMsg()}`); viewNotes(root);
      });
      else if (act === "ignore") { A.lsSet("notesIgnored", [...ignoredIds(), id]); viewNotes(root); }
      else if (act === "unignore") { A.lsSet("notesIgnored", [...ignoredIds()].filter((x) => x !== id)); viewNotes(root); }
    };
  }

  A.views.sideboard = (root, arg) => (arg === "note" ? viewNotes(root) : arg ? viewDetail(root, arg) : viewOverview(root));
})();
