// ── MOTEUR FORCE-DIRECTED PARTAGÉ (V2.0) ─────────────────────────────────────
// Extrait iso-comportement d'ExplorerWorkspace (graphe Mémoire) pour être partagé
// avec l'Explorer des acteurs. Le moteur possède la MÉCANIQUE : positions, physique
// (répulsion N-body + ressorts + friction + gravité optionnelle), boucle d'animation
// (« settle » à énergie gâtée ou « continuous »), zoom/pan/drag/pin, hit-detection
// nœud/arête, fondu alpha optionnel, resize/DPR, thème.
//
// Le CLIENT garde tout le sens : il fournit `draw()` (rendu pixel-identique à son
// implémentation d'origine), `visible()` (règles métier), `seed()` (mise en place),
// les rayons de hit et les callbacks d'interaction. Deux configs : Mémoire
// (ExplorerWorkspace) et Acteurs (ActorsGraphCanvas). AUCUN couplage sémantique ici.
//
// Zéro dépendance. Hors React : les clients l'instancient dans leur useEffect.

export type Vec = { x: number; y: number; vx: number; vy: number; alpha: number }

export interface EngineView { k: number; tx: number; ty: number }

export interface EdgeRef { a: string; b: string }

export interface FrameInfo {
  P: Record<string, Vec>
  view: EngineView
  W: number
  H: number
  visible: Set<string>
  dragId: string | null
  hoverNode: string | null
  hoverEdgeIndex: number | null
}

export interface HoverInfo {
  kind: 'node' | 'edge'
  nodeId?: string
  edgeIndex?: number
  sx: number
  sy: number
}

export interface ForceGraphConfig {
  /** Ids des nœuds (l'ordre définit l'itération physique/rendu). */
  nodeIds(): string[]
  /** Extrémités des liens, index-stables. */
  edges(): EdgeRef[]
  /** Ensemble visible (règles métier du client). Défaut : tous. */
  visible?(): Set<string>
  /** Positionne les nœuds au (re)dimensionnement — le client décide de sa géographie
   *  (idempotent : ne repositionner que les nœuds manquants). Peut initialiser la vue. */
  seed(P: Record<string, Vec>, size: { W: number; H: number }, view: EngineView): void
  /** Rendu COMPLET du client (arêtes + nœuds + labels), transform déjà appliquée. */
  draw(ctx: CanvasRenderingContext2D, f: FrameInfo): void

  physics: {
    repulsion: number                       // ex. 4200 (Mémoire) / 5200 (Acteurs)
    spring: number                          // ex. 0.022 / 0.02
    rest(e: EdgeRef, index: number): number // ex. centre 150, sinon 105
    friction: number                        // ex. 0.8 / 0.82
    gravity?: number                        // rappel vers (0,0) monde — Acteurs
    bounds?: { padX: number; padTop: number; padBottom: number } // clamp écran — Mémoire
  }
  /** Fondu alpha à l'(in)visibilité — asymétrie Mémoire 0.12/0.14. null = alpha figé à 1. */
  fade: { in: number; out: number } | null
  /** « settle » : la physique ne vit que pendant un geste/kick puis s'arrête (Mémoire).
   *  « continuous » : boucle permanente (Acteurs V1). */
  loop: 'settle' | 'continuous'
  zoom: { min: number; max: number; factorIn: number; factorOut: number }
  dprCap?: number
  /** Replacement des nouveaux visibles près d'un voisin déjà posé (Mémoire). */
  placeNewNearNeighbors?: boolean

  /** Rayon de hit d'un nœud, en unités MONDE (k fourni pour les rayons écran-constants). */
  hitNodeRadius(id: string, k: number): number
  /** Hit des arêtes : tolérance monde + clamp du segment. null = arêtes non cliquables. */
  edgeHit: { tolerance(k: number): number; clampA: number; clampB: number } | null
  /** Nœuds dont alpha < ce seuil sont transparents aux gestes (Mémoire : 0.5). */
  hitAlphaGate?: number

