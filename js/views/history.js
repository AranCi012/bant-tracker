// Storico: tabella dei match, export CSV, backup/import JSON.
(() => {
  "use strict";
  const A = window.App;
  const { $, S, DB, today } = A;
  const canEdit = () => !A.canEdit || A.canEdit();
  const emptyView = (msg) => (canEdit() ? A.emptyState(msg) : `<div class="card empty-state"><p>${msg}</p></div>`);

  function viewHistory(root) {
    const ms = A.chrono(A.filtered()).reverse();
    root.innerHTML = `
      <div class="page-head"><h1>Storico <span class="muted" style="font-weight:500">· ${A.esc(A.currentDeck().name)}</span></h1>
        <div class="inline">
          <a class="btn sm primary" href="#report">📄 Report leggibile</a>
          <button class="btn sm" id="exp-csv">Esporta CSV</button>
          <button class="btn sm" id="exp-json">Backup JSON</button>
          <label class="btn sm" data-edit>Importa backup<input type="file" id="imp-json" accept=".json,application/json" hidden></label>
        </div></div>
      ${A.filtersHTML()}
      ${ms.length ? `<div class="card">${A.matchTable(ms)}${canEdit() ? `<p class="muted small" style="margin-bottom:0">Clicca una riga per modificarla o eliminarla.</p>` : ""}</div>` : emptyView(A.deckMatches().length ? "Nessun match con questi filtri." : canEdit() ? "Ancora nessuna partita registrata." : "Nessun match ancora.")}`;
    A.bindFilters(root, () => viewHistory(root));
    A.bindMatchRows(root);
    A.bindDemo(root);
    $("#exp-csv", root).onclick = () => exportCSV(ms);
    $("#exp-json", root).onclick = () => A.download(`meta-backup-${today()}.json`, JSON.stringify({ version: 2, decks: S.decks, archetypes: S.archetypes, decklists: S.decklists, matches: S.matches, sideboard_guides: S.guides, archetype_groups: S.groups }, null, 2), "application/json");
    if ($("#imp-json", root)) $("#imp-json", root).onchange = (e) => A.guard(() => importJSON(e.target.files[0]));
  }

  const sbText = (sb) => (sb ? [...(sb.in || []).map((c) => `+${c.q} ${c.name}`), ...(sb.out || []).map((c) => `-${c.q} ${c.name}`)].join("; ") : "");

  function exportCSV(ms) {
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const pd = (p) => (p === true ? "play" : p === false ? "draw" : "");
    const deck = A.currentDeck();
    const head = ["data", "mazzo", "giocatore", "avversario", "nome_avversario", "lista", "evento", "risultato", "g1", "g1_play", "g2", "g2_play", "g2_sideboard", "g3", "g3_play", "g3_sideboard", "note"];
    const rows = ms.map((m) => [m.played_at, deck.name, m.player, A.archById(m.archetype_id)?.name, m.opponent, A.versionById(m.decklist_id)?.name, m.event, A.matchResult(m), m.g1, pd(m.p1), m.g2, pd(m.p2), sbText(m.sb2), m.g3, pd(m.p3), sbText(m.sb3), m.notes]);
    A.download(`match-${deck.name.replace(/\W+/g, "_")}-${today()}.csv`, [head, ...rows].map((r) => r.map(q).join(",")).join("\n"), "text/csv");
  }

  // Accetta backup v1 (senza mazzi: tutto va nel mazzo corrente) e v2.
  async function importJSON(file) {
    if (!file) return;
    const data = JSON.parse(await file.text());
    if (!data.matches || !data.archetypes) throw new Error("File non valido");
    if (!confirm(`Importare ${data.matches.length} match? I match già presenti (stesso id) vengono saltati.`)) return;
    const deckMap = {}, archMap = {}, verMap = {};
    const cur = A.currentDeck();
    for (const d of data.decks || []) {
      let ex = S.decks.find((x) => x.name.toLowerCase() === d.name.toLowerCase());
      if (!ex) { ex = await DB.insert("decks", { name: d.name, notes: d.notes || "" }); S.decks.push(ex); }
      deckMap[d.id] = ex.id;
    }
    const deckOf = (id) => (id && deckMap[id]) || cur.id;
    for (const a of data.archetypes) {
      let ex = S.archetypes.find((x) => x.name.toLowerCase() === a.name.toLowerCase());
      if (!ex) { ex = await DB.insert("archetypes", { name: a.name, sideboard_plan: a.sideboard_plan || "", notes: a.notes || "" }); S.archetypes.push(ex); }
      archMap[a.id] = ex.id;
    }
    for (const d of data.decklists || []) {
      let ex = S.decklists.find((x) => x.id === d.id || (x.name === d.name && x.maindeck === d.maindeck));
      if (!ex) { ex = await DB.insert("decklists", { deck_id: deckOf(d.deck_id), name: d.name, maindeck: d.maindeck || "", sideboard: d.sideboard || "", notes: d.notes || "", is_active: false }); S.decklists.push(ex); }
      verMap[d.id] = ex.id;
    }
    for (const g of data.sideboard_guides || []) {
      const deck_id = deckOf(g.deck_id), archetype_id = archMap[g.archetype_id];
      if (!archetype_id || S.guides.some((x) => x.deck_id === deck_id && x.archetype_id === archetype_id)) continue;
      const { id, created_at, ...rest } = g;
      S.guides.push(await DB.insert("sideboard_guides", { ...rest, deck_id, archetype_id }));
    }
    const have = new Set(S.matches.map((m) => m.id));
    let n = 0;
    for (const m of data.matches) {
      if (have.has(m.id)) continue;
      const { id, created_at, ...rest } = m;
      await DB.insert("matches", { ...rest, deck_id: deckOf(m.deck_id), archetype_id: archMap[m.archetype_id], decklist_id: m.decklist_id ? verMap[m.decklist_id] || null : null });
      n++;
    }
    await A.reload(); A.renderDeckSwitch(); A.toast(`Importati ${n} match`); A.route();
  }

  A.views.history = viewHistory;
})();
