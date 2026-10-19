// Gruppi di avversari: ogni archetipo può stare in UN gruppo (Combo, Control, Tempo...). Non è un'unione distruttiva:
// i match restano sull'archetipo, il gruppo serve solo a raggrupparli nelle statistiche (filtro "Tutti i gruppi").
// Route: #groups
(() => {
  "use strict";
  const A = window.App;
  const { $, $$, esc, pct, S, DB } = A;
  const canEdit = () => !A.canEdit || A.canEdit();

  // ---- Conoscenza del formato (Legacy) per "✨ Suggerisci" --------------------------------------------
  // Parole chiave confrontate con il nome dell'archetipo (minuscolo, solo lettere/numeri/&):
  //  "xyz"  = inizio di parola (es. "sneak" trova "Sneak and Show"),  "=xyz" = parola intera (es. "=ant" non trova "Elefanti").
  // Solo i casi chiari: se un nome ricade in due gruppi diversi, non si propone nulla.
  const SUGGEST_MAP = [
    ["Combo", ["storm", "=ant", "=tes", "doomsday", "oops", "sneak", "show", "=s&t", "reanimat", "painter", "dredge", "elves", "cradle", "belcher", "welder", "aluren", "breakfast", "combo", "lotus"]],
    ["Control", ["control", "miracle", "beanstalk", "landstill"]],
    ["Tempo", ["delver", "tempo", "moonshadow", "murktide", "phelia"]],
    ["Aggro", ["burn", "death and taxes", "=d&t", "tasse", "=taxes", "affinity", "gatti", "=zoo", "red deck wins"]],
    ["Prison", ["prison", "stax", "chalice"]],
    ["Big mana", ["tron", "eldrazi", "=land", "=lands", "cloudpost", "=post", "ramp"]],
    ["Midrange", ["midrange", "hoogak", "jund", "maverick"]],
  ];
  function suggestFor(name) {
    const t = " " + String(name || "").toLowerCase().replace(/[^a-z0-9&àèéìòù]+/g, " ").trim() + " ";
    const hit = new Set();
    for (const [g, kws] of SUGGEST_MAP) {
      for (const k of kws) {
        if (k.startsWith("=") ? t.includes(" " + k.slice(1) + " ") : t.includes(" " + k)) { hit.add(g); break; }
      }
    }
    return hit.size === 1 ? [...hit][0] : null;
  }

  // ---- Stato dell'interfaccia (sopravvive ai ridisegni) ----------------------------------------------
  const sel = new Set();   // archetipi spuntati nel pannello "Assegna velocemente"
  let bulkOpen = null;     // null = automatico (aperto se ci sono archetipi senza gruppo)

  const groupOpts = (selected, placeholder, except) =>
    (placeholder ? `<option value="__ph"${selected === "__ph" ? " selected" : ""} disabled>${esc(placeholder)}</option>` : "") +
    (except === "__none" ? "" : `<option value=""${selected === "" ? " selected" : ""}>— nessuno —</option>`) +
    S.groups.filter((g) => g.id !== except).map((g) => `<option value="${esc(g.id)}"${g.id === selected ? " selected" : ""}>${esc(g.name)}</option>`).join("");
  const effGroupId = (a) => (a.group_id && A.groupById(a.group_id) ? a.group_id : "");

  async function refresh(root) {
    const y = window.scrollY;
    await A.reload();
    view(root);
    window.scrollTo(0, y);
  }
  async function assign(root, archIds, groupId, msg) {
    await A.guard(async () => {
      for (const id of archIds) await DB.update("archetypes", id, { group_id: groupId || null });
      sel.clear();
      await refresh(root);
      if (msg) A.toast(msg);
    });
  }

  function view(root) {
    const edit = canEdit();
    // Le statistiche seguono i filtri attivi (giocatore, versione, evento, date) ma non il filtro "gruppo": qui si vedono tutti i gruppi.
    const savedG = S.filters.group; S.filters.group = "";
    const ms = A.filtered();
    S.filters.group = savedG;
    const fActive = Object.entries(S.filters).some(([k, v]) => k !== "group" && v);
    const deckMs = A.deckMatches();
    const cnt = (list, id) => list.filter((m) => m.archetype_id === id).length;
    const archs = [...S.archetypes];
    const bySort = (list) => list.sort((x, y) => cnt(ms, y.id) - cnt(ms, x.id) || x.name.localeCompare(y.name));
    const cards = S.groups.map((g) => ({ id: g.id, group: g, name: g.name, archs: bySort(archs.filter((a) => effGroupId(a) === g.id)) }));
    cards.push({ id: "__none", group: null, name: "Senza gruppo", archs: bySort(archs.filter((a) => !effGroupId(a))) });
    const unassigned = cards[cards.length - 1].archs.length;

    const card = (c, i) => {
      const ids = new Set(c.archs.map((a) => a.id));
      const s = A.stats(ms.filter((m) => ids.has(m.archetype_id)));
      let stat = `<span class="muted small">nessun match</span>`;
      if (s.n) {
        const col = A.wrColor(s.wr);
        stat = `<span class="pill gp-wr" style="background:${col.bg};color:${col.fg}" title="Win rate match di ${esc(A.currentDeck().name)} contro questo gruppo">${pct(s.wr)}</span> <span class="num small">${A.record(s)} <span class="muted">· ${s.n} match</span></span>`;
      }
      const tools = c.group ? `<div class="gp-tools" data-edit>
          <button class="btn sm ghost" data-up="${esc(c.id)}" aria-label="Sposta su"${i === 0 ? " disabled" : ""}>↑</button>
          <button class="btn sm ghost" data-down="${esc(c.id)}" aria-label="Sposta giù"${i === S.groups.length - 1 ? " disabled" : ""}>↓</button>
          <button class="btn sm" data-rename="${esc(c.id)}">Rinomina</button>
          <button class="btn sm danger" data-delgroup="${esc(c.id)}">Elimina</button></div>` : "";
      const chips = c.archs.length ? c.archs.map((a) => `<span class="gp-chip">
          <a class="gp-cname" href="#matchup/${encodeURIComponent(a.id)}" title="Statistiche contro ${esc(a.name)}">${esc(a.name)}</a><small>${cnt(ms, a.id)}</small>
          ${edit && S.groups.length ? `<select class="gp-move" data-edit data-move="${esc(a.id)}" aria-label="Sposta ${esc(a.name)} in un altro gruppo">${groupOpts("__ph", "⇄", c.id)}</select>` : ""}
        </span>`).join("") : `<span class="muted small">${c.group ? "Nessun archetipo in questo gruppo." : "Tutti gli archetipi hanno un gruppo."}</span>`;
      return `<section class="card gp-card${c.group ? "" : " gp-none"}">
        <div class="gp-head">
          <div class="gp-title"><a class="gp-name" href="#matchup" data-gfilter="${esc(c.id)}" title="Apri le statistiche di tutto il gruppo">${esc(c.name)}</a>
            <span class="muted small">${c.archs.length} archetip${c.archs.length === 1 ? "o" : "i"}</span></div>
          <div class="gp-stat">${stat}</div>
          ${tools}
        </div>
        <div class="gp-chips">${chips}</div>
      </section>`;
    };

    // Pannello "Assegna velocemente": tutti gli archetipi, con un menu di gruppo e la selezione multipla
    const bulkRows = [...archs].sort((x, y) => cnt(deckMs, y.id) - cnt(deckMs, x.id) || x.name.localeCompare(y.name));
    const open = bulkOpen == null ? unassigned > 0 : bulkOpen;
    const bulk = edit && S.groups.length ? `<details class="card gp-bulk" id="gp-bulk" data-edit${open ? " open" : ""}>
        <summary><b>Assegna velocemente</b> <span class="muted small">· ${archs.length} archetipi${unassigned ? `, ${unassigned} senza gruppo` : ""}</span></summary>
        <div class="gp-bar">
          <button class="btn sm" id="gp-sel-none">Seleziona i senza gruppo</button>
          <button class="btn sm ghost" id="gp-sel-clear">Deseleziona</button>
          <span class="gp-bar-move"><select id="gp-bulk-to" aria-label="Sposta selezionati in">${groupOpts("__ph", "Sposta selezionati in…")}</select>
          <button class="btn sm primary" id="gp-bulk-go">Sposta <span id="gp-bulk-n"></span></button></span>
        </div>
        <div class="gp-rows">${bulkRows.map((a) => `<div class="gp-row${effGroupId(a) ? "" : " none"}">
            <label class="gp-pick"><input type="checkbox" data-pick="${esc(a.id)}"${sel.has(a.id) ? " checked" : ""} aria-label="Seleziona ${esc(a.name)}"><span class="gp-rname">${esc(a.name)}</span></label>
            <span class="muted small num">${cnt(deckMs, a.id)} match</span>
            <select data-assign="${esc(a.id)}" aria-label="Gruppo di ${esc(a.name)}">${groupOpts(effGroupId(a))}</select>
          </div>`).join("")}</div>
      </details>` : "";

    root.innerHTML = `
      <div class="page-head"><h1>Gruppi di avversari</h1>
        <span class="inline"><button class="btn" id="gp-suggest" data-edit>✨ Suggerisci</button><button class="btn primary" id="gp-new" data-edit>+ Nuovo gruppo</button></span></div>
      <div class="seg opp-switch"><a href="#opponents">Mazzi</a><a href="#players">Giocatori</a><a href="#groups" class="on">Gruppi</a></div>
      <p class="muted" style="margin-top:-6px">Raggruppa gli archetipi in famiglie più grandi (Combo, Control…) senza unirli: i match restano sul loro archetipo. Le statistiche sono quelle di <b>${esc(A.currentDeck().name)}</b>${fActive ? " con i filtri attivi" : ""}.${edit ? "" : " Sola lettura."}</p>
      ${fActive ? `<div class="filter-warn" role="status">🔎 Filtri attivi: le statistiche dei gruppi li rispettano. <button class="btn sm" id="gp-fr">Mostra tutti</button></div>` : ""}
      ${S.groups.length ? "" : `<div class="card empty-state"><p>Non c'è ancora nessun gruppo${edit ? "." : ", e in sola lettura non puoi crearli."}</p>
        ${edit ? `<button class="btn primary" id="gp-defaults">Crea i gruppi predefiniti (${esc(A.DEFAULT_GROUPS.join(", "))})</button>` : ""}</div>`}
      ${bulk}
      <div class="gp-grid">${cards.filter((c) => c.group || S.groups.length || c.archs.length).map(card).join("")}</div>`;

    wire(root, cards);
  }

  function wire(root, cards) {
    const edit = canEdit();
    const fr = $("#gp-fr", root);
    if (fr) fr.onclick = () => { const g = S.filters.group; S.filters = { player: "", version: "", event: "", group: g, from: "", to: "" }; A.lsSet("filters", S.filters); view(root); };
    // Nome gruppo -> statistiche del gruppo (filtro)
    $$("[data-gfilter]", root).forEach((el) => (el.onclick = (e) => {
      e.preventDefault();
      S.filters.group = el.dataset.gfilter; A.lsSet("filters", S.filters); location.hash = "matchup";
    }));
    if (!edit) return;

    const d = $("#gp-defaults", root);
    if (d) d.onclick = () => A.guard(async () => {
      for (const [i, name] of A.DEFAULT_GROUPS.entries()) await DB.insert("archetype_groups", { name, sort: i + 1 });
      await refresh(root); A.toast("Gruppi creati");
    });
    $("#gp-new", root).onclick = () => nameModal("Nuovo gruppo", "", (name) => A.guard(async () => {
      const sort = Math.max(0, ...S.groups.map((g) => g.sort || 0)) + 1;
      await DB.insert("archetype_groups", { name, sort });
      A.closeModal(); await refresh(root); A.toast(`Gruppo “${name}” creato`);
    }));
    $("#gp-suggest", root).onclick = () => suggestModal(root);

    $$("[data-rename]", root).forEach((b) => (b.onclick = () => {
      const g = A.groupById(b.dataset.rename);
      nameModal("Rinomina gruppo", g.name, (name) => A.guard(async () => {
        await DB.update("archetype_groups", g.id, { name });
        A.closeModal(); await refresh(root); A.toast("Gruppo rinominato");
      }), g.id);
    }));
    $$("[data-delgroup]", root).forEach((b) => (b.onclick = () => {
      const g = A.groupById(b.dataset.delgroup);
      const members = S.archetypes.filter((a) => a.group_id === g.id);
      if (!confirm(`Eliminare il gruppo “${g.name}”?${members.length ? ` I suoi ${members.length} archetipi restano, ma tornano “senza gruppo”.` : ""}`)) return;
      A.guard(async () => {
        // Esplicito anche online (lì c'è già ON DELETE SET NULL): in locale non esiste alcuna cascata.
        for (const a of members) await DB.update("archetypes", a.id, { group_id: null });
        await DB.remove("archetype_groups", g.id);
        await refresh(root); A.toast("Gruppo eliminato");
      });
    }));
    // Ordine dei gruppi: si rinumerano tutti (1..n) così anche i vecchi pari-merito tornano coerenti
    const move = (id, dir) => A.guard(async () => {
      const order = S.groups.map((g) => g.id), i = order.indexOf(id), j = i + dir;
      if (i < 0 || j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      for (const [k, gid] of order.entries()) if ((A.groupById(gid).sort || 0) !== k + 1) await DB.update("archetype_groups", gid, { sort: k + 1 });
      await refresh(root);
    });
    $$("[data-up]", root).forEach((b) => (b.onclick = () => move(b.dataset.up, -1)));
    $$("[data-down]", root).forEach((b) => (b.onclick = () => move(b.dataset.down, 1)));

    // Menu "sposta" sul chip
    $$("[data-move]", root).forEach((s) => (s.onchange = () => {
      const a = A.archById(s.dataset.move), g = A.groupById(s.value);
      assign(root, [a.id], s.value, `“${a.name}” → ${g ? g.name : "senza gruppo"}`);
    }));

    // Pannello veloce
    const bulk = $("#gp-bulk", root);
    if (!bulk) return;
    bulk.addEventListener("toggle", () => { bulkOpen = bulk.open; });
    const upd = () => { const n = $("#gp-bulk-n", root); if (n) n.textContent = sel.size ? `(${sel.size})` : ""; };
    upd();
    $$("[data-assign]", root).forEach((s) => (s.onchange = () => {
      const a = A.archById(s.dataset.assign), g = A.groupById(s.value);
      assign(root, [a.id], s.value, `“${a.name}” → ${g ? g.name : "senza gruppo"}`);
    }));
    $$("[data-pick]", root).forEach((c) => (c.onchange = () => { if (c.checked) sel.add(c.dataset.pick); else sel.delete(c.dataset.pick); upd(); }));
    $("#gp-sel-none", root).onclick = () => {
      S.archetypes.filter((a) => !effGroupId(a)).forEach((a) => sel.add(a.id));
      $$("[data-pick]", root).forEach((c) => (c.checked = sel.has(c.dataset.pick))); upd();
    };
    $("#gp-sel-clear", root).onclick = () => { sel.clear(); $$("[data-pick]", root).forEach((c) => (c.checked = false)); upd(); };
    $("#gp-bulk-go", root).onclick = () => {
      const to = $("#gp-bulk-to", root).value;
      if (to === "__ph") { A.toast("Scegli il gruppo di destinazione"); return; }
      if (!sel.size) { A.toast("Spunta almeno un archetipo"); return; }
      const g = A.groupById(to), n = sel.size;
      assign(root, [...sel], to, `${n} archetip${n === 1 ? "o" : "i"} → ${g ? g.name : "senza gruppo"}`);
    };
  }

  function nameModal(title, initial, onSave, selfId) {
    A.openModal(`<h2>${esc(title)}</h2>
      <form id="gp-form" class="form-grid">
        <label class="field full">Nome <input name="name" value="${esc(initial)}" required maxlength="40" autocomplete="off"></label>
        <div class="row-actions full"><button type="button" class="btn" data-close>Annulla</button><button class="btn primary">Salva</button></div>
      </form>`, (body) => {
      const f = $("#gp-form", body);
      f.name.focus(); f.name.select();
      f.onsubmit = (e) => {
        e.preventDefault();
        const name = f.name.value.trim().replace(/\s+/g, " ");
        if (!name) return;
        if (S.groups.some((g) => g.name.toLowerCase() === name.toLowerCase() && g.id !== selfId)) { A.toast("Esiste già un gruppo con questo nome"); return; }
        onSave(name);
      };
    });
  }

  function suggestModal(root) {
    if (!S.groups.length) { A.toast("Crea prima almeno un gruppo"); return; }
    const props = [];
    for (const a of S.archetypes) {
      if (effGroupId(a)) continue; // non si sovrascrive mai un'assegnazione esistente
      const gname = suggestFor(a.name);
      const g = gname && S.groups.find((x) => x.name.toLowerCase() === gname.toLowerCase());
      if (g) props.push({ a, g });
    }
    if (!props.length) { A.toast("Nessun suggerimento: gli archetipi riconoscibili hanno già un gruppo"); return; }
    A.openModal(`<h2>✨ Suggerimenti</h2>
      <p class="muted small" style="margin-top:0">Proposte basate sul nome degli archetipi non ancora assegnati. Togli la spunta a quelle che non ti convincono.</p>
      <div class="gp-sug">${props.map((p, i) => `<label class="gp-sug-row"><input type="checkbox" data-sug="${i}" checked>
        <span class="gp-rname">${esc(p.a.name)}</span><span class="gp-arrow">→</span><b>${esc(p.g.name)}</b></label>`).join("")}</div>
      <div class="row-actions" style="margin-top:12px"><button class="btn" data-close>Annulla</button><button class="btn primary" id="gp-sug-go">Applica selezionati</button></div>`, (body) => {
      $("#gp-sug-go", body).onclick = () => A.guard(async () => {
        const chosen = $$("[data-sug]", body).filter((c) => c.checked).map((c) => props[+c.dataset.sug]);
        if (!chosen.length) { A.toast("Nessun suggerimento selezionato"); return; }
        for (const p of chosen) await DB.update("archetypes", p.a.id, { group_id: p.g.id });
        A.closeModal(); await refresh(root); A.toast(`${chosen.length} archetip${chosen.length === 1 ? "o assegnato" : "i assegnati"}`);
      });
    });
  }

  A.suggestGroupFor = suggestFor;
  A.views.groups = view;
})();
