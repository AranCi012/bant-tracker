// Form per registrare / modificare un match (usato da #add e dal modal di modifica).
(() => {
  "use strict";
  const A = window.App;
  const { $, esc, today, lsGet, lsSet, S, DB, EVENTS } = A;

  function matchFormHTML(m) {
    const isEdit = !!m.id;
    const ad = A.activeVersion();
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
          <datalist id="pl-dl">${A.players().map((p) => `<option value="${esc(p)}">`).join("")}</datalist>
        </label>
        <label class="field">Data <input type="date" name="played_at" value="${esc(m.played_at || today())}" required></label>
        <label class="field">Evento
          <select name="event">${EVENTS.map((e) => `<option${e === (m.event ?? lsGet("lastEvent", EVENTS[0])) ? " selected" : ""}>${esc(e)}</option>`).join("")}</select>
        </label>
        <label class="field">Versione lista
          <select name="decklist_id"><option value="">—</option>${A.versions().map((d) => `<option value="${esc(d.id)}"${d.id === deckSel ? " selected" : ""}>${esc(d.name)}${d.is_active ? " (attiva)" : ""}</option>`).join("")}</select>
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
      const gs = A.gamesOf(fake);
      const prev = $("#res-prev", root);
      if (!gs.length) prev.textContent = "";
      else {
        const r = A.matchResult(fake), w = gs.filter((x) => x.r === "W").length, l = gs.filter((x) => x.r === "L").length;
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
      A.guard(async () => {
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
      A.guard(async () => { await DB.remove("matches", m.id); S.matches = S.matches.filter((x) => x.id !== m.id); A.toast("Match eliminato"); onSaved(); });
    };

    form.onsubmit = (e) => {
      e.preventDefault();
      if (!G[0].r) { A.toast("Indica almeno il risultato di G1"); return; }
      if (!form.archetype_id.value) { A.toast("Scegli l'archetipo avversario"); return; }
      const row = {
        deck_id: m.deck_id || A.currentDeck().id,
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
      if (!row.player) { A.toast("Scrivi il nome del giocatore"); return; }
      $("#save-match", root).disabled = true;
      A.guard(async () => {
        if (m.id) {
          const u = await DB.update("matches", m.id, row);
          S.matches = S.matches.map((x) => (x.id === m.id ? u : x));
        } else {
          S.matches.push(await DB.insert("matches", row));
        }
        if (!S.me) { S.me = row.player; lsSet("me", S.me); A.renderWho(); }
        lsSet("lastEvent", row.event);
        const a = A.archById(row.archetype_id);
        A.toast(m.id ? "Match aggiornato" : `Salvato: ${A.matchResult(row) === "W" ? "vittoria" : A.matchResult(row) === "L" ? "sconfitta" : "pareggio"} vs ${a ? a.name : ""}`);
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

  A.matchFormHTML = matchFormHTML;
  A.bindMatchForm = bindMatchForm;
  A.views.add = viewAdd;
})();
