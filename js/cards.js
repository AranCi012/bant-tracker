// Database carte (Scryfall): immagini, tipo, cache locale. Espone A.cards.
// Funziona anche prima di qualunque chiamata di rete: le immagini si
// ottengono con la ricerca fuzzy, i metadati si arricchiscono in lookup().
(() => {
  "use strict";

  const A = window.App;
  const { esc, cardKey, lsGet, lsSet } = A;

  const API = "https://api.scryfall.com";
  const SITE = "https://scryfall.com";
  const CACHE_KEY = "cardcache";
  const CACHE_MAX = 1500;
  const BATCH = 75;        // massimo identificatori per /cards/collection
  const GAP_MS = 125;      // ~8 richieste al secondo, come chiede Scryfall

  // Tipo interno -> intestazione di sezione (plurale italiano). L'ordine è quello di visualizzazione.
  const TYPE_LABELS = {
    Creatura: "Creature",
    Planeswalker: "Planeswalker",
    Istantaneo: "Istantanei",
    Stregoneria: "Stregonerie",
    Artefatto: "Artefatti",
    Incantesimo: "Incantesimi",
    Battaglia: "Battaglie",
    Terra: "Terre",
    Altro: "Altro",
  };
  const TYPE_ORDER = Object.keys(TYPE_LABELS);

  // ---- Stato ----------------------------------------------------------
  let store = null;               // cache persistente: cardKey -> meta
  const memo = new Map();         // cardKey -> null (non trovata): solo in memoria
  let chain = Promise.resolve();  // coda: un lookup alla volta, niente richieste doppie
  let lastAt = 0;

  const isKey = (k) => !!k && k !== "__proto__";

  function db() {
    if (!store) {
      const v = lsGet(CACHE_KEY, {});
      store = v && typeof v === "object" && !Array.isArray(v) ? v : {};
    }
    return store;
  }
  function getCached(k) {
    const s = db();
    return Object.prototype.hasOwnProperty.call(s, k) ? s[k] : null;
  }
  function cachedMeta(name) {
    return getCached(cardKey(String(name ?? "")));
  }
  function persist() {
    const s = db();
    const keys = Object.keys(s);
    for (const k of keys.slice(0, Math.max(0, keys.length - CACHE_MAX))) delete s[k];
    lsSet(CACHE_KEY, s);
  }

  // ---- Tipo e metadati --------------------------------------------------
  // Priorità: Terra > Creatura > Planeswalker > Istantaneo > Stregoneria > Artefatto > Incantesimo > Battaglia.
  function classify(typeLine) {
    const t = String(typeLine || "");
    if (/\bLand\b/.test(t)) return "Terra";
    if (/\bCreature\b/.test(t)) return "Creatura";
    if (/\bPlaneswalker\b/.test(t)) return "Planeswalker";
    if (/\bInstant\b/.test(t)) return "Istantaneo";
    if (/\bSorcery\b/.test(t)) return "Stregoneria";
    if (/\bArtifact\b/.test(t)) return "Artefatto";
    if (/\bEnchantment\b/.test(t)) return "Incantesimo";
    if (/\bBattle\b/.test(t)) return "Battaglia";
    return "Altro";
  }

  // Dalla risposta Scryfall al nostro formato. Per le carte a due facce usa la faccia frontale.
  function toMeta(c) {
    const face0 = Array.isArray(c.card_faces) && c.card_faces[0] ? c.card_faces[0] : c;
    const imgs = c.image_uris || face0.image_uris || {};
    const typeLine = face0.type_line || c.type_line || "";
    return {
      name: c.name,
      type: classify(typeLine),
      typeLine,
      cmc: typeof c.cmc === "number" ? c.cmc : 0,
      manaCost: face0.mana_cost || c.mana_cost || "",
      img: { small: imgs.small || null, normal: imgs.normal || null },
      uri: c.scryfall_uri || "",
    };
  }

  // Indice delle carte ricevute: ogni nome (anche le singole facce) punta al suo meta.
  function indexCards(cards) {
    const idx = new Map();
    for (const c of cards) {
      if (!c || !c.name) continue;
      const meta = toMeta(c);
      const names = [c.name, ...String(c.name).split(" // ")];
      if (Array.isArray(c.card_faces)) for (const f of c.card_faces) names.push(f.name);
      for (const n of names) {
        const k = cardKey(n);
        if (isKey(k) && !idx.has(k)) idx.set(k, meta);
      }
    }
    return idx;
  }

  // ---- Rete -----------------------------------------------------------
  async function gate() {
    const now = Date.now();
    const wait = Math.max(0, lastAt + GAP_MS - now);
    lastAt = now + wait;
    if (wait) await new Promise((r) => setTimeout(r, wait));
  }

  // Lancia un errore con .status (0 = rete non raggiungibile).
  async function call(path, body) {
    await gate();
    let res;
    try {
      res = body
        ? await fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch(API + path);
    } catch {
      throw Object.assign(new Error("rete"), { status: 0 });
    }
    if (!res.ok) throw Object.assign(new Error("HTTP " + res.status), { status: res.status });
    return res.json();
  }

  // list = [[cardKey, nome]]. Ritorna Map(cardKey -> meta | null | undefined):
  // null = carta non trovata; undefined = errore di rete (da ritentare più tardi).
  async function fetchMany(list) {
    const found = new Map();
    for (let i = 0; i < list.length; i += BATCH) {
      const chunk = list.slice(i, i + BATCH);
      let batchOk = true;
      try {
        const json = await call("/cards/collection", { identifiers: chunk.map(([, name]) => ({ name })) });
        const idx = indexCards(Array.isArray(json.data) ? json.data : []);
        for (const [k] of chunk) if (idx.has(k)) found.set(k, idx.get(k));
      } catch {
        batchOk = false;
      }
      if (!batchOk) continue; // rete giù: niente fallback per non martellare il servizio
      // Nomi non trovati nel batch (not_found): ricerca fuzzy, una alla volta.
      for (const [k, name] of chunk) {
        if (found.has(k)) continue;
        try {
          found.set(k, toMeta(await call("/cards/named?fuzzy=" + encodeURIComponent(name))));
        } catch (e) {
          found.set(k, e && e.status === 404 ? null : undefined);
        }
      }
    }
    return found;
  }

  // ---- API pubblica ------------------------------------------------------
  function imageUrl(name, size = "normal") {
    const n = String(name ?? "");
    const c = cachedMeta(n);
    const cached = c && c.img && c.img[size];
    if (cached) return cached;
    return API + "/cards/named?fuzzy=" + encodeURIComponent(n) + "&format=image&version=" + size;
  }

  function pageUrl(name) {
    const n = String(name ?? "");
    const c = cachedMeta(n);
    return c && c.uri ? c.uri : SITE + "/search?q=" + encodeURIComponent(n);
  }

  function canonicalName(name) {
    const c = cachedMeta(name);
    return c && c.name ? c.name : name;
  }

  // names -> Map(cardKey -> meta | null). Non lancia mai: in caso di errore restituisce null.
  function lookup(names) {
    const job = async () => {
      const out = new Map();
      try {
        const want = new Map();
        for (const n of Array.isArray(names) ? names : []) {
          const k = cardKey(String(n ?? ""));
          if (isKey(k) && !want.has(k)) want.set(k, String(n).trim());
        }
        const todo = [];
        for (const [k, name] of want) {
          const c = getCached(k);
          if (c) out.set(k, c);
          else if (memo.has(k)) out.set(k, null);
          else todo.push([k, name]);
        }
        if (todo.length) {
          const found = await fetchMany(todo);
          let changed = false;
          for (const [k] of todo) {
            const r = found.get(k);
            if (r === undefined) { out.set(k, null); continue; } // errore: si ritenta alla prossima
            if (r === null) { memo.set(k, null); out.set(k, null); continue; }
            out.set(k, r);
            db()[k] = r;
            changed = true;
            const ck = cardKey(r.name);
            if (isKey(ck) && !getCached(ck)) db()[ck] = r;
          }
          if (changed) persist();
        }
      } catch {
        /* mai lanciare verso il chiamante */
      }
      return out;
    };
    const p = chain.then(job);
    chain = p.catch(() => {});
    return p;
  }

  // ---- Visualizzazione ---------------------------------------------------
  const cmcOf = (r) => (r.meta && typeof r.meta.cmc === "number" ? r.meta.cmc : 99);
  const typeOf = (r) => (r.meta && TYPE_LABELS[r.meta.type] ? r.meta.type : "Altro");

  function tileHTML(r) {
    const badge = `<span class="cv-qty">${r.q}×</span>`;
    const img = r.meta && r.meta.img && (r.meta.img.normal || r.meta.img.small); // normal: nitida anche su schermi retina
    if (!img) {
      return `<div class="cv-tile cv-missing" data-card="${esc(r.name)}" title="${esc(r.name)}"><span class="cv-name">${esc(r.name)}</span>${badge}</div>`;
    }
    const name = r.meta.name;
    return `<a class="cv-tile" href="${esc(pageUrl(r.name))}" target="_blank" rel="noopener" data-card="${esc(name)}" title="${esc(name)}">` +
      `<img src="${esc(img)}" alt="${esc(name)}" loading="lazy" decoding="async">${badge}</a>`;
  }

  // Sposta la tooltip del cursore senza rigenerarne il contenuto (niente sfarfallio dell'immagine).
  function moveTip(x, y) {
    const t = document.getElementById("tooltip");
    if (!t || t.hidden) return;
    const r = t.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > innerHeight - 8) top = y - r.height - 14;
    t.style.left = Math.max(8, left) + "px";
    t.style.top = Math.max(8, top) + "px";
  }

  function bindHover(root) {
    if (!root || !root.querySelectorAll) return;
    if (window.matchMedia && window.matchMedia("(hover: none)").matches) return; // solo touch
    root.querySelectorAll("[data-card]").forEach((el) => {
      if (el.dataset.cvHover) return;
      el.dataset.cvHover = "1";
      const name = el.dataset.card;
      el.addEventListener("mouseenter", (e) => {
        A.showTip(`<img class="card-preview" src="${esc(imageUrl(name))}" alt="${esc(name)}">`, e.clientX, e.clientY);
      });
      el.addEventListener("mousemove", (e) => moveTip(e.clientX, e.clientY));
      el.addEventListener("mouseleave", () => A.hideTip());
    });
  }

  // list = [{q, name}]. Mostra un placeholder, poi la griglia di immagini.
  async function renderVisual(container, list, opts) {
    const el = container;
    if (!el) return;
    const o = Object.assign({ groupByType: true }, opts || {});
    const token = (el._cardsToken = (el._cardsToken || 0) + 1);
    el.innerHTML = `<p class="muted small">Caricamento immagini…</p>`;

    // Carte duplicate: si sommano le quantità.
    const agg = new Map();
    for (const it of Array.isArray(list) ? list : []) {
      const name = String((it && it.name) || "").trim();
      const k = cardKey(name);
      if (!isKey(k)) continue;
      const q = Number(it.q) || 0;
      if (agg.has(k)) agg.get(k).q += q;
      else agg.set(k, { name, q });
    }
    if (!agg.size) { el.innerHTML = `<p class="muted">Nessuna carta.</p>`; return; }

    const meta = await lookup([...agg.values()].map((r) => r.name));
    if (el._cardsToken !== token || !el.isConnected) return; // è arrivato un render più recente

    const rows = [...agg.entries()].map(([k, r]) => ({ name: r.name, q: r.q, meta: meta.get(k) || null }));
    rows.sort((a, b) => cmcOf(a) - cmcOf(b) || a.name.localeCompare(b.name, "it"));

    if (!o.groupByType) {
      el.innerHTML = `<div class="cv-grid">${rows.map(tileHTML).join("")}</div>`;
    } else {
      const groups = new Map(TYPE_ORDER.map((t) => [t, []]));
      for (const r of rows) groups.get(typeOf(r)).push(r);
      el.innerHTML = TYPE_ORDER.filter((t) => groups.get(t).length).map((t) => {
        const items = groups.get(t);
        const total = items.reduce((s, r) => s + r.q, 0);
        return `<section class="cv-sec"><h3 class="cv-head">${esc(TYPE_LABELS[t])} (${total})</h3>` +
          `<div class="cv-grid">${items.map(tileHTML).join("")}</div></section>`;
      }).join("");
    }
    bindHover(el);
  }

  // ---- Stili (una sola volta, per tutte le schermate) --------------------
  const CSS = `
.cv-sec + .cv-sec { margin-top: 16px; }
.cv-head { font-size: .9rem; color: var(--text-2); margin: 0 0 8px; font-weight: 600; }
.cv-grid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); }
@media (min-width: 721px) { .cv-grid { grid-template-columns: repeat(auto-fill, minmax(146px, 1fr)); } }
.cv-tile { position: relative; display: block; aspect-ratio: 5 / 7; min-width: 0; border-radius: 8px; overflow: hidden; background: var(--surface-2); border: 1px solid var(--border); color: var(--text); text-decoration: none; }
.cv-tile img { display: block; width: 100%; height: 100%; object-fit: cover; }
.cv-tile:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.cv-missing { display: flex; align-items: center; justify-content: center; padding: 10px; text-align: center; }
.cv-name { font-size: .85rem; color: var(--text-2); line-height: 1.25; overflow-wrap: anywhere; }
.cv-qty { position: absolute; right: 6px; bottom: 6px; padding: 2px 7px; border-radius: 999px; font-size: .8rem; font-weight: 700; font-variant-numeric: tabular-nums; background: color-mix(in srgb, var(--text) 80%, transparent); color: var(--surface); }
`;
  function injectCss() {
    if (document.getElementById("cards-style")) return;
    const s = document.createElement("style");
    s.id = "cards-style";
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  injectCss();

  A.cards = { imageUrl, pageUrl, lookup, canonicalName, renderVisual, bindHover };
})();
