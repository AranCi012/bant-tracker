// =====================================================================
//  core.js — utilità, database, stato, statistiche, UI condivisa, router.
//  Tutto è esposto su window.App; le viste stanno in js/views/*.js e si
//  registrano con App.views.<nome> = function (root, arg) { ... }.
// =====================================================================
(() => {
  "use strict";

  const App = (window.App = window.App || {});
  App.views = App.views || {};

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
  // "mario  longo" -> "Mario Longo" (nomi dei nostri giocatori)
  const titleName = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, p, c) => p + c.toUpperCase());
  // Nomi dei mazzi avversari: sigle di colore in maiuscolo ("wr gatti" -> "WR gatti", "mono u S&T" -> "Mono U S&T"), prima lettera maiuscola
  const archName = (s) => { const t = String(s || "").trim().replace(/\s+/g, " ").split(" ").map((w) => (/^[wubrg]{1,3}$/.test(w) ? w.toUpperCase() : w)).join(" "); return t.charAt(0).toUpperCase() + t.slice(1); };
  const fmtDate = (d) => { if (!d) return ""; const [y, m, g] = d.split("-"); return `${g}/${m}/${y.slice(2)}`; };

  const DEFAULT_ARCHETYPES = [
    "Dimir Tempo", "Izzet Delver", "Sneak and Show", "Doomsday", "Oops All Spells", "Reanimator", "Storm",
    "Death and Taxes", "Lands", "Eldrazi", "Elves / Cradle", "Painter", "Affinity / Saga", "Initiative",
    "Mystic Forge", "Control (4c / Beanstalk)", "Red Prison", "Bant mirror", "Altro",
  ];
  const DEFAULT_GROUPS = ["Combo", "Control", "Tempo", "Aggro", "Midrange", "Prison", "Big mana"];
  const EVENTS = ["MTGO League", "MTGO Challenge", "Torneo locale", "Torneo grande", "Playtest", "Altro"];

  // ---- Liste di carte ("4 Brainstorm") --------------------------------
  // Nome normalizzato per confronti: minuscolo, spazi compattati, apostrofi uniformi.
  const cardKey = (name) => String(name || "").toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();
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
  // Map cardKey -> { name, q } sommando righe duplicate
  function listMap(list) {
    const m = new Map();
    for (const c of list) {
      const k = cardKey(c.name);
      if (m.has(k)) m.get(k).q += c.q; else m.set(k, { name: c.name, q: c.q });
    }
    return m;
  }
  const listToText = (list) => list.map((c) => `${c.q} ${c.name}`).join("\n");

  // =====================================================================
  //  Storage: locale (localStorage) o remoto (Supabase)
  //  Tabelle: decks, archetypes, decklists, matches, sideboard_guides
  // =====================================================================
  const TABLES = ["decks", "archetypes", "decklists", "matches", "sideboard_guides"];
  const now = () => new Date().toISOString();

  const Local = {
    async init() {
      if (!lsGet("db_archetypes")) {
        lsSet("db_archetypes", DEFAULT_ARCHETYPES.map((name) => ({ id: uid(), name, sideboard_plan: "", notes: "", created_at: now() })));
      }
      for (const t of [...TABLES, "archetype_groups"]) if (!lsGet("db_" + t)) lsSet("db_" + t, []);
      if (!lsGet("db_archetype_groups", []).length) lsSet("db_archetype_groups", DEFAULT_GROUPS.map((name, i) => ({ id: uid(), name, sort: i + 1, created_at: now() })));
      // Migrazione locale v1 -> v2 (come supabase/migrations/002): mazzo di default "Bant"
      let decks = lsGet("db_decks", []);
      if (!decks.length) { decks = [{ id: uid(), name: "Bant", notes: "", created_at: now() }]; lsSet("db_decks", decks); }
      const def = decks[0].id;
      for (const t of ["decklists", "matches"]) {
        const rows = lsGet("db_" + t, []);
        if (rows.some((r) => !r.deck_id)) lsSet("db_" + t, rows.map((r) => (r.deck_id ? r : { ...r, deck_id: def })));
      }
      const guides = lsGet("db_sideboard_guides", []);
      const arch = lsGet("db_archetypes", []);
      let changed = false;
      for (const a of arch) {
        if (a.sideboard_plan && !guides.some((g) => g.deck_id === def && g.archetype_id === a.id)) {
          guides.push({ id: uid(), deck_id: def, archetype_id: a.id, play_in: "", play_out: "", draw_in: "", draw_out: "", notes: a.sideboard_plan, created_at: now(), updated_at: now() });
          changed = true;
        }
      }
      if (changed) lsSet("db_sideboard_guides", guides);
    },
    async all(t) { return lsGet("db_" + t, []); },
    async insert(t, row) {
      const r = { id: uid(), created_at: now(), ...row };
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
    // 'edit' | 'view' | null. Se il database non ha ancora la migrazione 003 si ricade sul vecchio controllo (solo 'edit').
    async access() {
      const { data, error } = await this.client.rpc("access_level");
      if (!error) return data || null;
      return (await this.check()) ? "edit" : null;
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
    async insert(t, row) { readOnlyGuard(); const { data, error } = await this.client.from(t).insert(row).select().single(); if (error) throw error; return data; },
    async update(t, id, patch) { readOnlyGuard(); const { data, error } = await this.client.from(t).update(patch).eq("id", id).select().single(); if (error) throw error; return data; },
    async remove(t, id) { readOnlyGuard(); const { error } = await this.client.from(t).delete().eq("id", id); if (error) throw error; },
  };

  const DB = REMOTE ? Remote : Local;

  // ---- Sola lettura ------------------------------------------------------
  // Chi entra con il codice "solo visione" vede tutto ma non può scrivere: il database lo rifiuta comunque (RLS),
  // qui lo blocchiamo prima con un messaggio chiaro e l'interfaccia nasconde i controlli marcati data-edit.
  const canEdit = () => S.access !== "view";
  function readOnlyGuard() { if (!canEdit()) throw new Error("Accesso in sola lettura: non puoi modificare"); }
  async function getViewKey() {
    if (!REMOTE || !Remote.client) return null;
    try { const { data, error } = await Remote.client.rpc("get_view_key"); return error ? null : data || null; } catch { return null; }
  }

  // =====================================================================
  //  State
  // =====================================================================
  // group: id di un gruppo di archetipi, "__none" = mazzi senza gruppo
  const emptyFilters = () => ({ player: "", version: "", event: "", group: "", from: "", to: "" });
  const S = {
    decks: [],        // i NOSTRI mazzi (Bant, ...)
    archetypes: [],   // mazzi avversari (condivisi fra tutti i nostri mazzi)
    decklists: [],    // versioni delle liste (di tutti i mazzi), più recenti prima
    matches: [],      // tutti i match (di tutti i mazzi)
    guides: [],       // sideboard_guides (per coppia mazzo × archetipo)
    groups: [],       // archetype_groups: famiglie di archetipi (Combo, Control, ...)
    deckId: lsGet("deckId", ""),
    me: lsGet("me", ""),
    filters: emptyFilters(), // ogni visita parte da "tutti i match"
    deckSel: null,
    access: "edit",   // "edit" | "view"
    ready: false,
  };
  delete S.filters.deck; // filtro della v1, sostituito da "version"

  async function reload() {
    const [dk, a, d, m, g] = await Promise.all(TABLES.map((t) => DB.all(t)));
    S.decks = dk.sort((x, y) => (x.created_at || "").localeCompare(y.created_at || ""));
    S.archetypes = a.sort((x, y) => x.name.localeCompare(y.name));
    S.decklists = d.sort((x, y) => (y.created_at || "").localeCompare(x.created_at || ""));
    S.matches = m;
    S.guides = g;
    // I gruppi arrivano con la migrazione 004: se il database non l'ha ancora, l'app funziona lo stesso senza.
    S.groups = (await DB.all("archetype_groups").catch(() => [])).sort((x, y) => (x.sort || 0) - (y.sort || 0) || x.name.localeCompare(y.name));
    if (S.filters.group && S.filters.group !== "__none" && !S.groups.some((x) => x.id === S.filters.group)) S.filters.group = "";
    if (!S.decks.some((x) => x.id === S.deckId)) setDeck(S.decks[0] ? S.decks[0].id : "", true);
  }

  // ---- Mazzo corrente (funzione multi-mazzo) ---------------------------
  const currentDeck = () => S.decks.find((d) => d.id === S.deckId) || S.decks[0] || null;
  function setDeck(id, silent) {
    if (S.deckId !== id) { S.filters.version = ""; lsSet("filters", S.filters); S.deckSel = null; }
    S.deckId = id; lsSet("deckId", id);
    if (!silent) { renderDeckSwitch(); route(); }
  }
  // Versioni della lista del mazzo corrente (più recenti prima)
  const versions = () => { const d = currentDeck(); return d ? S.decklists.filter((v) => v.deck_id === d.id) : []; };
  const versionById = (id) => S.decklists.find((d) => d.id === id);
  const activeVersion = () => versions().find((d) => d.is_active) || versions()[0];
  // Tutti i match del mazzo corrente, senza filtri
  const deckMatches = () => { const d = currentDeck(); return d ? S.matches.filter((m) => m.deck_id === d.id) : []; };
  const guideFor = (archId, deckId) => { const d = deckId || (currentDeck() || {}).id; return S.guides.find((g) => g.deck_id === d && g.archetype_id === archId) || null; };
  async function saveGuide(archId, patch) {
    const d = currentDeck(); if (!d) throw new Error("Nessun mazzo selezionato");
    const g = guideFor(archId);
    const row = { ...patch, updated_at: now() };
    let saved;
    if (g) { saved = await DB.update("sideboard_guides", g.id, row); S.guides = S.guides.map((x) => (x.id === g.id ? saved : x)); }
    else { saved = await DB.insert("sideboard_guides", { deck_id: d.id, archetype_id: archId, play_in: "", play_out: "", draw_in: "", draw_out: "", notes: "", ...row }); S.guides.push(saved); }
    return saved;
  }

  // Carta di copertina: scelta nel mazzo, altrimenti la creatura con più copie della lista attiva
  const coverCache = new Map();
  async function coverCard(deck) {
    if (!deck) return "";
    if (deck.cover_card) return deck.cover_card;
    const v = versions().find((x) => x.is_active) || versions()[0];
    if (!v) return "";
    const key = deck.id + "|" + v.id + "|" + v.maindeck.length;
    if (coverCache.has(key)) return coverCache.get(key);
    const main = parseList(v.maindeck).sort((a, b) => b.q - a.q);
    let pick = main[0] ? main[0].name : "";
    if (App.cards && main.length) {
      const meta = await App.cards.lookup(main.map((c) => c.name));
      const cr = main.find((c) => { const m = meta.get(cardKey(c.name)); return m && m.type === "Creatura"; });
      if (cr) pick = cr.name;
    }
    coverCache.set(key, pick);
    return pick;
  }
  const artUrl = (name) => `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}&format=image&version=art_crop`;

  // Soprannomi delle carte del mazzo corrente (usati per leggere le note): { "spighe": "Up the Beanstalk" }
  const aliases = () => { const d = currentDeck(); return (d && d.card_aliases && typeof d.card_aliases === "object") ? d.card_aliases : {}; };
  async function saveAliases(map) {
    const d = currentDeck(); if (!d) throw new Error("Nessun mazzo selezionato");
    const clean = {};
    for (const [k, v] of Object.entries(map || {})) { const kk = cardKey(k), vv = String(v || "").trim(); if (kk && vv) clean[kk] = vv; }
    const u = await DB.update("decks", d.id, { card_aliases: clean });
    S.decks = S.decks.map((x) => (x.id === d.id ? { ...x, ...u } : x));
    return clean;
  }

  const archById = (id) => S.archetypes.find((a) => a.id === id);
  const players = () => [...new Set(S.matches.map((m) => m.player).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const chrono = (ms) => [...ms].sort((a, b) => (a.played_at || "").localeCompare(b.played_at || "") || (a.created_at || "").localeCompare(b.created_at || ""));

  // =====================================================================
  //  Stats
  // =====================================================================
  function gamesOf(m) {
    return [[m.g1, m.p1, null], [m.g2, m.p2, m.sb2], [m.g3, m.p3, m.sb3]]
      .map(([r, p, sb], i) => ({ r, play: p, n: i + 1, sb: sb || null }))
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

  // Match del mazzo corrente con i filtri della barra applicati
  function filtered() {
    const f = S.filters;
    return deckMatches().filter((m) =>
      (!f.player || m.player === f.player) &&
      (!f.version || m.decklist_id === f.version) &&
      (!f.event || m.event === f.event) &&
      (!f.group || (f.group === "__none" ? !groupOf(m.archetype_id) : (groupOf(m.archetype_id) || {}).id === f.group)) &&
      (!f.from || (m.played_at || "") >= f.from) &&
      (!f.to || (m.played_at || "") <= f.to));
  }
  // ---- Gruppi di archetipi --------------------------------------------
  const groupById = (id) => S.groups.find((g) => g.id === id) || null;
  const groupOf = (archId) => { const a = archById(archId); return a && a.group_id ? groupById(a.group_id) : null; };
  // Match raggruppati per gruppo: [{ id ("__none" = senza gruppo), group, name, list, s, archIds }]
  function byGroup(ms) {
    const g = new Map();
    for (const m of ms) {
      const gr = groupOf(m.archetype_id), id = gr ? gr.id : "__none";
      if (!g.has(id)) g.set(id, { id, group: gr, name: gr ? gr.name : "Senza gruppo", list: [], archIds: new Set() });
      const e = g.get(id); e.list.push(m); e.archIds.add(m.archetype_id);
    }
    return [...g.values()].map((e) => ({ ...e, archIds: [...e.archIds], s: stats(e.list) }))
      .sort((a, b) => (a.id === "__none") - (b.id === "__none") || b.s.n - a.s.n || a.name.localeCompare(b.name));
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
    else if (!e.target.closest("[data-chart],[data-card]")) hideTip();
  });
  const ttRows = (rows) => rows.map(([k, v]) => `<div class="tt-row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join("");

  async function guard(fn) {
    try { return await fn(); }
    catch (err) { console.error(err); toast("Errore: " + (err.message || err)); }
  }
  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  // Barra 0–100% colorata come le heatmap, con tacca al 50%
  const meter = (ratio) => (ratio == null || isNaN(ratio) ? "" : `<div class="meter" aria-hidden="true"><span style="width:${(Math.max(0, Math.min(1, ratio)) * 100).toFixed(1)}%;background:${ratio >= 0.5 ? "var(--win)" : "var(--loss)"}"></span><i></i></div>`);
  const kpi = (label, value, sub, ratio) => `<div class="card kpi"><div class="label">${label}</div><div class="value num">${value}</div>${meter(ratio)}<div class="sub">${esc(sub)}</div></div>`;

  // ---- Heatmap & matrice G1 (usate da più viste) ----------------------
  function heatCell(v, k, n, title, rec, matchN) {
    if (!n) return `<td class="cell empty">—</td>`;
    const c = wrColor(v);
    const low = matchN < LOW_N;
    const ci = wilson(k, n);
    const tipHtml = `<b>${esc(title)}</b>` + ttRows([["Win rate", pct(v, 1)], ["Vinti", `${k} su ${n}`], ...(rec ? [["Record", rec]] : []), ["IC 95%", `${pct(ci[0])}–${pct(ci[1])}`]]) + (low ? `<div class="tt-row"><span>⚠ campione piccolo</span><span></span></div>` : "");
    return `<td class="cell${low ? " low" : ""}" style="background-color:${c.bg};color:${c.fg}" data-tip="${esc(tipHtml)}">${pct(v)}<small>${k}/${n}</small></td>`;
  }
  const heatLegend = () => `<div class="legend"><span>0%</span><span class="ramp"></span><span>100%</span><span class="lowsw"></span><span>tratteggiato = meno di ${LOW_N} match</span><span>Pre/post/play/draw contano le game, non i match</span></div>`;
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

  // ---- Tabella match --------------------------------------------------
  function matchTable(ms, compact = false) {
    if (!ms.length) return `<p class="muted">Nessun match.</p>`;
    return `<div class="table-wrap"><table class="matches${compact ? " compact" : ""}">
      <thead><tr><th>Data</th>${compact ? "" : "<th>Giocatore</th>"}<th>Avversario</th><th>Esito</th><th>Game</th>${compact ? "" : "<th>Lista</th><th>Evento</th><th>Note</th>"}</tr></thead>
      <tbody>${ms.map((m) => {
        const a = archById(m.archetype_id), d = versionById(m.decklist_id), r = matchResult(m), g = gamesOf(m);
        const gw = g.filter((x) => x.r === "W").length, gl = g.filter((x) => x.r === "L").length;
        return `<tr class="click" data-match="${esc(m.id)}">
          <td class="num" data-label="Data">${fmtDate(m.played_at)}</td>
          ${compact ? "" : `<td data-label="Giocatore">${esc(m.player)}</td>`}
          <td data-label="Avversario">${esc(a ? a.name : "?")}${m.opponent ? ` <span class="muted small">(${esc(m.opponent)})</span>` : ""}</td>
          <td data-label="Esito"><span class="pill ${r}">${r === "W" ? "V" : r === "L" ? "P" : "="} ${gw}-${gl}</span></td>
          <td data-label="Game"><span class="gdots" title="${g.map((x) => `G${x.n}: ${x.r} ${x.play === true ? "play" : x.play === false ? "draw" : ""}`).join(" · ")}">${g.map((x) => `<i class="${x.r}"></i>`).join("")}</span>
            <span class="muted small">${m.p1 === true ? "play" : m.p1 === false ? "draw" : ""}</span></td>
          ${compact ? "" : `<td class="small" data-label="Lista">${esc(d ? d.name : "—")}</td><td class="small" data-label="Evento">${esc(m.event || "")}</td><td class="notes small" data-label="Note">${esc(m.notes || "")}</td>`}
        </tr>`;
      }).join("")}</tbody></table></div>`;
  }
  function bindMatchRows(root) {
    if (!canEdit()) { $$("[data-match]", root).forEach((tr) => tr.classList.remove("click")); return; }
    $$("[data-match]", root).forEach((tr) => (tr.onclick = () => {
      const m = S.matches.find((x) => x.id === tr.dataset.match);
      if (m) openModal(`<h2>Modifica match</h2>${App.matchFormHTML(m)}`, (body) => App.bindMatchForm(body, m, () => { closeModal(); route(); }));
    }));
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
      <select data-f="version" aria-label="Versione lista">${opt("", "Tutte le versioni lista", f.version)}${versions().map((d) => opt(d.id, d.name, f.version)).join("")}</select>
      <select data-f="event" aria-label="Evento">${opt("", "Tutti gli eventi", f.event)}${EVENTS.map((e) => opt(e, e, f.event)).join("")}</select>
      ${S.groups.length ? `<select data-f="group" aria-label="Gruppo avversario">${opt("", "Tutti i gruppi", f.group)}${S.groups.map((g) => opt(g.id, g.name, f.group)).join("")}${opt("__none", "Senza gruppo", f.group)}</select>` : ""}
      <label class="small muted">dal <input type="date" data-f="from" value="${esc(f.from)}"></label>
      <label class="small muted">al <input type="date" data-f="to" value="${esc(f.to)}"></label>
      ${active ? `<button class="btn ghost sm chip-reset" id="f-reset">✕ Azzera filtri</button>` : ""}
    </div>
    ${active ? `<div class="filter-warn" role="status">🔎 Filtri attivi: stai vedendo <b>${filtered().length}</b> match su <b>${deckMatches().length}</b>. <button class="btn sm" id="f-reset2">Mostra tutti</button></div>` : ""}`;
  }
  function bindFilters(root, rerender) {
    $$("[data-f]", root).forEach((el) => (el.onchange = () => { S.filters[el.dataset.f] = el.value; lsSet("filters", S.filters); rerender(); }));
    const r2 = $("#f-reset2", root);
    if (r2) r2.onclick = () => { S.filters = emptyFilters(); lsSet("filters", S.filters); rerender(); };
    const r = $("#f-reset", root);
    if (r) r.onclick = () => { S.filters = emptyFilters(); lsSet("filters", S.filters); rerender(); };
  }

  function emptyState(msg) {
    if (!canEdit()) return `<div class="card empty-state"><p>${msg}</p></div>`;
    return `<div class="card empty-state"><p>${msg}</p><a class="btn primary" href="#add">+ Registra la prima partita</a>
      ${!REMOTE && !S.matches.length ? `<div style="margin-top:10px"><button class="btn sm" id="demo">Carica dati demo per provare</button></div>` : ""}</div>`;
  }
  function bindDemo(root) { const b = $("#demo", root); if (b) b.onclick = () => guard(loadDemo); }

  // =====================================================================
  //  Router
  // =====================================================================
  function route() {
    if (!S.ready) return;
    const [name, arg] = (location.hash.replace("#", "") || "dashboard").split("/");
    const v = App.views[name] ? name : "dashboard";
    const tab = { players: "opponents", groups: "opponents", report: "sideboard" }[v] || v;
    $$("#tabs a").forEach((a) => a.classList.toggle("active", a.dataset.view === tab));
    $("#fab").hidden = v === "add" || !canEdit();
    hideTip();
    if (!currentDeck()) { viewNoDeck($("#view")); return; }
    App.views[v]($("#view"), arg ? decodeURIComponent(arg) : null);
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);

  function viewNoDeck(root) {
    if (!canEdit()) { root.innerHTML = `<div class="card empty-state"><p>Nessun mazzo ancora.</p></div>`; return; }
    root.innerHTML = `<div class="card empty-state"><p>Crea il primo mazzo che giocate (es. “Bant”).</p><button class="btn primary" id="nd">+ Nuovo mazzo</button></div>`;
    $("#nd", root).onclick = () => editDeckEntity(null);
  }

  // ---- Barra in alto: utente + selettore mazzo -------------------------
  function renderWho() {
    // Ospiti in sola lettura: in alto a destra solo "condividi" (il loro link di sola lettura, da passare ad altri)
    if (!canEdit()) {
      $("#who").hidden = false;
      $("#who").innerHTML = "";
      if (App.mobile && App.mobile.openInvite) {
        const sh = document.createElement("button");
        sh.className = "btn ghost sm"; sh.textContent = "condividi"; sh.id = "invite-btn";
        sh.onclick = () => App.mobile.openInvite();
        $("#who").appendChild(sh);
      }
      return;
    }
    $("#who").hidden = false;
    $("#who").innerHTML = S.me
      ? `Ciao <b>${esc(S.me)}</b> <button class="btn ghost sm" id="change-me">cambia</button>`
      : `<button class="btn sm" id="change-me">Chi sei?</button>`;
    if ($("#change-me")) $("#change-me").onclick = () => askName();
    if (App.mobile && App.mobile.openInvite) {
      const inv = document.createElement("button");
      inv.className = "btn ghost sm"; inv.textContent = "invita"; inv.id = "invite-btn";
      inv.onclick = () => App.mobile.openInvite();
      $("#who").appendChild(inv);
    }
    if (REMOTE) {
      const out = document.createElement("button");
      out.className = "btn ghost sm"; out.textContent = "esci";
      out.onclick = () => { lsSet("groupKey", ""); location.reload(); };
      $("#who").appendChild(out);
    }
  }
  function renderDeckSwitch() {
    const el = $("#deck-switch");
    if (!el) return;
    const cur = currentDeck();
    el.innerHTML = S.decks.map((d) => `<option value="${esc(d.id)}"${cur && d.id === cur.id ? " selected" : ""}>${esc(d.name)}</option>`).join("")
      + (canEdit() ? `<option value="__manage">⚙ Gestisci mazzi…</option>` : "");
    el.onchange = () => {
      if (el.value === "__manage") { el.value = cur ? cur.id : ""; manageDecks(); return; }
      setDeck(el.value);
    };
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
        S.me = titleName($("#name-in", root).value); lsSet("me", S.me);
        closeModal(); renderWho(); after && after();
      };
    });
  }

  // ---- Gestione dei nostri mazzi ---------------------------------------
  function manageDecks() {
    openModal(`
      <h2>I nostri mazzi</h2>
      <p class="muted small" style="margin-top:0">Ogni mazzo ha le sue liste, i suoi match, le sue guide di sideboard e le sue statistiche. Gli archetipi avversari sono condivisi.</p>
      <ul class="versions">${S.decks.map((d) => {
        const s = stats(S.matches.filter((m) => m.deck_id === d.id));
        return `<li class="version" data-edit-deck="${esc(d.id)}"><span><b>${esc(d.name)}</b><br><span class="muted small">${S.decklists.filter((v) => v.deck_id === d.id).length} versioni lista</span></span>
          <span class="inline deck-row-r"><span class="num small">${s.n ? `${pct(s.wr)} <span class="muted">${record(s)}</span>` : `<span class="muted">nessun match</span>`}</span>
            <button type="button" class="btn sm" data-edit-btn="${esc(d.id)}">Modifica</button>
            <button type="button" class="btn sm danger" data-del-deck="${esc(d.id)}">Elimina</button></span></li>`;
      }).join("")}</ul>
      <div class="row-actions"><button class="btn primary" id="add-deck">+ Nuovo mazzo</button></div>`, (body) => {
      $("#add-deck", body).onclick = () => editDeckEntity(null);
      $$("[data-edit-deck]", body).forEach((li) => (li.onclick = () => editDeckEntity(S.decks.find((d) => d.id === li.dataset.editDeck))));
      $$("[data-edit-btn]", body).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); editDeckEntity(S.decks.find((d) => d.id === b.dataset.editBtn)); }));
      $$("[data-del-deck]", body).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); deleteDeckFlow(S.decks.find((d) => d.id === b.dataset.delDeck)); }));
    });
  }
  function editDeckEntity(d) {
    const used = d ? S.matches.filter((m) => m.deck_id === d.id).length : 0;
    openModal(`
      <h2>${d ? "Modifica mazzo" : "Nuovo mazzo"}</h2>
      <form id="deck-ent" class="form-grid">
        <label class="field full">Nome <input name="name" value="${esc(d ? d.name : "")}" required placeholder="es. Bant, Dimir Tempo, Lands…"></label>
        <label class="field full">Carta di copertina <span class="muted" style="font-weight:400">(opzionale: la sua illustrazione appare in cima alla dashboard)</span>
          <input name="cover_card" value="${esc(d ? d.cover_card || "" : "")}" placeholder="es. Phelia, Exuberant Shepherd — vuoto = scelta automatica"></label>
        <label class="field full">Note <textarea name="notes" rows="3">${esc(d ? d.notes : "")}</textarea></label>
        <div class="row-actions full" style="justify-content:space-between">
          <span>${d ? `<button type="button" class="btn danger" id="del-deck-ent">Elimina</button>` : ""}</span>
          <span class="inline"><button type="button" class="btn" id="back-decks">Indietro</button><button class="btn primary">Salva</button></span>
        </div>
      </form>`, (body) => {
      const f = $("#deck-ent", body);
      $("#back-decks", body).onclick = () => (S.decks.length ? manageDecks() : closeModal());
      const del = $("#del-deck-ent", body);
      if (del) del.onclick = () => deleteDeckFlow(d);
      f.onsubmit = (e) => {
        e.preventDefault();
        const name = f.name.value.trim();
        if (S.decks.some((x) => x.name.toLowerCase() === name.toLowerCase() && (!d || x.id !== d.id))) { toast("Esiste già un mazzo con questo nome"); return; }
        guard(async () => {
          const row = { name, notes: f.notes.value.trim(), cover_card: f.cover_card.value.trim() };
          if (d) await DB.update("decks", d.id, row);
          else { const n = await DB.insert("decks", row); S.deckId = n.id; lsSet("deckId", n.id); S.filters.version = ""; }
          await reload(); closeModal(); renderDeckSwitch(); route(); toast(d ? "Mazzo aggiornato" : `Ora stai guardando “${name}”`);
        });
      };
    });
  }
  // ---- Eliminazione di un mazzo, con backup obbligatorio ----------------
  // Prima di cancellare scarica un file JSON con tutti i dati del mazzo (match, liste, guide + archetipi e gruppi
  // per poterlo reimportare da Storico -> Importa backup). Serve scrivere il nome del mazzo per confermare.
  function deckBackup(d) {
    return {
      version: 2, backup_of_deck: d.name, created_at: now(),
      decks: [d],
      archetypes: S.archetypes, archetype_groups: S.groups,
      decklists: S.decklists.filter((v) => v.deck_id === d.id),
      matches: S.matches.filter((m) => m.deck_id === d.id),
      sideboard_guides: S.guides.filter((g) => g.deck_id === d.id),
    };
  }
  function deleteDeckFlow(d) {
    if (!d) return;
    const nM = S.matches.filter((m) => m.deck_id === d.id).length;
    const nV = S.decklists.filter((v) => v.deck_id === d.id).length;
    const nG = S.guides.filter((g) => g.deck_id === d.id).length;
    const last = S.decks.length === 1;
    openModal(`
      <h2>Elimina “${esc(d.name)}”</h2>
      <p>Verranno cancellati definitivamente: <b>${nM} match</b>, <b>${nV} ${nV === 1 ? "versione" : "versioni"} della lista</b> e <b>${nG} ${nG === 1 ? "guida" : "guide"} di sideboard</b> di questo mazzo. Gli archetipi avversari e gli altri mazzi non vengono toccati.</p>
      <p class="small">🛟 Prima di eliminare viene <b>scaricato automaticamente un backup</b> (file .json) con tutti questi dati: si può reimportare da <b>Storico → Importa backup</b>.</p>
      ${last ? `<p class="small warn">È il vostro unico mazzo: dopo l'eliminazione ne dovrete creare uno nuovo.</p>` : ""}
      <label class="field">Per confermare scrivi il nome del mazzo <input id="del-confirm" autocomplete="off" placeholder="${esc(d.name)}"></label>
      <div class="row-actions" style="justify-content:space-between">
        <button type="button" class="btn" id="del-back">Annulla</button>
        <button type="button" class="btn danger" id="del-go" disabled>Scarica backup ed elimina</button>
      </div>`, (body) => {
      const inp = $("#del-confirm", body), go = $("#del-go", body);
      inp.oninput = () => { go.disabled = inp.value.trim().toLowerCase() !== d.name.trim().toLowerCase(); };
      inp.focus();
      $("#del-back", body).onclick = () => manageDecks();
      go.onclick = () => guard(async () => {
        go.disabled = true; go.textContent = "Elimino…";
        const file = `backup-mazzo-${d.name.replace(/[^\w-]+/g, "_")}-${today()}.json`;
        download(file, JSON.stringify(deckBackup(d), null, 2), "application/json");
        // i match bloccano l'eliminazione del mazzo (vincolo nel database): si cancellano prima, poi il mazzo (liste e guide vanno via con lui)
        for (const m of S.matches.filter((x) => x.deck_id === d.id)) await DB.remove("matches", m.id);
        await DB.remove("decks", d.id);
        if (!REMOTE) await localCascadeDeck(d.id);
        await reload(); closeModal(); renderDeckSwitch(); route();
        toast(`“${d.name}” eliminato · backup scaricato: ${file}`);
      }).finally(() => { if (go.isConnected) { go.textContent = "Scarica backup ed elimina"; } });
    });
  }
  async function localCascadeDeck(id) {
    for (const t of ["decklists", "sideboard_guides"]) lsSet("db_" + t, lsGet("db_" + t, []).filter((r) => r.deck_id !== id));
  }

  // =====================================================================
  //  Demo data (solo modalità locale)
  // =====================================================================
  async function loadDemo() {
    const deckId = currentDeck().id;
    const v = await DB.insert("decklists", {
      deck_id: deckId, name: "Bant Phelia v1 (esempio)", is_active: true, notes: "Lista di esempio: sostituiscila con la vostra.",
      maindeck: "4 Brainstorm\n4 Ponder\n4 Force of Will\n4 Swords to Plowshares\n4 Phelia, Exuberant Shepherd\n4 Stoneforge Mystic\n2 Force of Negation\n4 Stifle",
      sideboard: "2 Force of Negation\n2 Containment Priest\n3 Consign to Memory\n2 Wrath of the Skies",
    });
    const v2 = await DB.insert("decklists", {
      deck_id: deckId, name: "Bant Phelia v2 (esempio)", is_active: false, notes: "",
      maindeck: "4 Brainstorm\n4 Ponder\n4 Force of Will\n3 Swords to Plowshares\n4 Phelia, Exuberant Shepherd\n4 Stoneforge Mystic\n2 Force of Negation\n4 Stifle\n1 Prismatic Ending",
      sideboard: "1 Force of Negation\n2 Containment Priest\n3 Consign to Memory\n2 Wrath of the Skies\n1 Hydroblast",
    });
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const bias = { "Dimir Tempo": 0.45, "Izzet Delver": 0.55, "Sneak and Show": 0.4, "Death and Taxes": 0.65, "Lands": 0.35, "Eldrazi": 0.6, "Reanimator": 0.5, "Doomsday": 0.45 };
    const archs = S.archetypes.filter((a) => bias[a.name] != null);
    const who = ["Emanuele", "Marco", "Luca"];
    const d0 = Date.now() - 60 * 864e5;
    const sbIn = [{ q: 2, name: "Containment Priest" }, { q: 1, name: "Hydroblast" }], sbOut = [{ q: 2, name: "Stifle" }, { q: 1, name: "Ponder" }];
    for (let i = 0; i < 48; i++) {
      const a = pick(archs), p = bias[a.name];
      const g = (play) => (Math.random() < p + (play ? 0.05 : -0.05) ? "W" : "L");
      const p1 = Math.random() < 0.5, g1 = g(p1);
      const p2 = g1 === "L", g2 = g(p2);
      let g3 = null, p3 = null;
      if (g1 !== g2) { p3 = g2 === "L"; g3 = g(p3); }
      const sb = Math.random() < 0.6 ? { in: sbIn, out: sbOut } : null;
      await DB.insert("matches", {
        deck_id: deckId, archetype_id: a.id, player: pick(who), played_at: new Date(d0 + i * 1.25 * 864e5).toISOString().slice(0, 10),
        event: pick(EVENTS.slice(0, 3)), decklist_id: i < 24 ? v.id : v2.id, opponent: "", notes: "", g1, p1, g2, p2, g3, p3,
        sb2: sb, sb3: g3 ? sb : null,
      });
    }
    await reload(); toast("Dati demo caricati"); route();
  }

  // =====================================================================
  //  Boot
  // =====================================================================
  function loginScreen(errMsg) {
    $("#view").innerHTML = `<div class="login"><form class="card" id="login">
      <h1>${esc(CFG.APP_NAME || "Meta Tracker")}</h1>
      <p class="muted" style="margin:0">Inserisci il codice del gruppo per vedere e registrare le partite.</p>
      <label class="field">Codice gruppo <input type="password" name="key" required autocomplete="current-password" value="${esc(lsGet("groupKeyHint", ""))}"></label>
      <label class="field">Il tuo nome <input name="me" value="${esc(S.me)}" required placeholder="es. Emanuele"></label>
      ${errMsg ? `<div class="err">${esc(errMsg)}</div>` : ""}
      <button class="btn primary big">Entra</button>
    </form></div>`;
    $("#fab").hidden = true;
    $("#tabs").hidden = true;
    $("#deck-switch-wrap").hidden = true;
    $("#login").onsubmit = (e) => {
      e.preventDefault();
      const key = e.target.key.value.trim();
      S.me = titleName(e.target.me.value); lsSet("me", S.me);
      lsSet("groupKey", key);
      start();
    };
  }

  async function start() {
    $("#app-name").textContent = CFG.APP_NAME || "Meta Tracker";
    try {
      if (REMOTE) {
        await Remote.load();
        const key = lsGet("groupKey", "");
        if (!key) return loginScreen();
        Remote.connect(key);
        const lvl = await Remote.access();
        if (!lvl) { lsSet("groupKey", ""); return loginScreen("Codice non valido."); }
        S.access = lvl;
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
      $("#deck-switch-wrap").hidden = false;
      document.body.classList.toggle("readonly", !canEdit());
      renderWho();
      renderDeckSwitch();
      S.ready = true;
      route();
    } catch (err) {
      console.error(err);
      $("#view").innerHTML = `<div class="card"><h2>Qualcosa non va</h2><p class="err">${esc(err.message || err)}</p>
        <p class="muted small">Controlla config.js e di aver eseguito gli script SQL in supabase/. Se il progetto Supabase è in pausa, riattivalo dalla dashboard di Supabase.</p>
        <button class="btn" onclick="location.reload()">Riprova</button></div>`;
    }
  }

  // =====================================================================
  //  Export su App
  // =====================================================================
  Object.assign(App, {
    CFG, REMOTE, LOW_N, EVENTS, DB, S,
    $, $$, esc, lsGet, lsSet, uid, today, pct, fmtDate, titleName, archName,
    cardKey, parseList, countList, listMap, listToText,
    reload, currentDeck, setDeck, aliases, saveAliases, versions, versionById, activeVersion, deckMatches, guideFor, saveGuide,
    archById, players, chrono, groupById, groupOf, byGroup, DEFAULT_GROUPS,
    gamesOf, matchResult, wilson, stats, record, filtered, byArchetype,
    wrColor, meter, coverCard, artUrl, toast, openModal, closeModal, showTip, hideTip, ttRows, guard, download, kpi,
    heatCell, heatLegend, confusionG1, matchTable, bindMatchRows,
    filtersHTML, bindFilters, emptyState, bindDemo,
    canEdit, getViewKey,
    route, renderWho, renderDeckSwitch, manageDecks, start,
  });
})();
