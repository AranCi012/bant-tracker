// LEGACY v1: resta solo per chi ha in cache la vecchia index.html durante il passaggio alla v2. Da eliminare in seguito.
(() => {
  "use strict";

  // =====================================================================
  //  Config & utils
  // =====================================================================
  const CFG = window.APP_CONFIG || {};
  const REMOTE = !!(CFG.SUPABASE_URL && CFG.SUPABASE_KEY);
  const SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js";
  const LOW_N = 3; // sotto questo numero di match il dato è poco affidabile

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const lsKey = (k) => "bant." + k;
  const lsGet = (k, d) => { try { const v = localStorage.getItem(lsKey(k)); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(lsKey(k), JSON.stringify(v)); } catch { /* ignore */ } };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const today = () => new Date().toISOString().slice(0, 10);
  const pct = (x, d = 0) => (x == null || isNaN(x) ? "—" : (x * 100).toFixed(d) + "%");
  const fmtDate = (d) => { if (!d) return ""; const [y, m, g] = d.split("-"); return `${g}/${m}/${y.slice(2)}`; };

  const DEFAULT_ARCHETYPES = [
    "Dimir Tempo", "Izzet Delver", "Sneak and Show", "Doomsday", "Oops All Spells", "Reanimator", "Storm",
    "Death and Taxes", "Lands", "Eldrazi", "Elves / Cradle", "Painter", "Affinity / Saga", "Initiative",
    "Mystic Forge", "Control (4c / Beanstalk)", "Red Prison", "Bant mirror", "Altro",
  ];
  const EVENTS = ["MTGO League", "MTGO Challenge", "Torneo locale", "Torneo grande", "Playtest", "Altro"];

  // =====================================================================
  //  Storage: locale (localStorage) o remoto (Supabase)
  // =====================================================================
  const Local = {
    async init() {
      if (!lsGet("db_archetypes")) {
        lsSet("db_archetypes", DEFAULT_ARCHETYPES.map((name) => ({ id: uid(), name, sideboard_plan: "", notes: "", created_at: new Date().toISOString() })));
      }
      if (!lsGet("db_decklists")) lsSet("db_decklists", []);
      if (!lsGet("db_matches")) lsSet("db_matches", []);
    },
    async all(t) { return lsGet("db_" + t, []); },
    async insert(t, row) {
      const r = { id: uid(), created_at: new Date().toISOString(), ...row };
      const a = lsGet("db_" + t, []); a.push(r); lsSet("db_" + t, a); return r;
    },
    async update(t, id, patch) {
      const a = lsGet("db_" + t, []); const i = a.findIndex((x) => x.id === id);
      if (i < 0) throw new Error("Elemento non trovato");
      a[i] = { ...a[i], ...patch }; lsSet("db_" + t, a); return a[i];
    },
    async remove(t, id) { lsSet("db_" + t, lsGet("db_" + t, []).filter((x) => x.id !== id)); },
  };

  const Remote = {
    client: null,
    async load() {
      if (window.supabase) return;
      await new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = SUPABASE_CDN; s.onload = res; s.onerror = () => rej(new Error("Impossibile caricare Supabase"));
        document.head.appendChild(s);
      });
    },
    connect(key) {
      this.client = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {
        auth: { persistSession: false },
        global: { headers: { "x-group-key": key } },
      });
    },
    async check() {
      const { data, error } = await this.client.rpc("check_group_key");
      if (error) throw error;
      return data === true;
    },
    async init() {},
    async all(t) {
      const out = []; const page = 1000;
      for (let from = 0; ; from += page) {
        const { data, error } = await this.client.from(t).select("*").order("created_at").range(from, from + page - 1);
        if (error) throw error;
        out.push(...data);
        if (data.length < page) break;
      }
      return out;
    },
    async insert(t, row) { const { data, error } = await this.client.from(t).insert(row).select().single(); if (error) throw error; return data; },
    async update(t, id, patch) { const { data, error } = await this.client.from(t).update(patch).eq("id", id).select().single(); if (error) throw error; return data; },
    async remove(t, id) { const { error } = await this.client.from(t).delete().eq("id", id); if (error) throw error; },
  };

  const DB = REMOTE ? Remote : Local;

  // =====================================================================
  //  State
  // =====================================================================
  const S = {
    archetypes: [],
    decklists: [],
    matches: [],
    me: lsGet("me", ""),
    filters: Object.assign({ player: "", deck: "", event: "", from: "", to: "" }, lsGet("filters", {})),
    deckSel: null,
    histSort: "date",
  };

  async function reload() {
    const [a, d, m] = await Promise.all([DB.all("archetypes"), DB.all("decklists"), DB.all("matches")]);
    S.archetypes = a.sort((x, y) => x.name.localeCompare(y.name));
    S.decklists = d.sort((x, y) => (y.created_at || "").localeCompare(x.created_at || ""));
    S.matches = m;
  }

  const archById = (id) => S.archetypes.find((a) => a.id === id);
  const deckById = (id) => S.decklists.find((d) => d.id === id);
  const activeDeck = () => S.decklists.find((d) => d.is_active) || S.decklists[0];
  const players = () => [...new Set(S.matches.map((m) => m.player).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const chrono = (ms) => [...ms].sort((a, b) => (a.played_at || "").localeCompare(b.played_at || "") || (a.created_at || "").localeCompare(b.created_at || ""));

  // =====================================================================
  //  Stats
  // =====================================================================
  function gamesOf(m) {
    return [[m.g1, m.p1], [m.g2, m.p2], [m.g3, m.p3]]
      .map(([r, p], i) => ({ r, play: p, n: i + 1 }))
      .filter((g) => g.r === "W" || g.r === "L" || g.r === "D");
  }
  function matchResult(m) {
    const g = gamesOf(m);
    const w = g.filter((x) => x.r === "W").length, l = g.filter((x) => x.r === "L").length;
    return w > l ? "W" : l > w ? "L" : "D";
  }
  function wilson(k, n, z = 1.96) {
    if (!n) return null;
    const p = k / n, d = 1 + (z * z) / n;
    const c = (p + (z * z) / (2 * n)) / d;
    const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
    return [Math.max(0, c - h), Math.min(1, c + h)];
  }
  function stats(ms) {
    const s = { n: ms.length, W: 0, L: 0, D: 0, gW: 0, gL: 0, gD: 0, preW: 0, preN: 0, postW: 0, postN: 0, playW: 0, playN: 0, drawW: 0, drawN: 0, g1wM: 0, g1wMW: 0, g1lM: 0, g1lMW: 0 };
    for (const m of ms) {
      const r = matchResult(m); s[r]++;
      if (m.g1 === "W") { s.g1wM++; if (r === "W") s.g1wMW++; }
      if (m.g1 === "L") { s.g1lM++; if (r === "W") s.g1lMW++; }
      for (const g of gamesOf(m)) {
        const win = g.r === "W" ? 1 : 0;
        if (g.r === "W") s.gW++; else if (g.r === "L") s.gL++; else s.gD++;
        if (g.n === 1) { s.preN++; s.preW += win; } else { s.postN++; s.postW += win; }
        if (g.play === true) { s.playN++; s.playW += win; } else if (g.play === false) { s.drawN++; s.drawW += win; }
      }
    }
    s.gN = s.gW + s.gL + s.gD;
    s.wr = s.n ? s.W / s.n : null;
    s.gwr = s.gN ? s.gW / s.gN : null;
    s.pre = s.preN ? s.preW / s.preN : null;
    s.post = s.postN ? s.postW / s.postN : null;
    s.play = s.playN ? s.playW / s.playN : null;
    s.draw = s.drawN ? s.drawW / s.drawN : null;
    s.ci = wilson(s.W, s.n);
    return s;
  }
  const record = (s) => `${s.W}-${s.L}${s.D ? "-" + s.D : ""}`;

  function filtered() {
    const f = S.filters;
    return S.matches.filter((m) =>
      (!f.player || m.player === f.player) &&
      (!f.deck || m.decklist_id === f.deck) &&
      (!f.event || m.event === f.event) &&
      (!f.from || (m.played_at || "") >= f.from) &&
      (!f.to || (m.played_at || "") <= f.to));
  }
  function byArchetype(ms) {
    const g = new Map();
    for (const m of ms) { if (!g.has(m.archetype_id)) g.set(m.archetype_id, []); g.get(m.archetype_id).push(m); }
    return [...g.entries()].map(([id, list]) => ({ id, arch: archById(id), list, s: stats(list) }))
      .filter((x) => x.arch)
      .sort((a, b) => b.s.n - a.s.n || a.arch.name.localeCompare(b.arch.name));
  }

  // =====================================================================
  //  Colors (divergente rosso ← grigio → blu, 50% = neutro)
  // =====================================================================
  function hexToRgb(h) { h = h.trim().replace("#", ""); if (h.length === 3) h = h.split("").map((c) => c + c).join(""); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function wrColor(wr) {
    const mid = hexToRgb(cssVar("--mid")), win = hexToRgb(cssVar("--win")), loss = hexToRgb(cssVar("--loss"));
    const t = Math.max(-1, Math.min(1, (wr - 0.5) * 2));
    const pole = t >= 0 ? win : loss, a = Math.abs(t);
    const c = mid.map((v, i) => Math.round(v + (pole[i] - v) * a));
    return { bg: `rgb(${c.join(",")})`, fg: a > 0.55 ? "#fff" : "var(--text)" };
  }

  // =====================================================================
  //  UI helpers: toast, modal, tooltip
  // =====================================================================
  let toastT;
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2600);
  }
  function openModal(html, onMount) {
    $("#modal-body").innerHTML = html; $("#modal").hidden = false;
    document.body.style.overflow = "hidden";
    onMount && onMount($("#modal-body"));
  }
  function closeModal() { $("#modal").hidden = true; $("#modal-body").innerHTML = ""; document.body.style.overflow = ""; }
  document.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#modal").hidden) closeModal(); });

  const tip = $("#tooltip");
  function showTip(html, x, y) {
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > innerHeight - 8) top = y - r.height - 14;
    tip.style.left = Math.max(8, left) + "px"; tip.style.top = Math.max(8, top) + "px";
  }
  const hideTip = () => (tip.hidden = true);
  // Tooltip generico: elementi con data-tip (HTML già escapato)
  document.addEventListener("mousemove", (e) => {
    const el = e.target.closest("[data-tip]");
    if (el) showTip(el.dataset.tip, e.clientX, e.clientY);
    else if (!e.target.closest("[data-chart]")) hideTip();
  });
  const ttRows = (rows) => rows.map(([k, v]) => `<div class="tt-row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join("");

  async function guard(fn) {
    try { return await fn(); }
    catch (err) { console.error(err); toast("Errore: " + (err.message || err)); }
  }

  // =====================================================================
  //  Router
  // =====================================================================
  const VIEWS = { dashboard: viewDashboard, matchup: viewMatchup, history: viewHistory, deck: viewDeck, opponents: viewOpponents, add: viewAdd };
  function route() {
    if (!S.ready) return;
    const [name, arg] = (location.hash.replace("#", "") || "dashboard").split("/");
    const v = VIEWS[name] ? name : "dashboard";
    $$("#tabs a").forEach((a) => a.classList.toggle("active", a.dataset.view === v));
    $("#fab").hidden = v === "add";
    hideTip();
    VIEWS[v]($("#view"), arg ? decodeURIComponent(arg) : null);
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);

  function renderWho() {
    $("#who").innerHTML = S.me
      ? `Ciao <b>${esc(S.me)}</b> <button class="btn ghost sm" id="change-me">cambia</button>`
      : `<button class="btn sm" id="change-me">Chi sei?</button>`;
    $("#change-me").onclick = () => askName();
    if (REMOTE) {
      const out = document.createElement("button");
      out.className = "btn ghost sm"; out.textContent = "esci";
      out.onclick = () => { lsSet("groupKey", ""); location.reload(); };
      $("#who").appendChild(out);
    }
  }
  function askName(after) {
    openModal(`
      <h2>Come ti chiami?</h2>
      <p class="muted small">Serve per sapere chi ha giocato ogni partita (puoi filtrare per giocatore).</p>
      <form id="name-form" class="inline">
        <input id="name-in" list="players-dl" value="${esc(S.me)}" placeholder="es. Emanuele" required autocomplete="off">
        <datalist id="players-dl">${players().map((p) => `<option value="${esc(p)}">`).join("")}</datalist>
        <button class="btn primary">OK</button>
      </form>`, (root) => {
      $("#name-in", root).focus();
      $("#name-form", root).onsubmit = (e) => {
        e.preventDefault();
        S.me = $("#name-in", root).value.trim(); lsSet("me", S.me);
        closeModal(); renderWho(); after && after();
      };
    });
  }

  // =====================================================================
  //  Filters bar
  // =====================================================================
  function filtersHTML() {
    const f = S.filters;
    const opt = (v, l, sel) => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(l)}</option>`;
    const active = Object.values(f).some(Boolean);
    return `<div class="filters" id="filters">
      <select data-f="player" aria-label="Giocatore">${opt("", "Tutti i giocatori", f.player)}${players().map((p) => opt(p, p, f.player)).join("")}</select>
      <select data-f="deck" aria-label="Versione lista">${opt("", "Tutte le versioni lista", f.deck)}${S.decklists.map((d) => opt(d.id, d.name, f.deck)).join("")}</select>
      <select data-f="event" aria-label="Evento">${opt("", "Tutti gli eventi", f.event)}${EVENTS.map((e) => opt(e, e, f.event)).join("")}</select>
      <label class="small muted">dal <input type="date" data-f="from" value="${esc(f.from)}"></label>
      <label class="small muted">al <input type="date" data-f="to" value="${esc(f.to)}"></label>
      ${active ? `<button class="btn ghost sm chip-reset" id="f-reset">✕ Azzera filtri</button>` : ""}
    </div>`;
  }
  function bindFilters(root, rerender) {
    $$("[data-f]", root).forEach((el) => (el.onchange = () => { S.filters[el.dataset.f] = el.value; lsSet("filters", S.filters); rerender(); }));
    const r = $("#f-reset", root);
    if (r) r.onclick = () => { S.filters = { player: "", deck: "", event: "", from: "", to: "" }; lsSet("filters", S.filters); rerender(); };
  }

  function emptyState(msg) {
    return `<div class="card empty-state"><p>${msg}</p><a class="btn primary" href="#add">+ Registra la prima partita</a>
      ${!REMOTE && !S.matches.length ? `<div style="margin-top:10px"><button class="btn sm" id="demo">Carica dati demo per provare</button></div>` : ""}</div>`;
  }
  function bindDemo(root) { const b = $("#demo", root); if (b) b.onclick = () => guard(loadDemo); }

  // =====================================================================
  //  Dashboard
  // =====================================================================
  function viewDashboard(root) {
    const ms = filtered();
    const s = stats(ms);
    const groups = byArchetype(ms);
    root.innerHTML = `
      <div class="page-head"><h1>Dashboard</h1><span class="muted small">${ms.length} match${ms.length !== S.matches.length ? ` (su ${S.matches.length})` : ""}</span></div>
      ${filtersHTML()}
      ${!ms.length ? emptyState(S.matches.length ? "Nessun match con questi filtri." : "Ancora nessuna partita registrata.") : `
      <div class="kpis">
        ${kpi("Match win rate", pct(s.wr), `${record(s)}${s.ci ? ` · IC95 ${pct(s.ci[0])}–${pct(s.ci[1])}` : ""}`)}
        ${kpi("Game win rate", pct(s.gwr), `${s.gW}-${s.gL}${s.gD ? "-" + s.gD : ""} in ${s.gN} game`)}
        ${kpi("Pre-board (G1)", pct(s.pre), `${s.preW}/${s.preN} game`)}
        ${kpi("Post-board (G2/G3)", pct(s.post), `${s.postW}/${s.postN} game`)}
        ${kpi("On the play", pct(s.play), `${s.playW}/${s.playN} game`)}
        ${kpi("On the draw", pct(s.draw), `${s.drawW}/${s.drawN} game`)}
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
        <div class="card">
          <div class="section-head"><h2>Win rate per matchup</h2><a href="#matchup" class="small">Matrice completa →</a></div>
          ${wrBars(groups)}
          <div class="legend"><span>Barra = distanza da 50%</span><span>sbiadito = meno di ${LOW_N} match</span></div>
        </div>
        <div class="card">
          <div class="section-head"><h2>Chi incontriamo</h2><span class="muted small">% dei match</span></div>
          ${shareBars(groups, ms.length)}
        </div>
      </div>
      <div class="grid g2" style="margin-top:16px">
        <div class="card">
          <h2>G1 → risultato del match</h2>
          <p class="muted small" style="margin-top:0">Quanto pesa vincere/perdere la prima game.</p>
          ${confusionG1(s)}
        </div>
        <div class="card">
          <div class="section-head"><h2>Ultimi match</h2><a href="#history" class="small">Storico →</a></div>
          ${matchTable(chrono(ms).reverse().slice(0, 6), true)}
        </div>
      </div>`}`;
    bindFilters(root, () => viewDashboard(root));
    bindDemo(root);
    bindMatchRows(root);
    if (ms.length) trendChart($("#trend", root), chrono(ms));
  }

  const kpi = (label, value, sub) => `<div class="card kpi"><div class="label">${label}</div><div class="value num">${value}</div><div class="sub">${esc(sub)}</div></div>`;

  function wrBars(groups) {
    if (!groups.length) return `<p class="muted">—</p>`;
    const sorted = [...groups].sort((a, b) => b.s.wr - a.s.wr || b.s.n - a.s.n);
    return `<div class="bars">${sorted.map((g) => {
      const d = g.s.wr - 0.5, w = Math.abs(d) * 100; // % della traccia (metà = 50 punti)
      const cls = (d >= 0 ? "pos" : "neg") + (g.s.n < LOW_N ? " low" : "");
      const style = d >= 0 ? `left:50%;width:${w}%` : `left:${50 - w}%;width:${w}%`;
      const tipHtml = `<b>${esc(g.arch.name)}</b>` + ttRows([["Match", `${record(g.s)} (${pct(g.s.wr)})`], ["Game", pct(g.s.gwr)], ["Pre / Post", `${pct(g.s.pre)} / ${pct(g.s.post)}`], ["IC 95%", g.s.ci ? `${pct(g.s.ci[0])}–${pct(g.s.ci[1])}` : "—"]]);
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
      <div class="bar-row" data-tip="${esc(`<b>${esc(g.arch.name)}</b>` + ttRows([["Match", g.s.n], ["Quota", pct(g.s.n / total, 1)]]))}">
        <span class="name">${esc(g.arch.name)}</span>
        <span class="track"><span class="fill share" style="width:${(g.s.n / max) * 100}%"></span></span>
        <span class="val">${pct(g.s.n / total)} <span class="muted small">(${g.s.n})</span></span></div>`).join("")}</div>`;
  }
  function confusionG1(s) {
    const cell = (k, n) => {
      if (!n) return `<td class="cell empty">—</td>`;
      const c = wrColor(k / n);
      return `<td class="cell" style="background:${c.bg};color:${c.fg}">${pct(k / n)}<small>${k}/${n}</small></td>`;
    };
    const lossCell = (k, n) => {
      if (!n) return `<td class="cell empty">—</td>`;
      const c = wrColor(k / n); // colore sempre riferito al nostro win rate
      return `<td class="cell" style="background:${c.bg};color:${c.fg}">${pct((n - k) / n)}<small>${n - k}/${n}</small></td>`;
    };
    return `<div class="table-wrap"><table class="cm">
      <tr><th></th><th>Match vinto</th><th>Match non vinto</th></tr>
      <tr><th class="small">G1 vinta</th>${cell(s.g1wMW, s.g1wM)}${lossCell(s.g1wMW, s.g1wM)}</tr>
      <tr><th class="small">G1 persa</th>${cell(s.g1lMW, s.g1lM)}${lossCell(s.g1lMW, s.g1lM)}</tr>
    </table></div>`;
  }

  // Line chart SVG: WR cumulativo + rolling 10, con crosshair e tooltip
  function trendChart(el, ms) {
    const W = 760, H = 240, P = { l: 36, r: 12, t: 10, b: 24 };
    const pts = []; let w = 0;
    ms.forEach((m, i) => {
      const r = matchResult(m); if (r === "W") w++;
      const win = ms.slice(Math.max(0, i - 9), i + 1);
      pts.push({ i, m, r, cum: w / (i + 1), roll: win.filter((x) => matchResult(x) === "W").length / win.length });
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
      const a = archById(p.m.archetype_id);
      showTip(`<b>Match #${p.i + 1} · ${fmtDate(p.m.played_at)}</b>` + ttRows([["vs", a ? a.name : "?"], ["Risultato", p.r === "W" ? "Vinto" : p.r === "L" ? "Perso" : "Pari"], ["Cumulativo", pct(p.cum)], ["Ultimi 10", pct(p.roll)]]), e.clientX, e.clientY);
    };
    hit.addEventListener("mousemove", show);
    hit.addEventListener("mouseleave", () => { hideTip(); ["#xh", "#d1", "#d2"].forEach((id) => $(id, el).setAttribute("visibility", "hidden")); });
  }

  // =====================================================================
  //  Matchup (matrice) + dettaglio
  // =====================================================================
  function viewMatchup(root, archId) {
    if (archId) return viewMatchupDetail(root, archId);
    const ms = filtered();
    const groups = byArchetype(ms);
    const cols = [["wr", "Match", "W", "n"], ["gwr", "Game", "gW", "gN"], ["pre", "G1 (pre)", "preW", "preN"], ["post", "G2-3 (post)", "postW", "postN"], ["play", "On the play", "playW", "playN"], ["draw", "On the draw", "drawW", "drawN"]];
    const ps = players();
    root.innerHTML = `
      <div class="page-head"><h1>Matrice matchup</h1></div>
      ${filtersHTML()}
      ${!groups.length ? emptyState("Nessun match con questi filtri.") : `
      <div class="card">
        <div class="section-head"><h2>Matchup × situazione</h2><span class="muted small">Clicca un matchup per il dettaglio e il piano di sideboard</span></div>
        <div class="table-wrap"><table class="heat">
          <thead><tr><th></th><th class="r">Match</th>${cols.map((c) => `<th style="text-align:center">${c[1]}</th>`).join("")}</tr></thead>
          <tbody>${groups.map((g) => `<tr>
            <th class="rowh"><a href="#matchup/${encodeURIComponent(g.id)}">${esc(g.arch.name)}</a></th>
            <td class="r num muted">${g.s.n}</td>
            ${cols.map(([k, label, kk, nn]) => heatCell(g.s[k], g.s[kk], g.s[nn], `${g.arch.name} · ${label}`, k === "wr" ? record(g.s) : null, k === "wr" ? g.s.n : g.s.n)).join("")}
          </tr>`).join("")}
          ${(() => { const t = stats(ms); return `<tr><th class="rowh">Totale</th><td class="r num muted">${t.n}</td>${cols.map(([k, label, kk, nn]) => heatCell(t[k], t[kk], t[nn], `Totale · ${label}`, k === "wr" ? record(t) : null, t.n)).join("")}</tr>`; })()}
          </tbody></table></div>
        ${heatLegend()}
      </div>
      ${ps.length > 1 ? `<div class="card">
        <div class="section-head"><h2>Giocatore × matchup</h2><span class="muted small">Match win rate</span></div>
        <div class="table-wrap"><table class="heat">
          <thead><tr><th></th>${groups.map((g) => `<th style="text-align:center;white-space:normal;min-width:74px">${esc(g.arch.name)}</th>`).join("")}<th style="text-align:center">Totale</th></tr></thead>
          <tbody>${ps.map((p) => { const mine = ms.filter((m) => m.player === p); const tot = stats(mine); return `<tr><th class="rowh">${esc(p)}</th>${groups.map((g) => { const s = stats(mine.filter((m) => m.archetype_id === g.id)); return heatCell(s.wr, s.W, s.n, `${p} vs ${g.arch.name}`, record(s), s.n); }).join("")}${heatCell(tot.wr, tot.W, tot.n, `${p} · totale`, record(tot), tot.n)}</tr>`; }).join("")}</tbody>
        </table></div>
        ${heatLegend()}
      </div>` : ""}`}`;
    bindFilters(root, () => viewMatchup(root));
    bindDemo(root);
  }
  function heatCell(v, k, n, title, rec, matchN) {
    if (!n) return `<td class="cell empty">—</td>`;
    const c = wrColor(v);
    const low = matchN < LOW_N;
    const tipHtml = `<b>${esc(title)}</b>` + ttRows([["Win rate", pct(v, 1)], ["Vinti", `${k} su ${n}`], ...(rec ? [["Record", rec]] : []), ["IC 95%", (() => { const ci = wilson(k, n); return `${pct(ci[0])}–${pct(ci[1])}`; })()]]) + (low ? `<div class="tt-row"><span>⚠ campione piccolo</span><span></span></div>` : "");
    return `<td class="cell${low ? " low" : ""}" style="background-color:${c.bg};color:${c.fg}" data-tip="${esc(tipHtml)}">${pct(v)}<small>${k}/${n}</small></td>`;
  }
  const heatLegend = () => `<div class="legend"><span>0%</span><span class="ramp"></span><span>100%</span><span class="lowsw"></span><span>tratteggiato = meno di ${LOW_N} match</span><span>Pre/post/play/draw contano le game, non i match</span></div>`;

  function viewMatchupDetail(root, archId) {
    const a = archById(archId);
    if (!a) { root.innerHTML = `<p>Matchup non trovato. <a href="#matchup">Torna alla matrice</a></p>`; return; }
    const ms = filtered().filter((m) => m.archetype_id === archId);
    const s = stats(ms);
    root.innerHTML = `
      <div class="page-head"><div><a href="#matchup" class="small">← Matrice</a><h1>vs ${esc(a.name)}</h1></div>
        <a class="btn primary" href="#add/${encodeURIComponent(a.id)}">+ Partita vs ${esc(a.name)}</a></div>
      ${filtersHTML()}
      <div class="kpis">
        ${kpi("Match win rate", pct(s.wr), `${record(s)}${s.ci ? ` · IC95 ${pct(s.ci[0])}–${pct(s.ci[1])}` : ""}`)}
        ${kpi("Game win rate", pct(s.gwr), `${s.gW}/${s.gN} game`)}
        ${kpi("Pre-board", pct(s.pre), `${s.preW}/${s.preN}`)}
        ${kpi("Post-board", pct(s.post), `${s.postW}/${s.postN}`)}
        ${kpi("On the play", pct(s.play), `${s.playW}/${s.playN}`)}
        ${kpi("On the draw", pct(s.draw), `${s.drawW}/${s.drawN}`)}
      </div>
      <div class="grid g2">
        <div class="card">
          <div class="section-head"><h2>Piano di sideboard</h2><button class="btn sm" id="edit-arch">Modifica</button></div>
          ${a.sideboard_plan ? `<pre class="plan">${esc(a.sideboard_plan)}</pre>` : `<p class="muted">Nessun piano ancora. Clicca “Modifica” per scriverlo (es. “+2 Force of Negation −2 Swords”).</p>`}
          ${a.notes ? `<h3 style="margin-top:14px">Note</h3><pre class="plan">${esc(a.notes)}</pre>` : ""}
        </div>
        <div class="card"><h2>G1 → risultato</h2>${confusionG1(s)}</div>
      </div>
      <div class="card"><h2>Match</h2>${ms.length ? matchTable(chrono(ms).reverse()) : `<p class="muted">Nessun match.</p>`}</div>`;
    bindFilters(root, () => viewMatchupDetail(root, archId));
    bindMatchRows(root);
    $("#edit-arch", root).onclick = () => editArchetype(a, () => viewMatchupDetail(root, archId));
  }

  // =====================================================================
  //  Tabella match (storico)
  // =====================================================================
  function matchTable(ms, compact = false) {
    if (!ms.length) return `<p class="muted">Nessun match.</p>`;
    return `<div class="table-wrap"><table>
      <thead><tr><th>Data</th>${compact ? "" : "<th>Giocatore</th>"}<th>Avversario</th><th>Esito</th><th>Game</th>${compact ? "" : "<th>Lista</th><th>Evento</th><th>Note</th>"}</tr></thead>
      <tbody>${ms.map((m) => {
        const a = archById(m.archetype_id), d = deckById(m.decklist_id), r = matchResult(m), g = gamesOf(m);
        const gw = g.filter((x) => x.r === "W").length, gl = g.filter((x) => x.r === "L").length;
        return `<tr class="click" data-match="${esc(m.id)}">
          <td class="num">${fmtDate(m.played_at)}</td>
          ${compact ? "" : `<td>${esc(m.player)}</td>`}
          <td>${esc(a ? a.name : "?")}${m.opponent ? ` <span class="muted small">(${esc(m.opponent)})</span>` : ""}</td>
          <td><span class="pill ${r}">${r === "W" ? "V" : r === "L" ? "P" : "="} ${gw}-${gl}</span></td>
          <td><span class="gdots" title="${g.map((x) => `G${x.n}: ${x.r} ${x.play === true ? "play" : x.play === false ? "draw" : ""}`).join(" · ")}">${g.map((x) => `<i class="${x.r}"></i>`).join("")}</span>
            <span class="muted small">${m.p1 === true ? "play" : m.p1 === false ? "draw" : ""}</span></td>
          ${compact ? "" : `<td class="small">${esc(d ? d.name : "—")}</td><td class="small">${esc(m.event || "")}</td><td class="notes small">${esc(m.notes || "")}</td>`}
        </tr>`;
      }).join("")}</tbody></table></div>`;
  }
  function bindMatchRows(root) {
    $$("[data-match]", root).forEach((tr) => (tr.onclick = () => {
      const m = S.matches.find((x) => x.id === tr.dataset.match);
      if (m) openModal(`<h2>Modifica match</h2>${matchFormHTML(m)}`, (body) => bindMatchForm(body, m, () => { closeModal(); route(); }));
    }));
  }

  function viewHistory(root) {
    const ms = chrono(filtered()).reverse();
    root.innerHTML = `
      <div class="page-head"><h1>Storico</h1>
        <div class="inline">
          <button class="btn sm" id="exp-csv">Esporta CSV</button>
          <button class="btn sm" id="exp-json">Backup JSON</button>
          <label class="btn sm">Importa backup<input type="file" id="imp-json" accept=".json,application/json" hidden></label>
        </div></div>
      ${filtersHTML()}
      ${ms.length ? `<div class="card">${matchTable(ms)}<p class="muted small" style="margin-bottom:0">Clicca una riga per modificarla o eliminarla.</p></div>` : emptyState(S.matches.length ? "Nessun match con questi filtri." : "Ancora nessuna partita registrata.")}`;
    bindFilters(root, () => viewHistory(root));
    bindMatchRows(root);
    bindDemo(root);
    $("#exp-csv", root).onclick = () => exportCSV(ms);
    $("#exp-json", root).onclick = () => download(`bant-backup-${today()}.json`, JSON.stringify({ version: 1, archetypes: S.archetypes, decklists: S.decklists, matches: S.matches }, null, 2), "application/json");
    $("#imp-json", root).onchange = (e) => guard(() => importJSON(e.target.files[0]));
  }

  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function exportCSV(ms) {
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const pd = (p) => (p === true ? "play" : p === false ? "draw" : "");
    const head = ["data", "giocatore", "avversario", "nome_avversario", "lista", "evento", "risultato", "g1", "g1_play", "g2", "g2_play", "g3", "g3_play", "note"];
    const rows = ms.map((m) => [m.played_at, m.player, archById(m.archetype_id)?.name, m.opponent, deckById(m.decklist_id)?.name, m.event, matchResult(m), m.g1, pd(m.p1), m.g2, pd(m.p2), m.g3, pd(m.p3), m.notes]);
    download(`bant-match-${today()}.csv`, [head, ...rows].map((r) => r.map(q).join(",")).join("\n"), "text/csv");
  }
  async function importJSON(file) {
    if (!file) return;
    const data = JSON.parse(await file.text());
    if (!data.matches || !data.archetypes) throw new Error("File non valido");
    if (!confirm(`Importare ${data.matches.length} match? I match già presenti (stesso id) vengono saltati.`)) return;
    const archMap = {}, deckMap = {};
    for (const a of data.archetypes) {
      let ex = S.archetypes.find((x) => x.name.toLowerCase() === a.name.toLowerCase());
      if (!ex) { ex = await DB.insert("archetypes", { name: a.name, sideboard_plan: a.sideboard_plan || "", notes: a.notes || "" }); S.archetypes.push(ex); }
      archMap[a.id] = ex.id;
    }
    for (const d of data.decklists || []) {
      let ex = S.decklists.find((x) => x.id === d.id || (x.name === d.name && x.maindeck === d.maindeck));
      if (!ex) { ex = await DB.insert("decklists", { name: d.name, maindeck: d.maindeck || "", sideboard: d.sideboard || "", notes: d.notes || "", is_active: false }); S.decklists.push(ex); }
      deckMap[d.id] = ex.id;
    }
    const have = new Set(S.matches.map((m) => m.id));
    let n = 0;
    for (const m of data.matches) {
      if (have.has(m.id)) continue;
      const { id, created_at, ...rest } = m;
      await DB.insert("matches", { ...rest, archetype_id: archMap[m.archetype_id], decklist_id: m.decklist_id ? deckMap[m.decklist_id] || null : null });
      n++;
    }
    await reload(); toast(`Importati ${n} match`); route();
  }

  // =====================================================================
  //  Form partita
  // =====================================================================
  function matchFormHTML(m) {
    const isEdit = !!m.id;
    const ad = activeDeck();
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
        </div>
        <label class="field">Giocatore
          <input name="player" list="pl-dl" value="${esc(m.player ?? S.me)}" required placeholder="Il tuo nome">
          <datalist id="pl-dl">${players().map((p) => `<option value="${esc(p)}">`).join("")}</datalist>
        </label>
        <label class="field">Data <input type="date" name="played_at" value="${esc(m.played_at || today())}" required></label>
        <label class="field">Evento
          <select name="event">${EVENTS.map((e) => `<option${e === (m.event ?? lsGet("lastEvent", EVENTS[0])) ? " selected" : ""}>${esc(e)}</option>`).join("")}</select>
        </label>
        <label class="field">Versione lista
          <select name="decklist_id"><option value="">—</option>${S.decklists.map((d) => `<option value="${esc(d.id)}"${d.id === deckSel ? " selected" : ""}>${esc(d.name)}${d.is_active ? " (attiva)" : ""}</option>`).join("")}</select>
        </label>
        <label class="field">Nome avversario <span class="muted" style="font-weight:400">(opzionale)</span><input name="opponent" value="${esc(m.opponent || "")}" placeholder="nick MTGO, nome…"></label>
        <label class="field">Note <span class="muted" style="font-weight:400">(opzionale)</span><input name="notes" value="${esc(m.notes || "")}" placeholder="mulligan, carte chiave, errori…"></label>
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
      const fake = { g1: G[0].r, g2: G[1].r, g3: G[2].r };
      const gs = gamesOf(fake);
      const prev = $("#res-prev", root);
      if (!gs.length) prev.textContent = "";
      else {
        const r = matchResult(fake), w = gs.filter((x) => x.r === "W").length, l = gs.filter((x) => x.r === "L").length;
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
      guard(async () => {
        const ex = S.archetypes.find((a) => a.name.toLowerCase() === name.trim().toLowerCase());
        const a = ex || (await DB.insert("archetypes", { name: name.trim(), sideboard_plan: "", notes: "" }));
        if (!ex) { S.archetypes.push(a); S.archetypes.sort((x, y) => x.name.localeCompare(y.name)); }
        const sel = form.archetype_id;
        sel.innerHTML = `<option value="">— scegli —</option>` + S.archetypes.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("");
        sel.value = a.id;
      });
    };

    const del = $("#del-match", root);
    if (del) del.onclick = () => {
      if (!confirm("Eliminare questo match?")) return;
      guard(async () => { await DB.remove("matches", m.id); S.matches = S.matches.filter((x) => x.id !== m.id); toast("Match eliminato"); onSaved(); });
    };

    form.onsubmit = (e) => {
      e.preventDefault();
      if (!G[0].r) { toast("Indica almeno il risultato di G1"); return; }
      if (!form.archetype_id.value) { toast("Scegli l'archetipo avversario"); return; }
      const row = {
        archetype_id: form.archetype_id.value,
        player: form.player.value.trim(),
        played_at: form.played_at.value,
        event: form.event.value,
        decklist_id: form.decklist_id.value || null,
        opponent: form.opponent.value.trim(),
        notes: form.notes.value.trim(),
        g1: G[0].r, p1: G[0].p,
        g2: G[1].r, p2: G[1].r ? G[1].p : null,
        g3: G[2].r, p3: G[2].r ? G[2].p : null,
      };
      if (!row.player) { toast("Scrivi il nome del giocatore"); return; }
      $("#save-match", root).disabled = true;
      guard(async () => {
        if (m.id) {
          const u = await DB.update("matches", m.id, row);
          S.matches = S.matches.map((x) => (x.id === m.id ? u : x));
        } else {
          S.matches.push(await DB.insert("matches", row));
        }
        if (!S.me) { S.me = row.player; lsSet("me", S.me); renderWho(); }
        lsSet("lastEvent", row.event);
        const a = archById(row.archetype_id);
        toast(m.id ? "Match aggiornato" : `Salvato: ${matchResult(row) === "W" ? "vittoria" : matchResult(row) === "L" ? "sconfitta" : "pareggio"} vs ${a ? a.name : ""}`);
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

  // =====================================================================
  //  Decklist
  // =====================================================================
  function parseList(text) {
    const out = [];
    for (const raw of (text || "").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || /^(\/\/|#)/.test(line) || /^(deck|sideboard|maindeck|main)\s*:?$/i.test(line)) continue;
      const mm = line.match(/^(\d+)\s*x?\s+(.+?)\s*(\(.*\))?$/i);
      if (mm) out.push({ q: +mm[1], name: mm[2] });
      else out.push({ q: 1, name: line });
    }
    return out;
  }
  const countList = (l) => l.reduce((a, c) => a + c.q, 0);
  const scry = (name) => `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=normal`;
  const scryPage = (name) => `https://scryfall.com/search?q=${encodeURIComponent('!"' + name + '"')}`;

  function cardListHTML(cards) {
    return `<ul class="cardlist">${cards.map((c) => `<li><span class="q">${c.q}</span><a href="${scryPage(c.name)}" target="_blank" rel="noopener" data-card="${esc(c.name)}">${esc(c.name)}</a></li>`).join("")}</ul>`;
  }

  function viewDeck(root) {
    if (!S.decklists.length) {
      root.innerHTML = `<div class="page-head"><h1>La nostra lista</h1></div>
        <div class="card empty-state"><p>Nessuna lista salvata. Incolla la vostra Bant (formato MTGO/Arena: “4 Brainstorm”).</p>
        <button class="btn primary" id="new-deck">+ Aggiungi lista</button></div>`;
      $("#new-deck", root).onclick = () => editDeck(null);
      return;
    }
    const sel = deckById(S.deckSel) || activeDeck();
    S.deckSel = sel.id;
    const main = parseList(sel.maindeck), side = parseList(sel.sideboard);
    const nm = countList(main), ns = countList(side);
    const ds = stats(S.matches.filter((m) => m.decklist_id === sel.id));
    root.innerHTML = `
      <div class="page-head"><h1>La nostra lista</h1>
        <div class="inline"><button class="btn" id="new-deck">+ Nuova versione</button></div></div>
      <div class="deck-cols">
        <div class="card">
          <div class="section-head">
            <div><h2 style="margin:0">${esc(sel.name)} ${sel.is_active ? `<span class="badge">ATTIVA</span>` : ""}</h2>
              <span class="muted small">${ds.n ? `${record(ds)} · ${pct(ds.wr)} match WR con questa versione` : "Nessun match con questa versione"}</span></div>
            <div class="inline">
              ${sel.is_active ? "" : `<button class="btn sm" id="set-active">Rendi attiva</button>`}
              <button class="btn sm" id="edit-deck">Modifica</button>
              <button class="btn sm" id="dup-deck">Duplica</button>
              <button class="btn sm danger" id="del-deck">Elimina</button>
            </div>
          </div>
          <h3>Main deck · ${nm} ${nm !== 60 && nm ? `<span class="warn">(non sono 60)</span>` : ""}</h3>
          ${main.length ? cardListHTML(main) : `<p class="muted">Vuoto</p>`}
          <h3 style="margin-top:16px">Sideboard · ${ns} ${ns > 15 ? `<span class="warn">(più di 15)</span>` : ""}</h3>
          ${side.length ? cardListHTML(side) : `<p class="muted">Vuota</p>`}
          ${sel.notes ? `<h3 style="margin-top:16px">Note</h3><pre class="plan">${esc(sel.notes)}</pre>` : ""}
          <p class="muted small">Passa il mouse su una carta per vederla, clicca per aprirla su Scryfall.</p>
        </div>
        <div class="card">
          <h2>Versioni</h2>
          <p class="muted small" style="margin-top:0">Ogni match è collegato alla versione usata, così potete confrontarle.</p>
          <ul class="versions">${S.decklists.map((d) => { const s = stats(S.matches.filter((m) => m.decklist_id === d.id)); return `
            <li class="version${d.id === sel.id ? " sel" : ""}" data-deck="${esc(d.id)}">
              <span>${esc(d.name)} ${d.is_active ? `<span class="badge">ATTIVA</span>` : ""}<br><span class="muted small">${(d.created_at || "").slice(0, 10)}</span></span>
              <span class="num small">${s.n ? `${pct(s.wr)} <span class="muted">(${s.n})</span>` : `<span class="muted">—</span>`}</span>
            </li>`; }).join("")}</ul>
        </div>
      </div>`;
    $$("[data-deck]", root).forEach((li) => (li.onclick = () => { S.deckSel = li.dataset.deck; viewDeck(root); }));
    $("#new-deck", root).onclick = () => editDeck(null);
    $("#edit-deck", root).onclick = () => editDeck(sel);
    $("#dup-deck", root).onclick = () => editDeck({ ...sel, id: null, name: sel.name + " (nuova)", is_active: false });
    const sa = $("#set-active", root);
    if (sa) sa.onclick = () => guard(async () => { await setActive(sel.id); viewDeck(root); });
    $("#del-deck", root).onclick = () => {
      const used = S.matches.filter((m) => m.decklist_id === sel.id).length;
      if (!confirm(`Eliminare “${sel.name}”?${used ? ` I ${used} match collegati resteranno ma senza versione.` : ""}`)) return;
      guard(async () => {
        await DB.remove("decklists", sel.id);
        if (!REMOTE) for (const m of S.matches.filter((x) => x.decklist_id === sel.id)) await DB.update("matches", m.id, { decklist_id: null });
        await reload(); S.deckSel = null; viewDeck(root);
      });
    };
    bindCardHover(root);
  }

  function bindCardHover(root) {
    $$("[data-card]", root).forEach((a) => {
      a.addEventListener("mouseenter", (e) => showTip(`<img class="card-preview" alt="${esc(a.dataset.card)}" src="${scry(a.dataset.card)}">`, e.clientX, e.clientY));
      a.addEventListener("mousemove", (e) => showTip(tip.innerHTML, e.clientX, e.clientY));
      a.addEventListener("mouseleave", hideTip);
    });
  }

  async function setActive(id) {
    for (const d of S.decklists) {
      const want = d.id === id;
      if (!!d.is_active !== want) await DB.update("decklists", d.id, { is_active: want });
    }
    await reload();
    toast("Versione attiva aggiornata");
  }

  function editDeck(d) {
    const isEdit = !!(d && d.id);
    const v = d || { name: `Bant ${today()}`, maindeck: "", sideboard: "", notes: "" };
    openModal(`
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
        guard(async () => {
          if (isEdit) {
            await DB.update("decklists", d.id, row);
            await reload();
          } else {
            const makeActive = f.active.checked || !S.decklists.length;
            const n = await DB.insert("decklists", { ...row, is_active: false });
            await reload();
            if (makeActive) await setActive(n.id);
            S.deckSel = n.id;
          }
          closeModal(); toast("Lista salvata"); route();
        });
      };
    });
  }

  // =====================================================================
  //  Avversari (archetipi)
  // =====================================================================
  function viewOpponents(root) {
    const ms = filtered();
    root.innerHTML = `
      <div class="page-head"><h1>Avversari</h1><button class="btn primary" id="add-arch">+ Archetipo</button></div>
      <p class="muted" style="margin-top:-6px">Gli archetipi che incontrate, con piano di sideboard e note. Clicca per modificarli.</p>
      <div class="opp-list">${[...S.archetypes].sort((x, y) => ms.filter((m) => m.archetype_id === y.id).length - ms.filter((m) => m.archetype_id === x.id).length || x.name.localeCompare(y.name)).map((a) => {
        const s = stats(ms.filter((m) => m.archetype_id === a.id));
        return `<div class="card opp" data-arch="${esc(a.id)}">
          <div class="top"><span class="name">${esc(a.name)}</span>
            <span class="num small">${s.n ? `<b>${pct(s.wr)}</b> <span class="muted">${record(s)}</span>` : `<span class="muted">nessun match</span>`}</span></div>
          <div class="plan">${a.sideboard_plan ? esc(a.sideboard_plan) : `<span style="opacity:.7">Nessun piano di sideboard</span>`}</div>
        </div>`;
      }).join("")}</div>`;
    $("#add-arch", root).onclick = () => editArchetype(null, () => viewOpponents(root));
    $$("[data-arch]", root).forEach((el) => (el.onclick = () => editArchetype(archById(el.dataset.arch), () => viewOpponents(root))));
  }

  function editArchetype(a, after) {
    const isEdit = !!a;
    const used = isEdit ? S.matches.filter((m) => m.archetype_id === a.id).length : 0;
    openModal(`
      <h2>${isEdit ? esc(a.name) : "Nuovo archetipo"}</h2>
      <form id="arch-form" class="form-grid">
        <label class="field full">Nome <input name="name" value="${esc(a?.name || "")}" required></label>
        <label class="field full">Piano di sideboard <textarea name="plan" rows="6" placeholder="IN: +2 Force of Negation, +1 Flusterstorm&#10;OUT: −2 Swords to Plowshares, −1 …&#10;On the draw: …">${esc(a?.sideboard_plan || "")}</textarea></label>
        <label class="field full">Note sul matchup <textarea name="notes" rows="4" placeholder="Carte chiave dell'avversario, come mulligare, cosa temere…">${esc(a?.notes || "")}</textarea></label>
        <div class="row-actions full" style="justify-content:space-between">
          <span>${isEdit ? `<a class="btn sm" href="#matchup/${encodeURIComponent(a.id)}" data-close>Vedi statistiche</a>` : ""}</span>
          <span class="inline">
            ${isEdit ? `<button type="button" class="btn danger" id="del-arch"${used ? ` disabled title="Ha ${used} match collegati"` : ""}>Elimina</button>` : ""}
            <button class="btn primary">Salva</button></span>
        </div>
        ${isEdit && used ? `<p class="full small muted" style="margin:0">Non eliminabile: ha ${used} match collegati (puoi rinominarlo).</p>` : ""}
      </form>`, (body) => {
      const f = $("#arch-form", body);
      const del = $("#del-arch", body);
      if (del) del.onclick = () => {
        if (!confirm(`Eliminare “${a.name}”?`)) return;
        guard(async () => { await DB.remove("archetypes", a.id); await reload(); closeModal(); toast("Archetipo eliminato"); after(); });
      };
      f.onsubmit = (e) => {
        e.preventDefault();
        const name = f.name.value.trim();
        if (S.archetypes.some((x) => x.name.toLowerCase() === name.toLowerCase() && x.id !== a?.id)) { toast("Esiste già un archetipo con questo nome"); return; }
        const row = { name, sideboard_plan: f.plan.value.trim(), notes: f.notes.value.trim() };
        guard(async () => {
          if (isEdit) await DB.update("archetypes", a.id, row); else await DB.insert("archetypes", row);
          await reload(); closeModal(); toast("Salvato"); after();
        });
      };
    });
  }

  // =====================================================================
  //  Demo data (solo modalità locale)
  // =====================================================================
  async function loadDemo() {
    const deck = await DB.insert("decklists", {
      name: "Bant Phelia v1 (esempio)", is_active: true, notes: "Lista di esempio: sostituiscila con la vostra.",
      maindeck: "4 Brainstorm\n4 Ponder\n4 Force of Will\n4 Swords to Plowshares\n4 Phelia, Exuberant Shepherd\n4 Stoneforge Mystic\n…",
      sideboard: "2 Force of Negation\n…",
    });
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const bias = { "Dimir Tempo": 0.45, "Izzet Delver": 0.55, "Sneak and Show": 0.4, "Death and Taxes": 0.65, "Lands": 0.35, "Eldrazi": 0.6, "Reanimator": 0.5, "Doomsday": 0.45 };
    const archs = S.archetypes.filter((a) => bias[a.name] != null);
    const who = ["Emanuele", "Marco", "Luca"];
    const d0 = Date.now() - 60 * 864e5;
    for (let i = 0; i < 48; i++) {
      const a = pick(archs), p = bias[a.name];
      const g = (play) => (Math.random() < p + (play ? 0.05 : -0.05) ? "W" : "L");
      const p1 = Math.random() < 0.5, g1 = g(p1);
      const p2 = g1 === "L", g2 = g(p2);
      let g3 = null, p3 = null;
      if (g1 !== g2) { p3 = g2 === "L"; g3 = g(p3); }
      await DB.insert("matches", {
        archetype_id: a.id, player: pick(who), played_at: new Date(d0 + i * 1.25 * 864e5).toISOString().slice(0, 10),
        event: pick(EVENTS.slice(0, 3)), decklist_id: deck.id, opponent: "", notes: "", g1, p1, g2, p2, g3, p3,
      });
    }
    await reload(); toast("Dati demo caricati"); route();
  }

  // =====================================================================
  //  Boot
  // =====================================================================
  function loginScreen(errMsg) {
    $("#view").innerHTML = `<div class="login"><form class="card" id="login">
      <h1>${esc(CFG.APP_NAME || "Bant Meta Tracker")}</h1>
      <p class="muted" style="margin:0">Inserisci il codice del gruppo per vedere e registrare le partite.</p>
      <label class="field">Codice gruppo <input type="password" name="key" required autocomplete="current-password"></label>
      <label class="field">Il tuo nome <input name="me" value="${esc(S.me)}" required placeholder="es. Emanuele"></label>
      ${errMsg ? `<div class="err">${esc(errMsg)}</div>` : ""}
      <button class="btn primary big">Entra</button>
    </form></div>`;
    $("#fab").hidden = true;
    $("#tabs").hidden = true;
    $("#login").onsubmit = (e) => {
      e.preventDefault();
      const key = e.target.key.value.trim();
      S.me = e.target.me.value.trim(); lsSet("me", S.me);
      lsSet("groupKey", key);
      start();
    };
  }

  async function start() {
    $("#app-name").textContent = CFG.APP_NAME || "Bant Meta Tracker";
    try {
      if (REMOTE) {
        await Remote.load();
        const key = lsGet("groupKey", "");
        if (!key) return loginScreen();
        Remote.connect(key);
        if (!(await Remote.check())) { lsSet("groupKey", ""); return loginScreen("Codice non valido."); }
        $("#banner").hidden = true;
      } else {
        await Local.init();
        const b = $("#banner");
        b.hidden = false;
        b.innerHTML = `<b>Modalità locale</b>: i dati restano solo in questo browser. Per condividerli con gli amici configura Supabase in <code>config.js</code> (vedi README).`;
      }
      $("#view").innerHTML = `<p class="muted">Caricamento…</p>`;
      await reload();
      $("#tabs").hidden = false;
      renderWho();
      S.ready = true;
      route();
    } catch (err) {
      console.error(err);
      $("#view").innerHTML = `<div class="card"><h2>Qualcosa non va</h2><p class="err">${esc(err.message || err)}</p>
        <p class="muted small">Controlla config.js e di aver eseguito supabase/schema.sql. Se il progetto Supabase è in pausa, riattivalo dalla dashboard di Supabase.</p>
        <button class="btn" onclick="location.reload()">Riprova</button></div>`;
    }
  }

  start();
})();
