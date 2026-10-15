// La nostra lista: versioni della lista del mazzo corrente.
(() => {
  "use strict";
  const A = window.App;
  const { $, $$, esc, pct, today, S, DB, REMOTE } = A;

  const scry = (name) => `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=normal`;
  const scryPage = (name) => `https://scryfall.com/search?q=${encodeURIComponent('!"' + name + '"')}`;

  function cardListHTML(cards) {
    return `<ul class="cardlist">${cards.map((c) => `<li><span class="q">${c.q}</span><a href="${scryPage(c.name)}" target="_blank" rel="noopener" data-card="${esc(c.name)}">${esc(c.name)}</a></li>`).join("")}</ul>`;
  }

  function viewDeck(root) {
    if (!A.versions().length) {
      root.innerHTML = `<div class="page-head"><h1>La nostra lista</h1></div>
        <div class="card empty-state"><p>Nessuna lista salvata. Incolla la vostra Bant (formato MTGO/Arena: “4 Brainstorm”).</p>
        <button class="btn primary" id="new-deck">+ Aggiungi lista</button></div>`;
      $("#new-deck", root).onclick = () => editDeck(null);
      return;
    }
    const sel = (A.versions().find((v) => v.id === S.deckSel)) || A.activeVersion();
    S.deckSel = sel.id;
    const main = A.parseList(sel.maindeck), side = A.parseList(sel.sideboard);
    const nm = A.countList(main), ns = A.countList(side);
    const ds = A.stats(S.matches.filter((m) => m.decklist_id === sel.id));
    root.innerHTML = `
      <div class="page-head"><h1>La nostra lista</h1>
        <div class="inline"><button class="btn" id="new-deck">+ Nuova versione</button></div></div>
      <div class="deck-cols">
        <div class="card">
          <div class="section-head">
            <div><h2 style="margin:0">${esc(sel.name)} ${sel.is_active ? `<span class="badge">ATTIVA</span>` : ""}</h2>
              <span class="muted small">${ds.n ? `${A.record(ds)} · ${pct(ds.wr)} match WR con questa versione` : "Nessun match con questa versione"}</span></div>
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
          <ul class="versions">${A.versions().map((d) => { const s = A.stats(S.matches.filter((m) => m.decklist_id === d.id)); return `
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
    bindCardHover(root);
  }

  function bindCardHover(root) {
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
    const v = d || { name: `Bant ${today()}`, maindeck: "", sideboard: "", notes: "" };
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