  features: {
    pin: boolean
    dblClick: boolean
    /** Un clic (sans déplacement) tombant sur une arête déclenche onTapEdge au lieu
     *  d'onTapVoid. false = comportement Mémoire historique (arête ≡ vide). */
    edgeTap?: boolean
    /** Active le pinch-to-zoom deux doigts (mobile). Requiert touchAction:'none' sur le wrapper. */
    pinchZoom?: boolean
  }

  onTapNode?(id: string): void
  /** Appui long (~500 ms) sur un nœud sans déplacement — mobile. Le tap n'est
   *  PAS émis ensuite : le geste long consomme l'interaction. */
  onLongPressNode?(id: string): void
  /** Délai de l'appui long en ms (défaut 500). */
  longPressMs?: number
  onTapEdge?(index: number): void
  /** Clic dans le vide sans déplacement. wasPan = un pan était engagé. */
  onTapVoid?(wasPan: boolean): void
  onDblClickNode?(id: string): void
  onHover?(h: HoverInfo | null): void
  /** Le thème a changé (data-theme) — redessiner. */
  watchTheme?: boolean
}

export interface ForceGraphEngine {
  P: Record<string, Vec>
  view: EngineView
  pinned: Set<string>
  hoverNode: string | null
  hoverEdgeIndex: number | null
  size(): { W: number; H: number }
  kick(ms?: number): void
  redraw(): void
  /** Replace les nouveaux visibles + relance (après changement de contexte client). */
  refreshVisibility(): void
  /** Pose SYNCHRONE du layout : itère la physique sans dessiner (alphas des
   *  visibles forcés à 1), puis un seul draw. Le graphe apparaît déjà posé —
   *  aucun drift visible, aucun recentrage ultérieur nécessaire. */
  settleSync(iterations?: number): void
  toWorld(sx: number, sy: number): { x: number; y: number }
  destroy(): void
}

/** Distance point→segment (clampée) — utilisée par le hit d'arête. Pure, testable. */
export function distToSegment(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
  clampA = 0, clampB = 1,
): number {
  const L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1
  let t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / L2
  t = Math.max(clampA, Math.min(clampB, t))
  return Math.hypot(ax + t * (bx - ax) - px, ay + t * (by - ay) - py)
}

/** Zoom centré sur un point écran (formule commune Mémoire/Acteurs). Pure, testable. */
export function zoomAt(view: EngineView, sx: number, sy: number, nextK: number): EngineView {
  const wx = (sx - view.tx) / view.k
  const wy = (sy - view.ty) / view.k
  return { k: nextK, tx: sx - wx * nextK, ty: sy - wy * nextK }
}

