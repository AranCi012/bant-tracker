// =====================================================================
//  sbplan.js — "Piano sideboard": core del mazzo, sidata consigliata per matchup e lato, stima "what-if".
//  Funzioni pure (niente DOM, niente cache fra una chiamata e l'altra), deterministiche: il piano si aggiorna
//  da solo ogni volta che viene registrata una nuova sidata.
//
//    A.sbplan.core({ versions, matches })                                          -> CoreReport
//    A.sbplan.recommend({ matches, archId, side, version, guide, groupArchIds })   -> Rec (con Rec.simple e Rec.oppAdj)
//    A.sbplan.estimate({ matches, archId, side, plan, version, groupArchIds })     -> { wr, lo, hi, n, note }
//    A.sbplan.overview({ matches, version, archetypes, groupOf, guideFor })        -> [{ archId, name, group, nMatches, nPost, nRec, play, draw }]
//    A.sbplan.groupArchIds(archId, archetypes, groupOf)                            -> archetipi dello stesso gruppo ("Altro" = nessun gruppo)
//  Tutte accettano anche `oppStrength: (match) => numero in [-1, 1]` (bravura dell'avversario; default 0 = come v1).
//  `version` è l'OGGETTO versione della lista ({id,name,maindeck,sideboard,created_at,...}). Identità carta: A.cardKey.
//
//  METODO, IN PAROLE SEMPLICI
//  ---------------------------------------------------------------------------------------------------------------
//  CORE E FLEX (core)
//   - Ogni versione pesa quanti match ci avete giocato. Una carta è "core" se è presente nella versione attiva e in
//     versioni che coprono almeno il 90% dei match giocati; la quantità core è il MINIMO di copie in quelle versioni.
//   - "Flex" = ogni carta il cui numero di copie è cambiato fra le versioni (anche le copie in più di una carta core,
//     es. Murktide 3 -> 2: 2 core + flex). Per ogni flex: match vinti CON le copie extra e SENZA (solo descrittivo).
//   - Timeline: per ogni versione (in ordine di creazione) cosa è cambiato rispetto alla precedente.
//
//  SIDATA CONSIGLIATA (recommend)
//   0. Bravura degli avversari (facoltativa: avversari valutati forte = +1, scarso = −1; medio o non valutato = 0).
//      Ogni game post-board si legge come "risultato rispetto alle attese": contro un forte si parte con 9 punti di WR
//      in meno, contro uno scarso con 9 in più. In pratica una vittoria contro un forte vale 1,09 invece di 1 e una
//      sconfitta contro uno scarso vale −0,09 invece di 0; con un avversario medio o non valutato nulla cambia.
//      Tutto ciò che segue (WR di partenza, effetti delle carte, confronto fra sidate provate) usa questi risultati
//      corretti, così una sidata provata soprattutto contro giocatori scarsi non sembra migliore di quello che è.
//      I conteggi mostrati ("vinte 3 su 4") restano quelli veri. Senza valutazioni i risultati sono identici a prima.
//      Perché 9 punti: è circa 0,4 in scala logit (≈ 70 punti Elo); la differenza vera fra un forte e un medio è forse
//      di 10-15 punti, ma le valutazioni sono a occhio e a volte sbagliate, e con un dato rumoroso conviene un
//      coefficiente più piccolo del vero (diluizione da errore di misura). Nelle simulazioni, con valutazioni giuste
//      9 punti tolgono buona parte della distorsione; con valutazioni del tutto a caso non peggiorano quasi nulla.
//      Anche il WR di partenza è corretto (è quindi il WR atteso contro un avversario medio): serve perché il
//      confronto "risultato di una sidata vs stima" sia fatto sulla stessa scala; l'effetto sul numero è di 1-2 punti. le game post-board (G2/G3). Una game "conta" un po' meno se nello stesso match ce n'è un'altra
//      (G2 e G3 con lo stesso avversario si somigliano): peso 1/(1+0,3) invece di 1.
//   2. WR di partenza del matchup+lato (con la sidata "solita"): media prudente a cascata. Si parte dal WR post-board
//      di tutti i mazzi, ci si sposta verso gli altri mazzi del gruppo (Combo, Tempo, ...), poi verso le game dell'altro
//      lato dello stesso matchup (corrette per il vantaggio di essere on the play) e infine verso le game di questo
//      lato. Ogni passo si sposta tanto più quante più game ci sono (media "pesata per affidabilità").
//   3. Effetto di ogni carta (entrata o uscita): si confrontano SOLO game dello stesso matchup e lato, con e senza
//      quella carta (così un matchup facile non fa sembrare buone le carte che ci si sidano). I confronti si sommano
//      a cascata, ciascun livello usato come punto di partenza del successivo:
//        altri gruppi -> altri mazzi dello stesso gruppo -> questo matchup -> questo lato.
//      Con pochi dati l'effetto resta vicino a quello del livello sopra; con tanti dati segue il matchup. Le carte
//      che entrano sempre insieme (es. Carpet + Erode) si dividono l'effetto invece di contarlo due volte.
//      Gli effetti visti contro altri gruppi valgono qui solo se la carta si usa anche contro questo gruppo.
//   4. "Cosa pensano i giocatori": se una carta viene mossa quasi sempre contro questo mazzo, parte con un piccolo
//      vantaggio (fino a +3 punti); se non viene mai mossa, con un piccolo svantaggio. I risultati possono ribaltarlo.
//      Senza sidate registrate contro il mazzo o il suo gruppo questo vantaggio/svantaggio è zero ("non si sa").
//   5. Piano: tra tutte le carte disponibili nella versione (IN dalla sideboard, OUT dal main, quantità più usata,
//      mai più copie di quelle presenti) si sceglie la combinazione con il miglior effetto totale, con tante carte
//      in entrata quante in uscita. Si confronta con le sidate già provate e con la guida scritta:
//        - pochi dati su questo lato (meno di 3 sidate) e c'è la guida -> si segue la guida (completata se non pari);
//        - pochi dati e niente guida -> la sidata più usata, salvo una combinazione nettamente migliore (+4 punti);
//        - abbastanza dati -> la migliore tra provate, guida e combinazione nuova; quest'ultima solo se batte la
//          migliore provata di almeno 2 punti.
//   6. expected = WR stimato con quel piano (WR di partenza + effetti delle carte che cambiano rispetto alla sidata
//      solita) con intervallo all'80%; baseline = WR post-board osservato nel matchup+lato (qualsiasi sidata).
//   7. confidence: alta = almeno 8 sidate su questo lato e intervallo largo al massimo 32 punti; media = almeno 3
//      sidate sul lato e intervallo entro 40 punti; bassa = altrimenti; nessuna = nessun dato e
//      nessuna guida. level = da dove vengono soprattutto i dati (lato >= 3 sidate, matchup >= 3, gruppo, guida).
//   8. Verdetto carta: chiave (effetto >= +6 punti, o >= +3 e mossa almeno metà delle volte), utile (>= +1),
//      sconsigliata (<= -4, o <= -2 se mossa raramente), neutra altrimenti. Per le carte OUT "effetto" = effetto di
//      toglierla. Gli effetti sono frazioni (0,05 = +5 punti percentuali di WR post-board).
//   9. Vista semplice (Rec.simple, per chi non vuole numeri): un titolo in italiano semplice, il piano, il record VERO
//      di quella sidata su quel lato (o della sidata provata più simile, al massimo 4 copie di differenza) e al massimo
//      una frase. "In media ha funzionato meglio" solo se la sidata è stata provata almeno 2 volte su quel lato e
//      nessun'altra provata almeno 2 volte ha fatto meglio nei risultati grezzi; con meno di 3 sidate sul lato il
//      titolo comincia sempre con "Ancora poche partite" (o "Ancora nessuna sidata").
//      Rec.oppAdj = { nRated, nGames, shift }: game post-board del matchup+lato con avversario valutato, game totali,
//      correzione media applicata in punti (positiva = avversari in media più forti del normale).
//  Limiti: l'effetto è per carta, non per copia (+2 o +3 Carpet contano uguale); con 1-8 sidate per matchup i numeri
//  sono indizi, non prove: il motore lo dice (confidence) e resta vicino a guida/sidata più usata.
// =====================================================================
(() => {
  "use strict";
  const A = window.App;

  const K = {
    SIGMA2: 0.25,      // varianza di una singola game (vinta/persa)
    DEP: 0.3,          // somiglianza fra G2 e G3 dello stesso match
    TAU_GLOBAL: 0.06,  // effetto tipico di una carta (dispersione), livello "tutti i mazzi"
    TAU_GROUP: 0.05,   // quanto un gruppo può discostarsi
    TAU_ARCH: 0.05,    // quanto un matchup può discostarsi dal suo gruppo
    TAU_SIDE: 0.03,    // quanto play e draw dello stesso matchup possono differire
    KAPPA: 0.03,       // "fiducia" nella scelta dei giocatori
    LAMBDA: 2,         // pseudo-conteggi per le frequenze d'uso
    WR_TAU_GROUP: 0.05, WR_TAU_SIDE: 0.06, WR_TAU_ARCH_MIN: 0.07, WR_TAU_ARCH_MAX: 0.14,
    TAU_PLAN: 0.05,    // quanto una sidata precisa può rendere diversamente dalla somma delle sue carte
    CARD_COST: 0.01,   // costo di ogni carta mossa nella costruzione del piano (evita piani gonfi di carte "neutre")
    PLAY_PRIOR: 0.04, PLAY_PRIOR_SD: 0.04,
    OPP: 0.09,         // bravura avversario: una game contro un "forte" (+1) vale come partire con 9 punti in meno di WR atteso
    OPP_BASE: true,    // la stessa correzione vale anche per il WR di partenza del matchup (vedi METODO, punto 0)
    MARGIN: 0.02, MARGIN_WEAK: 0.04, WEAK: 3, TMAX: 15,
    Z80: 1.2815515655,
  };
  const SIDE_LABEL = { play: "on the play", draw: "on the draw" };
  const OTHER = { play: "draw", draw: "play" };
  const MINUS = "−";
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const sideOf = (g) => (g.play === true ? "play" : g.play === false ? "draw" : "na");
  const isAltro = (g) => !g || /^(altro|altri|senza gruppo|other)$/i.test(String(g.name || "").trim());

  // Lista [{q,name}] -> Map(chiave -> {q,name}) (quantità sommate, righe vuote ignorate)
  function toMap(list) {
    const mp = new Map();
    for (const c of list || []) {
      if (!c || !c.name || !(+c.q > 0)) continue;
      const k = A.cardKey(c.name);
      if (!k) continue;
      if (mp.has(k)) mp.get(k).q += +c.q; else mp.set(k, { q: +c.q, name: String(c.name).trim() });
    }
    return mp;
  }
  const textMap = (t) => A.listMap(A.parseList(t || ""));
  function modeOf(cnt) { // Map(q -> n) -> q più frequente (a parità la più alta)
    let best = 0, bn = -1;
    for (const [q, n] of cnt) if (n > bn || (n === bn && q > best)) { best = q; bn = n; }
    return best;
  }
  function addSpell(P, k, name) {
    if (!P.spell.has(k)) P.spell.set(k, new Map());
    const m = P.spell.get(k); m.set(name, (m.get(name) || 0) + 1);
  }

  // ---------------------------------------------------------------------
  //  Algebra lineare minima (matrici simmetriche n×n in Float64Array)
  // ---------------------------------------------------------------------
  function inv(M, n) {
    if (!n) return new Float64Array(0);
    const L = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let s = M[i * n + j];
        for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
        if (i === j) L[i * n + i] = Math.sqrt(Math.max(s, 1e-10));
        else L[i * n + j] = s / L[j * n + j];
      }
    }
    const Li = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      Li[i * n + i] = 1 / L[i * n + i];
      for (let j = 0; j < i; j++) {
        let s = 0;
        for (let k = j; k < i; k++) s -= L[i * n + k] * Li[k * n + j];
        Li[i * n + j] = s / L[i * n + i];
      }
    }
    const R = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let s = 0;
        for (let k = i; k < n; k++) s += Li[k * n + i] * Li[k * n + j];
        R[i * n + j] = R[j * n + i] = s;
      }
    }
    return R;
  }
  const mv = (M, v, n) => { const o = new Float64Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += M[i * n + j] * v[j]; o[i] = s; } return o; };
  // Posteriore gaussiana: dati (XtX, Xty) + a priori (media mu, precisione Cinv)
  function posterior(XtX, Xty, mu, Cinv, n) {
    const Q = new Float64Array(n * n), b = mv(Cinv, mu, n);
    for (let i = 0; i < n * n; i++) Q[i] = XtX[i] / K.SIGMA2 + Cinv[i];
    for (let i = 0; i < n; i++) b[i] += Xty[i] / K.SIGMA2;
    const S = inv(Q, n);
    return { m: mv(S, b, n), S };
  }
  // Combina una stima a priori (media, varianza) con un dato (media, varianza)
  function combine(pm, pv, y, dv) {
    if (!(dv < Infinity) || !(dv > 0)) return [pm, pv];
    const w = pv / (pv + dv);
    return [pm + w * (y - pm), (pv * dv) / (pv + dv)];
  }

  // ---------------------------------------------------------------------
  //  Preparazione dei dati (una volta per chiamata)
  // ---------------------------------------------------------------------
  const zPost = () => ({ n: 0, wins: 0, nw: 0, ww: 0, nRated: 0, adj: 0 });
  // Bravura dell'avversario in [-1, 1] (0 = media o non valutato); qualsiasi valore strano vale 0
  function strengthOf(oppStrength, m) {
    if (typeof oppStrength !== "function") return 0;
    let s;
    try { s = +oppStrength(m); } catch (e) { s = 0; }
    return Number.isFinite(s) ? clamp(s, -1, 1) : 0;
  }
  function prep(matches, oppStrength) {
    const P = { cd: new Map(), cds: [], spell: new Map(), games: [], arch: new Map(), gcache: new Map() };
    const idx = (dir, key) => {
      const id = dir + "|" + key;
      let i = P.cd.get(id);
      if (i == null) { i = P.cds.length; P.cd.set(id, i); P.cds.push({ id, dir, key }); }
      return i;
    };
    const archOf = (id) => {
      if (!P.arch.has(id)) P.arch.set(id, { id, nMatches: 0, post: { play: zPost(), draw: zPost(), na: zPost() }, rec: { play: [], draw: [], na: [] }, last: "" });
      return P.arch.get(id);
    };
    for (const m of matches || []) {
      if (!m) continue;
      const a = archOf(m.archetype_id);
      a.nMatches++;
      const post = A.gamesOf(m).filter((g) => g.n >= 2);
      const w = 1 / (1 + K.DEP * Math.max(0, post.length - 1));
      // risultato "sopra le attese": contro un forte la vittoria vale di più, contro uno scarso la sconfitta pesa di più
      const adj = K.OPP * strengthOf(oppStrength, m);
      for (const g of post) {
        const side = sideOf(g), y = g.r === "W" ? 1 : 0, ya = y + adj, yb = K.OPP_BASE ? ya : y;
        const ps = a.post[side]; ps.n++; ps.wins += y; ps.nw += w; ps.ww += w * yb;
        if (adj) { ps.nRated++; ps.adj += adj; }
        if (!g.sb) continue;
        const mi = toMap(g.sb.in), mo = toMap(g.sb.out);
        if (!mi.size && !mo.size) continue;
        const x = new Map();
        for (const [k, c] of mi) { x.set(idx("in", k), c.q); addSpell(P, k, c.name); }
        for (const [k, c] of mo) { x.set(idx("out", k), c.q); addSpell(P, k, c.name); }
        const sig = [...x].map(([i, q]) => P.cds[i].id + ":" + q).sort().join(";");
        const rg = { arch: m.archetype_id, side, y, ya, yb, w, date: m.played_at || "", x, sig };
        P.games.push(rg); a.rec[side].push(rg);
        if (rg.date > a.last) a.last = rg.date;
      }
    }
    const n = (P.n = P.cds.length);
    P.XtX = new Float64Array(n * n); P.Xty = new Float64Array(n);
    P.uAll = new Float64Array(n); P.nRecAll = 0;
    P.qAll = Array.from({ length: n }, () => new Map());
    for (const a of P.arch.values()) {
      a.XtX = new Float64Array(n * n); a.Xty = new Float64Array(n);
      a.st = {}; a.u = {}; a.q = {}; a.uAll = new Float64Array(n);
      a.nRec = 0;
      for (const side of ["play", "draw", "na"]) {
        const gs = a.rec[side], u = new Float64Array(n), q = new Map();
        for (const g of gs) for (const [i, qq] of g.x) {
          u[i]++; P.uAll[i]++; a.uAll[i]++;
          if (!q.has(i)) q.set(i, new Map());
          q.get(i).set(qq, (q.get(i).get(qq) || 0) + 1);
          P.qAll[i].set(qq, (P.qAll[i].get(qq) || 0) + 1);
        }
        a.u[side] = u; a.q[side] = q; a.nRec += gs.length; P.nRecAll += gs.length;
        a.st[side] = stratum(gs, n);
        if (a.st[side]) for (let i = 0; i < n * n; i++) a.XtX[i] += a.st[side].XtX[i];
        if (a.st[side]) for (let i = 0; i < n; i++) a.Xty[i] += a.st[side].Xty[i];
      }
      for (let i = 0; i < n * n; i++) P.XtX[i] += a.XtX[i];
      for (let i = 0; i < n; i++) P.Xty[i] += a.Xty[i];
    }
    P.fAll = new Float64Array(n);
    for (let i = 0; i < n; i++) P.fAll[i] = P.nRecAll ? P.uAll[i] / P.nRecAll : 0;
    // WR post-board di tutti i mazzi, vantaggio on the play, dispersione fra matchup
    let N = 0, W = 0, np = 0, wp = 0, nd = 0, wd = 0;
    for (const a of P.arch.values()) {
      for (const s of ["play", "draw", "na"]) { N += a.post[s].nw; W += a.post[s].ww; }
      np += a.post.play.nw; wp += a.post.play.ww; nd += a.post.draw.nw; wd += a.post.draw.ww;
    }
    P.p0 = (W + 1) / (N + 2); P.v0 = (P.p0 * (1 - P.p0)) / (N + 3);
    if (np > 0 && nd > 0) {
      const [d, vd] = combine(K.PLAY_PRIOR, K.PLAY_PRIOR_SD ** 2, wp / np - wd / nd, K.SIGMA2 * (1 / np + 1 / nd));
      P.delta = d; P.vDelta = vd;
    } else { P.delta = K.PLAY_PRIOR; P.vDelta = K.PLAY_PRIOR_SD ** 2; }
    let sq = 0, ev = 0, na = 0;
    for (const a of P.arch.values()) {
      const nw = a.post.play.nw + a.post.draw.nw + a.post.na.nw;
      if (nw < 3) continue;
      const y = (a.post.play.ww + a.post.draw.ww + a.post.na.ww) / nw;
      sq += (y - P.p0) ** 2; ev += K.SIGMA2 / nw; na++;
    }
    const t2 = na >= 3 ? (sq - ev) / na : 0;
    P.tauA = clamp(Math.sqrt(Math.max(0, t2)), K.WR_TAU_ARCH_MIN, K.WR_TAU_ARCH_MAX);
    return P;
  }
  // Statistiche "entro lo strato" (stesso matchup e lato): x e y centrati sulla media dello strato
  function stratum(gs, n) {
    if (gs.length < 2) return null;
    let W = 0, Wy = 0;
    const xb = new Float64Array(n), XtX = new Float64Array(n * n), Xty = new Float64Array(n);
    for (const g of gs) {
      W += g.w; Wy += g.w * g.ya;
      const ks = [...g.x.keys()];
      for (const i of ks) { xb[i] += g.w; Xty[i] += g.w * g.ya; for (const j of ks) XtX[i * n + j] += g.w; }
    }
    const yb = Wy / W;
    for (let i = 0; i < n; i++) xb[i] /= W;
    for (let i = 0; i < n; i++) {
      Xty[i] -= W * xb[i] * yb;
      if (!xb[i]) continue;
      for (let j = 0; j < n; j++) XtX[i * n + j] -= W * xb[i] * xb[j];
    }
    return { W, XtX, Xty };
  }

  // ---------------------------------------------------------------------
  //  Contesto di un matchup: effetti delle carte (play e draw) e WR di partenza
  // ---------------------------------------------------------------------
  function emptyArch(P, id) {
    const n = P.n, z = () => new Float64Array(n);
    return { id, nMatches: 0, post: { play: zPost(), draw: zPost(), na: zPost() }, rec: { play: [], draw: [], na: [] }, last: "",
      XtX: new Float64Array(n * n), Xty: z(), st: {}, u: { play: z(), draw: z(), na: z() }, q: { play: new Map(), draw: new Map(), na: new Map() }, uAll: z(), nRec: 0 };
  }
  function globalFit(P, exclude) {
    const n = P.n, key = exclude.slice().sort().join(",");
    if (P.gcache.has(key)) return P.gcache.get(key);
    const XtX = Float64Array.from(P.XtX), Xty = Float64Array.from(P.Xty);
    for (const id of exclude) {
      const a = P.arch.get(id); if (!a) continue;
      for (let i = 0; i < n * n; i++) XtX[i] -= a.XtX[i];
      for (let i = 0; i < n; i++) Xty[i] -= a.Xty[i];
    }
    const Cinv = new Float64Array(n * n);
    for (let i = 0; i < n; i++) Cinv[i * n + i] = 1 / K.TAU_GLOBAL ** 2;
    const fit = posterior(XtX, Xty, new Float64Array(n), Cinv, n);
    P.gcache.set(key, fit);
    return fit;
  }

  function archCtx(P, archId, gIds, meta) {
    const n = P.n, a = P.arch.get(archId) || emptyArch(P, archId);
    const others = [...new Set((gIds || []).filter((id) => id != null && id !== archId))].sort();
    const grp = others.map((id) => P.arch.get(id)).filter(Boolean);
    const nRecGroup = grp.reduce((t, g) => t + g.nRec, 0);

    // 1) altri gruppi
    const G = globalFit(P, [archId, ...others]);
    // 2) gruppo (altri mazzi del gruppo): eredita dal globale solo se la carta si usa contro questo gruppo
    const uCtx = Float64Array.from(a.uAll);
    for (const g of grp) for (let i = 0; i < n; i++) uCtx[i] += g.uAll[i];
    const r = uCtx.map((u) => u / (u + 1));
    const mu = new Float64Array(n), Cm = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      mu[i] = r[i] * G.m[i];
      for (let j = 0; j < n; j++) Cm[i * n + j] = r[i] * r[j] * G.S[i * n + j];
      Cm[i * n + i] += (1 - r[i] * r[i]) * K.TAU_GLOBAL ** 2 + K.TAU_GROUP ** 2;
    }
    let mg = mu, Sg = Cm;
    if (nRecGroup > 1) {
      const XtX = new Float64Array(n * n), Xty = new Float64Array(n);
      for (const g of grp) { for (let i = 0; i < n * n; i++) XtX[i] += g.XtX[i]; for (let i = 0; i < n; i++) Xty[i] += g.Xty[i]; }
      const f = posterior(XtX, Xty, mu, inv(Cm, n), n);
      mg = f.m; Sg = f.S;
    }
    // 3) frequenze d'uso ("cosa pensano i giocatori"), a cascata tutti -> gruppo -> matchup -> lato
    const L2 = K.LAMBDA;
    const fg = new Float64Array(n), fa = new Float64Array(n), fs = { play: new Float64Array(n), draw: new Float64Array(n) };
    const uG = new Float64Array(n);
    for (const g of grp) for (let i = 0; i < n; i++) uG[i] += g.uAll[i];
    for (let i = 0; i < n; i++) {
      fg[i] = (uG[i] + L2 * P.fAll[i]) / (nRecGroup + L2);
      fa[i] = (a.uAll[i] + L2 * fg[i]) / (a.nRec + L2);
      for (const s of ["play", "draw"]) fs[s][i] = (a.u[s][i] + L2 * fa[i]) / (a.rec[s].length + L2);
    }
    // conta quanto si sa dell'uso: senza sidate registrate in questo contesto "mai mossa" vuol dire solo "non si sa"
    const nCtx = a.nRec + nRecGroup, rho = nCtx / (nCtx + L2);
    const bel = (f) => K.KAPPA * (2 * f - 1) * rho;
    // 4) matchup: effetto comune ai due lati + scarto play/draw, stimati insieme sulle game di questo matchup
    const Lx = [];
    for (let i = 0; i < n; i++) if (a.XtX[i * n + i] > 1e-9) Lx.push(i);
    const l = Lx.length, sides = {};
    for (const s of ["play", "draw"]) {
      const mean = new Float64Array(n), vr = new Float64Array(n);
      for (let i = 0; i < n; i++) { mean[i] = mg[i] + bel(fs[s][i]); vr[i] = Sg[i * n + i] + K.TAU_ARCH ** 2 + K.TAU_SIDE ** 2; }
      sides[s] = { mean, var: vr, f: fs[s], L: Lx, Lpos: new Map(Lx.map((c, i) => [c, i])), covL: new Float64Array(l * l) };
    }
    if (l) {
      const d = 3 * l, H = new Float64Array(d * d), hy = new Float64Array(d);
      const blocks = { play: 1, draw: 2, na: 0 };
      for (const s of ["play", "draw", "na"]) {
        const st = a.st[s]; if (!st) continue;
        const bk = blocks[s];
        for (let i = 0; i < l; i++) {
          const yi = st.Xty[Lx[i]];
          hy[i] += yi; if (bk) hy[bk * l + i] += yi;
          for (let j = 0; j < l; j++) {
            const v = st.XtX[Lx[i] * n + Lx[j]];
            H[i * d + j] += v;
            if (bk) { H[(bk * l + i) * d + j] += v; H[i * d + bk * l + j] += v; H[(bk * l + i) * d + bk * l + j] += v; }
          }
        }
      }
      const C0 = new Float64Array(l * l);
      for (let i = 0; i < l; i++) { for (let j = 0; j < l; j++) C0[i * l + j] = Sg[Lx[i] * n + Lx[j]]; C0[i * l + i] += K.TAU_ARCH ** 2; }
      const C0i = inv(C0, l), Cinv = new Float64Array(d * d), m0 = new Float64Array(d);
      for (let i = 0; i < l; i++) {
        for (let j = 0; j < l; j++) Cinv[i * d + j] = C0i[i * l + j];
        Cinv[(l + i) * d + l + i] = Cinv[(2 * l + i) * d + 2 * l + i] = 1 / K.TAU_SIDE ** 2;
        const c = Lx[i], ba = bel(fa[c]);
        m0[i] = mg[c] + ba; m0[l + i] = bel(fs.play[c]) - ba; m0[2 * l + i] = bel(fs.draw[c]) - ba;
      }
      const fit = posterior(H, hy, m0, Cinv, d);
      for (const s of ["play", "draw"]) {
        const bk = blocks[s], S = sides[s];
        for (let i = 0; i < l; i++) {
          S.mean[Lx[i]] = fit.m[i] + fit.m[bk * l + i];
          for (let j = 0; j < l; j++) {
            S.covL[i * l + j] = fit.S[i * d + j] + fit.S[i * d + bk * l + j] + fit.S[(bk * l + i) * d + j] + fit.S[(bk * l + i) * d + bk * l + j];
          }
          S.var[Lx[i]] = S.covL[i * l + i];
        }
      }
    }
    // 5) WR di partenza (sidata solita) per lato
    let gn = 0, gw = 0;
    for (const g of grp) for (const s of ["play", "draw", "na"]) { gn += g.post[s].nw; gw += g.post[s].ww; }
    const [mG, vG] = combine(P.p0, P.v0 + K.WR_TAU_GROUP ** 2, gn ? gw / gn : 0, gn ? K.SIGMA2 / gn : Infinity);
    for (const s of ["play", "draw"]) {
      const sg = s === "play" ? 1 : -1, o = a.post[OTHER[s]], na = a.post.na, own = a.post[s];
      let [ma, va] = [mG, vG + P.tauA ** 2];
      if (o.nw) [ma, va] = combine(ma, va, o.ww / o.nw + (sg * P.delta) / 2, K.SIGMA2 / o.nw + K.WR_TAU_SIDE ** 2 + P.vDelta / 4);
      if (na.nw) [ma, va] = combine(ma, va, na.ww / na.nw, K.SIGMA2 / na.nw + P.vDelta / 4);
      let [m1, v1] = [ma + (sg * P.delta) / 2, va + K.WR_TAU_SIDE ** 2 + P.vDelta / 4];
      if (own.nw) [m1, v1] = combine(m1, v1, own.ww / own.nw, K.SIGMA2 / own.nw);
      Object.assign(sides[s], { alpha: m1, valpha: v1, nRec: a.rec[s].length, post: own, unk: { m: bel(0), v: K.TAU_GLOBAL ** 2 + K.TAU_GROUP ** 2 + K.TAU_ARCH ** 2 + K.TAU_SIDE ** 2 } });
    }
    let last = a.last;
    if (!a.nRec) for (const g of grp) if (g.last > last) last = g.last;
    return { archId, a, grp, nRecGroup, sides, meta: meta || {}, last };
  }

  // ---------------------------------------------------------------------
  //  Piani: valutazione, costruzione, riparazione
  // ---------------------------------------------------------------------
  const pid = (dir, key) => dir + "|" + key;
  const planSig = (pm) => [...pm].filter(([, q]) => q > 0).map(([id, q]) => id + ":" + q).sort().join(";");
  const planTotals = (pm) => { let i = 0, o = 0; for (const [id, q] of pm) if (id.startsWith("in|")) i += q; else o += q; return [i, o]; };

  function effectOf(P, S, dir, key) {
    const ci = P.cd.get(pid(dir, key));
    return ci == null ? { m: S.unk.m, v: S.unk.v, ci: null } : { m: S.mean[ci], v: S.var[ci], ci };
  }
  // WR atteso di un piano = WR di partenza + effetti delle carte che cambiano rispetto alla sidata solita
  function expectedOf(P, S, pm) {
    let wr = S.alpha, v = S.valpha;
    const z = new Map();
    for (let c = 0; c < P.n; c++) if (S.f[c] > 1e-9) z.set(c, -S.f[c]);
    for (const [id, q] of pm) {
      if (!(q > 0)) continue;
      const ci = P.cd.get(id);
      if (ci == null) { wr += S.unk.m; v += S.unk.v; } else z.set(ci, (z.get(ci) || 0) + 1);
    }
    const l = S.L.length, zl = new Float64Array(l);
    for (const [c, zz] of z) {
      wr += zz * S.mean[c];
      const li = S.Lpos.get(c);
      if (li != null) zl[li] = zz; else v += zz * zz * S.var[c];
    }
    for (let i = 0; i < l; i++) if (zl[i]) for (let j = 0; j < l; j++) v += zl[i] * zl[j] * S.covL[i * l + j];
    wr = clamp(wr, 0.01, 0.99);
    const sd = Math.sqrt(Math.max(v, 1e-6));
    return { wr, lo: clamp(wr - K.Z80 * sd, 0, 1), hi: clamp(wr + K.Z80 * sd, 0, 1), sd };
  }

  // Una sidata già provata: la stima delle sue carte si corregge (poco) con il suo risultato effettivo
  function blendObs(S, e, obs) {
    if (!obs || !(obs.nw > 0)) return e;
    const vc = Math.max(0, e.sd * e.sd - S.valpha);
    const [res, vr] = combine(0, K.TAU_PLAN ** 2 + vc, obs.ww / obs.nw - e.wr, K.SIGMA2 / obs.nw);
    const wr = clamp(e.wr + res, 0.01, 0.99), sd = Math.sqrt(S.valpha + vr);
    return { wr, lo: clamp(wr - K.Z80 * sd, 0, 1), hi: clamp(wr + K.Z80 * sd, 0, 1), sd };
  }

  // Quantità più usata per una carta: lato -> matchup -> gruppo -> tutti
  function modeQ(P, ctx, side, dir, key) {
    const ci = P.cd.get(pid(dir, key));
    if (ci == null) return 0;
    const a = ctx.a;
    const pick = (maps) => { const c = new Map(); for (const mp of maps) { const x = mp.get(ci); if (x) for (const [q, k] of x) c.set(q, (c.get(q) || 0) + k); } return c.size ? modeOf(c) : 0; };
    return pick([a.q[side]]) || pick([a.q.play, a.q.draw, a.q.na]) || pick(ctx.grp.flatMap((g) => [g.q.play, g.q.draw, g.q.na])) || (P.qAll[ci].size ? modeOf(P.qAll[ci]) : 0);
  }

  // Disponibilità nella versione: IN dalla sideboard, OUT dal main
  function availability(P, version) {
    if (version && (version.maindeck != null || version.sideboard != null)) {
      const main = textMap(version.maindeck), side = textMap(version.sideboard);
      return { known: true, main, side, cap: (dir, key) => ((dir === "in" ? side : main).get(key) || { q: 0 }).q };
    }
    // Nessuna versione: vale tutto ciò che è stato mosso almeno una volta (al massimo quante copie si sono viste)
    const mx = new Map();
    for (const g of P.games) for (const [i, q] of g.x) mx.set(P.cds[i].id, Math.max(mx.get(P.cds[i].id) || 0, q));
    return { known: false, main: new Map(), side: new Map(), cap: (dir, key) => mx.get(pid(dir, key)) || 0 };
  }

  // Zaino esatto: per ogni totale di copie T, la scelta di valore massimo
  function knap(items, tmax) {
    let dp = new Float64Array(tmax + 1).fill(-Infinity); dp[0] = 0;
    const back = [];
    for (const it of items) {
      const nd = new Float64Array(tmax + 1).fill(-Infinity), nb = new Int8Array(tmax + 1).fill(-1);
      for (let T = 0; T <= tmax; T++) {
        if (dp[T] === -Infinity) continue;
        for (const o of it.opts) {
          const t2 = T + o.q; if (t2 > tmax) continue;
          const v = dp[T] + o.v;
          if (v > nd[t2] + 1e-12) { nd[t2] = v; nb[t2] = o.q; }
        }
      }
      back.push(nb); dp = nd;
    }
    return { dp, back };
  }
  function knapPick(items, back, T) {
    const qs = new Array(items.length).fill(0);
    for (let i = items.length - 1; i >= 0; i--) { const q = back[i][T]; qs[i] = q; T -= q; }
    return qs;
  }
  const optValue = (val, q, qm) => val * Math.min(1, q / qm) - 0.004 * Math.abs(q - qm) - K.CARD_COST;
  function optsFor(it, mode) {
    if (mode === "fixed") return [{ q: it.q0, v: optValue(it.val, it.q0, it.qm) }];
    if (mode === "trim") { const o = [{ q: 0, v: 0 }]; for (let q = 1; q <= it.q0; q++) o.push({ q, v: optValue(it.val, q, it.qm) }); return o; }
    if (mode === "none") return [{ q: 0, v: 0 }];
    const o = [{ q: 0, v: 0 }];
    for (let q = 1; q <= it.cap; q++) o.push({ q, v: optValue(it.val, q, it.qm) });
    return o;
  }
  // Sceglie il totale T con IN = OUT che massimizza il valore
  function solve(itIn, itOut) {
    const tmax = Math.min(K.TMAX, itIn.reduce((t, x) => t + Math.max(...x.opts.map((o) => o.q)), 0), itOut.reduce((t, x) => t + Math.max(...x.opts.map((o) => o.q)), 0));
    const ki = knap(itIn, Math.max(0, tmax)), ko = knap(itOut, Math.max(0, tmax));
    let bestT = -1, bv = -Infinity;
    for (let T = 0; T <= tmax; T++) {
      const v = ki.dp[T] + ko.dp[T];
      if (v > bv + 1e-9) { bv = v; bestT = T; }
    }
    if (bestT < 0) return null;
    const pm = new Map(), qi = knapPick(itIn, ki.back, bestT), qo = knapPick(itOut, ko.back, bestT);
    itIn.forEach((it, i) => { if (qi[i] > 0) pm.set(pid("in", it.key), qi[i]); });
    itOut.forEach((it, i) => { if (qo[i] > 0) pm.set(pid("out", it.key), qo[i]); });
    return pm;
  }
  function itemsFor(P, ctx, side, S, av, dir) {
    const zone = av.known ? (dir === "in" ? av.side : av.main) : null;
    const keys = zone ? [...zone.keys()] : P.cds.filter((c) => c.dir === dir).map((c) => c.key);
    return keys.map((key) => {
      const cap = av.cap(dir, key);
      const qm = clamp(modeQ(P, ctx, side, dir, key) || 1, 1, Math.max(1, cap));
      return { key, dir, cap, qm, val: effectOf(P, S, dir, key).m };
    }).filter((x) => x.cap > 0).sort((x, y) => (x.key < y.key ? -1 : 1));
  }
  function optimal(P, ctx, side, S, av) {
    const mk = (dir) => itemsFor(P, ctx, side, S, av, dir).map((it) => ({ ...it, opts: optsFor(it, "free") }));
    return solve(mk("in"), mk("out")) || new Map();
  }
  // Rende valido un piano per la versione: toglie le carte assenti, limita le copie, pareggia IN/OUT
  function repair(P, ctx, side, S, av, pm0) {
    const dropped = [], pm = new Map();
    for (const [id, q] of pm0) {
      if (!(q > 0)) continue;
      const [dir, key] = [id.slice(0, id.indexOf("|")), id.slice(id.indexOf("|") + 1)];
      const cap = av.cap(dir, key);
      if (!cap) { dropped.push({ key, dir }); continue; }
      pm.set(id, Math.min(q, cap));
    }
    const [ti, to] = planTotals(pm);
    let changed = dropped.length > 0 || [...pm].some(([id, q]) => q !== pm0.get(id));
    if (ti === to) return { pm, dropped, changed, completed: false };
    const build = (dir, mode) => {
      const all = itemsFor(P, ctx, side, S, av, dir);
      return all.map((it) => {
        const q0 = pm.get(pid(dir, it.key)) || 0;
        let md = mode;
        if (q0 > 0) md = mode === "trim" ? "trim" : "fixed";
        else if (mode === "trim" || mode === "fixed") md = "none";
        return { ...it, q0, opts: optsFor({ ...it, q0 }, md) };
      });
    };
    const shortDir = ti < to ? "in" : "out", longDir = OTHER_DIR[shortDir];
    let res = solve(shortDir === "in" ? build("in", "free") : build("in", "fixed"), shortDir === "out" ? build("out", "free") : build("out", "fixed"));
    if (!res) {
      res = solve(longDir === "in" ? build("in", "trim") : build("in", "fixed"), longDir === "out" ? build("out", "trim") : build("out", "fixed"));
    }
    return { pm: res || new Map(), dropped, changed: true, completed: true };
  }
  const OTHER_DIR = { in: "out", out: "in" };

  // ---------------------------------------------------------------------
  //  Raccomandazione
  // ---------------------------------------------------------------------
  function verdictOf(eff, freq) {
    if (eff >= 0.06 || (eff >= 0.03 && freq >= 0.5)) return "chiave";
    if (eff >= 0.01) return "utile";
    if (eff <= -0.04 || (eff <= -0.02 && freq < 0.5)) return "sconsigliata";
    return "neutra";
  }
  function nameFor(P, av, key, extra) {
    const v = av.side.get(key) || av.main.get(key);
    if (v) return String(v.name).trim();
    const sp = P.spell.get(key);
    if (sp) { let best = null, bn = -1; for (const [nm, c] of sp) if (c > bn) { best = nm; bn = c; } return best; }
    return (extra && extra.get(key)) || key;
  }
  function guideMap(guide, side) {
    if (!guide) return null;
    const mk = (s) => {
      const i = textMap(guide[s + "_in"]), o = textMap(guide[s + "_out"]), pm = new Map(), names = new Map();
      for (const [k, c] of i) { pm.set(pid("in", k), c.q); names.set(k, c.name); }
      for (const [k, c] of o) { pm.set(pid("out", k), c.q); names.set(k, c.name); }
      return pm.size ? { pm, names } : null;
    };
    const own = mk(side);
    if (own) return { ...own, otherSide: false };
    const oth = mk(OTHER[side]);
    return oth ? { ...oth, otherSide: true } : null;
  }
  const splitId = (id) => { const i = id.indexOf("|"); return [id.slice(0, i), id.slice(i + 1)]; };
  function freqIn(gs, ci) { if (!gs.length || ci == null) return 0; let k = 0; for (const g of gs) if (g.x.has(ci)) k++; return k / gs.length; }

  function buildRec(P, ctx, side, version, guide) {
    const S = ctx.sides[side], a = ctx.a, av = availability(P, version);
    const nSide = S.nRec, nMatchup = a.nRec, nGroup = ctx.nRecGroup;
    const recSide = a.rec[side], recArch = [...a.rec.play, ...a.rec.draw, ...a.rec.na];
    const recGroup = ctx.grp.flatMap((g) => [...g.rec.play, ...g.rec.draw, ...g.rec.na]);
    const scopeGames = recSide.length ? recSide : recArch.length ? recArch : recGroup;
    const gd = guideMap(guide, side);
    const gNames = gd ? gd.names : null;
    const name = (key) => nameFor(P, av, key, gNames);
    const eff = (dir, key) => effectOf(P, S, dir, key);
    const freqOf = (dir, key) => freqIn(scopeGames, P.cd.get(pid(dir, key)));
    const pick = (id, q) => {
      const [dir, key] = splitId(id), e = eff(dir, key).m, f = freqOf(dir, key);
      return { key, name: name(key), q, freq: r3(f), effect: r3(e), verdict: verdictOf(e, f) };
    };
    const toPlan = (pm) => {
      const pl = { in: [], out: [] };
      for (const [id, q] of pm) if (q > 0) pl[id.startsWith("in|") ? "in" : "out"].push(pick(id, q));
      const ord = (x, y) => y.q - x.q || y.effect - x.effect || (x.name < y.name ? -1 : 1);
      pl.in.sort(ord); pl.out.sort(ord);
      return pl;
    };
    const fromGame = (g) => { const pm = new Map(); for (const [i, q] of g.x) pm.set(P.cds[i].id, q); return pm; };
    const basePost = S.post;
    const baseline = basePost.n ? { wr: r3(basePost.wins / basePost.n), n: basePost.n } : null;
    const nm = ctx.meta.name || "questo mazzo", sl = SIDE_LABEL[side], grpName = ctx.meta.group || null;
    const oppAdj = { nRated: basePost.nRated, nGames: basePost.n, shift: basePost.n ? Math.round((1000 * basePost.adj) / basePost.n) / 10 : 0 };
    const plainPlan = (pl) => ({ in: pl.in.map((c) => ({ q: c.q, name: c.name })), out: pl.out.map((c) => ({ q: c.q, name: c.name })) });

    // Sidate osservate (raggruppate per piano identico)
    const observed = (gs) => {
      const by = new Map();
      for (const g of gs) { if (!by.has(g.sig)) by.set(g.sig, { pm: fromGame(g), n: 0, wins: 0, nw: 0, ww: 0, last: "" }); const e = by.get(g.sig); e.n++; e.wins += g.y; e.nw += g.w; e.ww += g.w * g.yb; if (g.date > e.last) e.last = g.date; }
      return [...by.entries()].map(([sig, e]) => ({ sig, ...e })).sort((x, y) => y.n - x.n || y.wins - x.wins || (x.sig < y.sig ? -1 : 1));
    };
    const obsSide = observed(recSide), obsArch = observed(recArch);

    // Niente di niente
    if (!nMatchup && !nGroup && !gd) {
      return {
        archId: ctx.archId, side, level: "nessuno", nUsed: 0, nSide: 0, nMatchup: 0,
        plan: { in: [], out: [] }, expected: null, baseline, confidence: "nessuna",
        why: [basePost.n ? `Contro ${nm} ${sl} ci sono ${basePost.n} game post-board ma nessuna sidata registrata, né contro mazzi simili, e nessuna guida scritta.` : `Nessuna sidata registrata contro ${nm} né contro mazzi simili, e nessuna guida scritta.`],
        alternatives: [], cards: [], notInVersion: [], updatedAt: null,
        simple: { headline: "Ancora nessuna sidata", plan: { in: [], out: [] }, record: null, source: "nessuno", note: null },
        oppAdj,
      };
    }

    // Candidati
    const cands = [];
    const add = (kind, pm0, extra) => {
      const rp = repair(P, ctx, side, S, av, pm0);
      let e = expectedOf(P, S, rp.pm);
      if (kind === "tested" && !rp.changed) e = blendObs(S, e, extra.obs);
      const c = { kind, pm: rp.pm, sig: planSig(rp.pm), e, rp, ...extra };
      cands.push(c); return c;
    };
    const M = add("model", optimal(P, ctx, side, S, av), {});
    const tested = obsSide.map((o) => add("tested", o.pm, { obs: o }));
    const testedArch = !obsSide.length ? obsArch.map((o) => add("testedArch", o.pm, { obs: o })) : [];
    const G = gd ? add("guide", gd.pm, {}) : null;
    const weak = nSide < K.WEAK;
    const better = (x, y) => (x.e.wr > y.e.wr + 1e-9 ? x : y);
    let chosen, how;
    if (G && weak && (!gd.otherSide || !nMatchup)) {
      chosen = G; how = "guida";
    } else if (weak) {
      const most = tested[0] || testedArch[0] || null;
      if (most && !(M.e.wr - most.e.wr >= K.MARGIN_WEAK && M.sig !== most.sig)) { chosen = most; how = "piu-usata"; }
      else { chosen = M; how = "modello"; }
    } else {
      const pool = [...tested, ...(G && !gd.otherSide ? [G] : [])];
      let bestT = pool.reduce((b, c) => (b ? better(c, b) : c), null);
      if (pool.some((c) => c.sig === M.sig)) bestT = better(M, bestT);
      if (!bestT || (M.e.wr - bestT.e.wr >= K.MARGIN)) { chosen = M; how = "modello"; } else { chosen = bestT; how = bestT.kind === "guide" ? "guida-vince" : "provata"; }
    }

    const level = how === "guida" ? "guida" : nSide >= K.WEAK ? "matchup-lato" : nMatchup >= K.WEAK ? "matchup" : nGroup >= K.WEAK ? "gruppo" : nSide > 0 ? "matchup-lato" : nMatchup > 0 ? "matchup" : "gruppo";
    const ex = chosen.e;
    const width = ex.hi - ex.lo;
    const confidence = level === "guida" && !nMatchup ? "bassa"
      : nSide >= 8 && width <= 0.32 && level === "matchup-lato" ? "alta"
      : nSide >= K.WEAK && width <= 0.4 ? "media" : "bassa";
    const nUsed = level === "matchup-lato" ? nSide : level === "matchup" ? nMatchup : level === "gruppo" ? nMatchup + nGroup : nMatchup;

    // Carte: quelle del piano, quelle mosse in questo matchup, quelle della guida
    const cardIds = new Set([...chosen.pm.keys()]);
    for (const g of scopeGames === recGroup ? [] : scopeGames) for (const i of g.x.keys()) cardIds.add(P.cds[i].id);
    if (gd) for (const id of gd.pm.keys()) cardIds.add(id);
    const sg = recSide.length ? recSide : recArch;
    const cards = [...cardIds].map((id) => {
      const [dir, key] = splitId(id), ci = P.cd.get(id), e = eff(dir, key).m, f = freqOf(dir, key);
      let nW = 0, wW = 0, nO = 0, wO = 0;
      for (const g of sg) { if (ci != null && g.x.has(ci)) { nW++; wW += g.y; } else { nO++; wO += g.y; } }
      return { key, name: name(key), dir, nWith: nW, winsWith: wW, nWithout: nO, winsWithout: wO, effect: r3(e), verdict: verdictOf(e, f), freq: r3(f), inPlan: (chosen.pm.get(id) || 0) > 0, scope: recSide.length ? "lato" : "matchup" };
    }).sort((x, y) => (y.inPlan - x.inPlan) || (x.dir < y.dir ? -1 : x.dir > y.dir ? 1 : 0) || y.effect - x.effect || (x.name < y.name ? -1 : 1));

    // Carte buone non più nella lista
    const niv = new Map();
    const noteFor = (dir, key) => (dir === "in" && av.main.has(key) ? "ora è nel main" : dir === "out" && av.side.has(key) ? "ora è in sideboard" : "non è più nella lista");
    if (av.known) {
      for (const c of cards) {
        if (av.cap(c.dir, c.key) > 0) continue;
        const good = c.verdict === "chiave" || c.verdict === "utile" || c.freq >= 0.5 || (gd && gd.pm.has(pid(c.dir, c.key)));
        if (good) niv.set(pid(c.dir, c.key), { key: c.key, name: c.name, dir: c.dir, note: noteFor(c.dir, c.key) });
      }
      for (const d of chosen.rp.dropped) if (!niv.has(pid(d.dir, d.key))) niv.set(pid(d.dir, d.key), { key: d.key, name: name(d.key), dir: d.dir, note: noteFor(d.dir, d.key) });
    }
    const notInVersion = [...niv.values()];

    // Alternative: sidate osservate (adattate alla versione, stessa stima del piano consigliato) + guida
    const altC = tested.length ? tested : testedArch, bySig = new Map();
    for (const c of altC) {
      if (!bySig.has(c.sig)) bySig.set(c.sig, { c, n: 0, wins: 0, changed: false, sides: new Set() });
      const e = bySig.get(c.sig); e.n += c.obs.n; e.wins += c.obs.wins; e.changed = e.changed || c.rp.changed;
      if (c.kind === "testedArch") for (const g of recArch) if (g.sig === c.obs.sig && g.side !== "na") e.sides.add(g.side);
    }
    const alts = [...bySig.values()].filter((x) => x.c.pm.size).sort((x, y) => y.c.e.wr - x.c.e.wr || y.n - x.n || (x.c.sig < y.c.sig ? -1 : 1));
    const maxN = Math.max(0, ...alts.map((x) => x.n));
    const gsig = G ? G.sig : null;
    let out = alts.slice(0, 3).map((x, i) => ({
      label: (x.c.sig === gsig ? "Guida scritta" : x.n === maxN && x.n >= 2 ? "Più usata" : i === 0 ? "Migliore finora" : `Alternativa ${i + 1}`)
        + (x.sides.size === 1 ? ` (${SIDE_LABEL[[...x.sides][0]]})` : "") + (x.changed ? " (adattata alla lista)" : "") + (x.c.sig === chosen.sig ? " · consigliata" : ""),
      plan: toPlan(x.c.pm), n: x.n, wins: x.wins, wr: r3(x.c.e.wr), lo: r3(x.c.e.lo), hi: r3(x.c.e.hi), sig: x.c.sig,
    }));
    if (G && G.sig !== chosen.sig && !out.some((x) => x.sig === gsig)) {
      const same = recSide.filter((g) => g.sig === planSig(gd.pm));
      const ga = { label: (gd.otherSide ? `Guida scritta (${SIDE_LABEL[OTHER[side]]})` : "Guida scritta") + (G.rp.changed ? " (completata)" : ""), plan: toPlan(G.pm), n: same.length, wins: same.reduce((t, g) => t + g.y, 0), wr: r3(G.e.wr), lo: r3(G.e.lo), hi: r3(G.e.hi), sig: G.sig };
      out = [...out.slice(0, 2), ga];
    }
    out.forEach((x) => delete x.sig);

    // Perché (frasi brevi)
    const why = [];
    const short = (id) => { const [dir, key] = splitId(id); return `${dir === "in" ? "+" : MINUS}${chosen.pm.get(id) || ""} ${name(key)}`.replace(/(\+|−) /, "$1"); };
    const obsChosen = obsSide.find((o) => o.sig === chosen.sig);
    if (nSide) {
      if (obsChosen) {
        why.push(obsChosen.n === nSide
          ? `Contro ${nm} ${sl} è sempre stata usata questa sidata: vinte ${obsChosen.wins} su ${obsChosen.n}.`
          : `Su ${nSide} sidate contro ${nm} ${sl}, questa è stata usata ${obsChosen.n} ${obsChosen.n === 1 ? "volta" : "volte"} e ha vinto ${obsChosen.wins} su ${obsChosen.n}.`);
      } else {
        // la carta del piano con il confronto più netto
        let best = null;
        for (const c of cards) {
          if (!c.inPlan || !c.nWith || !c.nWithout) continue;
          const d = c.winsWith / c.nWith - c.winsWithout / c.nWithout;
          if (Math.abs(d) < 0.2) continue;
          if (!best || Math.abs(d) > Math.abs(best.d)) best = { c, d };
        }
        if (best) {
          const c = best.c, q = chosen.pm.get(pid(c.dir, c.key));
          why.push(`Su ${nSide} sidate contro ${nm} ${sl}, quelle con ${c.dir === "in" ? "+" : MINUS}${q} ${c.name} hanno vinto ${c.winsWith} su ${c.nWith}, quelle senza ${c.winsWithout} su ${c.nWithout}.`);
        } else {
          const w = recSide.reduce((t, g) => t + g.y, 0);
          why.push(nSide === 1 ? `Contro ${nm} ${sl} c'è una sola sidata registrata: ${w ? "vinta" : "persa"}.` : `Su ${nSide} sidate registrate contro ${nm} ${sl} ne sono state vinte ${w}.`);
        }
      }
    }
    if (nSide < K.WEAK && how !== "guida") {
      const parts = [];
      if (nMatchup > nSide) parts.push(`le sidate ${SIDE_LABEL[OTHER[side]]}`);
      if (nGroup) parts.push(`quelle contro gli altri mazzi ${grpName || "dello stesso gruppo"}`);
      if (parts.length) why.push(`${nSide ? "Pochi dati" : "Nessuna sidata registrata"} ${sl}: uso ${parts.join(" e ")}.`);
    }
    if ((chosen.kind === "tested" || chosen.kind === "testedArch") && chosen.rp.changed && !obsChosen) {
      const o = chosen.obs;
      why.push(`È la sidata provata ${o.n} ${o.n === 1 ? "volta" : "volte"}${chosen.kind === "testedArch" ? " sull'altro lato" : ""} (vinte ${o.wins}), adattata alla lista attuale.`);
    }
    if (how === "modello" && !weak) why.push("Nessuna sidata provata è migliore: è la combinazione delle carte che hanno reso di più.");
    if (how === "modello" && weak && !obsChosen) why.push("Combinazione delle carte più usate e con i risultati migliori contro questo tipo di mazzo.");
    if (gd) {
      if (how === "guida") why.push(`Con così pochi dati seguo la guida scritta${gd.otherSide ? ` (${SIDE_LABEL[OTHER[side]]})` : ""}${chosen.rp.completed ? ", completata perché entrate e uscite siano pari" : ""}.`);
      else if (G && G.sig === chosen.sig) why.push("Coincide con la guida scritta.");
      else {
        const gk = new Set([...gd.pm.keys()]), ck = new Set([...chosen.pm.keys()]);
        const plus = [...ck].filter((id) => !gk.has(id)).slice(0, 2).map(short), minus = [...gk].filter((id) => !ck.has(id)).slice(0, 2).map((id) => name(splitId(id)[1]));
        const diff = [plus.length ? `aggiunge ${plus.join(", ")}` : "", minus.length ? `non usa ${minus.join(", ")}` : ""].filter(Boolean).join(" e ");
        why.push(`Rispetto alla guida scritta${gd.otherSide ? ` (${SIDE_LABEL[OTHER[side]]})` : ""} ${diff || "cambia le quantità"}: ${weak ? "i dati sono ancora pochi, valuta tu" : "i risultati finora vanno in questa direzione"}.`);
      }
    }
    if (baseline && baseline.n < 12 && Math.abs(ex.wr - baseline.wr) >= 0.15 && why.length < 4) {
      why.push(`Il ${Math.round(baseline.wr * 100)}% osservato su ${baseline.n} game è ancora incerto: la stima lo avvicina a quanto visto sull'altro lato e contro mazzi simili.`);
    }
    if (notInVersion.length && why.length < 4) {
      const xs = notInVersion.slice(0, 2);
      why.push(xs.map((x) => `${x.name} ${x.note}`).join("; ") + (notInVersion.length > 2 ? ` (e altre ${notInVersion.length - 2})` : "") + ".");
    }

    const plan = toPlan(chosen.pm);
    const simple = simpleView({ side, chosen, how, weak, nMatchup, nGroup, obsSide, obsChosen, recArch, gd, plan: plainPlan(plan) });

    return {
      archId: ctx.archId, side, level, nUsed, nSide, nMatchup,
      plan,
      expected: { wr: r3(ex.wr), lo: r3(ex.lo), hi: r3(ex.hi) },
      baseline, confidence, why: why.slice(0, 4),
      alternatives: out, cards, notInVersion,
      updatedAt: (level === "gruppo" ? ctx.last : a.last || ctx.last) || null,
      simple, oppAdj,
    };
  }

  // Vista semplice per chi non vuole numeri: titolo, piano, record osservato (conteggi veri), al massimo una frase.
  // Non dice mai più di quanto mostrano i dati: "ha funzionato meglio" solo se la sidata è stata provata almeno 2 volte
  // su questo lato e nessun'altra sidata provata almeno 2 volte ha fatto meglio nei risultati grezzi.
  const planDist = (x, y) => { let d = 0; for (const id of new Set([...x.keys(), ...y.keys()])) d += Math.abs((x.get(id) || 0) - (y.get(id) || 0)); return d; };
  const timesIt = (n) => (n === 1 ? "una volta" : `${n} volte`);
  function simpleView({ side, chosen, how, weak, nMatchup, nGroup, obsSide, obsChosen, recArch, gd, plan }) {
    const sl = SIDE_LABEL[side];
    // sidata provata solo sull'altro lato (o senza lato): dove e con che risultato
    const archObs = chosen.kind === "testedArch" ? chosen.obs : null;
    let archWhere = "in questo matchup";
    if (archObs) {
      const sides = new Set(recArch.filter((g) => g.sig === archObs.sig).map((g) => g.side));
      if (sides.size === 1 && !sides.has("na")) archWhere = SIDE_LABEL[[...sides][0]];
    }
    const won = (n, w) => (n === 1 ? (w ? "vinta" : "persa") : `vinte ${w}`);
    // record: la sidata stessa su questo lato, altrimenti la più simile (al massimo 4 copie di differenza)
    let rec = obsChosen || null, exact = !!obsChosen;
    if (!rec && obsSide.length) {
      let best = null, bd = Infinity;
      for (const o of obsSide) { const d = planDist(o.pm, chosen.pm); if (d < bd) { best = o; bd = d; } } // obsSide è già ordinato per n
      if (best && bd <= 4) rec = best;
    }
    // Vista per gli utenti (richiesta esplicita): un titolo solo, semplice, e i numeri grezzi. Niente sfumature tecniche.
    //  - c'è una guida e pochi dati      -> "Guida scritta"
    //  - nessuna sidata contro il mazzo  -> "Come contro mazzi simili" (il piano viene dal gruppo)
    //  - altrimenti                      -> "In media ha funzionato meglio"
    // Il "record" è mostrato solo se è proprio di QUESTA sidata su questo lato; altrimenti una frase semplice.
    const record = rec && exact ? { wins: rec.wins, n: rec.n } : null;
    let headline, source = "dati";
    if (how === "guida") { source = "guida"; headline = "Guida scritta"; }
    else if (!nMatchup) headline = nGroup ? "Come contro mazzi simili" : "Ancora nessuna sidata";
    else headline = "In media ha funzionato meglio";
    let note = null;
    if (rec && !exact) note = `Con sidate simili ${sl}: ${won(rec.n, rec.wins)}${rec.n === 1 ? "" : ` su ${rec.n}`}.`;
    else if (!rec && archObs) note = `Provata ${timesIt(archObs.n)} ${archWhere}: ${won(archObs.n, archObs.wins)}.`;
    else if (!rec) {
      const os = OTHER[side], same = recArch.filter((g) => g.side === os && g.sig === chosen.sig);
      if (same.length) note = `Provata ${timesIt(same.length)} ${SIDE_LABEL[os]}: ${won(same.length, same.reduce((t, g) => t + g.y, 0))}.`;
      else if (how === "guida" && gd && gd.otherSide) note = `La guida scritta è per ${SIDE_LABEL[OTHER[side]]}.`;
    }
    return { headline, plan, record, source, note };
  }

  // ---------------------------------------------------------------------
  //  API
  // ---------------------------------------------------------------------
  function metaFor(archId, archetypes, groupOf) {
    const ar = archetypes ? archetypes.find((x) => x.id === archId) : (A.archById ? A.archById(archId) : null);
    const g = groupOf ? groupOf(archId) : A.groupOf ? A.groupOf(archId) : null;
    return { name: ar ? ar.name : null, group: g && !isAltro(g) ? g.name : null, altro: !!g && isAltro(g) };
  }
  function groupArchIds(archId, archetypes, groupOf) {
    const go = groupOf || A.groupOf;
    const g = go ? go(archId) : null;
    if (!g || isAltro(g)) return [];
    return (archetypes || []).filter((x) => { const y = go(x.id); return y && y.id === g.id; }).map((x) => x.id);
  }
  const ctxFor = (P, archId, groupIds, meta) => archCtx(P, archId, meta.altro ? [] : groupIds, meta);

  function recommend({ matches, archId, side = "play", version, guide, groupArchIds: gIds, oppStrength } = {}) {
    const s = side === "draw" ? "draw" : "play";
    const P = prep(matches, oppStrength);
    const ctx = ctxFor(P, archId, gIds, metaFor(archId));
    return buildRec(P, ctx, s, version, guide || null);
  }

  function estimate({ matches, archId, side = "play", plan, version, groupArchIds: gIds, oppStrength } = {}) {
    const s = side === "draw" ? "draw" : "play";
    const P = prep(matches, oppStrength), meta = metaFor(archId);
    const ctx = ctxFor(P, archId, gIds, meta), S = ctx.sides[s], av = availability(P, version);
    const pm = new Map(), names = new Map();
    for (const dir of ["in", "out"]) for (const [k, c] of toMap((plan || {})[dir])) { pm.set(pid(dir, k), (pm.get(pid(dir, k)) || 0) + c.q); names.set(pid(dir, k), c.name); }
    const e = expectedOf(P, S, pm);
    const sig = planSig(pm), rec = ctx.a.rec[s];
    const same = rec.filter((g) => g.sig === sig);
    const notes = [];
    const [ti, to] = planTotals(pm);
    if (!pm.size) notes.push("Nessuna carta mossa: stima della sidata solita.");
    if (ti !== to) notes.push(`Entrano ${ti} carte ed escono ${to}: la sidata non è in pari.`);
    if (same.length) notes.push(`Sidata già provata ${same.length} ${same.length === 1 ? "volta" : "volte"} ${SIDE_LABEL[s]}: vinte ${same.reduce((t, g) => t + g.y, 0)}.`);
    else if (pm.size) {
      const archGames = [...ctx.a.rec.play, ...ctx.a.rec.draw, ...ctx.a.rec.na];
      const untested = [...pm.keys()].filter((id) => { const ci = P.cd.get(id); return ci == null || !archGames.some((g) => g.x.has(ci)); });
      if (untested.length) notes.push(`Stima estrapolata: ${untested.slice(0, 3).map((id) => names.get(id)).join(", ")}${untested.length > 3 ? " e altre" : ""} mai ${untested.length === 1 ? "provata" : "provate"} contro questo mazzo; conta il comportamento contro mazzi simili.`);
      else notes.push("Combinazione nuova di carte già provate: stima dalla somma degli effetti delle singole carte.");
    }
    if (av.known) {
      const miss = [...pm.keys()].filter((id) => { const [dir, key] = splitId(id); return av.cap(dir, key) < pm.get(id); });
      if (miss.length) notes.push(`Attenzione: ${miss.slice(0, 3).map((id) => names.get(id)).join(", ")} ${miss.length === 1 ? "non è disponibile" : "non sono disponibili"} (o con meno copie) in questa versione.`);
    }
    return { wr: r3(e.wr), lo: r3(e.lo), hi: r3(e.hi), n: same.length, note: notes.join(" ") };
  }

  function overview({ matches, version, archetypes, groupOf, guideFor, oppStrength } = {}) {
    const P = prep(matches, oppStrength), archs = archetypes || [];
    const go = groupOf || A.groupOf || (() => null);
    const gOf = new Map(archs.map((a) => [a.id, go(a.id)]));
    const members = new Map();
    for (const a of archs) { const g = gOf.get(a.id); if (g && !isAltro(g)) { if (!members.has(g.id)) members.set(g.id, []); members.get(g.id).push(a.id); } }
    const rows = [];
    for (const a of archs) {
      const ag = P.arch.get(a.id), guide = guideFor ? guideFor(a.id) : null;
      const hasGuide = !!(guide && ["play_in", "play_out", "draw_in", "draw_out"].some((f) => String(guide[f] || "").trim()));
      if (!(ag && ag.nMatches) && !hasGuide) continue;
      const g = gOf.get(a.id), gIds = g && !isAltro(g) ? members.get(g.id) : [];
      const ctx = archCtx(P, a.id, gIds, { name: a.name, group: g && !isAltro(g) ? g.name : null });
      const nPost = ag ? ag.post.play.n + ag.post.draw.n + ag.post.na.n : 0;
      rows.push({ archId: a.id, name: a.name, group: g ? g.name : null, nMatches: ag ? ag.nMatches : 0, nPost, nRec: ag ? ag.nRec : 0,
        play: buildRec(P, ctx, "play", version, guide), draw: buildRec(P, ctx, "draw", version, guide) });
    }
    return rows.sort((x, y) => y.nMatches - x.nMatches || String(x.name).localeCompare(String(y.name)));
  }

  // ---------------------------------------------------------------------
  //  Core del mazzo e modifiche nel tempo
  // ---------------------------------------------------------------------
  // `oppStrength` è accettato per uniformità ma non usato: i conteggi flex sono match vinti/giocati, solo descrittivi.
  function core({ versions, matches, oppStrength } = {}) { // eslint-disable-line no-unused-vars
    const vs = (versions || []).slice().sort((x, y) => String(x.created_at || "").localeCompare(String(y.created_at || "")) || String(x.name || "").localeCompare(String(y.name || "")));
    const ms = matches || [];
    const nOf = new Map(vs.map((v) => [v.id, 0]));
    for (const m of ms) if (nOf.has(m.decklist_id)) nOf.set(m.decklist_id, nOf.get(m.decklist_id) + 1);
    const maps = new Map(vs.map((v) => [v.id, { main: textMap(v.maindeck), side: textMap(v.sideboard) }]));
    const active = vs.find((v) => v.is_active) || vs[vs.length - 1] || null;
    const played = vs.filter((v) => nOf.get(v.id) > 0);
    const basis = played.length ? played : vs;
    const wOf = (v) => (played.length ? nOf.get(v.id) : 1);
    const totW = basis.reduce((t, v) => t + wOf(v), 0) || 1;
    const spell = new Map();
    for (const v of vs) for (const z of ["main", "side"]) for (const [k, c] of maps.get(v.id)[z]) { if (!spell.has(k)) spell.set(k, new Map()); spell.get(k).set(c.name, (spell.get(k).get(c.name) || 0) + 1); }
    const nameOf = (k) => {
      if (active) { const am = maps.get(active.id); const c = am.main.get(k) || am.side.get(k); if (c) return c.name; }
      const sp = spell.get(k); let best = k, bn = -1; if (sp) for (const [nm, c] of sp) if (c > bn) { best = nm; bn = c; } return best;
    };
    const result = (m) => A.matchResult(m) === "W" ? 1 : 0;
    const coreOut = { main: [], side: [] }, flex = { main: [], side: [] };
    for (const z of ["main", "side"]) {
      const keys = new Set();
      for (const v of vs) for (const k of maps.get(v.id)[z].keys()) keys.add(k);
      for (const k of [...keys].sort()) {
        const qOf = (v) => (maps.get(v.id)[z].get(k) || { q: 0 }).q;
        const share = basis.reduce((t, v) => t + (qOf(v) > 0 ? wOf(v) : 0), 0) / totW;
        const aq = active ? qOf(active) : 0;
        let cq = 0;
        if (share >= 0.9 && aq > 0) cq = Math.min(aq, ...basis.filter((v) => qOf(v) > 0).map(qOf));
        if (cq > 0) coreOut[z].push({ key: k, name: nameOf(k), q: cq });
        const qs = vs.map(qOf);
        if (new Set(qs).size > 1) {
          let nW = 0, wW = 0, nO = 0, wO = 0;
          const vq = new Map(vs.map((v) => [v.id, qOf(v)]));
          for (const m of ms) {
            if (!vq.has(m.decklist_id)) continue;
            if (vq.get(m.decklist_id) > cq) { nW++; wW += result(m); } else { nO++; wO += result(m); }
          }
          flex[z].push({ key: k, name: nameOf(k), byVersion: vs.map((v) => ({ versionId: v.id, q: qOf(v) })), current: aq, core: cq, nWith: nW, winsWith: wW, nWithout: nO, winsWithout: wO });
        }
      }
      coreOut[z].sort((x, y) => y.q - x.q || x.name.localeCompare(y.name));
      flex[z].sort((x, y) => y.current - x.current || x.name.localeCompare(y.name));
    }
    const date = (v) => String(v.created_at || "").slice(0, 10) || null;
    const timeline = vs.map((v, i) => {
      const changes = [];
      if (i > 0) {
        const pv = maps.get(vs[i - 1].id), cv = maps.get(v.id);
        for (const z of ["main", "side"]) {
          const ks = new Set([...pv[z].keys(), ...cv[z].keys()]);
          for (const k of [...ks].sort()) {
            const from = (pv[z].get(k) || { q: 0 }).q, to = (cv[z].get(k) || { q: 0 }).q;
            if (from !== to) changes.push({ key: k, name: nameOf(k), zone: z, from, to });
          }
        }
      }
      return { versionId: v.id, name: v.name, date: date(v), n: nOf.get(v.id), changes };
    });
    return {
      versions: vs.map((v) => ({ id: v.id, name: v.name, date: date(v), n: nOf.get(v.id), active: !!(active && v.id === active.id) })),
      core: coreOut, flex, timeline,
    };
  }

  A.sbplan = { core, recommend, estimate, overview, groupArchIds, _K: K, _internal: { prep, archCtx, expectedOf, strengthOf } };
})();
