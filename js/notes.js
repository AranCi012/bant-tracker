// Interprete delle note: trova le sidate (IN/OUT) scritte a mano, in italiano/inglese gergale.
// Deterministico, spiegabile, offline: nessuna API esterna.
//
//   A.notes.parse(text, { version, aliases }) -> { plans, keep, evidence, ignored, unknown, warnings, confidence }
//   A.notes.forMatch(m, result)               -> { sb2, sb3 }   (formato salvato {in:[{q,name}], out:[{q,name}]} o null)
//
// REGOLE (in sintesi):
//  1. Tokenizzazione sul testo originale (gli offset start/end di evidence/ignored puntano al testo originale):
//     parole, numeri, segni +/- (un "-" tra due caratteri alfanumerici attaccati è un trattino, non un "meno"),
//     interruzioni di frase (. ; ! ? a-capo, "/", la parola "ma") e separatori morbidi (virgola, due punti).
//     Punteggi ("2 - 0", "2-1", "G1", "game 2") non sono mai quantità né OUT.
//  2. Se la nota contiene una parola di sezione sideboard (side, sideboard, sb, sidato, post side...) si legge SOLO
//     il testo dalla prima occorrenza in poi. In quel caso anche le carte senza marcatore vengono interpretate
//     (IN se solo in sideboard, OUT se solo nel main). Senza sezione servono marcatori espliciti.
//  3. Marcatori di direzione: IN (+, in, dentro, metti..., entra..., aggiungi..., porto, sido), OUT (-, out, fuori,
//     togli..., levo..., esce..., taglio), KEEP (lascia..., tengo, tieni, resta...). Valgono per le carte che seguono,
//     fino al marcatore successivo o alla fine della frase.
//  4. Quantità: numero prima del nome ("+ 3 carpet", "2 fow", "x2", "2x"), parole (una/un/uno/due/tre/quattro/cinque),
//     "tutte le/tutti i" o nessun numero = tutte le copie presenti nella zona sorgente. Un numero più grande della lista
//     viene mantenuto con un avviso.
//  5. Riferimenti alle carte: alias (anche multi-parola) > nome completo / sequenza contigua di parole del nome /
//     parola distintiva o prefisso >= 4 lettere / acronimo delle iniziali (fow, stp, utb) / plurali in "s".
//     Per IN si cerca prima nella sideboard, per OUT nel main, poi nell'altra zona (con avviso). Se più carte
//     corrispondono allo stesso modo ("force") il riferimento è ambiguo: saltato con avviso, mai indovinato.
//  6. Lato: otp / on the play / al|in|di play -> "play"; otd / on the draw / al|in|di draw -> "draw". Il lato vale da
//     dove compare in avanti (anche nelle frasi successive) fino al lato successivo; se compare in fondo a una frase
//     già riempita vale per quella frase. Nessun lato = null (tutte le game post-board).
//  7. Avversario: dopo ha/hanno/lui/avversario/suo.../contro/vs/morire... le carte sono ignorate ("carta dell'avversario")
//     fino al prossimo marcatore di direzione o fine frase.
//  8. Confidenza: alta = marcatori e quantità espliciti, tutto risolto; media = quantità implicite, carta senza
//     marcatore, carta fuori zona o solo "lascia"; bassa = qualcosa di ambiguo/non riconosciuto; nessuna = niente.
(() => {
  "use strict";
  const A = window.App;

  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const set = (s) => new Set(s.split(/\s+/));

  const IN_W = set("in dentro metti metto messo messa messi messe mettere entra entrano aggiungi aggiungo porto sido");
  const OUT_W = set("out fuori togli tolgo tolto tolti tolta levo levato levati esce escono taglio");
  const KEEP_W = set("lascia lascio lasciare lasciate tengo tieni resta restano rimane rimangono");
  const SECTION_W = set("side sideboard sb sidato sidata sidati sidate sidando sideboarding");
  const OPP_W = set("ha hanno avversario avversari avversaria suo sua suoi sue lui loro contro vs versus morire muore morto morta");
  const BREAK_W = set("ma pero mentre invece");
  const CONJ_W = set("e ed anche pure poi");
  const ART_W = set("le la lo i gli il l di dei del delle degli della x copie copia carte carta altre altri quelle quelli quello quella queste questi miei mie the");
  const NUM_W = { una: 1, un: 1, uno: 1, due: 2, tre: 3, quattro: 4, cinque: 5 };
  const ALL_W = set("tutte tutti tutto tutta");
  const STOPN = set("of the to a an and in on for with from at by into de del");
  const GAME_W = set("g game games partita partite round turno turni");
  const NOQTY_AFTER = set("game games turni turno partite punti vita life mulligan minuti volte");
  const UNK_STOP = set("che con per non sul sulla nel nella dopo prima quando solo tutto ogni mazzo deck game partita side sideboard post play draw sono era ero ho hai fatto fare gioco giocare giocato mio mia miei mie ora poi cosa cose questa questo molto meno piu come perche");

  // ---------------------------------------------------------------- tokenizer
  function tokenize(text) {
    const re = /([\p{L}\p{M}]+)|(\d+)|([+\-−–—])|([.;!?\n\r])|(\/)|([,:])/gu;
    const isW = (c) => !!c && /[\p{L}\p{N}]/u.test(c);
    const T = []; let m;
    while ((m = re.exec(text))) {
      const start = m.index, end = start + m[0].length;
      if (m[1]) T.push({ t: "w", s: norm(m[1]), low: m[1].toLowerCase(), start, end });
      else if (m[2]) T.push({ t: "n", v: +m[2], start, end });
      else if (m[3]) {
        if (text[start] === "-" && text[end] === ">") { T.push({ t: "co", start, end: end + 1 }); re.lastIndex = end + 1; }
        else if (isW(text[start - 1]) && isW(text[end])) T.push({ t: "hy", start, end });
        else T.push({ t: "sg", v: m[3] === "+" ? "+" : "-", start, end });
      } else if (m[4] || m[5]) T.push({ t: "brk", start, end });
      else T.push({ t: m[6] === "," ? "cm" : "co", start, end });
    }
    // punteggi "2 - 0", "2-1"
    for (let i = 0; i < T.length - 2; i++) {
      const a = T[i], d = T[i + 1], b = T[i + 2];
      if (a.t === "n" && (d.t === "hy" || (d.t === "sg" && d.v === "-")) && b.t === "n" && a.v <= 3 && b.v <= 3 && !(T[i - 1] && T[i - 1].t === "sg")) {
        a.t = "sc"; b.t = "sc"; d.t = "x"; a.scoreEnd = b.end; i += 2;
      }
    }
    // "game 2", "G1", "3 turni"
    for (let i = 0; i < T.length; i++) {
      if (T[i].t === "w" && GAME_W.has(T[i].s) && T[i + 1] && T[i + 1].t === "n") T[i + 1].t = "sc";
      if (T[i].t === "n" && T[i + 1] && T[i + 1].t === "w" && NOQTY_AFTER.has(T[i + 1].s)) T[i].t = "sc";
    }
    return T.filter((x) => x.t !== "hy" && x.t !== "x");
  }
  const wordsOf = (name) => tokenize(String(name || "")).filter((t) => t.t === "w").map((t) => t.s);

  // ---------------------------------------------------------------- pool di carte
  function buildPool(version, aliases) {
    const pool = new Map();
    const get = (name) => {
      const k = A.cardKey(name);
      let e = pool.get(k);
      if (!e) {
        const words = wordsOf(name);
        e = { key: k, name, nameMain: null, nameSide: null, main: 0, side: 0, words, acr: words.length >= 2 ? words.map((w) => w[0]).join("") : "" };
        pool.set(k, e);
      }
      return e;
    };
    const add = (txt, zone) => {
      for (const c of A.parseList((txt || ""))) {
        const e = get(c.name);
        if (zone === "main") { e.main += c.q; e.nameMain = e.nameMain || c.name; } else { e.side += c.q; e.nameSide = e.nameSide || c.name; }
      }
    };
    if (version) { add(version.maindeck, "main"); add(version.sideboard, "side"); }
    const aliasList = [];
    for (const [k, v] of Object.entries(aliases || {})) {
      const toks = wordsOf(k);
      if (!toks.length || !String(v || "").trim()) continue;
      aliasList.push({ toks, e: pool.get(A.cardKey(v)) || get(String(v).trim()) });
    }
    aliasList.sort((a, b) => b.toks.length - a.toks.length);
    return { pool, aliasList };
  }
  const nameFor = (e, dir) => (dir === "in" ? e.nameSide || e.name : dir === "out" ? e.nameMain || e.name : e.nameMain || e.nameSide || e.name);

  // ---------------------------------------------------------------- matching
  const tokMatch = (t, w) => t === w || (t.length >= 4 && w.startsWith(t)) || (w.length >= 4 && (t === w + "s" || t === w + "es"));
  function aliasLen(T, i, toks) {
    for (let j = 0; j < toks.length; j++) {
      const x = T[i + j];
      if (!x || x.t !== "w") return 0;
      const last = j === toks.length - 1;
      if (x.s !== toks[j] && !(last && (x.s === toks[j] + "s" || toks[j] === x.s + "s"))) return 0;
    }
    return toks.length;
  }
  function matchEntry(T, i, e) {
    const w0 = T[i];
    if (!w0 || w0.t !== "w") return 0;
    let best = 0;
    if (e.acr && w0.s.length >= 3 && (w0.s === e.acr || w0.s === e.acr + "s")) best = 1;
    const W = e.words;
    for (let s = 0; s < W.length; s++) {
      if (STOPN.has(W[s])) continue;
      let j = 0, good = 0;
      while (s + j < W.length && T[i + j] && T[i + j].t === "w" && tokMatch(T[i + j].s, W[s + j])) {
        const wt = W[s + j], tt = T[i + j].s;
        if (!STOPN.has(wt) && ((tt === wt && wt.length >= 3) || (tt !== wt && tt.length >= 4))) good = j + 1;
        j++;
      }
      if (good > best) best = good;
    }
    return best;
  }
  function resolve(T, i, dir, ctx) {
    for (const al of ctx.aliasList) { const k = aliasLen(T, i, al.toks); if (k) return { ok: true, e: al.e, k }; }
    const all = [...ctx.pool.values()];
    const tiers = dir === "in" ? [all.filter((e) => e.side > 0), all] : dir === "out" ? [all.filter((e) => e.main > 0), all] : [all];
    for (const tier of tiers) {
      let best = 0, hits = [];
      for (const e of tier) { const k = matchEntry(T, i, e); if (k > best) { best = k; hits = [e]; } else if (k && k === best) hits.push(e); }
      if (hits.length === 1) return { ok: true, e: hits[0], k: best };
      if (hits.length > 1) return { ok: false, amb: hits, k: best };
    }
    return null;
  }
  function sideTagAt(T, i) {
    const w = T[i].s, n1 = T[i + 1] && T[i + 1].t === "w" ? T[i + 1].s : "", n2 = T[i + 2] && T[i + 2].t === "w" ? T[i + 2].s : "";
    if (w === "otp") return { side: "play", len: 1 };
    if (w === "otd") return { side: "draw", len: 1 };
    if (w === "on" && n1 === "the" && (n2 === "play" || n2 === "draw")) return { side: n2, len: 3 };
    if (/^(al|in|di|on|a)$/.test(w) && (n1 === "play" || n1 === "draw")) return { side: n1, len: 2 };
    return null;
  }

  // ---------------------------------------------------------------- parse
  function parse(text, opts) {
    opts = opts || {};
    text = String(text || "");
    const version = opts.version || null;
    const ctx = buildPool(version, opts.aliases || {});
    const hasList = !!version && (ctx.pool.size > 0);
    const res = { plans: [], keep: [], evidence: [], ignored: [], unknown: [], warnings: [], confidence: "nessuna" };
    const T = tokenize(text);
    for (const x of T) if (x.t === "sc") res.ignored.push({ text: text.slice(x.start, x.end), reason: "punteggio", start: x.start, end: x.end });

    // sezione sideboard: si legge solo da qui in avanti
    let from = T.findIndex((x) => x.t === "w" && SECTION_W.has(x.s));
    const sectionMode = from >= 0;
    if (from < 0) from = 0;

    const items = [];
    let U = 0, zoneMismatch = false;
    let dir = null, markerExp = false, q = null, qExp = false, qStart = null, markerStart = null, refPos = false, opp = false;
    let curSide = null, clause = { items: [], tagAt: null };
    const warn = (w) => { if (!res.warnings.includes(w)) res.warnings.push(w); };
    // Marcatori POSTFISSI ("terminus out", "2 fow e 1 fon fuori"): i riferimenti senza marcatore davanti restano
    // "in attesa" e prendono la direzione di un marcatore che li segue subito (lista unita da e / , / +).
    let pending = [], pendingOpen = false;
    const pushItem = (d, p, mExp) => {
      const it = { dir: d, e: p.e, q: p.q, qExp: p.qExp, markerExp: mExp, start: p.start, end: p.end, side: curSide };
      items.push(it); clause.items.push(it);
    };
    const flushInfer = () => {
      for (const p of pending) {
        if (!sectionMode) continue;
        const e = p.e;
        if (e.side > 0 && e.main === 0) pushItem("in", p, false);
        else if (e.main > 0 && e.side === 0) pushItem("out", p, false);
        else { U++; warn(`"${text.slice(p.start, p.end)}": non so se è IN o OUT (specifica + o -)`); }
      }
      pending = []; pendingOpen = false;
    };
    const mark = (d, tok, nextW) => {
      if (pending.length && pendingOpen) {
        if (d === "in" && /^(side|sideboard|sb|main|maindeck|mazzo|modo)$/.test(nextW)) { pendingOpen = false; return; }
        for (const p of pending) pushItem(d, p, true);
        pending = []; pendingOpen = false; q = null; qExp = false; qStart = null; return;
      }
      flushInfer(); setDir(d, tok);
    };
    const endClause = () => {
      flushInfer();
      if (clause.tagAt !== null && clause.tagAt === clause.items.length && clause.items.length) for (const it of clause.items) it.side = curSide;
      clause = { items: [], tagAt: null };
      dir = null; markerExp = false; q = null; qExp = false; qStart = null; markerStart = null; refPos = false; opp = false;
    };
    const setDir = (d, tok) => { dir = d; markerExp = true; q = null; qExp = false; qStart = null; markerStart = tok.start; refPos = true; opp = false; };

    for (let i = from; i < T.length; i++) {
      const t = T[i];
      if (t.t === "brk") { endClause(); continue; }
      if (t.t === "co") continue;
      if (t.t === "cm") { refPos = false; continue; }
      if (t.t === "sc") continue;
      if (t.t === "sg") {
        if (t.v === "+" && pending.length && pendingOpen) continue;
        flushInfer(); setDir(t.v === "+" ? "in" : "out", t); continue;
      }
      if (t.t === "n") { if (t.v > 0) { q = t.v; qExp = true; qStart = t.start; refPos = true; } continue; }
      // ---- parole
      const w = t.s;
      if (BREAK_W.has(w)) { endClause(); continue; }
      if (SECTION_W.has(w) || w === "post") continue;
      const tag = sideTagAt(T, i);
      if (tag) {
        clause.tagAt = clause.items.length; curSide = tag.side; i += tag.len - 1; continue;
      }
      const nx = T[i + 1] && T[i + 1].t === "w" ? T[i + 1].s : "";
      if (IN_W.has(w)) { mark("in", t, nx); continue; }
      if (OUT_W.has(w)) { mark("out", t, nx); continue; }
      if (KEEP_W.has(w)) { mark("keep", t, nx); continue; }
      if (OPP_W.has(w)) { pendingOpen = false; opp = true; refPos = false; q = null; qStart = null; continue; }
      if (CONJ_W.has(w)) { if (dir) { refPos = true; q = null; qExp = false; qStart = null; } continue; }
      if (NUM_W[w] != null) { q = NUM_W[w]; qExp = true; qStart = t.start; refPos = true; continue; }
      if (ALL_W.has(w)) { q = "all"; qExp = true; qStart = t.start; refPos = true; continue; }
      if (ART_W.has(w)) continue;

      const r = resolve(T, i, dir === "keep" ? null : dir, ctx);
      if (r && r.ok) {
        const last = T[i + r.k - 1];
        const e = r.e;
        if (opp) {
          res.ignored.push({ text: text.slice(t.start, last.end), reason: "carta dell'avversario", start: t.start, end: last.end });
        } else {
          const starts = [qStart, markerStart].filter((x) => x != null);
          const start = starts.length ? Math.min(...starts, t.start) : t.start;
          const p = { e, q, qExp, start, end: last.end };
          if (dir === null) { pending.push(p); pendingOpen = true; }
          else pushItem(dir, p, markerExp);
        }
        i += r.k - 1;
        q = null; qExp = false; qStart = null; markerStart = null; refPos = false;
        continue;
      }
      if (r && !r.ok) {
        if (!opp && (dir !== null || sectionMode)) { U++; warn(`Riferimento ambiguo "${text.slice(t.start, T[i + r.k - 1].end)}": ${r.amb.map((e) => e.name).join(" / ")}`); }
        i += r.k - 1; q = null; qExp = false; qStart = null; markerStart = null; refPos = false;
        continue;
      }
      // nessuna corrispondenza
      pendingOpen = false;
      if (refPos && !opp && dir !== null && /^\p{L}+$/u.test(t.low) && t.low.length >= 3 && !UNK_STOP.has(w) && !res.unknown.includes(t.low)) { res.unknown.push(t.low); U++; }
      q = null; qExp = false; qStart = null; refPos = false;
    }
    endClause();

    // ---- piani
    const plansBy = new Map();
    let implicit = false;
    for (const it of items) {
      const name = nameFor(it.e, it.dir === "keep" ? null : it.dir);
      if (it.dir === "keep") {
        if (!res.keep.includes(name)) res.keep.push(name);
        res.evidence.push({ text: text.slice(it.start, it.end), dir: "keep", name, q: 0, start: it.start, end: it.end });
        continue;
      }
      const zoneQ = it.dir === "in" ? it.e.side : it.e.main;
      const known = it.e.main + it.e.side > 0;
      let qty = typeof it.q === "number" ? it.q : null;
      if (qty == null) qty = zoneQ || it.e.main || it.e.side || 1;
      if (known && hasList) {
        const zn = it.dir === "in" ? "in sideboard" : "nel main";
        if (zoneQ === 0) { warn(`${name} non è ${it.dir === "in" ? "in sideboard" : "nel main"}`); zoneMismatch = true; }
        else if (typeof it.q === "number" && it.q > zoneQ) warn(`${it.dir === "in" ? "+" : "-"}${it.q} ${name} ma la lista ne ha ${zoneQ} ${zn}`);
      }
      if (!(it.qExp && it.markerExp)) implicit = true;
      const key = it.side || "";
      if (!plansBy.has(key)) plansBy.set(key, { side: it.side || null, in: new Map(), out: new Map() });
      const mp = plansBy.get(key)[it.dir];
      const k = A.cardKey(name);
      if (mp.has(k)) mp.get(k).q += qty; else mp.set(k, { q: qty, name });
      res.evidence.push({ text: text.slice(it.start, it.end), dir: it.dir, name, q: qty, start: it.start, end: it.end });
    }
    for (const p of plansBy.values()) {
      const pl = { side: p.side, in: [...p.in.values()], out: [...p.out.values()] };
      if (pl.in.length || pl.out.length) res.plans.push(pl);
    }
    res.plans.sort((a, b) => (a.side === null ? -1 : 0) - (b.side === null ? -1 : 0));

    if (!res.plans.length && !res.keep.length) res.confidence = "nessuna";
    else if (U > 0) res.confidence = "bassa";
    else if (implicit || zoneMismatch || !res.plans.length) res.confidence = "media";
    else res.confidence = "alta";
    return res;
  }

  // ---------------------------------------------------------------- forMatch
  function forMatch(m, result) {
    const out = { sb2: null, sb3: null };
    if (!result || !result.plans || !result.plans.length) return out;
    for (const g of A.gamesOf(m)) {
      if (g.n < 2) continue;
      const side = g.play === true ? "play" : g.play === false ? "draw" : null;
      const plan = (side && result.plans.find((p) => p.side === side)) || result.plans.find((p) => p.side === null) || null;
      out["sb" + g.n] = plan ? { in: plan.in.map((c) => ({ q: c.q, name: c.name })), out: plan.out.map((c) => ({ q: c.q, name: c.name })) } : null;
    }
    return out;
  }

  A.notes = { parse, forMatch };
})();
