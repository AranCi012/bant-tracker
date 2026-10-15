// Report leggibile (Haiku): vista #report, stampa come PDF, file .html autonomo, testo per WhatsApp.
(() => {
  "use strict";

  const A = window.App;
  const esc = (s) => A.esc(s);
  const pct = (x, d = 0) => A.pct(x, d);
  const safe = (fn, fallback = null) => { try { return fn(); } catch (err) { console.error(err); return fallback; } };

  const TIER_RANK = { chiave: 0, routine: 1, occasionale: 2 };
  const TIER_LABEL = { chiave: "Chiave", routine: "Routine", occasionale: "Occasionale" };
  const copie = (q) => `${q} ${q === 1 ? "copia" : "copie"}`;
  const pctOr = (x) => (x == null || isNaN(x) ? "—" : pct(x));
  const recStr = (s) => `${s.W}–${s.L}${s.D ? `–${s.D}` : ""}`;
  const slug = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mazzo";

  // Commento in parole per un matchup: [classe, etichetta]
  function comento(s) {
    if (s.n < A.LOW_N) return ["low", "Pochi dati"];
    if (s.wr >= 0.6 - 1e-9) return ["fav", "Favorevole"];
    if (s.wr <= 0.4 + 1e-9) return ["unf", "Sfavorevole"];
    return ["eq", "Equilibrato"];
  }

  // ---------------------------------------------------------------------
  //  Modello: calcolato una volta, poi usato da vista, file e WhatsApp
  // ---------------------------------------------------------------------
  function filterLabel() {
    const f = A.S.filters, parts = [];
    parts.push(f.player ? f.player : "Tutti i giocatori");
    if (f.version) { const v = A.versionById(f.version); parts.push(`lista ${v ? v.name : "?"}`); }
    if (f.event) parts.push(f.event);
    if (f.from && f.to) parts.push(`dal ${A.fmtDate(f.from)} al ${A.fmtDate(f.to)}`);
    else if (f.from) parts.push(`dal ${A.fmtDate(f.from)}`);
    else if (f.to) parts.push(`al ${A.fmtDate(f.to)}`);
    return parts.join(" · ");
  }

  function buildModel() {
    const deck = A.currentDeck();
    const ms = A.filtered();
    const dates = ms.map((m) => m.played_at).filter(Boolean).sort();
    const players = [...new Set(ms.map((m) => m.player).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    // Sidate: se il modulo sbstats manca, la sezione viene saltata ("missing")
    const rep = A.sbstats && ms.length ? safe(() => A.sbstats.analyze(ms)) : null;
    const sbState = !rep ? "missing" : rep.recorded > 0 ? "ok" : "none";
    return {
      deck: deck ? deck.name : "Mazzo",
      generated: new Date().toLocaleDateString("it-IT"),
      filterText: filterLabel(),
      n: ms.length,
      players,
      first: dates[0] || "",
      last: dates[dates.length - 1] || "",
      overall: A.stats(ms),
      matchups: A.byArchetype(ms),
      sbState,
      sb: sbState === "ok" ? rep : null,
    };
  }

  // "In breve": frasi semplici dai numeri generali
  function sentencesBreve(m) {
    const o = m.overall, out = [];
    if (!o.n) return ["Nessun match con i filtri attuali."];
    out.push(`Su ${o.n} ${o.n === 1 ? "match giocato" : "match giocati"} (${o.W} ${o.W === 1 ? "vinto" : "vinti"}, ${o.L} ${o.L === 1 ? "perso" : "persi"}${o.D ? `, ${o.D} pareggiati` : ""}) il mazzo ha un win rate del ${pct(o.wr)}${o.n < A.LOW_N ? ": sono ancora pochi match per trarre conclusioni" : ""}.`);
    if (o.play != null && o.draw != null) {
      const diff = (o.play - o.draw) * 100;
      const verdetto = Math.abs(diff) < 5 ? "la differenza è piccola" : diff > 0 ? "finora vi va meglio quando iniziate voi" : "finora vi va meglio quando iniziano loro";
      out.push(`Giocando per primi vincete il ${pct(o.play)} delle game (${o.playW} su ${o.playN}), contro il ${pct(o.draw)} quando giocate in seconda (${o.drawW} su ${o.drawN}): ${verdetto}.`);
    } else {
      out.push("Non ci sono ancora abbastanza game registrate separatamente per chi gioca per primo e in seconda.");
    }
    if (o.pre != null && o.post != null) {
      const diff = (o.post - o.pre) * 100;
      const verdetto = diff > 5 ? "dopo la sidata finora andate meglio" : diff < -5 ? "dopo la sidata finora andate peggio" : "prima e dopo la sidata andate più o meno uguale";
      out.push(`Nelle game dopo la sidata (2 e 3) vincete il ${pct(o.post)} (${o.postW} su ${o.postN}), contro il ${pct(o.pre)} della prima game (${o.preW} su ${o.preN}): ${verdetto}.`);
    }
    const eligible = m.matchups.filter((x) => x.s.n >= A.LOW_N);
    if (eligible.length >= 2) {
      const best = eligible.reduce((a, b) => (b.s.wr > a.s.wr ? b : a));
      const worst = eligible.reduce((a, b) => (b.s.wr < a.s.wr ? b : a));
      out.push(`Il matchup migliore è contro ${best.arch.name} (${recStr(best.s)}, ${pct(best.s.wr)}); il peggiore è contro ${worst.arch.name} (${recStr(worst.s)}, ${pct(worst.s.wr)}).`);
    } else if (eligible.length === 1) {
      out.push(`Solo ${eligible[0].arch.name} ha almeno ${A.LOW_N} match (${recStr(eligible[0].s)}): non è ancora possibile confrontare i matchup.`);
    } else {
      out.push(`Nessun avversario ha ancora almeno ${A.LOW_N} match: i dati per matchup sono indicativi.`);
    }
    const small = m.matchups.filter((x) => x.s.n < A.LOW_N).length;
    if (small && eligible.length) out.push(`${small === 1 ? "Un matchup ha" : `${small} matchup hanno`} meno di ${A.LOW_N} match: per ${small === 1 ? "quello" : "quelli"} il dato è poco affidabile.`);
    return out;
  }

  // ---------------------------------------------------------------------
  //  Sidate: helper
  // ---------------------------------------------------------------------
  const findCard = (list, key) => (list || []).find((c) => c.key === key) || null;
  const sideRate = (side, dir, key) => { const c = findCard(side && side.cards && side.cards[dir], key); return c ? c.rate : null; };
  function topCards(list, limit) {
    return [...(list || [])]
      .sort((a, b) => (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9) || (b.rate || 0) - (a.rate || 0))
      .slice(0, limit);
  }
  const chip = (c, dir) => `<span class="rp-chip ${dir}">${dir === "in" ? "+" : "−"}${c.q} ${esc(c.name)}</span>`;
  const chips = (t) => [...((t && t.in) || []).map((c) => chip(c, "in")), ...((t && t.out) || []).map((c) => chip(c, "out"))].join("");
  const planTxt = (t) => [...((t && t.in) || []).map((c) => `+${c.q} ${c.name}`), ...((t && t.out) || []).map((c) => `−${c.q} ${c.name}`)].join(", ");

  function cardListHTML(list, dir, sides) {
    if (!list.length) return `<p class="rp-small">Nessuna carta ricorrente.</p>`;
    return `<ul class="rp-ul">${list.map((c) => {
      const tier = TIER_LABEL[c.tier] ? c.tier : "occasionale";
      const p = sideRate(sides && sides.play, dir, c.key), d = sideRate(sides && sides.draw, dir, c.key);
      return `<li><span class="nm">${esc(c.name)} <span class="rp-badge ${tier}">${TIER_LABEL[tier]}</span></span>
        <span class="det">Frequenza ${pctOr(c.rate)}${c.modeQ ? ` · di solito ${copie(c.modeQ)}` : ""} · play ${pctOr(p)} · draw ${pctOr(d)}</span></li>`;
    }).join("")}</ul>`;
  }

  function guideHTML(g) {
    if (!g) return "";
    const lines = [["Sul play", g.play_in, g.play_out], ["Sul draw", g.draw_in, g.draw_out]]
      .filter(([, i, o]) => (i || "").trim() || (o || "").trim())
      .map(([l, i, o]) => `<div class="rp-guide-line"><b>${l}:</b> <span class="rp-chips">${[
        ...A.parseList(i || "").map((c) => chip(c, "in")), ...A.parseList(o || "").map((c) => chip(c, "out"))].join("")}</span></div>`);
    if (g.notes && g.notes.trim()) lines.push(`<p class="rp-notes">${esc(g.notes.trim()).replace(/\n/g, "<br>")}</p>`);
    if (!lines.length) return "";
    return `<div class="rp-guide"><h4>Guida scritta</h4>${lines.join("")}</div>`;
  }

  function planBoxHTML(label, st) {
    const n = (st && st.n) || 0, t = st && st.typical;
    const sup = t && typeof t.support === "number" ? ` · basato su ${t.support} game` : "";
    const c = chips(t);
    const body = n ? (c ? `<div class="rp-chips">${c}</div>` : `<p class="rp-small">Nessuna sidata ricorrente.</p>`) : `<p class="rp-small">Nessun dato su questo lato.</p>`;
    return `<div class="rp-plan"><h4>${label}</h4>${body}${n ? `<p class="rp-small">Win rate ${pct(st.wr)}${sup}</p>` : ""}</div>`;
  }

  function matchupBlockHTML(rep, r) {
    const sc = r.scope || {};
    const sum = safe(() => A.sbstats.archSummary(rep, r.archId), []) || [];
    const g = safe(() => A.guideFor(r.archId), null);
    const sides = sc.sides || {};
    return `<div class="rp-matchup">
      <div class="rp-matchup-head"><h3>vs ${esc(r.name)}</h3><span class="rp-small">su ${(sides.all && sides.all.n) || 0} game</span></div>
      ${sum.length ? `<ul class="rp-list">${sum.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
      <div class="rp-plans">${planBoxHTML("Sul play", sides.play)}${planBoxHTML("Sul draw", sides.draw)}</div>
      ${guideHTML(g)}
    </div>`;
  }

  function sidateHTML(m) {
    if (m.sbState === "missing") return "";
    if (m.sbState === "none") {
      return `<section class="rp-sec"><h2>Sidate</h2>
        <p>Per ora non ci sono sidate registrate per questi match, quindi questa parte del report è vuota.</p>
        <p><b>Per iniziare:</b> nel modulo di registrazione partita compila le sidate di ogni game (le carte che entrano e che escono), oppure confermale dalle note dei match nella sezione Sideboard. Più sidate registrate, più il report saprà dire cosa funziona in ogni matchup.</p>
      </section>`;
    }
    const rep = m.sb;
    const hl = safe(() => A.sbstats.highlights(rep, { max: 6 }), []) || [];
    const sides = rep.overall && rep.overall.sides;
    const cardsIn = topCards(sides && sides.all && sides.all.cards && sides.all.cards.in, 12);
    const cardsOut = topCards(sides && sides.all && sides.all.cards && sides.all.cards.out, 12);
    const byArch = [...(rep.byArch || [])].sort((a, b) => ((b.scope && b.scope.sides && b.scope.sides.all && b.scope.sides.all.n) || 0) - ((a.scope && a.scope.sides && a.scope.sides.all && a.scope.sides.all.n) || 0));
    return `<section class="rp-sec">
      <h2>Sidate</h2>
      ${hl.length ? `<ul class="rp-list">${hl.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : `<p class="rp-muted">Ancora poche sidate per evidenziare tendenze.</p>`}
      <h3 class="rp-h3">Carte chiave e di routine</h3>
      <p class="rp-small">Frequenza: quanto spesso la carta compare nelle sidate registrate. Play e draw indicano la frequenza su ciascun lato.</p>
      <div class="rp-cols">
        <div><h4>Entrano</h4>${cardListHTML(cardsIn, "in", sides)}</div>
        <div><h4>Escono</h4>${cardListHTML(cardsOut, "out", sides)}</div>
      </div>
      <h3 class="rp-h3">Piani per matchup</h3>
      <div class="rp-matchups">${byArch.map((r) => matchupBlockHTML(rep, r)).join("")}</div>
    </section>`;
  }

  // ---------------------------------------------------------------------
  //  Corpo del report (uguale per schermo e file)
  // ---------------------------------------------------------------------
  function articleHTML(m) {
    const head = `<header class="rp-head">
      <p class="rp-kicker">Report · Meta Tracker</p>
      <h1>${esc(m.deck)}</h1>
      <p class="rp-sub">${esc(m.filterText)}</p>
      <dl class="rp-facts">
        <div><dt>Generato</dt><dd>${esc(m.generated)}</dd></div>
        <div><dt>Match</dt><dd>${m.n}</dd></div>
        <div><dt>Giocatori</dt><dd>${m.players.length ? esc(m.players.join(", ")) : "—"}</dd></div>
        <div><dt>Periodo</dt><dd>${m.first ? `${esc(A.fmtDate(m.first))} – ${esc(A.fmtDate(m.last))}` : "—"}</dd></div>
      </dl>
    </header>`;
    if (!m.n) {
      return `<article class="report">${head}<section class="rp-sec"><p>Nessun match con i filtri attuali. Cambia o azzera i filtri per vedere il report.</p></section></article>`;
    }
    const breve = `<section class="rp-sec"><h2>In breve</h2><div class="rp-lead">${sentencesBreve(m).map((s) => `<p>${esc(s)}</p>`).join("")}</div></section>`;
    const rows = m.matchups.map((x) => {
      const [cls, lab] = comento(x.s);
      const w = Math.round(x.s.wr * 100);
      return `<tr>
        <td>${esc(x.arch.name)}</td>
        <td class="num">${x.s.n}</td>
        <td class="num">${recStr(x.s)}</td>
        <td class="rp-wr"><span class="rp-meter"><i style="width:${w}%;background:${x.s.wr >= 0.5 ? "var(--win)" : "var(--loss)"}"></i><b></b></span><span class="num">${pct(x.s.wr)}</span></td>
        <td><span class="rp-com ${cls}">${lab}</span></td>
      </tr>`;
    }).join("");
    const matchup = `<section class="rp-sec"><h2>Matchup</h2>
      ${m.matchups.length ? `<div class="table-wrap"><table class="rp-table">
        <thead><tr><th>Avversario</th><th class="num">Match</th><th class="num">Vinti–Persi</th><th>Win rate</th><th>Commento</th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : `<p>Nessun avversario con match registrati.</p>`}
    </section>`;
    const foot = `<footer class="rp-foot">
      <p>Generato da Meta Tracker il ${esc(m.generated)}.</p>
      <p class="rp-note">Attenzione ai campioni piccoli: con meno di ${A.LOW_N} match un risultato può cambiare molto con una sola partita. Leggi i numeri come indicazioni, non come certezze.</p>
    </footer>`;
    return `<article class="report">${head}${breve}${matchup}${sidateHTML(m)}${foot}</article>`;
  }

  // ---------------------------------------------------------------------
  //  Testo per WhatsApp
  // ---------------------------------------------------------------------
  function waText(m) {
    const L = [];
    L.push(`*📊 Report ${m.deck}*`);
    L.push(`${m.generated} · ${m.n} match · ${m.filterText}`);
    if (m.players.length) L.push(`Giocatori: ${m.players.join(", ")}`);
    if (m.first) L.push(`Periodo: ${A.fmtDate(m.first)} – ${A.fmtDate(m.last)}`);
    L.push("");
    if (!m.n) { L.push("Nessun match con i filtri attuali."); return L.join("\n"); }
    L.push("*🔎 In breve*");
    sentencesBreve(m).forEach((s) => L.push(`• ${s}`));
    L.push("", "*⚔️ Matchup*");
    if (!m.matchups.length) L.push("• Nessun dato");
    m.matchups.forEach((x) => L.push(`• *${x.arch.name}*: ${recStr(x.s)} (${pct(x.s.wr)}) · ${comento(x.s)[1]}`));
    if (m.sbState === "ok") {
      const rep = m.sb, sides = rep.overall && rep.overall.sides;
      const hl = safe(() => A.sbstats.highlights(rep, { max: 6 }), []) || [];
      L.push("", "*🎯 Sidate*");
      hl.forEach((s) => L.push(`• ${s}`));
      const line = (c, dir) => `• ${dir === "in" ? "Entra" : "Esce"}: ${c.name} (${TIER_LABEL[c.tier] || "occasionale"}, frequenza ${pct(c.rate)}${c.modeQ ? `, di solito ${copie(c.modeQ)}` : ""})`;
      const cIn = topCards(sides && sides.all && sides.all.cards && sides.all.cards.in, 8);
      const cOut = topCards(sides && sides.all && sides.all.cards && sides.all.cards.out, 8);
      L.push("", "*🃏 Carte chiave e di routine*");
      cIn.forEach((c) => L.push(line(c, "in")));
      cOut.forEach((c) => L.push(line(c, "out")));
      L.push("", "*🧭 Piani per matchup*");
      [...(rep.byArch || [])].forEach((r) => {
        const sc = r.scope || {}, pl = sc.sides && sc.sides.play, dr = sc.sides && sc.sides.draw;
        L.push(`*vs ${r.name}*`);
        (safe(() => A.sbstats.archSummary(rep, r.archId), []) || []).forEach((s) => L.push(`• ${s}`));
        L.push(`• Sul play: ${pl && pl.n ? planTxt(pl.typical) || "nessuna sidata ricorrente" : "nessun dato"}`);
        L.push(`• Sul draw: ${dr && dr.n ? planTxt(dr.typical) || "nessuna sidata ricorrente" : "nessun dato"}`);
        const g = safe(() => A.guideFor(r.archId), null);
        if (g) {
          if ((g.play_in || g.play_out || "").trim()) L.push(`• Guida play: ${A.parseList(g.play_in || "").map((c) => `+${c.q} ${c.name}`).concat(A.parseList(g.play_out || "").map((c) => `−${c.q} ${c.name}`)).join(", ")}`);
          if ((g.draw_in || g.draw_out || "").trim()) L.push(`• Guida draw: ${A.parseList(g.draw_in || "").map((c) => `+${c.q} ${c.name}`).concat(A.parseList(g.draw_out || "").map((c) => `−${c.q} ${c.name}`)).join(", ")}`);
          if ((g.notes || "").trim()) L.push(`• Note: ${g.notes.trim().replace(/\s*\n\s*/g, " ")}`);
        }
      });
    } else if (m.sbState === "none") {
      L.push("", "*🎯 Sidate*", "Nessuna sidata registrata: registrale nel modulo partita per vedere il piano per matchup.");
    }
    L.push("", `_Campioni piccoli (meno di ${A.LOW_N} match): i numeri sono indicativi._`);
    return L.join("\n");
  }

  // ---------------------------------------------------------------------
  //  File HTML autonomo (CSS inline, versione chiara, nessuno script)
  // ---------------------------------------------------------------------
  const LIGHT_VARS = `:root{color-scheme:light;--bg:#f6f5f2;--surface:#fcfcfb;--surface-2:#f0efec;--border:#e3e1dc;--grid:#e9e7e2;--text:#0b0b0b;--text-2:#52514e;--text-3:#8a8883;--accent:#2a78d6;--accent-ink:#ffffff;--win:#2a78d6;--loss:#e34948;--mid:#f0efec;--good:#1a7f37;--bad:#c62828;--radius:12px;--shadow:0 1px 2px rgba(0,0,0,.05),0 4px 16px rgba(0,0,0,.05);}`;
  const FILE_EXTRA = `html{background:#f6f5f2}
body{margin:0;padding:24px 14px 48px;background:#f6f5f2;color:#0b0b0b;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
.rp-wrap{padding:0}`;

  async function reportCss() {
    try {
      const r = await fetch(new URL("css/report.css", document.baseURI));
      if (r.ok) return await r.text();
    } catch { /* ripiego sotto */ }
    try {
      const sh = [...document.styleSheets].find((s) => (s.href || "").includes("report.css"));
      return sh ? [...sh.cssRules].map((r) => r.cssText).join("\n") : "";
    } catch { return ""; }
  }

  async function fileHTML(m) {
    const css = await reportCss();
    return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light">
<title>Report ${esc(m.deck)}</title>
<style>${LIGHT_VARS}
${css}
${FILE_EXTRA}</style>
</head>
<body>
<div class="rp-wrap">${articleHTML(m)}</div>
</body>
</html>`;
  }

  // ---------------------------------------------------------------------
  //  Vista
  // ---------------------------------------------------------------------
  A.views.report = (root) => {
    const m = buildModel();
    root.innerHTML = `<div class="rp-wrap">
      <div class="rp-toolbar no-print">
        <button class="btn ghost sm" id="rp-back">← Indietro</button>
        <div class="rp-actions">
          <button class="btn sm" id="rp-print">🖨 Salva come PDF</button>
          <button class="btn sm" id="rp-dl">⬇ Scarica report</button>
          <button class="btn primary sm" id="rp-wa">📋 Copia per WhatsApp</button>
        </div>
      </div>
      <div class="no-print rp-filters">${A.filtersHTML()}</div>
      ${articleHTML(m)}
    </div>`;
    A.bindFilters(root, () => A.route());

    root.querySelector("#rp-back").onclick = () => (history.length > 1 ? history.back() : (location.hash = "#dashboard"));
    root.querySelector("#rp-print").onclick = () => window.print();
    root.querySelector("#rp-dl").onclick = () => A.guard(async () => {
      const html = await fileHTML(buildModel());
      A.download(`report-${slug(m.deck)}-${A.today()}.html`, html, "text/html;charset=utf-8");
      A.toast("Report scaricato: aprilo dal telefono o dal computer");
    });
    root.querySelector("#rp-wa").onclick = () => A.guard(async () => {
      const txt = waText(buildModel());
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try { await navigator.clipboard.writeText(txt); A.toast("Testo copiato: incollalo in WhatsApp"); return; }
        catch { /* ripiego sotto */ }
      }
      A.download(`report-${slug(m.deck)}-${A.today()}.txt`, txt, "text/plain;charset=utf-8");
      A.toast("Appunti non disponibili: ho scaricato un file .txt");
    });
  };
})();
