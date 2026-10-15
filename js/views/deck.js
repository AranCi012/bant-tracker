// La nostra lista: versioni della lista del mazzo corrente.
(() => {
  "use strict";
  const A = window.App;
  const { $, $$, esc, pct, today, S, DB, REMOTE } = A;

  const MINUS = "−";
  const scry = (name) => `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=normal`;
  const scryPage = (name) => (A.cards && A.cards.pageUrl ? A.cards.pageUrl(name) : `https://scryfall.com/search?q=${encodeURIComponent('!"' + name + '"')}`);

  let viewMode = "list"; // "list" | "img"
  const cmp = { a: "", b: "" }; // versioni confrontate
  let matchup = ""; // id archetipo avversario; "" = tutti i matchup
  let matchupLoaded = false;

  // Stile del solo selettore matchup e della tabella per matchup (variabili del tema)
  const CSS = `
.matchup-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0 0 14px; }
.matchup-bar select { min-width: 260px; max-width: 100%; }
.mu-pick { all: unset; cursor: pointer; color: var(--accent); font-weight: 600; text-decoration: underline dotted; text-underline-offset: 3px; }
.mu-pick:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
.heat tr.mu-low { opacity: .55; }
@media (max-width: 640px) {
  .matchup-bar { flex-direction: column; align-items: stretch; }
  .matchup-bar select { width: 100%; min-width: 0; }
}`;
  function injectCss() {
    if (document.getElementById("deck-style")) return;
    const s = document.createElement("style");
    s.id = "deck-style";
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  injectCss();

  const archName = (id) => (A.archById(id) || {}).name || "";
  const scopeTitle = () => (matchup ? ` · vs ${esc(archName(matchup))}` : "");
  const inScope = (m) => !matchup || m.archetype_id === matchup;
  const vMatchesAll = (v) => A.deckMatches().filter((m) => m.decklist_id === v.id);
  const vMatches = (v) => vMatchesAll(v).filter(inScope); // match della versione, nel matchup selezionato
  const setMatchup = (id, root) => { matchup = id || ""; A.lsSet("deckMatchup", matchup); viewDeck(root); };

  function cardListHTML(cards) {
    return `<ul class="cardlist">${cards.map((c) => `<li><span class="q">${c.q}</span><a href="${esc(scryPage(c.name))}" target="_blank" rel="noopener" data-card="${esc(c.name)}">${esc(c.name)}</a></li>`).join("")}</ul>`;
  }

  // ---- Confronto fra liste (per carta, con cardKey) ---------------------
  const chronoVersions = () => [...A.versions()].sort((x, y) => (x.created_at || "").localeCompare(y.created_at || ""));
  const prevOf = (v) => { const c = chronoVersions(); const i = c.findIndex((x) => x.id === v.id); return i > 0 ? c[i - 1] : null; };

  function diffZone(oldText, newText) {
    const o = A.listMap(A.parseList(oldText)), n = A.listMap(A.parseList(newText));
    const out = [];
    for (const k of new Set([...o.keys(), ...n.keys()])) {
      const d = (n.has(k) ? n.get(k).q : 0) - (o.has(k) ? o.get(k).q : 0);
      if (d) out.push({ d, name: (n.get(k) || o.get(k)).name });
    }
    return out.sort((a, b) => (b.d > 0) - (a.d > 0) || a.name.localeCompare(b.name));
  }
  function diffHTML(from, to) {
    if (!from) return `<span class="muted small">Prima versione del mazzo</span>`;
    const zone = (label, list) => (list.length ? `<div class="diff-row"><span class="diff-label">${label}</span><span class="sb-sum">${list.map((x) => `<span class="${x.d > 0 ? "sb-in" : "sb-out"}" data-card="${esc(x.name)}">${x.d > 0 ? "+" : MINUS}${Math.abs(x.d)} ${esc(x.name)}</span>`).join("")}</span></div>` : "");
    const html = zone("Main", diffZone(from.maindeck, to.maindeck)) + zone("Side", diffZone(from.sideboard, to.sideboard));
    return html || `<span class="muted small">Nessuna differenza di carte</span>`;
  }

  const statsLine = (s) => (s.n
    ? `<b>${pct(s.wr)}</b> match WR · ${A.record(s)} · game ${pct(s.gwr)} · n=${s.n} · IC ${pct(s.ci[0])}–${pct(s.ci[1])}${s.n < A.LOW_N ? ` <span class="warn">⚠ campione piccolo</span>` : ""}`
    : `<span class="muted">Nessun match con questa versione</span>`);

  // Differenza in punti percentuali (B−A) con colore; "—" se manca un lato
  const deltaCell = (x, y) => (x == null || y == null ? `<td class="muted" style="text-align:center">—</td>` : (() => { const d = (y - x) * 100; return `<td class="num" style="text-align:center;color:${d >= 0 ? "var(--win)" : "var(--loss)"}">${d >= 0 ? "+" : MINUS}${Math.abs(d).toFixed(0)} pp</td>`; })());

  // ---- Confronta versioni ------------------------------------------------
  // Tabella per matchup: una riga per avversario con match in A o B (tutti i matchup, non filtrati)
  function matchupCompareHTML(a, b) {
    const mA = vMatchesAll(a), mB = vMatchesAll(b);
    const rows = A.byArchetype([...mA, ...mB]);
    if (!rows.length) return `<p class="muted small">Nessun match con queste due versioni.</p>`;
    const sub = (ms, id) => A.stats(ms.filter((m) => m.archetype_id === id));
    const body = rows.map(({ id, arch }) => {
      const sa = sub(mA, id), sb = sub(mB, id);
      const low = sa.n < A.LOW_N || sb.n < A.LOW_N;
      return `<tr class="${low ? "mu-low" : ""}">
        <th class="rowh" style="white-space:normal"><button type="button" class="mu-pick" data-mu="${esc(id)}" title="Mostra solo questo matchup">${esc(arch.name)}</button></th>
        ${A.heatCell(sa.wr, sa.W, sa.n, `${a.name} vs ${arch.name} · Match WR`, A.record(sa), sa.n)}
        ${A.heatCell(sb.wr, sb.W, sb.n, `${b.name} vs ${arch.name} · Match WR`, A.record(sb), sb.n)}
        ${deltaCell(sa.wr, sb.wr)}
        <td class="num" style="text-align:center">${sa.n}</td><td class="num" style="text-align:center">${sb.n}</td>
      </tr>`;
    }).join("");
    return `<p class="small muted" style="margin-top:0">Solo match contro ciascun avversario, ordinati per match totali. Clicca il nome per vedere quel matchup.</p>
      <div class="table-wrap"><table class="heat"><thead><tr><th>Matchup</th><th style="text-align:center">${esc(a.name)}</th><th style="text-align:center">${esc(b.name)}</th><th style="text-align:center">Δ B−A</th><th style="text-align:center">n A</th><th style="text-align:center">n B</th></tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function compareHTML() {
    const vs = chronoVersions();
    if (vs.length < 2) return `<div class="card"><h2>Confronta versioni</h2><p class="muted">Servono almeno due versioni della lista per confrontarle.</p></div>`;
    const a = vs.find((v) => v.id === cmp.a) || vs[0], b = vs.find((v) => v.id === cmp.b) || vs[vs.length - 1];
    cmp.a = a.id; cmp.b = b.id;
    const sa = A.stats(vMatches(a)), sb = A.stats(vMatches(b));
    const opt = (sel) => vs.map((v) => `<option value="${esc(v.id)}"${v.id === sel ? " selected" : ""}>${esc(v.name)}</option>`).join("");
    const metrics = [["Match WR", "wr", "W", "n"], ["Game WR", "gwr", "gW", "gN"], ["Pre-board (G1)", "pre", "preW", "preN"], ["Post-board (G2-3)", "post", "postW", "postN"], ["On the play", "play", "playW", "playN"], ["On the draw", "draw", "drawW", "drawN"]];
    const small = sa.n < A.LOW_N || sb.n < A.LOW_N;
    const tot = sa.n + sb.n;
    return `<div class="card">
      <div class="section-head"><h2>Confronta versioni${scopeTitle()}</h2><span class="muted small">Le percentuali contano match o game a seconda della riga</span></div>
      <div class="cmp-pick">
        <label class="field">A <select id="cmp-a">${opt(a.id)}</select></label>
        <span class="muted">→</span>
        <label class="field">B <select id="cmp-b">${opt(b.id)}</select></label>
      </div>
      ${small ? `<p class="small warn" style="margin:8px 0">⚠ Almeno una delle due versioni ha meno di ${A.LOW_N} match: il confronto è molto incerto.</p>` : ""}
      ${matchup && tot === 0 ? `<p class="small muted" style="margin:8px 0">Nessun match contro ${esc(archName(matchup))} con queste due versioni: scegline altre qui sotto.</p>` : ""}
      ${matchup && tot > 0 && tot < 6 ? `<p class="small warn" style="margin:8px 0">⚠ Solo ${tot} match contro ${esc(archName(matchup))} tra A e B: i numeri per matchup sono molto rumorosi, non trarne conclusioni.</p>` : ""}
      <div class="table-wrap"><table class="heat"><thead><tr><th></th><th style="text-align:center">${esc(a.name)}</th><th style="text-align:center">${esc(b.name)}</th><th style="text-align:center">Δ B−A</th></tr></thead><tbody>
        ${metrics.map(([label, f, k, n]) => `<tr><th class="rowh">${label}</th>${A.heatCell(sa[f], sa[k], sa[n], `${a.name} · ${label}`, f === "wr" ? A.record(sa) : null, sa.n)}${A.heatCell(sb[f], sb[k], sb[n], `${b.name} · ${label}`, f === "wr" ? A.record(sb) : null, sb.n)}${deltaCell(sa[f], sb[f])}</tr>`).join("")}
        <tr><th class="rowh">Match giocati</th><td class="num" style="text-align:center">${sa.n}</td><td class="num" style="text-align:center">${sb.n}</td><td></td></tr>
      </tbody></table></div>
      ${matchup ? "" : `<h3>Per matchup</h3>${matchupCompareHTML(a, b)}`}
      <h3>Differenze di carte (A → B)</h3>
      ${a.id === b.id ? `<span class="muted small">Hai scelto la stessa versione.</span>` : `<div class="diff">${diffHTML(a, b)}</div>`}
    </div>`;
  }

  // ---- Impatto delle carte -----------------------------------------------
  // Match del mazzo con una versione esistente; filtri giocatore/evento/data della barra, IGNORANDO il filtro versione.
  function impactMatches() {
    const f = S.filters, ids = new Set(A.versions().map((v) => v.id));
    return A.deckMatches().filter((m) => ids.has(m.decklist_id) && inScope(m) &&
      (!f.player || m.player === f.player) && (!f.event || m.event === f.event) &&
      (!f.from || (m.played_at || "") >= f.from) && (!f.to || (m.played_at || "") <= f.to));
  }
  function impactRows(zone, ms) {
    const byV = new Map();
    for (const m of ms) { if (!byV.has(m.decklist_id)) byV.set(m.decklist_id, []); byV.get(m.decklist_id).push(m); }
    const vs = A.versions().filter((v) => byV.has(v.id));
    const maps = new Map(vs.map((v) => [v.id, A.listMap(A.parseList(v[zone]))]));
    const keys = new Map();
    for (const mp of maps.values()) for (const [k, c] of mp) if (!keys.has(k)) keys.set(k, c.name);
    const rows = [];
    for (const [k, name] of keys) {
      const buckets = new Map();
      for (const v of vs) {
        const q = maps.get(v.id).has(k) ? maps.get(v.id).get(k).q : 0;
        if (!buckets.has(q)) buckets.set(q, []);
        buckets.get(q).push(...byV.get(v.id));
      }
      if (buckets.size < 2) continue;
      const withL = [], withoutL = [];
      for (const [q, l] of buckets) (q > 0 ? withL : withoutL).push(...l);
      const sw = A.stats(withL), swo = A.stats(withoutL);
      const delta = sw.n && swo.n ? sw.wr - swo.wr : null;
      const ok = sw.n >= A.LOW_N && swo.n >= A.LOW_N;
      rows.push({ name, ok, delta, sw, swo, buckets: [...buckets].sort((x, y) => x[0] - y[0]).map(([q, l]) => ({ q, s: A.stats(l) })) });
    }
    return rows.sort((a, b) => (b.ok - a.ok) || (Math.abs(b.delta ?? -1) - Math.abs(a.delta ?? -1)) || a.name.localeCompare(b.name));
  }
  function impactTable(zone, ms) {
    const rows = impactRows(zone, ms);
    if (!rows.length) return `<p class="muted small">Nessuna carta cambia numero di copie tra versioni che hanno dei match.</p>`;
    return `<div class="table-wrap"><table class="heat"><thead><tr><th>Carta</th><th style="text-align:center">Con la carta</th><th style="text-align:center">Senza</th><th style="text-align:center">Δ</th><th>Per numero di copie</th></tr></thead><tbody>
      ${rows.map((r) => `<tr class="${r.ok ? "" : "lowrow"}">
        <th class="rowh" style="white-space:normal"><span data-card="${esc(r.name)}">${esc(r.name)}</span></th>
        ${A.heatCell(r.sw.wr, r.sw.W, r.sw.n, `${r.name} · con`, A.record(r.sw), r.sw.n)}
        ${A.heatCell(r.swo.wr, r.swo.W, r.swo.n, `${r.name} · senza`, A.record(r.swo), r.swo.n)}
        ${r.delta == null ? `<td class="muted" style="text-align:center">—</td>` : `<td class="num" style="text-align:center;color:${r.delta >= 0 ? "var(--win)" : "var(--loss)"}">${r.delta >= 0 ? "+" : MINUS}${Math.abs(r.delta * 100).toFixed(0)} pp</td>`}
        <td class="bk-cell">${r.buckets.map((b) => `<span class="bk${b.s.n < A.LOW_N ? " low" : ""}">×${b.q}: ${b.s.n} match · ${pct(b.s.wr)} <small>IC ${pct(b.s.ci[0])}–${pct(b.s.ci[1])}</small></span>`).join("")}</td>
      </tr>`).join("")}</tbody></table></div>`;
  }
  function impactHTML() {
    const ms = impactMatches();
    const f = S.filters, act = [f.player && `giocatore: ${f.player}`, f.event && `evento: ${f.event}`, f.from && `dal ${f.from}`, f.to && `al ${f.to}`].filter(Boolean);
    return `<div class="card">
      <div class="section-head"><h2>Impatto delle carte${scopeTitle()}</h2><span class="muted small">${ms.length} match con una versione nota${act.length ? ` · filtri attivi: ${esc(act.join(", "))}` : ""}</span></div>
      ${A.versions().length < 2 ? `<p class="muted">Servono almeno due versioni con dei match per vedere cosa cambia carta per carta.</p>` : `
      <p class="small muted" style="margin-top:0">Per ogni carta che cambia numero di copie tra le versioni giocate: win rate dei match con la carta (almeno una copia) contro quelli senza. Righe grigie = meno di ${A.LOW_N} match da un lato.</p>
      <h3>Main deck</h3>${impactTable("maindeck", ms)}
      <h3 style="margin-top:16px">Sideboard</h3>${impactTable("sideboard", ms)}
      <p class="small muted" style="margin-bottom:0">⚠ Le carte cambiate insieme nella stessa versione sono confuse tra loro (non si capisce quale abbia fatto la differenza), e con pochi match le differenze sono in gran parte rumore: usa questi numeri come indizio, non come prova.</p>`}
    </div>`;
  }

  // ---- Copia lista ---------------------------------------------------------
  function deckText(sel) {
    const main = A.parseList(sel.maindeck), side = A.parseList(sel.sideboard);
    return A.listToText(main) + (side.length ? `\n\nSideboard\n${A.listToText(side)}` : "") + "\n";
  }
  async function copyDeck(sel) {
    const text = deckText(sel);
    try { await navigator.clipboard.writeText(text); A.toast("Lista copiata"); }
    catch { A.download(`${sel.name.replace(/[^\w-]+/g, "_")}.txt`, text, "text/plain"); A.toast("Appunti non disponibili: scaricata come file"); }
  }

  function viewDeck(root) {
    if (!A.versions().length) {
      root.innerHTML = `<div class="page-head"><h1>La nostra lista</h1></div>
        <div class="card empty-state"><p>Nessuna lista salvata per “${esc(A.currentDeck().name)}”. Incolla la vostra lista (formato MTGO/Arena: “4 Brainstorm”).</p>
        <button class="btn primary" id="new-deck">+ Aggiungi lista</button></div>`;
      $("#new-deck", root).onclick = () => editDeck(null);
      return;
    }
    const sel = (A.versions().find((v) => v.id === S.deckSel)) || A.activeVersion();
    S.deckSel = sel.id;
    // Matchup scelto: ricordato, ma se per il mazzo corrente non ci sono match contro quell'avversario torna a "Tutti"
    if (!matchupLoaded) { matchup = A.lsGet("deckMatchup", "") || ""; matchupLoaded = true; }
    const muOpts = A.byArchetype(A.deckMatches());
    if (matchup && !muOpts.some((o) => o.id === matchup)) { matchup = ""; A.lsSet("deckMatchup", ""); }
    const main = A.parseList(sel.maindeck), side = A.parseList(sel.sideboard);
    const nm = A.countList(main), ns = A.countList(side);
    const ds = A.stats(vMatches(sel));
    const useImg = viewMode === "img" && A.cards && A.cards.renderVisual;
    const zone = (list, id, empty) => (!list.length ? `<p class="muted">${empty}</p>` : useImg ? `<div id="${id}" class="vis"><p class="muted small">Carico le immagini…</p></div>` : cardListHTML(list));
    root.innerHTML = `
      <div class="page-head"><h1>La nostra lista <span class="muted" style="font-weight:500">· ${esc(A.currentDeck().name)}</span></h1>
        <div class="inline"><button class="btn" id="new-deck">+ Nuova versione</button></div></div>
      <div class="matchup-bar"><label for="matchup-sel"><b>Matchup</b></label>
        <select id="matchup-sel"><option value="">Tutti i matchup</option>${muOpts.map((o) => `<option value="${esc(o.id)}"${o.id === matchup ? " selected" : ""}>${esc(o.arch.name)} (${o.s.n})</option>`).join("")}</select>
        ${matchup ? `<span class="small muted">Tutte le statistiche qui sotto sono solo per questo matchup</span>` : ""}
      </div>
      <div class="deck-cols">
        <div class="card">
          <div class="section-head">
            <div><h2 style="margin:0">${esc(sel.name)} ${sel.is_active ? `<span class="badge">ATTIVA</span>` : ""}</h2>
              <span class="small">${statsLine(ds)}</span></div>
            <div class="inline">
              ${sel.is_active ? "" : `<button class="btn sm" id="set-active">Rendi attiva</button>`}
              <button class="btn sm" id="edit-deck">Modifica</button>
              <button class="btn sm" id="dup-deck">Duplica</button>
              <button class="btn sm danger" id="del-deck">Elimina</button>
            </div>
          </div>
          <div class="inline" style="justify-content:space-between;margin-bottom:8px;flex-wrap:wrap">
            <div class="seg" id="mode-seg"><button type="button" data-mode="list" class="${useImg ? "" : "on"}">Lista</button><button type="button" data-mode="img" class="${useImg ? "on" : ""}">Immagini</button></div>
            <button class="btn sm" id="copy-deck">Copia lista</button>
          </div>
          ${viewMode === "img" && !useImg ? `<p class="small muted">Le immagini non sono disponibili: mostro la lista.</p>` : ""}
          <h3>Main deck · ${nm} ${nm !== 60 && nm ? `<span class="warn">(non sono 60)</span>` : ""}</h3>
          ${zone(main, "vis-main", "Vuoto")}
          <h3 style="margin-top:16px">Sideboard · ${ns} ${ns > 15 ? `<span class="warn">(più di 15)</span>` : ""}</h3>
          ${zone(side, "vis-side", "Vuota")}
          ${sel.notes ? `<h3 style="margin-top:16px">Note</h3><pre class="plan">${esc(sel.notes)}</pre>` : ""}
          <p class="muted small">Passa il mouse su una carta per vederla, clicca per aprirla su Scryfall.</p>
        </div>
        <div class="card">
          <h2>Versioni${scopeTitle()}</h2>
          <p class="muted small" style="margin-top:0">Ogni match è collegato alla versione usata. Sotto ogni versione trovi le carte cambiate rispetto alla precedente.</p>
          <ul class="versions">${A.versions().map((d) => { const s = A.stats(vMatches(d)); return `
            <li class="version vx${d.id === sel.id ? " sel" : ""}" data-deck="${esc(d.id)}">
              <div class="vx-head"><span><b>${esc(d.name)}</b> ${d.is_active ? `<span class="badge">ATTIVA</span>` : ""} <span class="muted small">${(d.created_at || "").slice(0, 10)}</span></span></div>
              <div class="small vx-stats${s.n && s.n < A.LOW_N ? " lowv" : ""}">${statsLine(s)}</div>
              <div class="diff small">${diffHTML(prevOf(d), d)}</div>
            </li>`; }).join("")}</ul>
        </div>
      </div>
      ${compareHTML()}
      ${impactHTML()}`;
    $$("[data-deck]", root).forEach((li) => (li.onclick = () => { S.deckSel = li.dataset.deck; viewDeck(root); }));
    $("#new-deck", root).onclick = () => editDeck(null);
    $("#edit-deck", root).onclick = () => editDeck(sel);
    $("#dup-deck", root).onclick = () => editDeck({ ...sel, id: null, name: sel.name + " (nuova)", is_active: false });
    $("#copy-deck", root).onclick = () => copyDeck(sel);
    $$("#mode-seg button", root).forEach((b) => (b.onclick = () => { viewMode = b.dataset.mode; viewDeck(root); }));
    const mSel = $("#matchup-sel", root);
    mSel.onchange = () => setMatchup(mSel.value, root);
    $$("[data-mu]", root).forEach((b) => (b.onclick = () => setMatchup(b.dataset.mu, root)));
    const ca = $("#cmp-a", root), cb = $("#cmp-b", root);
    if (ca) { ca.onchange = () => { cmp.a = ca.value; viewDeck(root); }; cb.onchange = () => { cmp.b = cb.value; viewDeck(root); }; }
    const sa = $("#set-active", root);
    if (sa) sa.onclick = () => A.guard(async () => { await setActive(sel.id); viewDeck(root); });
    $("#del-deck", root).onclick = () => {
      const used = S.matches.filter((m) => m.decklist_id === sel.id).length;
      if (!confirm(`Eliminare “${sel.name}”?${used ? ` I ${used} match collegati resteranno ma senza versione.` : ""}`)) return;
      A.guard(async () => {
        await DB.remove("decklists", sel.id);
        if (!REMOTE) for (const m of S.matches.filter((x) => x.decklist_id === sel.id)) await DB.update("matches", m.id, { decklist_id: null });
        await A.reload(); S.deckSel = null; viewDeck(root);
      });
    };
    if (useImg) {
      const draw = (id, list) => { const el = $("#" + id, root); if (el && list.length) Promise.resolve(A.cards.renderVisual(el, list, { groupByType: true })).catch((e) => { console.error(e); el.innerHTML = cardListHTML(list); }); };
      draw("vis-main", main); draw("vis-side", side);
    }
    bindCardHover(root);
  }

  function bindCardHover(root) {
    if (A.cards && A.cards.bindHover) { A.cards.bindHover(root); return; }
    $$("[data-card]", root).forEach((a) => {
      a.addEventListener("mouseenter", (e) => A.showTip(`<img class="card-preview" alt="${esc(a.dataset.card)}" src="${scry(a.dataset.card)}">`, e.clientX, e.clientY));
      a.addEventListener("mousemove", (e) => A.showTip($("#tooltip").innerHTML, e.clientX, e.clientY));
      a.addEventListener("mouseleave", A.hideTip);
    });
  }

  async function setActive(id) {
    for (const d of A.versions()) {
      const want = d.id === id;
      if (!!d.is_active !== want) await DB.update("decklists", d.id, { is_active: want });
    }
    await A.reload();
    A.toast("Versione attiva aggiornata");
  }

  function editDeck(d) {
    const isEdit = !!(d && d.id);
    const v = d || { name: `${A.currentDeck().name} ${today()}`, maindeck: "", sideboard: "", notes: "" };
    A.openModal(`
      <h2>${isEdit ? "Modifica lista" : "Nuova versione della lista"}</h2>
      ${isEdit && S.matches.some((m) => m.decklist_id === d.id) ? `<p class="small muted">Questa versione ha già dei match: se cambi carte in modo importante conviene usare “Duplica” e creare una nuova versione, così le statistiche restano confrontabili.</p>` : ""}
      <form id="deck-form" class="form-grid">
        <label class="field full">Nome versione <input name="name" value="${esc(v.name)}" required></label>
        <label class="field">Main deck <textarea name="maindeck" rows="16" placeholder="4 Brainstorm&#10;4 Force of Will&#10;4 Phelia, Exuberant Shepherd&#10;…">${esc(v.maindeck)}</textarea></label>
        <label class="field">Sideboard <textarea name="sideboard" rows="16" placeholder="2 Force of Negation&#10;…">${esc(v.sideboard)}</textarea></label>
        <label class="field full">Note <textarea name="notes" rows="3" placeholder="perché questi cambi…">${esc(v.notes)}</textarea></label>
        ${isEdit ? "" : `<label class="full small inline" style="color:var(--text-2)"><input type="checkbox" name="active" checked style="width:auto"> Rendila la versione attiva (proposta di default quando registri un match)</label>`}
        <div class="full small muted">Puoi incollare direttamente l'export di MTGO/Arena/Moxfield: se c'è una riga “Sideboard”, la parte sotto finisce in sideboard.</div>
        <div class="row-actions full"><button type="button" class="btn" data-close>Annulla</button><button class="btn primary">Salva</button></div>
      </form>`, (body) => {
      const f = $("#deck-form", body);
      // Incolla export completo nel main: separa automaticamente la sideboard
      f.maindeck.addEventListener("paste", () => setTimeout(() => {
        const t = f.maindeck.value, m = t.match(/^\s*sideboard\s*:?\s*$/im);
        if (m && !f.sideboard.value.trim()) {
          f.sideboard.value = t.slice(m.index + m[0].length).trim();
          f.maindeck.value = t.slice(0, m.index).replace(/^\s*(deck|main(deck)?)\s*:?\s*$/im, "").trim();
        }
      }));
      f.onsubmit = (e) => {
        e.preventDefault();
        const row = { name: f.name.value.trim(), maindeck: f.maindeck.value.trim(), sideboard: f.sideboard.value.trim(), notes: f.notes.value.trim() };
        A.guard(async () => {
          if (isEdit) {
            await DB.update("decklists", d.id, row);
            await A.reload();
          } else {
            const makeActive = f.active.checked || !A.versions().length;
            const n = await DB.insert("decklists", { ...row, deck_id: A.currentDeck().id, is_active: false });
            await A.reload();
            if (makeActive) await setActive(n.id);
            S.deckSel = n.id;
          }
          A.closeModal(); A.toast("Lista salvata"); A.route();
        });
      };
    });
  }

  A.views.deck = viewDeck;
})();
