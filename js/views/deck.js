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
.ic-how { margin: 0 0 12px; }
.ic-how summary { cursor: pointer; font-weight: 600; color: var(--accent); }
.ic-card { border: 1px solid var(--border); border-left: 4px solid var(--text-3); border-radius: 10px; padding: 10px 12px; margin: 0 0 10px; background: var(--surface); }
.ic-card.v-pos { border-left-color: var(--win); } .ic-card.v-neg { border-left-color: var(--loss); }
.ic-card.v-pos-l { border-left-color: color-mix(in srgb, var(--win) 45%, var(--surface)); } .ic-card.v-neg-l { border-left-color: color-mix(in srgb, var(--loss) 45%, var(--surface)); }
.ic-card.v-low { opacity: .8; }
.ic-chips span { font-size: .85rem !important; }
.ic-chips small { opacity: .75; }
.ic-neu { background: var(--surface-2); color: var(--text-2); }
.ic-vers { margin: 6px 0 0; }
.ic-sentence { margin: 8px 0 6px; }
.ic-verdict { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
.ic-badge { font-size: .78rem; font-weight: 700; padding: 1px 8px; border-radius: 999px; background: var(--surface-2); color: var(--text-2); white-space: nowrap; }
.v-pos .ic-badge { background: color-mix(in srgb, var(--win) 16%, transparent); color: var(--win); }
.v-neg .ic-badge { background: color-mix(in srgb, var(--loss) 16%, transparent); color: var(--loss); }
.v-pos-l .ic-badge { background: color-mix(in srgb, var(--win) 8%, transparent); color: var(--win); }
.v-neg-l .ic-badge { background: color-mix(in srgb, var(--loss) 8%, transparent); color: var(--loss); }
.ic-svg { display: block; width: 100%; max-width: 420px; height: auto; }
.ic-lab { font-size: 9px; fill: var(--text-2); } .ic-tick { font-size: 8px; fill: var(--text-3); }
.ic-axis { stroke: var(--border); stroke-width: 1; } .ic-ref { stroke: var(--text-3); stroke-width: 1; stroke-dasharray: 2 2; }
.ic-line { stroke-width: 2; } .ic-line.c1 { stroke: var(--series-1); } .ic-line.c2 { stroke: var(--text-3); }
.ic-dot.c1 { fill: var(--series-1); } .ic-dot.c2 { fill: var(--text-3); }
.ic-note, .ic-detail { margin: 6px 0 0; }
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
  // Filtri giocatore/evento/data della barra, IGNORANDO il filtro versione.
  const impactScope = (m) => {
    const f = S.filters;
    return inScope(m) && (!f.player || m.player === f.player) && (!f.event || m.event === f.event) &&
      (!f.from || (m.played_at || "") >= f.from) && (!f.to || (m.played_at || "") <= f.to);
  };
  // Match del mazzo con una versione esistente
  function impactMatches() {
    const ids = new Set(A.versions().map((v) => v.id));
    return A.deckMatches().filter((m) => ids.has(m.decklist_id) && impactScope(m));
  }
  // Match nello stesso ambito ma senza versione nota (non conteggiabili)
  function impactUnknownCount() {
    const ids = new Set(A.versions().map((v) => v.id));
    return A.deckMatches().filter((m) => !ids.has(m.decklist_id) && impactScope(m)).length;
  }

  // <impact-pure> logica pura (testabile): nessun accesso al DOM
  // Test esatto di Fisher a due code su [[a,b],[c,d]] (log-fattoriali).
  function fisherP(a, b, c, d) {
    const n1 = a + b, n2 = c + d, K = a + c, N = n1 + n2;
    if (!n1 || !n2 || !K || K === N) return 1;
    const lf = [0];
    for (let i = 1; i <= N; i++) lf[i] = lf[i - 1] + Math.log(i);
    const lp = (x) => lf[n1] - lf[x] - lf[n1 - x] + lf[n2] - lf[K - x] - lf[n2 - (K - x)] - (lf[N] - lf[K] - lf[N - K]);
    const lo = Math.max(0, K - n2), hi = Math.min(n1, K), pObs = lp(a);
    let p = 0;
    for (let x = lo; x <= hi; x++) { const v = lp(x); if (v <= pObs + 1e-9) p += Math.exp(v); }
    return Math.min(1, p);
  }

  // Cambiamenti tra versioni: vs = versioni (con match nell'ambito), byV = Map id versione -> match.
  function buildChanges(vs, byV) {
    const chrono = [...vs].sort((x, y) => (x.created_at || "").localeCompare(y.created_at || ""));
    const newest = chrono[chrono.length - 1];
    const allIds = chrono.map((v) => v.id);
    const entries = [];
    for (const zone of ["maindeck", "sideboard"]) {
      const maps = new Map(chrono.map((v) => [v.id, A.listMap(A.parseList(v[zone]))]));
      const names = new Map();
      for (const v of chrono) for (const [k, c] of maps.get(v.id)) names.set(k, c.name); // vince la più recente
      for (const [key, name] of names) {
        const q = new Map(chrono.map((v) => [v.id, maps.get(v.id).has(key) ? maps.get(v.id).get(key).q : 0]));
        const distinct = [...new Set(q.values())].sort((x, y) => x - y);
        if (distinct.length < 2) continue;
        const hi = distinct[distinct.length - 1];
        const more = allIds.filter((id) => q.get(id) === hi);
        const less = allIds.filter((id) => q.get(id) !== hi);
        entries.push({ key, zone, name, q, hi, lows: distinct.slice(0, -1), more, less, buckets: distinct.map((c) => ({ q: c, ids: allIds.filter((id) => q.get(id) === c) })) });
      }
    }
    // Una partizione delle versioni = un cambiamento. Il lato "con" è quello che contiene la versione più recente.
    const groups = new Map();
    for (const e of entries) {
      const sides = [e.more, e.less];
      const sig = sides.map((s) => s.join("|")).sort()[0]; // chiave simmetrica della partizione
      const withIds = e.more.includes(newest.id) ? e.more : e.less;
      const g = groups.get(sig) || { withIds, outIds: allIds.filter((id) => !withIds.includes(id)), items: [] };
      const plus = withIds === e.more;
      // conteggi sul lato "senza" (from) e sul lato "con" (to)
      const to = plus ? [e.hi] : e.lows, from = plus ? e.lows : [e.hi];
      g.items.push({ e, from, to, scalar: to.length === 1 && from.length === 1 });
      groups.set(sig, g);
    }
    const changes = [];
    for (const g of groups.values()) {
      const msOf = (ids) => ids.flatMap((id) => byV.get(id) || []);
      const sw = A.stats(msOf(g.withIds)), swo = A.stats(msOf(g.outIds));
      const delta = sw.n && swo.n ? sw.wr - swo.wr : null;
      const p = sw.n && swo.n ? fisherP(sw.W, sw.n - sw.W, swo.W, swo.n - swo.W) : 1;
      const low = Math.min(sw.n, swo.n) < A.LOW_N;
      const verdict = low ? "low" : p < 0.05 ? "net" : p < 0.2 ? "trend" : "none";
      // Chip: coppie carta main<->side con stesso numero di copie diventano "dal side al main"
      const chips = [], used = new Set();
      const byKey = new Map();
      for (const it of g.items) { if (!byKey.has(it.e.key)) byKey.set(it.e.key, []); byKey.get(it.e.key).push(it); }
      for (const its of byKey.values()) {
        const m = its.find((i) => i.e.zone === "maindeck" && i.scalar), s = its.find((i) => i.e.zone === "sideboard" && i.scalar);
        if (m && s) {
          const dm = m.to[0] - m.from[0], ds = s.to[0] - s.from[0];
          if (dm === -ds && dm !== 0) { chips.push({ kind: "move", name: m.e.name, txt: dm > 0 ? "dal side al main" : "dal main al side", k: Math.abs(dm) }); used.add(m); used.add(s); }
        }
      }
      for (const it of g.items) {
        if (used.has(it)) continue;
        const z = it.e.zone === "maindeck" ? "main" : "side";
        if (!it.scalar) { chips.push({ kind: "count", name: it.e.name, z, txt: `${it.from.join("/")}→${it.to.join("/")}` }); continue; }
        const f = it.from[0], t = it.to[0];
        if (f === 0) chips.push({ kind: "in", name: it.e.name, z, k: t });
        else if (t === 0) chips.push({ kind: "out", name: it.e.name, z, k: f });
        else chips.push({ kind: "count", name: it.e.name, z, txt: `${f}→${t}` });
      }
      const rank = (c) => (c.kind === "in" ? 0 : c.kind === "out" ? 1 : 2);
      chips.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
      const multi = new Set(g.items.map((i) => i.e.key)).size > 1;
      const detail = g.items.filter((i) => i.e.buckets.length > 2).map((i) => ({ name: i.e.name, zone: i.e.zone, buckets: i.e.buckets.map((b) => ({ q: b.q, s: A.stats(msOf(b.ids)) })) }));
      changes.push({ withIds: g.withIds, outIds: g.outIds, chips, multi, sw, swo, delta, p, verdict, detail, total: sw.n + swo.n });
    }
    const order = { net: 0, trend: 1, none: 2, low: 3 };
    return changes.sort((a, b) => order[a.verdict] - order[b.verdict] || b.total - a.total);
  }
  // </impact-pure>

  const fmtP = (p) => (p < 0.01 ? "< 0,01" : p.toFixed(2).replace(".", ","));
  function verdictInfo(c) {
    const ps = `(p = ${fmtP(c.p)})`;
    const small = c.sw.n <= c.swo.n ? ["con", c.sw.n] : ["senza", c.swo.n];
    if (c.verdict === "low") return { label: "Dati insufficienti", cls: "v-low", text: `Solo ${small[1]} match ${small[0]} il cambiamento: troppo pochi per dire qualcosa.` };
    if (c.verdict === "net") return { label: "Differenza netta", cls: c.delta >= 0 ? "v-pos" : "v-neg", text: `Differenza difficile da spiegare con il caso ${ps}.` };
    if (c.verdict === "trend") return { label: "Possibile tendenza", cls: c.delta >= 0 ? "v-pos-l" : "v-neg-l", text: `C'è un indizio, ma non abbastanza forte per fidarsi ${ps}: servono più match.` };
    if (small[1] < 10) return { label: "Nessuna differenza visibile", cls: "v-none", text: `Solo ${small[1]} match ${small[0]} il cambiamento: una differenza così può uscire anche per caso ${ps}.` };
    return { label: "Nessuna differenza visibile", cls: "v-none", text: `Le due percentuali sono compatibili tra loro ${ps}.` };
  }

  // Grafico a intervalli: punto = win rate, linea = IC 95% di Wilson
  function intervalSvg(sw, swo) {
    const X0 = 46, W = 206, x = (r) => (X0 + r * W).toFixed(1);
    const row = (label, s, y, cls) => {
      if (!s.n) return "";
      const tip = `<b>${esc(label)}</b>` + A.ttRows([["Match", `${s.W} vinti su ${s.n}`], ["Win rate", pct(s.wr, 1)], ["IC 95%", `${pct(s.ci[0])}–${pct(s.ci[1])}`]]);
      return `<g data-tip="${esc(tip)}"><rect x="0" y="${y - 9}" width="260" height="18" fill="transparent"/>
        <text x="0" y="${y + 3}" class="ic-lab">${label}</text>
        <line x1="${x(s.ci[0])}" x2="${x(s.ci[1])}" y1="${y}" y2="${y}" class="ic-line ${cls}"/>
        <line x1="${x(s.ci[0])}" x2="${x(s.ci[0])}" y1="${y - 3}" y2="${y + 3}" class="ic-line ${cls}"/>
        <line x1="${x(s.ci[1])}" x2="${x(s.ci[1])}" y1="${y - 3}" y2="${y + 3}" class="ic-line ${cls}"/>
        <circle cx="${x(s.wr)}" cy="${y}" r="4.5" class="ic-dot ${cls}"/></g>`;
    };
    return `<svg class="ic-svg" viewBox="0 0 260 46" role="img" aria-label="Win rate con intervallo di confidenza, con e senza il cambiamento">
      <line x1="${x(0.5)}" x2="${x(0.5)}" y1="2" y2="33" class="ic-ref"/>
      <line x1="${x(0)}" x2="${x(1)}" y1="33" y2="33" class="ic-axis"/>
      ${[0, 0.5, 1].map((t) => `<text x="${x(t)}" y="44" text-anchor="${t === 0 ? "start" : t === 1 ? "end" : "middle"}" class="ic-tick">${t * 100}%</text>`).join("")}
      ${row("con", sw, 10, "c1")}${row("senza", swo, 25, "c2")}</svg>`;
  }

  function chipHTML(ch) {
    const z = ch.z ? ` <small>(${ch.z})</small>` : "";
    if (ch.kind === "in") return `<span class="sb-in" data-card="${esc(ch.name)}">+${ch.k} ${esc(ch.name)}${z}</span>`;
    if (ch.kind === "out") return `<span class="sb-out" data-card="${esc(ch.name)}">${MINUS}${ch.k} ${esc(ch.name)}${z}</span>`;
    if (ch.kind === "move") return `<span class="ic-neu" data-card="${esc(ch.name)}">${esc(ch.name)}${ch.k > 1 ? ` ×${ch.k}` : ""}: ${ch.txt}</span>`;
    return `<span class="ic-neu" data-card="${esc(ch.name)}">${esc(ch.name)} ${esc(ch.txt)}${z}</span>`;
  }

  function changeHTML(c, vname) {
    const names = (ids) => ids.map((id) => esc(vname.get(id))).join(", ");
    const vi = verdictInfo(c), sw = c.sw, swo = c.swo;
    const dpp = c.delta == null ? null : Math.round(c.delta * 100);
    const diff = dpp == null ? "" : dpp === 0 ? ": stessa percentuale." : `: ${dpp > 0 ? "+" : MINUS}${Math.abs(dpp)} punti.`;
    const sentence = `Con questo cambiamento avete vinto <b>${sw.W} match su ${sw.n}</b> (${pct(sw.wr)}); senza, <b>${swo.W} su ${swo.n}</b> (${pct(swo.wr)})${diff || "."}`;
    return `<div class="ic-card ${vi.cls}">
      <div class="sb-sum ic-chips">${c.chips.map(chipHTML).join("")}</div>
      <div class="ic-vers small muted">Con, nelle versioni: ${names(c.withIds)}<br>Senza, nelle versioni: ${names(c.outIds)}</div>
      <p class="ic-sentence">${sentence}</p>
      <div class="ic-verdict"><span class="ic-badge">${vi.label}</span> <span class="small">${vi.text}</span></div>
      ${intervalSvg(sw, swo)}
      ${c.multi ? `<p class="small muted ic-note">Queste modifiche sono state fatte tutte insieme: non si può dire quale abbia contato.</p>` : ""}
      ${c.detail.map((d) => `<div class="small muted ic-detail">${esc(d.name)} (${d.zone === "maindeck" ? "main" : "side"}) per numero di copie: ${d.buckets.map((b) => `×${b.q}: ${b.s.W}/${b.s.n}${b.s.n ? ` (${pct(b.s.wr)})` : ""}`).join(" · ")}</div>`).join("")}
    </div>`;
  }

  function impactHTML() {
    const ms = impactMatches(), unk = impactUnknownCount();
    const f = S.filters, act = [f.player && `giocatore: ${f.player}`, f.event && `evento: ${f.event}`, f.from && `dal ${f.from}`, f.to && `al ${f.to}`].filter(Boolean);
    const byV = new Map();
    for (const m of ms) { if (!byV.has(m.decklist_id)) byV.set(m.decklist_id, []); byV.get(m.decklist_id).push(m); }
    const vs = A.versions().filter((v) => byV.has(v.id));
    const vname = new Map(vs.map((v) => [v.id, v.name]));
    const base = `${ms.length} match con una versione nota${unk ? ` (${unk} senza versione non ${unk === 1 ? "è conteggiato" : "sono conteggiati"})` : ""}${act.length ? ` · filtri attivi: ${esc(act.join(", "))}` : ""}`;
    let body;
    if (vs.length < 2) body = `<p class="muted">Servono match giocati con almeno due versioni diverse della lista${matchup ? ` contro ${esc(archName(matchup))}` : ""} per vedere cosa cambia. Per ora ce n'è ${vs.length}.</p>`;
    else {
      const changes = buildChanges(vs, byV);
      body = changes.length ? changes.map((c) => changeHTML(c, vname)).join("")
        : `<p class="muted">Le versioni con dei match hanno tutte le stesse carte (cambia solo il nome): non c'è nessun cambiamento da confrontare.</p>`;
    }
    return `<div class="card">
      <div class="section-head"><h2>Impatto delle carte${scopeTitle()}</h2><span class="muted small">${base}</span></div>
      <details class="ic-how" open><summary>Come leggere</summary>
        <p class="small">Ogni riquadro è <b>un cambiamento</b> fatto alla lista: le carte modificate insieme tra una versione e l'altra stanno nello stesso riquadro. <b>Con</b> sono i match giocati con le versioni che hanno il cambiamento, <b>senza</b> quelli giocati con le altre.</p>
        <p class="small">La barra mostra, per ciascun lato, il <b>punto</b> (win rate osservato) e la <b>linea</b> (l'intervallo in cui il vero win rate si trova probabilmente). Se le due linee si sovrappongono, i due lati non sono distinguibili. Con pochi match la fortuna pesa più della lista: un 100% su 3 match non dimostra nulla.</p>
      </details>
      ${body}
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