export function createForceGraphEngine(
  canvas: HTMLCanvasElement,
  wrap: HTMLElement,
  cfg: ForceGraphConfig,
): ForceGraphEngine {
  const ctx = canvas.getContext('2d')!
  const P: Record<string, Vec> = {}
  const view: EngineView = { k: 1, tx: 0, ty: 0 }
  const pinned = new Set<string>()
  let W = 0, H = 0
  let dragId: string | null = null
  let hoverNode: string | null = null
  let hoverEdgeIndex: number | null = null
  let simUntil = 0
  let running = false
  let destroyed = false

  const visibleSet = () => cfg.visible?.() ?? new Set(cfg.nodeIds())
  const gate = cfg.hitAlphaGate ?? 0

  function placeNew() {
    if (!cfg.placeNewNearNeighbors) return
    // Adjacence recalculée à la volée (peu coûteux vs cohérence garantie).
    const adj: Record<string, string[]> = {}
    for (const e of cfg.edges()) { (adj[e.a] ??= []).push(e.b); (adj[e.b] ??= []).push(e.a) }
    for (const id of visibleSet()) {
      const p = P[id]
      if (p && p.alpha < 0.05) {
        const nb = (adj[id] ?? []).find((m) => P[m] && P[m].alpha > 0.5)
        if (nb) { p.x = P[nb].x + (Math.random() - 0.5) * 90; p.y = P[nb].y + (Math.random() - 0.5) * 90; p.vx = 0; p.vy = 0 }
      }
    }
  }

  function kick(ms = 900) {
    simUntil = Math.max(simUntil, performance.now() + ms)
    if (!running) { running = true; requestAnimationFrame(step) }
  }

  // Un pas de physique pur (répulsion + ressorts + intégration), sans fade ni
  // draw — partagé entre la boucle animée (step) et la pose synchrone (settleSync).
  function integrate(vis: Set<string>, ids: string[]): number {
    let energy = 0
    // Répulsion N-body entre visibles.
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const A = P[ids[i]], B = P[ids[j]]; if (!A || !B) continue
      let dx = B.x - A.x, dy = B.y - A.y
      let d2 = dx * dx + dy * dy
      if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.5 }
      const d = Math.sqrt(d2)
      const f = cfg.physics.repulsion / d2, fx = (f * dx) / d, fy = (f * dy) / d
      A.vx -= fx; A.vy -= fy; B.vx += fx; B.vy += fy
    }
    // Ressorts le long des liens visibles.
    cfg.edges().forEach((e, i) => {
      if (!vis.has(e.a) || !vis.has(e.b)) return
      const A = P[e.a], B = P[e.b]; if (!A || !B) return
      const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1
      const f = cfg.physics.spring * (d - cfg.physics.rest(e, i))
      const fx = (f * dx) / d, fy = (f * dy) / d
      A.vx += fx; A.vy += fy; B.vx -= fx; B.vy -= fy
    })
    // Intégration + friction + gravité/bornes optionnelles.
    for (const id of ids) {
      const p = P[id]; if (!p) continue
      if (id === dragId || pinned.has(id)) { p.vx = 0; p.vy = 0; continue }
      if (cfg.physics.gravity) { p.vx += -p.x * cfg.physics.gravity; p.vy += -p.y * cfg.physics.gravity }
      p.vx *= cfg.physics.friction; p.vy *= cfg.physics.friction
      p.x += p.vx; p.y += p.vy
      const b = cfg.physics.bounds
      if (b) { p.x = Math.max(b.padX, Math.min(W - b.padX, p.x)); p.y = Math.max(b.padTop, Math.min(H - b.padBottom, p.y)) }
      energy += Math.abs(p.vx) + Math.abs(p.vy)
    }
    return energy
  }

  function step() {
    if (destroyed) return
    const vis = visibleSet()
    const ids = [...vis]
    const allIds = cfg.nodeIds()
    if (cfg.fade) {
      for (const id of ids) { const p = P[id]; if (p) p.alpha += (1 - p.alpha) * cfg.fade.in }
      for (const id of allIds) if (!vis.has(id)) { const p = P[id]; if (p) p.alpha += (0 - p.alpha) * cfg.fade.out }
    }
    const energy = integrate(vis, ids)
    draw()
    if (cfg.loop === 'continuous') { requestAnimationFrame(step); return }
    const fading = !!cfg.fade && allIds.some((id) => { const a = P[id]?.alpha ?? 0; return a > 0.02 && a < 0.98 })
    const alive = dragId || fading || (performance.now() < simUntil && energy > 0.25)
    if (alive) requestAnimationFrame(step); else running = false
  }

  function settleSync(iterations = 240) {
    const vis = visibleSet()
    for (const id of cfg.nodeIds()) { const p = P[id]; if (p) p.alpha = vis.has(id) ? 1 : 0 }
    const ids = [...vis]
    for (let i = 0; i < iterations; i++) {
      if (integrate(vis, ids) < 0.25) break
    }
    draw()
  }

  function draw() {
    ctx.clearRect(0, 0, W, H)
    ctx.save(); ctx.translate(view.tx, view.ty); ctx.scale(view.k, view.k)
    cfg.draw(ctx, { P, view, W, H, visible: visibleSet(), dragId, hoverNode, hoverEdgeIndex })
    ctx.restore()
  }

  const toWorld = (sx: number, sy: number) => ({ x: (sx - view.tx) / view.k, y: (sy - view.ty) / view.k })

  function hitNode(x: number, y: number): string | null {
    let best: string | null = null, bd = 1e9
    for (const id of cfg.nodeIds()) {
      const p = P[id]; if (!p) continue
      if (cfg.fade && p.alpha < gate) continue
      const d = Math.hypot(p.x - x, p.y - y)
      if (d < cfg.hitNodeRadius(id, view.k) && d < bd) { bd = d; best = id }
    }
    return best
  }

  function hitEdge(x: number, y: number): number | null {
    const eh = cfg.edgeHit
    if (!eh) return null
    let best = -1, bd = eh.tolerance(view.k)
    cfg.edges().forEach((e, i) => {
      const A = P[e.a], B = P[e.b]; if (!A || !B) return
      if (cfg.fade && Math.min(A.alpha, B.alpha) < gate) return
      const d = distToSegment(x, y, A.x, A.y, B.x, B.y, eh.clampA, eh.clampB)
      if (d < bd) { bd = d; best = i }
    })
    return best >= 0 ? best : null
  }

  function resize() {
    const dpr = Math.min(cfg.dprCap ?? Infinity, devicePixelRatio || 1)
    W = wrap.clientWidth; H = wrap.clientHeight
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    cfg.seed(P, { W, H }, view)
    kick()
  }

  // ── Gestes (seuil 5 px commun aux deux graphes d'origine) ──────────────────
  let downAt: { x: number; y: number } | null = null, moved = false
  let panning = false, panFrom = { tx: 0, ty: 0 }
  // Appui long : armé au pointerdown sur un nœud, annulé au moindre déplacement,
  // au relâchement ou à l'entrée en pinch. S'il aboutit, le tap n'est pas émis.
  let longPressTimer: ReturnType<typeof setTimeout> | null = null
  const cancelLongPress = () => {
    if (longPressTimer !== null) { clearTimeout(longPressTimer); longPressTimer = null }
  }
  // Pinch-to-zoom (actif uniquement si cfg.features.pinchZoom)
  const activePointers = new Map<number, { x: number; y: number }>()
  let pinching = false, pinchStartDist = 1, pinchStartK = 1

  const onDown = (ev: PointerEvent) => {
    const r = canvas.getBoundingClientRect(), sx = ev.clientX - r.left, sy = ev.clientY - r.top
    canvas.setPointerCapture(ev.pointerId)
    if (cfg.features.pinchZoom) {
      activePointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
      if (activePointers.size >= 2) {
        cancelLongPress()
        dragId = null; panning = false; moved = true
        const pts = [...activePointers.values()]
        pinchStartDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1
        pinchStartK = view.k; pinching = true
        return
      }
    }
    const { x, y } = toWorld(sx, sy)
    const id = hitNode(x, y); downAt = { x: sx, y: sy }; moved = false
    if (id) { dragId = id; canvas.style.cursor = 'grabbing' }
    else { panning = true; panFrom = { tx: view.tx, ty: view.ty }; canvas.style.cursor = 'grabbing' }
    if (id && cfg.onLongPressNode) {
      cancelLongPress()
      const pressedId = id
      longPressTimer = setTimeout(() => {
        longPressTimer = null
        if (dragId === pressedId && !moved && !pinching) {
          dragId = null
          canvas.style.cursor = 'grab'
          cfg.onLongPressNode!(pressedId)
          kick()
        }
      }, cfg.longPressMs ?? 500)
    }
    kick()
  }
  const onMove = (ev: PointerEvent) => {
    const r = canvas.getBoundingClientRect(), sx = ev.clientX - r.left, sy = ev.clientY - r.top
    if (cfg.features.pinchZoom) {
      activePointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
      if (pinching && activePointers.size >= 2) {
        const pts = [...activePointers.values()]
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1
        const cx = (pts[0].x + pts[1].x) / 2 - r.left
        const cy = (pts[0].y + pts[1].y) / 2 - r.top
        const nextK = Math.max(cfg.zoom.min, Math.min(cfg.zoom.max, pinchStartK * dist / pinchStartDist))
        const v = zoomAt(view, cx, cy, nextK)
        view.k = v.k; view.tx = v.tx; view.ty = v.ty
        draw(); return
      }
    }
    if (dragId) {
      if (downAt && Math.hypot(sx - downAt.x, sy - downAt.y) > 5) { moved = true; cancelLongPress() }
      const w = toWorld(sx, sy); const p = P[dragId]
      if (p) { p.x = w.x; p.y = w.y; p.vx = 0; p.vy = 0 }
      kick(); return
    }
    if (panning) {
      if (downAt && Math.hypot(sx - downAt.x, sy - downAt.y) > 5) moved = true
      view.tx = panFrom.tx + (sx - downAt!.x); view.ty = panFrom.ty + (sy - downAt!.y)
      draw(); return
    }
    const { x, y } = toWorld(sx, sy)
    const n = hitNode(x, y)
    const e = n ? null : hitEdge(x, y)
    const changed = n !== hoverNode || e !== hoverEdgeIndex
    hoverNode = n; hoverEdgeIndex = e
    if (changed) draw()
    canvas.style.cursor = n || e !== null ? 'pointer' : 'grab'
    if (n) cfg.onHover?.({ kind: 'node', nodeId: n, sx, sy })
    else if (e !== null) cfg.onHover?.({ kind: 'edge', edgeIndex: e, sx, sy })
    else cfg.onHover?.(null)
  }
  const onUp = (ev: PointerEvent) => {
    cancelLongPress()
    if (cfg.features.pinchZoom) {
      activePointers.delete(ev.pointerId)
      if (pinching) {
        if (activePointers.size < 2) pinching = false
        try { canvas.releasePointerCapture(ev.pointerId) } catch { /* noop */ }
        kick(); return
      }
    }
    const r = canvas.getBoundingClientRect()
    const { x, y } = toWorld(ev.clientX - r.left, ev.clientY - r.top)
    const id = dragId; dragId = null
    const wasPan = panning; panning = false
    canvas.style.cursor = id ? 'pointer' : 'grab'
    if (id && moved && cfg.features.pin) pinned.add(id)
    if (id && !moved) cfg.onTapNode?.(id)
    else if (wasPan && !moved) {
      // Clic sans déplacement dans le vide — ou sur une arête si edgeTap est actif.
      const e = cfg.features.edgeTap ? hitEdge(x, y) : null
      if (e !== null) { cfg.onTapEdge?.(e); kick(); try { canvas.releasePointerCapture(ev.pointerId) } catch { /* noop */ } return }
      hoverNode = null; hoverEdgeIndex = null; cfg.onHover?.(null); cfg.onTapVoid?.(true)
    }
    kick()
    try { canvas.releasePointerCapture(ev.pointerId) } catch { /* noop */ }
  }
  const onDbl = (ev: MouseEvent) => {
    if (!cfg.features.dblClick) return
    const r = canvas.getBoundingClientRect()
    const { x, y } = toWorld(ev.clientX - r.left, ev.clientY - r.top)
    const id = hitNode(x, y); if (!id) return
    cfg.onDblClickNode?.(id)
  }
  const onWheel = (ev: WheelEvent) => {
    ev.preventDefault()
    const r = canvas.getBoundingClientRect(), sx = ev.clientX - r.left, sy = ev.clientY - r.top
    const nextK = Math.max(cfg.zoom.min, Math.min(cfg.zoom.max, view.k * (ev.deltaY < 0 ? cfg.zoom.factorIn : cfg.zoom.factorOut)))
    const v = zoomAt(view, sx, sy, nextK)
    view.k = v.k; view.tx = v.tx; view.ty = v.ty
    draw()
  }
  const onLeave = () => { hoverNode = null; hoverEdgeIndex = null; cfg.onHover?.(null); draw() }

  resize()
  const ro = new ResizeObserver(resize); ro.observe(wrap)
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('dblclick', onDbl)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('pointerleave', onLeave)
  const mo = cfg.watchTheme
    ? new MutationObserver(() => draw())
    : null
  mo?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  if (cfg.loop === 'continuous') kick(1e12) // boucle permanente

  return {
    P, view, pinned,
    get hoverNode() { return hoverNode },
    get hoverEdgeIndex() { return hoverEdgeIndex },
    size: () => ({ W, H }),
    kick,
    redraw: draw,
    refreshVisibility: () => { placeNew(); kick(700) },
    settleSync,
    toWorld,
    destroy() {
      destroyed = true
      cancelLongPress()
      ro.disconnect(); mo?.disconnect()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('dblclick', onDbl)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointerleave', onLeave)
    },
  }
}
