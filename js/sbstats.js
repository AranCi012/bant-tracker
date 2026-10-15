// Statistiche delle sidate: carte "chiave", di "routine" e occasionali, per lato (play/draw) e per matchup.
// Funzioni pure (nessun DOM): analyze / highlights / archSummary.
(() => {
  "use strict";
  const A = window.App;

  const TIERS = { chiave: 0.75, routine: 0.4 };
  const MINUS = "−";
  const SIDE_LABEL = { play: "on the play", draw: "on the draw", all: "" };

  // ---------------------------------------------------------------------
  //  Analisi
  // ---------------------------------------------------------------------
  const sideOf = (g) => (g.play === true ? "play" : g.play === false ? "draw" : null);

  // Lista [{q,name}] -> Map(chiave -> { q, name }) con quantità sommate
  function toMap(list) {
    const mp = new Map();
    for (const c of list || []) {
      if (!c || !(c.q > 0) || !c.name) continue;
      const k = A.cardKey(c.name);
      if (!k) continue;
      if (mp.has(k)) mp.get(k).q += c.q; else mp.set(k, { q: c.q, name: String(c.name).trim() });
    }
    return mp;
  }

  const tierOf = (rate, games) => (rate >= TIERS.chiave && games >= 2 ? "chiave" : rate >= TIERS.routine ? "routine" : "occasionale");
  const TIER_ORDER = { chiave: 0, routine: 1, occasionale: 2 };

  // Spelling più diffuso (a parità: il primo incontrato)
  function commonName(counts) {
    let best = null, bn = -1;
    for (const [name, n] of counts) if (n > bn) { best = name; bn = n; }
    return best;
  }
  function modeOf(qs) {
    const f = new Map();
    for (const q of qs) f.set(q, (f.get(q) || 0) + 1);
    let best = 0, bn = -1;
    for (const [q, n] of f) if (n > bn || (n === bn && q > best)) { best = q; bn = n; }
    return best;
  }
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  function cardStats(gs, dir) {
    const n = gs.length, by = new Map();
    for (const g of gs) {
      for (const [k, c] of g.maps[dir]) {
        if (!by.has(k)) by.set(k, { names: new Map(), qs: [], idx: [], arch: new Set() });
        const e = by.get(k);
        e.names.set(c.name, (e.names.get(c.name) || 0) + 1);
        e.qs.push(c.q); e.idx.push(g); e.arch.add(g.arch);
      }
    }
    const out = [];
    for (const [key, e] of by) {
      const games = e.qs.length, rate = games / n;
      const wins = e.idx.filter((g) => g.r === "W").length;
      const totalWins = gs.filter((g) => g.r === "W").length;
      const nWithout = n - games, winsWithout = totalWins - wins;
      out.push({
        key, name: commonName(e.names), games, rate, avgQ: mean(e.qs), modeQ: modeOf(e.qs), tier: tierOf(rate, games),
        wrWith: wins / games, nWith: games,
        wrWithout: nWithout ? winsWithout / nWithout : null, nWithout,
        matchups: e.arch.size,
      });
    }
    return out.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || b.rate - a.rate || b.avgQ - a.avgQ || a.name.localeCompare(b.name));
  }

  function sideStat(gs) {
    const n = gs.length, wins = gs.filter((g) => g.r === "W").length;
    const sum = (dir) => gs.reduce((t, g) => t + [...g.maps[dir].values()].reduce((a, c) => a + c.q, 0), 0);
    const cards = { in: cardStats(gs, "in"), out: cardStats(gs, "out") };
    const typical = { in: [], out: [], support: 0 };
    const tk = { in: [], out: [] };
    for (const dir of ["in", "out"]) {
      for (const c of cards[dir]) if (c.rate >= 0.5) { typical[dir].push({ q: c.modeQ, name: c.name }); tk[dir].push(c.key); }
    }
    if (n && (tk.in.length || tk.out.length)) {
      const ok = gs.filter((g) => tk.in.every((k) => g.maps.in.has(k)) && tk.out.every((k) => g.maps.out.has(k))).length;
      typical.support = ok / n;
    }
    return { n, wins, wr: n ? wins / n : null, avgIn: n ? sum("in") / n : 0, avgOut: n ? sum("out") / n : 0, typical, cards };
  }

  function scopeOf(gs) {
    return { sides: {
      all: sideStat(gs),
      play: sideStat(gs.filter((g) => g.side === "play")),
      draw: sideStat(gs.filter((g) => g.side === "draw")),
    } };
  }

  function analyze(matches) {
    let totalPost = 0;
    const rec = [];
    for (const m of matches || []) {
      for (const g of A.gamesOf(m)) {
        if (g.n < 2) continue;
        totalPost++;
        if (!g.sb) continue;
        const maps = { in: toMap(g.sb.in), out: toMap(g.sb.out) };
        if (!maps.in.size && !maps.out.size) continue;
        rec.push({ r: g.r, side: sideOf(g), arch: m.archetype_id, maps });
      }
    }
    const groups = new Map();
    for (const g of rec) { if (!groups.has(g.arch)) groups.set(g.arch, []); groups.get(g.arch).push(g); }
    const byArch = [...groups].map(([archId, gs]) => {
      const a = A.archById ? A.archById(archId) : null;
      return { archId, name: a ? a.name : String(archId), scope: scopeOf(gs) };
    }).sort((x, y) => y.scope.sides.all.n - x.scope.sides.all.n || x.name.localeCompare(y.name));
    return { totalPost, recorded: rec.length, overall: scopeOf(rec), byArch };
  }

  // ---------------------------------------------------------------------
  //  Frasi
  // ---------------------------------------------------------------------
  const num = (x, d = 1) => (Math.round(x * 10 ** d) / 10 ** d).toFixed(d).replace(".", ",").replace(/,0+$/, "");
  const P = (r) => Math.round(r * 100);
  // "nel 70%" / "nell'80%" (elisione davanti a otto, undici, diciotto, ottanta-ottantanove, uno)
  const nel = (p) => (p === 1 || p === 8 || p === 11 || p === 18 || (p >= 80 && p < 90) ? `nell'${p}%` : `nel ${p}%`);
  const carte = (x) => (x === 1 ? "1 carta" : `${num(x)} carte`);
  const copie = (q) => (q === 1 ? "1 copia" : `${q} copie`);
  const joinE = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}`);
  const qn = (c) => `${c.q} ${c.name}`;
  const planText = (typ) => [typ.in.map((c) => `+${c.q} ${c.name}`).join(", "), typ.out.map((c) => `${MINUS}${c.q} ${c.name}`).join(", ")].filter(Boolean).join(" / ");
  const ONE = "Una sola sidata registrata: ancora troppo poco per parlare di 'media'.";

  function highlights(report, { max = 6 } = {}) {
    const out = [];
    const { totalPost, recorded } = report;
    if (!totalPost) return ["Nessuna game post-board (G2/G3) con questi filtri."];
    if (!recorded) return [`Nessuna sidata registrata su ${totalPost} game post-board: registra o conferma qualche sidata (anche dalle note) per vedere le statistiche.`];
    out.push(recorded === 1 ? `È stata registrata 1 sidata su ${totalPost} game post-board (${P(recorded / totalPost)}%).` : `Sono state registrate ${recorded} sidate su ${totalPost} game post-board (${P(recorded / totalPost)}%).`);
    if (recorded < 2) { out.push(ONE); return out.slice(0, max); }
    const S = report.overall.sides, all = S.all;

    const lead = (dir) => all.cards[dir].find((c) => c.tier !== "occasionale");
    const pm = (c) => (c.matchups > 1 ? ` (in ${c.matchups} matchup)` : "");
    const ci = lead("in");
    if (ci) {
      const when = ci.rate === 1 ? "entra in tutte le sidate" : `entra ${nel(P(ci.rate))} delle sidate`;
      out.push(`${ci.tier === "chiave" ? "Carta chiave" : "Carta di routine"} in entrata: ${ci.name} ${when}${pm(ci)}, di solito ${copie(ci.modeQ)}.`);
    }
    const co = lead("out");
    if (co) {
      const when = co.rate === 1 ? "fuori in tutte le sidate" : `fuori ${nel(P(co.rate))} delle sidate`;
      let side = "";
      if (S.play.n >= 2 && S.draw.n >= 2) {
        const r = (sd) => { const f = S[sd].cards.out.find((c) => c.key === co.key); return f ? f.rate : 0; };
        const rp = r("play"), rd = r("draw");
        if (Math.abs(rp - rd) >= 0.2) {
          side = rd > rp ? `, soprattutto on the draw (${P(rd)}% contro ${P(rp)}% on the play)` : `, soprattutto on the play (${P(rp)}% contro ${P(rd)}% on the draw)`;
        }
      }
      out.push(`La carta che esce più spesso è ${co.name}: ${when}${side}.`);
    }
    out.push(`In media ${all.avgIn === 1 ? "entra 1 carta" : `entrano ${carte(all.avgIn)}`} ed ${all.avgOut === 1 ? "esce 1 carta" : `escono ${carte(all.avgOut)}`}.`);
    if (S.play.n >= 2 && S.draw.n >= 2 && Math.abs(S.draw.avgIn - S.play.avgIn) >= 0.5) {
      const d = S.draw.avgIn > S.play.avgIn;
      out.push(d ? `On the draw si sida di più: ${carte(S.draw.avgIn)} contro ${num(S.play.avgIn)} on the play.` : `On the play si sida di più: ${carte(S.play.avgIn)} contro ${num(S.draw.avgIn)} on the draw.`);
    }
    // Indizio sul win rate (solo con abbastanza game da entrambi i lati)
    let best = null;
    for (const dir of ["in", "out"]) {
      for (const c of all.cards[dir]) {
        if (c.nWith < 5 || c.nWithout < 5 || c.wrWithout == null) continue;
        const d = Math.abs(c.wrWith - c.wrWithout);
        if (d >= 0.2 && (!best || d > best.d)) best = { c, dir, d };
      }
    }
    // Articolo davanti alla percentuale: "lo 0%", "l'80%", "l'11%", "il 45%"
    const art = (n) => { const t = String(n); return t === "0" ? "lo 0%" : /^(1|8|11|18|8\d)$/.test(t) ? `l'${t}%` : `il ${t}%`; };
    if (best) out.push(`Con ${best.c.name} ${best.dir === "in" ? "dentro" : "fuori"} avete vinto ${art(P(best.c.wrWith))} delle game post-board, senza ${art(P(best.c.wrWithout))}: indizio, non prova.`);
    // Altre carte ricorrenti
    for (const [dir, lab] of [["in", "in entrata"], ["out", "in uscita"]]) {
      const lead1 = lead(dir);
      const more = all.cards[dir].filter((c) => c.tier !== "occasionale" && c !== lead1).slice(0, 4);
      if (more.length) out.push(`Altre carte ricorrenti ${lab}: ${joinE(more.map((c) => `${c.name} (${P(c.rate)}%)`))}.`);
    }
    return out.slice(0, max);
  }

  function sideSentence(name, label, st) {
    const n = st.n, where = label ? ` ${label}` : "";
    const t = st.typical;
    if (n === 1) return `Contro ${name}${where}, una sola sidata: ${planText(t) || "—"}.`;
    const rate = (dir, key) => (st.cards[dir].find((c) => c.key === key) || {}).rate || 0;
    const kk = (c) => A.cardKey(c.name);
    const part = (dir, one, many) => {
      const cs = t[dir].filter((c) => rate(dir, kk(c)) >= 1), us = t[dir].filter((c) => rate(dir, kk(c)) < 1);
      const bits = [];
      if (cs.length) bits.push(`${cs.length === 1 ? one : many} sempre ${joinE(cs.map(qn))}`);
      if (us.length) bits.push(`di solito ${cs.length ? "" : (us.length === 1 ? one : many) + " "}${joinE(us.map(qn))}`);
      return bits.join(", ");
    };
    const pin = part("in", "entra", "entrano"), pout = part("out", "esce", "escono");
    let s = `Contro ${name}${where} (${n} sidate): `;
    s += [pin, pout].filter(Boolean).join("; ") || "nessuna carta si ripete almeno una volta su due";
    s += ".";
    const used = Math.round(t.support * n);
    if (used >= 1 && t.in.length + t.out.length) s += ` Sidata tipica: ${planText(t)} (usata in ${used} su ${n}).`;
    return s;
  }

  function archSummary(report, archId) {
    const e = (report.byArch || []).find((x) => x.archId === archId);
    if (!e) return ["Nessuna sidata registrata per questo matchup."];
    const S = e.scope.sides, all = S.all;
    if (all.n === 1) {
      const sd = S.play.n ? "play" : S.draw.n ? "draw" : "all";
      const lab = SIDE_LABEL[sd];
      return [ONE, `Sidata registrata${lab ? " " + lab : ""}: ${planText(all.typical) || "—"}.`, `Risultato post-board: ${all.wins} ${all.wins === 1 ? "vinta" : "vinte"} su 1.`];
    }
    const out = [];
    const sides = ["play", "draw"].filter((sd) => S[sd].n > 0);
    if (!sides.length) out.push(sideSentence(e.name, "", all));
    else {
      // draw prima (come negli esempi), poi play
      for (const sd of ["draw", "play"]) if (S[sd].n > 0) out.push(sideSentence(e.name, SIDE_LABEL[sd], S[sd]));
      if (S.play.n + S.draw.n < all.n) out.push(`In ${all.n - S.play.n - S.draw.n} ${all.n - S.play.n - S.draw.n === 1 ? "sidata" : "sidate"} non è registrato se eri on the play o on the draw.`);
    }
    out.push(`Risultato post-board: ${all.wins} ${all.wins === 1 ? "vinta" : "vinte"} su ${all.n}.`);
    return out;
  }

  A.sbstats = { TIERS, analyze, highlights, archSummary };
})();
