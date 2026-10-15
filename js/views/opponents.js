// Avversari: archetipi (condivisi fra i nostri mazzi), note e link alla guida di sideboard.
(() => {
  "use strict";
  const A = window.App;
  const { $, $$, esc, pct, S, DB } = A;

  function viewOpponents(root) {
    const ms = A.filtered();
    const count = (id) => ms.filter((m) => m.archetype_id === id).length;
    root.innerHTML = `
      <div class="page-head"><h1>Avversari</h1><button class="btn primary" id="add-arch">+ Archetipo</button></div>
      <p class="muted" style="margin-top:-6px">Gli archetipi che incontrate (validi per tutti i vostri mazzi). Le statistiche sono quelle di <b>${esc(A.currentDeck().name)}</b>. Clicca per modificarli.</p>
      <div class="opp-list">${[...S.archetypes].sort((x, y) => count(y.id) - count(x.id) || x.name.localeCompare(y.name)).map((a) => {
        const s = A.stats(ms.filter((m) => m.archetype_id === a.id));
        const g = A.guideFor(a.id);
        const hasGuide = g && (g.play_in || g.play_out || g.draw_in || g.draw_out || g.notes);
        return `<div class="card opp" data-arch="${esc(a.id)}">
          <div class="top"><span class="name">${esc(a.name)}</span>
            <span class="num small">${s.n ? `<b>${pct(s.wr)}</b> <span class="muted">${A.record(s)}</span>` : `<span class="muted">nessun match</span>`}</span></div>
          <div class="plan">${hasGuide ? "✓ Guida di sideboard" : `<span style="opacity:.7">Nessuna guida di sideboard</span>`}${a.notes ? ` · ${esc(a.notes)}` : ""}</div>
        </div>`;
      }).join("")}</div>`;
    $("#add-arch", root).onclick = () => editArchetype(null, () => viewOpponents(root));
    $$("[data-arch]", root).forEach((el) => (el.onclick = () => editArchetype(A.archById(el.dataset.arch), () => viewOpponents(root))));
  }

  function editArchetype(a, after) {
    const isEdit = !!a;
    const used = isEdit ? S.matches.filter((m) => m.archetype_id === a.id).length : 0;
    A.openModal(`
      <h2>${isEdit ? esc(a.name) : "Nuovo archetipo"}</h2>
      <form id="arch-form" class="form-grid">
        <label class="field full">Nome <input name="name" value="${esc(a?.name || "")}" required></label>
        <label class="field full">Note sull'avversario <textarea name="notes" rows="4" placeholder="Carte chiave dell'avversario, come mulligare, cosa temere…">${esc(a?.notes || "")}</textarea></label>
        ${isEdit && a.sideboard_plan ? `<div class="full small muted">Vecchio piano (v1): <pre class="plan">${esc(a.sideboard_plan)}</pre>È stato copiato nelle note della guida di sideboard di ogni mazzo esistente.</div>` : ""}
        <div class="row-actions full" style="justify-content:space-between">
          <span class="inline">${isEdit ? `<a class="btn sm" href="#matchup/${encodeURIComponent(a.id)}" data-close>Statistiche</a><a class="btn sm" href="#sideboard/${encodeURIComponent(a.id)}" data-close>Guida sideboard</a>` : ""}</span>
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
        A.guard(async () => { await DB.remove("archetypes", a.id); await A.reload(); A.closeModal(); A.toast("Archetipo eliminato"); after(); });
      };
      f.onsubmit = (e) => {
        e.preventDefault();
        const name = f.name.value.trim();
        if (S.archetypes.some((x) => x.name.toLowerCase() === name.toLowerCase() && x.id !== a?.id)) { A.toast("Esiste già un archetipo con questo nome"); return; }
        const row = { name, notes: f.notes.value.trim() };
        A.guard(async () => {
          if (isEdit) await DB.update("archetypes", a.id, row); else await DB.insert("archetypes", { ...row, sideboard_plan: "" });
          await A.reload(); A.closeModal(); A.toast("Salvato"); after();
        });
      };
    });
  }

  A.editArchetype = editArchetype;
  A.views.opponents = viewOpponents;
})();
