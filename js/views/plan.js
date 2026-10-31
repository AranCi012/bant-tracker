// Vista "Piano sideboard" (#plan, #plan/<archetipo>): per ogni matchup il piano consigliato (on the play / on the draw),
// con fiducia, win rate atteso, alternative osservate, prova-modifiche e riepilogo del mazzo.
// Usa il motore A.sbplan (js/sbplan.js). Se il motore non c'e' ancora usa un MOCK minimale (vedi sotto) e lo dichiara.
(() => {
  "use strict";
  const A = window.App;
  const { $, esc, pct, S } = A;
  const canEdit = () => !A.canEdit || A.canEdit();
  const MINUS = "−";
  const SIDES = [["play", "On the play", "OTP"], ["draw", "On the draw", "OTD"]];
  const CONF_LBL = { alta: "fiducia alta", media: "fiducia media", bassa: "fiducia bassa", nessuna: "senza dati" };
  const SORTS = [["giocati", "Più giocati"], ["peggiore", "Peggior post-board"], ["az", "A–Z"]];
  const VERDICT_LBL = { chiave: "chiave", utile: "utile", neutra: "neutra", sconsigliata: "sconsigliata" };

  // ---------------------------------------------------------------------
  //  MOCK del motore: SOLO per sviluppo UI, usato unicamente se A.sbplan non esiste.
  //  Piano = sidata registrata piu' frequente per matchup+lato. Nessuna statistica seria.
  // ---------------------------------------------------------------------
  const MOCK = (() => {
    const sideOf = (g) => (g.play === true ? "play" : g.play === false ? "draw" : null);
    const clean = (l) => (l || []).filter((c) => c && c.q > 0);
    const sig = (sb) => [clean(sb.in).map((c) => A.cardKey(c.name) + "x" + c.q).sort().join(","), clean(sb.out).map((c) => A.cardKey(c.name) + "x" + c.q).sort().join(",")].join("|");
    const picks = (l, verdict) => clean(l).map((c) => ({ key: A.cardKey(c.name), name: c.name, q: c.q, freq: 1, effect: 0, verdict }));
    const guideLists = (g, s) => ({ in: A.parseList(g ? g[s + "_in"] : ""), out: A.parseList(g ? g[s + "_out"] : "") });
    function rec(ms, archId, side, version, guide) {
      const games = [];
      for (const m of ms) if (m.archetype_id === archId) for (const g of A.gamesOf(m)) if (g.n >= 2 && sideOf(g) === side) games.push(g);
      const withSb = games.filter((g) => g.sb && (clean(g.sb.in).length || clean(g.sb.out).length));
      const by = new Map();
      for (const g of withSb) { const s = sig(g.sb); if (!by.has(s)) by.set(s, []); by.get(s).push(g); }
      const plans = [...by.values()].sort((a, b) => b.length - a.length);
      const w = (xs) => xs.filter((g) => g.r === "W").length;
      let plan = { in: [], out: [] }, level = "nessuno";
      if (plans.length) { const sb = plans[0][0].sb; plan = { in: picks(sb.in, "chiave"), out: picks(sb.out, "utile") }; level = "matchup-lato"; }
      else { const gl = guideLists(guide, side); if (gl.in.length || gl.out.length) { plan = { in: picks(gl.in, "neutra"), out: picks(gl.out, "neutra") }; level = "guida"; } }
      const n = withSb.length, k = w(withSb), ci = A.wilson(k, n);
      const bw = w(games);
      const mainK = version ? new Set(A.parseList(version.maindeck).map((c) => A.cardKey(c.name))) : null;
      const sideK = version ? new Set(A.parseList(version.sideboard).map((c) => A.cardKey(c.name))) : null;
      const notInVersion = [];
      if (version) { for (const c of plan.in) if (!sideK.has(c.key)) notInVersion.push({ key: c.key, name: c.name, dir: "in" }); for (const c of plan.out) if (!mainK.has(c.key)) notInVersion.push({ key: c.key, name: c.name, dir: "out" }); }
      const dates = games.length ? ms.filter((m) => m.archetype_id === archId).map((m) => m.played_at).filter(Boolean).sort().pop() : null;
      return {
        archId, side, level, nUsed: n, nSide: n, nMatchup: games.length, plan,
        expected: n ? { wr: (k + 1) / (n + 2), lo: ci[0], hi: ci[1] } : null,
        baseline: games.length ? { wr: bw / games.length, n: games.length } : null,
        confidence: n >= 6 ? "alta" : n >= 3 ? "media" : n ? "bassa" : "nessuna",
        why: n ? [`Piano usato più spesso in ${n} game con sidata (dati di prova).`] : level === "guida" ? ["Nessuna sidata registrata: uso la guida scritta."] : [],
        alternatives: plans.slice(1, 3).map((p, i) => ({ label: `Alternativa ${i + 2}`, plan: { in: picks(p[0].sb.in, "neutra"), out: picks(p[0].sb.out, "neutra") }, n: p.length, wins: w(p), wr: w(p) / p.length, lo: A.wilson(w(p), p.length)[0], hi: A.wilson(w(p), p.length)[1] })),
        cards: [...plan.in.map((c) => ({ ...c, dir: "in", nWith: n, winsWith: k, nWithout: 0, winsWithout: 0 })), ...plan.out.map((c) => ({ ...c, dir: "out", nWith: n, winsWith: k, nWithout: 0, winsWithout: 0 }))],
        notInVersion, updatedAt: dates ? String(dates).slice(0, 10) : null,
      };
    }
    return {
      overview({ matches, version, archetypes, guideFor }) {
        const out = [];
        for (const a of archetypes) {
          const ms = matches.filter((m) => m.archetype_id === a.id), g = guideFor(a.id);
          const hasG = !!g && ["play_in", "play_out", "draw_in", "draw_out"].some((f) => (g[f] || "").trim());
          if (!ms.length && !hasG) continue;
          const nPost = ms.reduce((s, m) => s + A.gamesOf(m).filter((x) => x.n >= 2).length, 0);
          const play = rec(matches, a.id, "play", version, g), draw = rec(matches, a.id, "draw", version, g);
          out.push({ archId: a.id, name: a.name, group: A.groupOf(a.id), nMatches: ms.length, nPost, nRec: play.nUsed + draw.nUsed, play, draw });
        }
        return out.sort((x, y) => y.nMatches - x.nMatches);
      },
      estimate({ archId, side, matches }) {
        const g = matches.filter((m) => m.archetype_id === archId).flatMap((m) => A.gamesOf(m)).filter((x) => x.n >= 2 && sideOf(x) === side);
        const k = g.filter((x) => x.r === "W").length, ci = A.wilson(k, g.length) || [0, 1];
        return { wr: g.length ? k / g.length : 0.5, lo: ci[0], hi: ci[1], n: g.length, note: "Stima di prova (motore in arrivo): coincide con il win rate osservato." };
      },
      core({ versions }) {
        const vs = versions.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
        const cur = vs.find((v) => v.is_active) || vs[vs.length - 1];
        const lst = (t) => A.parseList(cur ? cur[t] : "").map((c) => ({ key: A.cardKey(c.name), name: c.name, q: c.q }));
        const mapOf = (v) => ({ main: A.listMap(A.parseList(v.maindeck)), side: A.listMap(A.parseList(v.sideboard)) });
        const timeline = vs.map((v, i) => {
          const a = i ? mapOf(vs[i - 1]) : null, b = mapOf(v), changes = [];
          if (a) for (const z of ["main", "side"]) for (const k of new Set([...a[z].keys(), ...b[z].keys()])) {
            const f = a[z].has(k) ? a[z].get(k).q : 0, t = b[z].has(k) ? b[z].get(k).q : 0;
            if (f !== t) changes.push({ key: k, name: (b[z].get(k) || a[z].get(k)).name, zone: z, from: f, to: t });
          }
          return { versionId: v.id, name: v.name, date: String(v.created_at || "").slice(0, 10), n: 0, changes };
        });
        return { versions: vs.map((v, i) => ({ id: v.id, name: v.name, date: timeline[i].date, n: 0 })), core: { main: lst("maindeck"), side: lst("sideboard") }, flex: { main: [], side: [] }, timeline };
      },
    };
  })();
  const eng = () => A.sbplan || MOCK;
  const mocked = () => !A.sbplan;

  // ---------------------------------------------------------------------
  //  Stato (sopravvive ai re-render e ai cambi di vista)
  // ---------------------------------------------------------------------
  const P = { deck: null, q: "", group: "", sort: "giocati", verId: "", sel: null, alt: { play: 0, draw: 0 }, edit: { play: null, draw: null }, cardsOpen: { play: false, draw: false }, deckOpen: false };
  const resetSel = () => { P.alt = { play: 0, draw: 0 }; P.edit = { play: null, draw: null }; };
  let X = null; // contesto del render corrente: { root, c, rows, err }

  const clonePlan = (p) => ({ in: ((p && p.in) || []).filter((c) => c.q > 0).map((c) => ({ q: c.q, name: c.name })), out: ((p && p.out) || []).filter((c) => c.q > 0).map((c) => ({ q: c.q, name: c.name })) });
  const hasPlan = (p) => !!p && ((p.in || []).length > 0 || (p.out || []).length > 0);
  const rng = (r) => `${Math.round(r.lo * 100)}–${pct(r.hi)}`;
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const dayOf = (d) => A.fmtDate(String(d || "").slice(0, 10));
  const shortDate = (d) => { const s = dayOf(d); return s ? s.slice(0, 5) : ""; }; // DD/MM
  const planLine = (p) => [(p.in || []).map((c) => `+${c.q} ${c.name}`).join(", "), (p.out || []).map((c) => `${MINUS}${c.q} ${c.name}`).join(", ")].filter(Boolean).join(" / ");
  const groupArchIds = (archId) => { const g = A.groupOf(archId); return g ? S.archetypes.filter((a) => a.group_id === g.id).map((a) => a.id) : []; };
  const recText = (c) => (c.nWith ? `${c.winsWith}/${c.nWith}` : "—");

  async function copyText(text, okMsg) {
    try { await navigator.clipboard.writeText(text); A.toast(okMsg || "Copiato negli appunti"); }
    catch { A.download("piano-sideboard.txt", text, "text/plain"); A.toast("Appunti non disponibili: scaricato come file"); }
  }

  // ---------------------------------------------------------------------
  //  Dati
  // ---------------------------------------------------------------------
  function context() {
    const versions = A.versions();
    const ver = versions.find((v) => v.id === P.verId) || A.activeVersion() || null;
    P.verId = ver ? ver.id : "";
    return { deck: A.currentDeck(), versions, ver, ms: A.deckMatches() };
  }
  function computeRows(c) {
    const rows = eng().overview({ matches: c.ms, version: c.ver || undefined, archetypes: S.archetypes, groupOf: A.groupOf, guideFor: A.guideFor });
    const rec = new Map();
    for (const m of c.ms) {
      if (!rec.has(m.archetype_id)) rec.set(m.archetype_id, { W: 0, L: 0, D: 0 });
      rec.get(m.archetype_id)[A.matchResult(m)]++;
    }
    return rows.map((r) => { const g = A.groupOf(r.archId); return { ...r, rec: rec.get(r.archId) || { W: 0, L: 0, D: 0 }, gid: g ? g.id : "", gname: g ? g.name : "" }; });
  }
  const selectedRow = () => (X.rows || []).find((r) => r.archId === P.sel) || null;

  function visibleRows() {
    const q = P.q.trim().toLowerCase();
    const worst = (r) => { const xs = [r.play, r.draw].map((x) => (x && x.baseline && x.baseline.n ? x.baseline.wr : null)).filter((x) => x != null); return xs.length ? Math.min(...xs) : 9; };
    const by = { giocati: (a, b) => b.nMatches - a.nMatches, peggiore: (a, b) => worst(a) - worst(b) || b.nMatches - a.nMatches, az: () => 0 };
    return X.rows.filter((r) => (!q || r.name.toLowerCase().includes(q)) && (!P.group || r.gid === P.group))
      .sort((a, b) => by[P.sort](a, b) || a.name.localeCompare(b.name));
  }

  // ---------------------------------------------------------------------
  //  Componenti HTML
  // ---------------------------------------------------------------------
  function confDot(rec, label) {
    const cf = (rec && rec.confidence) || "nessuna";
    return `<span class="pn-dw" data-tip="${esc(`${label}: ${CONF_LBL[cf]}`)}"><small>${label}</small><i class="pn-dot c-${esc(cf)}"></i></span>`;
  }
  function rowHTML(r) {
    const w = r.rec, rec = `${w.W}–${w.L}${w.D ? `–${w.D}` : ""}`;
    return `<button type="button" class="pn-row${r.archId === P.sel ? " on" : ""}" data-id="${esc(r.archId)}" aria-pressed="${r.archId === P.sel}">
      <span class="pn-rname">${esc(r.name)}</span><span class="pn-rrec num" data-tip="${esc(`${r.nMatches} match: ${w.W} vinti, ${w.L} persi${w.D ? `, ${w.D} pari` : ""}`)}">${rec}</span>
      <span class="pn-dots">${confDot(r.play, "OTP")}${confDot(r.draw, "OTD")}</span></button>`;
  }

  // Chip del piano: +q Nome (verde) / −q Nome (rosso); "chiave" in grassetto con pallino
  function chipsHTML(plan, rec, extra) {
    const verd = new Map((rec.cards || []).map((c) => [A.cardKey(c.name), c.verdict]));
    const nov = new Set((rec.notInVersion || []).map((n) => n.key || A.cardKey(n.name)));
    const one = (c, dir) => {
      const k = A.cardKey(c.name), v = c.verdict || verd.get(k), key = v === "chiave", off = nov.has(k);
      const tips = [];
      if (c.freq != null) tips.push(`mossa in ${Math.round(c.freq * 100)}% dei game`);
      if (v) tips.push(VERDICT_LBL[v] || v);
      if (off) tips.push("non più in lista");
      return `<span class="pn-chip ${dir}${key ? " key" : ""}${off ? " off" : ""}" data-card="${esc(c.name)}"${tips.length ? ` data-tip="${esc(tips.join(" · "))}"` : ""}>${dir === "in" ? "+" : MINUS}${c.q} ${esc(c.name)}</span>`;
    };
    const ins = (plan.in || []).filter((c) => c.q > 0).map((c) => one(c, "in")), outs = (plan.out || []).filter((c) => c.q > 0).map((c) => one(c, "out"));
    return `<div class="pn-chips${extra ? " " + extra : ""}">${ins.join("")}${ins.length && outs.length ? `<span class="pn-sep" aria-hidden="true">/</span>` : ""}${outs.join("")}</div>`;
  }

  // Barra intervallo: 0–100%, banda lo–hi, punto = stima, tacca = baseline osservata, linea tenue = 50%
  function rangeHTML(e, base, label) {
    if (!e || e.wr == null) return `<div class="pn-range"><span class="muted small">${esc(label || "Win rate atteso")}: stima non disponibile</span></div>`;
    const L = (x) => (clamp01(x) * 100).toFixed(1) + "%";
    const lo = e.lo != null ? e.lo : e.wr, hi = e.hi != null ? e.hi : e.wr;
    const bs = base && base.n && base.wr != null;
    const aria = `${label || "Win rate atteso"} ${pct(e.wr)}, intervallo ${rng({ lo, hi })}${bs ? `, osservato ${pct(base.wr)} su ${base.n} game` : ""}`;
    return `<div class="pn-range" role="img" aria-label="${esc(aria)}">
      <div class="pn-rl"><span class="muted small">${esc(label || "Post-board atteso")}</span><b class="num">${pct(e.wr)}</b><span class="muted small num">(${rng({ lo, hi })})</span></div>
      <div class="pn-track"><span class="pn-mid"></span><span class="pn-band" style="left:${L(lo)};width:${((clamp01(hi) - clamp01(lo)) * 100).toFixed(1)}%"></span>
        ${bs ? `<span class="pn-base" style="left:${L(base.wr)}" data-tip="${esc(`Osservato finora: ${pct(base.wr)} su ${base.n} game`)}"></span>` : ""}<span class="pn-pt" style="left:${L(e.wr)}"></span></div>
      <div class="pn-rs muted small">${bs ? `<span><i class="pn-base-sw"></i> osservato ${pct(base.wr)} su ${base.n} game</span>` : `<span>nessun game osservato per il confronto</span>`}</div></div>`;
  }

  function levelHint(rec, row) {
    if (rec.level === "gruppo") return `basato anche sui mazzi ${esc(row.gname || "dello stesso gruppo")}`;
    if (rec.level === "guida") return "dalla guida scritta";
    if (rec.level === "matchup") return "basato su entrambi i lati del matchup";
    return "";
  }

  function sideHTML(row, side) {
    const rec = row[side], label = SIDES.find((s) => s[0] === side)[1];
    const alts = rec.alternatives || [], ai = Math.min(P.alt[side], alts.length), alt = ai ? alts[ai - 1] : null;
    const plan = alt ? alt.plan : rec.plan, empty = !hasPlan(plan);
    const cf = rec.confidence || "nessuna";
    let h = `<section class="card pn-side"><div class="pn-shead"><h3>${label}</h3><span class="pn-conf c-${esc(cf)}">${CONF_LBL[cf]}</span></div>`;
    const meta = [levelHint(rec, row), rec.nUsed ? `${rec.nUsed} ${rec.nUsed === 1 ? "game" : "game"} con sidata${rec.updatedAt ? ` · ultimo ${shortDate(rec.updatedAt)}` : ""}` : ""].filter(Boolean);
    if (meta.length) h += `<div class="pn-hint muted small">${meta.map((x, i) => (i ? " · " : "") + x).join("")}</div>`;
    if (alts.length) {
      h += `<div class="pn-pills" role="tablist" aria-label="Piani ${esc(label)}"><button type="button" class="pn-pill${ai === 0 ? " on" : ""}" data-alt="0" data-side="${side}">Consigliato</button>
        ${alts.map((a, i) => `<button type="button" class="pn-pill${ai === i + 1 ? " on" : ""}" data-alt="${i + 1}" data-side="${side}">${esc(a.label || `Alternativa ${i + 2}`)}</button>`).join("")}</div>`;
    }
    if (empty) {
      h += `<p class="pn-none">${rec.level === "nessuno" ? "Ancora nessuna sidata né guida per questo lato." : "Nessuna carta da muovere."}${canEdit() && rec.level === "nessuno" ? ` <span class="muted small">Registra le sidate di G2/G3 nel form della partita, oppure prova a costruirne una qui sotto.</span>` : ""}</p>`;
    } else h += chipsHTML(plan, rec);
    if (alt) {
      h += `<p class="pn-alt-info small"><b>Osservato con questo piano:</b> ${alt.wins} vinte su ${alt.n} game (${pct(alt.wr)}${alt.lo != null ? `, ${rng(alt)}` : ""})</p>`;
      h += rangeHTML({ wr: alt.wr, lo: alt.lo, hi: alt.hi }, rec.baseline, "Con questo piano");
    } else if (!empty || rec.expected) h += rangeHTML(rec.expected, rec.baseline);
    const niv = rec.notInVersion || [];
    if (niv.length) h += `<div class="pn-niv" role="note">⚠ non più in lista${X.c.ver ? ` (${esc(X.c.ver.name)})` : ""}: ${niv.map((n) => `<span class="pn-chip ${n.dir === "in" ? "in" : "out"} off">${n.dir === "in" ? "+" : MINUS} ${esc(n.name)}</span>`).join("")}</div>`;
    const why = (rec.why || []).filter(Boolean);
    if (why.length) {
      const ul = `<ul class="pn-why-list">${why.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
      h += why.length > 2 ? `<details class="pn-why"><summary>Perché <span class="muted small">(${why.length})</span></summary>${ul}</details>` : `<div class="pn-why"><div class="pn-why-t">Perché</div>${ul}</div>`;
    }
    h += `<div class="pn-actions no-print">
        <button type="button" class="btn sm${P.edit[side] ? " primary" : ""}" data-act="edit" data-side="${side}" aria-pressed="${!!P.edit[side]}">Prova modifiche</button>
        ${canEdit() ? `<button type="button" class="btn sm" data-act="guide" data-side="${side}"${empty ? " disabled" : ""}>Usa come guida</button>` : ""}
        <button type="button" class="btn sm" data-act="copy" data-side="${side}"${empty ? " disabled" : ""}>Copia</button></div>`;
    if (P.edit[side]) h += `<div class="pn-edit"><div class="pn-edithost"></div><div class="pn-est" aria-live="polite"></div></div>`;
    h += cardsHTML(rec, side);
    return h + `</section>`;
  }

  function cardsHTML(rec, side) {
    const cs = rec.cards || [];
    if (!cs.length) return "";
    const rows = cs.map((c) => `<tr><td><span class="pn-sign ${c.dir}">${c.dir === "in" ? "+" : MINUS}</span><span data-card="${esc(c.name)}">${esc(c.name)}</span></td>
      <td><span class="pn-verd v-${esc(c.verdict || "neutra")}">${esc(VERDICT_LBL[c.verdict] || c.verdict || "—")}</span></td>
      <td class="num r">${c.nWith ? `${c.winsWith}/${c.nWith}` : "—"}</td><td class="num r">${c.nWithout ? `${c.winsWithout}/${c.nWithout}` : "—"}</td></tr>`).join("");
    return `<details class="pn-cards" data-side="${side}"${P.cardsOpen[side] ? " open" : ""}><summary>Carte <span class="muted small">(${cs.length})</span></summary>
      <div class="table-wrap"><table class="pn-ctable"><thead><tr><th>Carta</th><th>Verdetto</th><th class="r">Con</th><th class="r">Senza</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="muted small" style="margin:6px 0 0">Vittorie/game post-board con e senza la carta nella sidata (stesso lato). Con pochi game è solo un indizio.</p></details>`;
  }

  // ---------------------------------------------------------------------
  //  Disegno delle parti
  // ---------------------------------------------------------------------
  const bindHover = (el) => { if (el && A.cards && A.cards.bindHover) A.cards.bindHover(el); };

  function shownPlan(row, side) {
    const rec = row[side], alts = rec.alternatives || [], ai = Math.min(P.alt[side], alts.length);
    return { plan: ai ? alts[ai - 1].plan : rec.plan, exp: ai ? { wr: alts[ai - 1].wr } : rec.expected };
  }

  function updEst(side) {
    const row = selectedRow(), el = $(`#pn-s-${side} .pn-est`);
    if (!row || !el || !P.edit[side]) return;
    const v = P.edit[side], rec = row[side];
    if (!hasPlan(v)) { el.innerHTML = `<span class="muted small">Aggiungi carte IN e OUT per vedere la stima.</span>`; return; }
    let e;
    try { e = eng().estimate({ matches: X.c.ms, archId: row.archId, side, plan: { in: v.in, out: v.out }, version: X.c.ver || undefined, groupArchIds: groupArchIds(row.archId) }); }
    catch (err) { console.error(err); el.innerHTML = `<span class="warn">Stima non disponibile.</span>`; return; }
    const ref = shownPlan(row, side).exp, d = e && e.wr != null && ref && ref.wr != null ? (e.wr - ref.wr) * 100 : null;
    el.innerHTML = `<div class="pn-est-h"><b>Stima con le tue modifiche</b>${d != null ? `<span class="pn-delta ${d >= 0 ? "up" : "down"}">${d >= 0 ? "+" : MINUS}${Math.abs(d).toFixed(1).replace(/\.0$/, "")} pt <small>vs piano mostrato</small></span>` : ""}</div>
      ${rangeHTML(e, rec.baseline, "Con le tue modifiche")}
      ${e && e.note ? `<p class="muted small pn-note">${esc(e.note)}</p>` : ""}`;
  }

  function drawSide(side) {
    const row = selectedRow(), host = $(`#pn-s-${side}`);
    if (!row || !host) return;
    host.innerHTML = sideHTML(row, side);
    if (P.edit[side]) {
      A.sbEditor($(".pn-edithost", host), {
        version: () => X.c.ver || undefined, value: P.edit[side],
        buttons: [{ label: "Riparti dal piano mostrato", run(ed) { ed.set(clonePlan(shownPlan(row, side).plan)); } }],
        onChange(v) { P.edit[side] = v; updEst(side); },
      });
      updEst(side);
    }
    const cd = $(".pn-cards", host);
    if (cd) cd.addEventListener("toggle", () => { P.cardsOpen[side] = cd.open; });
    bindHover(host);
  }

  function drawDetail() {
    const row = selectedRow(), el = $("#pn-detail");
    if (!el) return;
    if (!row) { el.innerHTML = X.rows.length ? `<div class="card empty-state"><p>Scegli un matchup dalla lista.</p></div>` : ""; return; }
    const w = row.rec;
    el.innerHTML = `<div class="pn-dhead"><div><h2 class="pn-dtitle">vs ${esc(row.name)}${row.gname ? ` <span class="grp-chip">${esc(row.gname)}</span>` : ""}</h2>
        <span class="muted small">${row.nMatches} match (${w.W}–${w.L}${w.D ? `–${w.D}` : ""}) · ${row.nPost} game post-board</span></div>
        <a class="btn sm no-print" href="#sideboard/${encodeURIComponent(row.archId)}">Guida e statistiche →</a></div>
      <div class="pn-sides"><div id="pn-s-play"></div><div id="pn-s-draw"></div></div>`;
    drawSide("play"); drawSide("draw");
  }

  function drawList() {
    const xs = visibleRows(), list = $("#pn-list");
    if (!list) return;
    const gids = new Set(X.rows.map((r) => r.gid).filter(Boolean));
    const chips = S.groups.filter((g) => gids.has(g.id));
    $("#pn-chips").innerHTML = chips.length ? [["", "Tutti"], ...chips.map((g) => [g.id, g.name])].map(([id, n]) => `<button type="button" class="pn-gchip${P.group === id ? " on" : ""}" data-g="${esc(id)}" aria-pressed="${P.group === id}">${esc(n)}</button>`).join("") : "";
    $("#pn-count").textContent = `${xs.length} ${xs.length === 1 ? "matchup" : "matchup"}`;
    list.innerHTML = xs.length ? xs.map(rowHTML).join("") : `<p class="muted pn-empty">${P.q.trim() ? `Nessun matchup corrisponde a “${esc(P.q.trim())}”.` : "Nessun matchup in questo gruppo."}</p>`;
    const on = $(".pn-row.on", list);
    if (on && list.scrollHeight > list.clientHeight) { const t = on.offsetTop - list.offsetTop - 8; if (t < list.scrollTop || t > list.scrollTop + list.clientHeight - 40) list.scrollTop = Math.max(0, t - 40); }
  }

  function select(id) {
    if (id === P.sel) return;
    P.sel = id; resetSel();
    try { history.replaceState(null, "", `#plan/${encodeURIComponent(id)}`); } catch { /* ignore */ }
    drawList(); drawDetail();
    if (window.matchMedia && window.matchMedia("(max-width: 899px)").matches) { const d = $("#pn-detail"); if (d) d.scrollIntoView({ behavior: "smooth", block: "start" }); }
  }

  // ---------------------------------------------------------------------
  //  Pannello "Il mazzo"
  // ---------------------------------------------------------------------
  const sumQ = (l) => l.reduce((s, c) => s + c.q, 0);
  function deckBodyHTML() {
    let core;
    try { core = eng().core({ versions: X.c.versions, matches: X.c.ms }); }
    catch (err) { console.error(err); return `<p class="warn">Impossibile calcolare il riepilogo del mazzo.</p>`; }
    if (!core || !core.versions || !core.versions.length) return `<p class="muted">Nessuna lista salvata per questo mazzo: aggiungila dalla scheda Lista.</p>`;
    const cc = (l) => `<div class="pn-ccs">${l.map((c) => `<span class="pn-cc" data-card="${esc(c.name)}"><b>${c.q}</b> ${esc(c.name)}</span>`).join("") || `<span class="muted small">—</span>`}</div>`;
    const vers = core.versions;
    const spark = (f) => {
      const max = Math.max(1, ...f.byVersion.map((b) => b.q));
      return `<span class="pn-spark" aria-hidden="true">${vers.map((v) => { const b = f.byVersion.find((x) => x.versionId === v.id), q = b ? b.q : 0; return `<i class="${q ? "" : "z"}${X.c.ver && v.id === X.c.ver.id ? " cur" : ""}" style="${q ? `opacity:${(0.3 + 0.7 * q / max).toFixed(2)}` : ""}" data-tip="${esc(`${v.name}: ${q}`)}"></i>`; }).join("")}</span>`;
    };
    const flexRows = [["main", core.flex.main], ["side", core.flex.side]].flatMap(([z, l]) => (l || []).map((f) => ({ ...f, z })));
    const flexHTML = flexRows.length ? `<div class="pn-flex">${flexRows.map((f) => `<div class="pn-frow"><span class="pn-fname" data-card="${esc(f.name)}"><span class="pn-zone">${f.z === "main" ? "M" : "S"}</span>${esc(f.name)}</span>${spark(f)}<span class="pn-fcur num" data-tip="Copie nella lista selezionata">${f.current}</span>
        <span class="pn-frec muted small num">con ${f.nWith ? `${f.winsWith}/${f.nWith}` : "—"} · senza ${f.nWithout ? `${f.winsWithout}/${f.nWithout}` : "—"}</span></div>`).join("")}</div>
      <p class="muted small" style="margin:4px 0 0">Un quadratino per versione (dalla più vecchia): più è scuro, più copie. Record = game vinti/giocati con e senza la carta nella lista.</p>` : `<p class="muted small">Nessuna carta cambia tra le versioni: il mazzo è sempre lo stesso.</p>`;
    const tl = core.timeline.slice().reverse().map((t) => `<li><div class="pn-th"><b class="num">${esc(dayOf(t.date))}</b> <span>${esc(t.name)}</span> <span class="muted small">${t.n} ${t.n === 1 ? "match" : "match"}</span></div>
      ${t.changes.length ? `<div class="pn-tch">${t.changes.map((x) => { const d = x.to - x.from; return `<span class="pn-chip ${d > 0 ? "in" : "out"}" data-card="${esc(x.name)}" data-tip="${esc(`${x.zone === "main" ? "Main" : "Side"}: ${x.from} → ${x.to}`)}">${d > 0 ? "+" : MINUS}${Math.abs(d)} ${esc(x.name)} <small>${x.zone === "main" ? "main" : "side"}</small></span>`; }).join("")}</div>` : `<div class="muted small">nessuna modifica rispetto alla precedente</div>`}</li>`).join("");
    return `<div class="pn-core"><div><h4>Main <span class="num">${sumQ(core.core.main)}</span></h4>${cc(core.core.main)}</div><div><h4>Side <span class="num">${sumQ(core.core.side)}</span></h4>${cc(core.core.side)}</div></div>
      <h4 class="pn-h4">Carte che cambiano</h4>${flexHTML}
      <h4 class="pn-h4">Versioni</h4><ol class="pn-tl">${tl}</ol>`;
  }
  function drawDeck() {
    const body = $("#pn-deck-body");
    if (body) { body.innerHTML = deckBodyHTML(); bindHover(body); }
  }

  // ---------------------------------------------------------------------
  //  Copia
  // ---------------------------------------------------------------------
  const confSuffix = (rec) => (rec.level === "guida" ? " (da guida)" : rec.confidence && rec.confidence !== "nessuna" ? ` (${CONF_LBL[rec.confidence]})` : "");
  function copyAllText() {
    const blocks = [];
    for (const r of X.rows) {
      const lines = SIDES.filter(([sd]) => hasPlan(r[sd].plan)).map(([sd, , ab]) => `${ab}: ${planLine(r[sd].plan)}${confSuffix(r[sd])}`);
      if (lines.length) blocks.push(`*vs ${r.name}*\n${lines.join("\n")}`);
    }
    return blocks.length ? [`*Piano sideboard · ${X.c.deck ? X.c.deck.name : ""}${X.c.ver ? ` · ${X.c.ver.name}` : ""}*`, ...blocks].join("\n\n") : "";
  }

  // ---------------------------------------------------------------------
  //  Azioni sulle card
  // ---------------------------------------------------------------------
  function onAction(b) {
    const side = b.dataset.side, act = b.dataset.act, row = selectedRow();
    if (!row || !side) return;
    const { plan } = shownPlan(row, side), label = SIDES.find((s) => s[0] === side)[1];
    if (act === "edit") {
      P.edit[side] = P.edit[side] ? null : clonePlan(plan);
      drawSide(side);
    } else if (act === "copy") {
      if (!hasPlan(plan)) return;
      copyText(`*vs ${row.name} · ${label}*\n${planLine(plan)}${confSuffix(row[side])}`, "Piano copiato");
    } else if (act === "guide") {
      if (!canEdit() || !hasPlan(plan)) return;
      const g = A.guideFor(row.archId), cur = g ? { in: (g[side + "_in"] || "").trim(), out: (g[side + "_out"] || "").trim() } : { in: "", out: "" };
      const next = { in: A.listToText(plan.in.filter((c) => c.q > 0)), out: A.listToText(plan.out.filter((c) => c.q > 0)) };
      const same = cur.in === next.in.trim() && cur.out === next.out.trim();
      if ((cur.in || cur.out) && !same && !confirm(`La guida contro ${row.name} (${label.toLowerCase()}) contiene già un piano. Sostituirlo con questo?`)) return;
      A.guard(async () => {
        await A.saveGuide(row.archId, { [side + "_in"]: next.in, [side + "_out"]: next.out });
        A.toast(`Guida aggiornata: ${row.name} (${label.toLowerCase()})`);
        refresh();
      });
    }
  }

  // ---------------------------------------------------------------------
  //  Vista
  // ---------------------------------------------------------------------
  let rootEl = null;
  const refresh = () => view(rootEl, null);

  function view(root, arg) {
    rootEl = root;
    const deck = A.currentDeck();
    if (P.deck !== (deck && deck.id)) { Object.assign(P, { deck: deck && deck.id, sel: null, verId: "", q: "", group: "" }); resetSel(); }
    if (arg && arg !== P.sel) { P.sel = arg; resetSel(); }
    const c = context();
    X = { root, c, rows: [], err: null };
    try { X.rows = computeRows(c); } catch (err) { console.error(err); X.err = err; }
    if (!X.rows.some((r) => r.archId === P.sel)) {
      if (arg) P.sel = null;
      const first = visibleRows()[0] || X.rows[0];
      if (P.sel !== (first ? first.archId : null)) { P.sel = first ? first.archId : null; resetSel(); }
    }
    if (P.sel) { try { history.replaceState(null, "", `#plan/${encodeURIComponent(P.sel)}`); } catch { /* ignore */ } }

    // Aggiornamento: sidate usate e data dell'ultima
    let nS = 0, last = "";
    for (const r of X.rows) for (const [sd] of SIDES) { const x = r[sd]; if (!x) continue; nS += x.nSide != null ? x.nSide : x.nUsed || 0; if (x.updatedAt && x.updatedAt > last) last = x.updatedAt; }
    const fresh = nS ? `Aggiornato con ${nS} ${nS === 1 ? "sidata" : "sidate"}${last ? ` · ultima ${shortDate(last)}` : ""}` : "Ancora nessuna sidata registrata";

    root.innerHTML = `
      <div class="page-head"><h1>Piano sideboard <span class="muted" style="font-weight:500">· ${esc(deck.name)}</span></h1>
        <div class="inline no-print"><button class="btn" id="pn-copyall"${X.rows.length ? "" : " disabled"}>📋 Copia tutti i piani</button></div></div>
      ${A.sbNavHTML ? A.sbNavHTML("plan") : ""}
      <div class="pn-meta no-print">
        <label class="pn-ver">Lista <select id="pn-ver" aria-label="Versione della lista">${c.versions.length ? c.versions.map((v) => `<option value="${esc(v.id)}"${c.ver && v.id === c.ver.id ? " selected" : ""}>${esc(v.name)}${v.is_active ? " (attiva)" : ""}</option>`).join("") : `<option value="">Nessuna lista</option>`}</select></label>
        <span class="muted small" id="pn-fresh">${esc(fresh)}</span></div>
      ${mocked() ? `<div class="pn-soon" role="status"><b>Motore in arrivo.</b> Stai vedendo un'anteprima con dati semplificati: percentuali e “perché” non sono ancora quelli veri.</div>` : ""}
      ${X.err ? `<div class="card empty-state"><p>Non riesco a calcolare i piani con i dati attuali. Riprova più tardi o apri le <a href="#sideboard">statistiche</a>.</p></div>` : ""}
      <details class="card pn-deck" id="pn-deck"${P.deckOpen ? " open" : ""}><summary>Il mazzo <span class="muted small">core, carte che cambiano, versioni</span></summary><div id="pn-deck-body"></div></details>
      ${X.err ? "" : !X.rows.length ? `<div class="card empty-state"><p>Nessun matchup da mostrare: serve almeno una partita contro un archetipo o una guida scritta.</p>${canEdit() ? `<a class="btn primary" href="#add">+ Registra una partita</a>` : ""}</div>` : `
      <div class="pn-grid">
        <aside class="card pn-pick no-print" aria-label="Scegli il matchup">
          <input type="search" id="pn-q" placeholder="Cerca avversario…" aria-label="Cerca avversario" autocomplete="off" value="${esc(P.q)}">
          <div class="pn-chips-g" id="pn-chips"></div>
          <div class="pn-pbar"><select id="pn-sort" aria-label="Ordina">${SORTS.map(([v, l]) => `<option value="${v}"${P.sort === v ? " selected" : ""}>${l}</option>`).join("")}</select><span class="muted small" id="pn-count"></span></div>
          <div class="pn-list" id="pn-list" role="list"></div>
        </aside>
        <div id="pn-detail" class="pn-detail"></div>
      </div>`}`;

    rootEl.onclick = null;
    if (P.deckOpen) drawDeck();
    $("#pn-deck", root).addEventListener("toggle", (e) => { P.deckOpen = e.target.open; if (P.deckOpen) drawDeck(); });
    const ver = $("#pn-ver", root);
    if (ver) ver.onchange = () => { P.verId = ver.value; P.edit = { play: null, draw: null }; refresh(); };
    const ca = $("#pn-copyall", root);
    if (ca) ca.onclick = () => { const t = copyAllText(); if (!t) { A.toast("Nessun piano da copiare"); return; } copyText(t, "Piani copiati: incollali dove vuoi"); };
    if (!X.rows.length || X.err) return;
    $("#pn-q", root).oninput = (e) => { P.q = e.target.value; drawList(); };
    $("#pn-sort", root).onchange = (e) => { P.sort = e.target.value; drawList(); };
    drawList(); drawDetail();
    root.onclick = (e) => {
      const t = e.target;
      const r = t.closest(".pn-row"); if (r) { select(r.dataset.id); return; }
      const g = t.closest(".pn-gchip"); if (g) { P.group = g.dataset.g; drawList(); return; }
      const p = t.closest(".pn-pill"); if (p) { P.alt[p.dataset.side] = +p.dataset.alt; drawSide(p.dataset.side); return; }
      const b = t.closest(".pn-actions button[data-act]"); if (b && !b.disabled) onAction(b);
    };
  }

  A.views.plan = (root, arg) => view(root, arg);
})();
