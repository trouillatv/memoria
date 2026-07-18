'use client'

// ── ONGLET « EXPLORER » — la mémoire du chantier, en carte ───────────────────
// Cadrage 2026-07-18 : une seule mémoire, deux lectures. La Mémoire répond à
// « qu'est-ce que MemorIA sait ? » ; Explorer répond à « comment tout est
// relié ? ». Mêmes données (read model site-graph), autre regard.
//
// Le langage validé sur 7 versions de prototype, porté EN ENTIER :
//   · figé par défaut — la physique ne vit que pendant un geste, puis s'arrête ;
//   · un nœud posé RESTE posé (« Réorganiser » libère tout) ;
//   · pointeur = cliquer/ouvrir · main = déplacer · molette = zoom ·
//     double-clic = recentrer · clic dans le vide = retour ;
//   · Isoler / Étendre — l'histoire se construit progressivement ;
//   · ⚠ Aujourd'hui — TROIS choses qui méritent l'attention, le reste plié ;
//   · 🎙️ Résumé de 20 secondes · 🔍 Voir les conséquences · « Si X
//     disparaissait… » — générés depuis les DONNÉES, jamais écrits à la main
//     (règle : rien d'affiché sans preuve) ;
//   · ▶ Rejouer cette histoire — les nœuds apparaissent à leur vraie date ;
//   · les VRAIES photos dans la fiche, plein écran au clic.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { SiteGraph, GraphEdge, GraphNode, GraphNodeType } from '@/lib/knowledge/site-graph'
import { cn } from '@/lib/utils'

const COLOR: Record<GraphNodeType, string> = {
  site: '#1C1B22', visite: '#0369A1', photo: '#D97706', memo: '#0F766E',
  action: '#059669', ech: '#C2410C', dec: '#4338CA', vigilance: '#BE123C',
  acteur: '#7C3AED', know: '#A16207',
}
const COLOR_DARK: Record<GraphNodeType, string> = {
  site: '#F0EDF6', visite: '#38BDF8', photo: '#FBBF24', memo: '#2DD4BF',
  action: '#34D399', ech: '#FB923C', dec: '#818CF8', vigilance: '#FDA4AF',
  acteur: '#A78BFA', know: '#FACC15',
}
const TYPE_LABEL: Record<GraphNodeType, string> = {
  site: 'Chantier', visite: 'Visite', photo: 'Photos', memo: 'Observation',
  action: 'Action', ech: 'Échéance', dec: 'Décision', vigilance: 'Vigilance',
  acteur: 'Intervenant', know: 'À savoir',
}
const SIZE: Record<GraphNodeType, number> = {
  site: 26, visite: 19, photo: 15, memo: 14, action: 12, ech: 12, dec: 12,
  vigilance: 12, acteur: 15, know: 12,
}
// Les PREUVES : elles racontent un moment, pas la structure. À l'échelle du
// chantier elles noieraient la carte (les 218 photos de Petro Atiti) — elles
// n'apparaissent qu'à côté de l'objet exploré qui les contient, ou dépliées.
const PROOF = new Set<GraphNodeType>(['photo', 'memo'])
// La vue globale du chantier ne montre par défaut que la STRUCTURE (décision
// Vincent 2026-07-18) : visites, actions, décisions, intervenants. Le reste
// se déplie depuis la légende.
const GLOBAL_DEFAULT = new Set<GraphNodeType>(['visite', 'action', 'dec', 'acteur'])

type P = { x: number; y: number; vx: number; vy: number; alpha: number }
type PanelMode = 'fiche' | 'recit' | 'gaps'

const dayFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Pacific/Noumea', day: 'numeric', month: 'long' })
const frDay = (iso: string | null | undefined) => (iso ? dayFmt.format(new Date(iso)) : null)

export function ExplorerWorkspace({ graph }: { graph: SiteGraph }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const cvRef = useRef<HTMLCanvasElement>(null)
  const [center, setCenter] = useState('site')
  const [trail, setTrail] = useState<string[]>(['site'])
  const [tip, setTip] = useState<{ x: number; y: number; html: string } | null>(null)
  const [depth, setDepth] = useState<1 | 2>(2)
  const [enquete, setEnquete] = useState<{ root: string; set: string[] } | null>(null)
  const [timeIdx, setTimeIdx] = useState<number | null>(null)
  const [panelMode, setPanelMode] = useState<PanelMode>('fiche')
  const [gapsOpen, setGapsOpen] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  // La légende n'est pas une légende : c'est le panneau de contrôle de
  // l'exploration (arbitrage 2026-07-18) — masquer, mettre en évidence, compter.
  const [hidden, setHidden] = useState<ReadonlySet<GraphNodeType>>(new Set())
  // Niveau de détail (arbitrage 2026-07-18, 2e volet) : le niveau de détail
  // dépend du point d'entrée — comme une carte, on ne voit pas les rues à
  // l'échelle du pays. `revealed` = preuves dépliées à la demande ; il se
  // réinitialise à chaque déplacement (le dépliage est contextuel).
  const [revealed, setRevealed] = useState<ReadonlySet<GraphNodeType>>(new Set())

  const nodeById = useMemo(() => Object.fromEntries(graph.nodes.map((n) => [n.id, n])), [graph])
  const neigh = useMemo(() => {
    const m: Record<string, Set<string>> = {}
    for (const e of graph.edges) {
      ;(m[e.a] ??= new Set()).add(e.b)
      ;(m[e.b] ??= new Set()).add(e.a)
    }
    return m
  }, [graph])

  // Les jours réels de la mémoire — l'axe du replay. Sans au moins deux dates,
  // il n'y a pas d'histoire à rejouer : la barre ne s'affiche pas.
  const days = useMemo(() => {
    const s = new Set<string>()
    for (const n of graph.nodes) if (n.t) s.add(n.t.slice(0, 10))
    return [...s].sort()
  }, [graph])
  const timeMax = timeIdx === null ? null : days[timeIdx] ?? null

  const gaps = useMemo(() => computeGaps(graph, neigh), [graph, neigh])

  // Les compteurs de la légende comptent le CONTEXTE EXPLORÉ (même règle de
  // visibilité que le canvas), pas tout le chantier — « les 12 photos de cette
  // visite, pas les 218 du chantier ».
  const contextCounts = useMemo(() => {
    let s: Set<string>
    if (enquete) s = new Set(enquete.set)
    else {
      s = new Set([center])
      for (const n of neigh[center] ?? []) s.add(n)
      if (depth === 2) for (const n of [...s]) for (const m of neigh[n] ?? []) s.add(m)
    }
    if (timeMax) for (const id of [...s]) {
      const t = nodeById[id]?.t
      if (t && t.slice(0, 10) > timeMax) s.delete(id)
    }
    const counts = {} as Record<GraphNodeType, number>
    for (const id of s) {
      const nd = nodeById[id]
      if (nd && nd.type !== 'site') counts[nd.type] = (counts[nd.type] ?? 0) + (nd.count ?? 1)
    }
    return counts
  }, [center, depth, enquete, timeMax, neigh, nodeById])

  // ── Le moteur canvas vit hors de React. ──
  const engine = useRef<{
    P: Record<string, P>; pinned: Set<string>
    view: { k: number; tx: number; ty: number }
    dragId: string | null; hoverNode: string | null; hoverEdge: GraphEdge | null
    simUntil: number; running: boolean
    center: string; depth: 1 | 2; enqueteSet: Set<string> | null; timeMax: string | null
    hiddenTypes: ReadonlySet<GraphNodeType>; revealedTypes: ReadonlySet<GraphNodeType>; hlType: GraphNodeType | null
    doSelect?: (id: string) => void; refreshVis?: () => void; reset?: () => void; redraw?: () => void
  }>({ P: {}, pinned: new Set(), view: { k: 1, tx: 0, ty: 0 }, dragId: null, hoverNode: null, hoverEdge: null, simUntil: 0, running: false, center: 'site', depth: 2, enqueteSet: null, timeMax: null, hiddenTypes: new Set(), revealedTypes: new Set(), hlType: null })

  useEffect(() => { engine.current.center = center }, [center])
  useEffect(() => {
    engine.current.depth = depth
    engine.current.enqueteSet = enquete ? new Set(enquete.set) : null
    engine.current.timeMax = timeMax
    engine.current.hiddenTypes = hidden
    engine.current.revealedTypes = revealed
    engine.current.refreshVis?.()
  }, [depth, enquete, timeMax, hidden, revealed])

  useEffect(() => {
    const wrap = wrapRef.current!, cv = cvRef.current!, ctx = cv.getContext('2d')!
    const E = engine.current
    const dark = () => document.documentElement.dataset.theme === 'dark'
      || (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)
    const col = (t: GraphNodeType) => (dark() ? COLOR_DARK : COLOR)[t]
    let W = 0, H = 0

    const visible = () => {
      let s: Set<string>
      if (E.enqueteSet) s = new Set(E.enqueteSet)
      else {
        s = new Set([E.center])
        for (const n of neigh[E.center] ?? []) s.add(n)
        if (E.depth === 2) for (const n of [...s]) for (const m of neigh[n] ?? []) s.add(m)
      }
      if (E.timeMax) for (const id of [...s]) {
        const t = nodeById[id]?.t
        if (t && t.slice(0, 10) > E.timeMax) s.delete(id)
      }
      // Niveau de détail adapté au point d'entrée : au niveau chantier, seule
      // la structure (GLOBAL_DEFAULT) ; ailleurs, une preuve n'est visible que
      // si elle entoure directement l'objet exploré. Déplié ou enquête = tout.
      if (!E.enqueteSet) {
        const near = neigh[E.center] ?? new Set()
        for (const id of [...s]) {
          const ty = nodeById[id]?.type
          if (!ty || ty === 'site' || id === E.center || E.revealedTypes.has(ty)) continue
          if (E.center === 'site') { if (!GLOBAL_DEFAULT.has(ty)) s.delete(id) }
          else if (PROOF.has(ty) && !near.has(id)) s.delete(id)
        }
      }
      if (E.hiddenTypes.size) for (const id of [...s]) {
        const ty = nodeById[id]?.type
        if (ty && ty !== 'site' && id !== E.center && E.hiddenTypes.has(ty)) s.delete(id)
      }
      return s
    }
    const toWorld = (x: number, y: number) => ({ x: (x - E.view.tx) / E.view.k, y: (y - E.view.ty) / E.view.k })

    function seed() {
      const ring = [...(neigh[E.center] ?? [])]
      E.P[E.center] ??= { x: W / 2, y: H / 2, vx: 0, vy: 0, alpha: 0 }
      ring.forEach((id, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, ring.length)
        E.P[id] ??= { x: W / 2 + 130 * Math.cos(a), y: H / 2 + 130 * Math.sin(a), vx: 0, vy: 0, alpha: 0 }
      })
      for (const n of graph.nodes) E.P[n.id] ??= { x: W / 2 + (Math.random() - 0.5) * 280, y: H / 2 + (Math.random() - 0.5) * 280, vx: 0, vy: 0, alpha: 0 }
    }
    function placeNew() {
      for (const id of visible()) {
        const p = E.P[id]
        if (p && p.alpha < 0.05) {
          const nb = [...(neigh[id] ?? [])].find((m) => E.P[m] && E.P[m].alpha > 0.5)
          if (nb) { p.x = E.P[nb].x + (Math.random() - 0.5) * 90; p.y = E.P[nb].y + (Math.random() - 0.5) * 90; p.vx = 0; p.vy = 0 }
        }
      }
    }
    function kick(ms = 900) {
      E.simUntil = Math.max(E.simUntil, performance.now() + ms)
      if (!E.running) { E.running = true; requestAnimationFrame(step) }
    }
    function step() {
      const vis = visible(), ids = [...vis]
      let energy = 0
      for (const id of ids) { const p = E.P[id]; if (p) p.alpha += (1 - p.alpha) * 0.12 }
      for (const n of graph.nodes) if (!vis.has(n.id)) { const p = E.P[n.id]; if (p) p.alpha += (0 - p.alpha) * 0.14 }
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const A = E.P[ids[i]], B = E.P[ids[j]]; if (!A || !B) continue
        const dx = B.x - A.x, dy = B.y - A.y, d2 = dx * dx + dy * dy || 1, d = Math.sqrt(d2)
        const f = 4200 / d2, fx = (f * dx) / d, fy = (f * dy) / d
        A.vx -= fx; A.vy -= fy; B.vx += fx; B.vy += fy
      }
      for (const e of graph.edges) {
        if (!vis.has(e.a) || !vis.has(e.b)) continue
        const A = E.P[e.a], B = E.P[e.b]; if (!A || !B) continue
        const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1
        const rest = e.a === E.center || e.b === E.center ? 150 : 105
        const f = 0.022 * (d - rest), fx = (f * dx) / d, fy = (f * dy) / d
        A.vx += fx; A.vy += fy; B.vx -= fx; B.vy -= fy
      }
      for (const id of ids) {
        const p = E.P[id]; if (!p) continue
        if (id === E.dragId || E.pinned.has(id)) { p.vx = 0; p.vy = 0; continue }
        p.vx *= 0.8; p.vy *= 0.8; p.x += p.vx; p.y += p.vy
        p.x = Math.max(30, Math.min(W - 30, p.x)); p.y = Math.max(34, Math.min(H - 40, p.y))
        energy += Math.abs(p.vx) + Math.abs(p.vy)
      }
      draw()
      const fading = graph.nodes.some((n) => { const a = E.P[n.id]?.alpha ?? 0; return a > 0.02 && a < 0.98 })
      const alive = E.dragId || fading || (performance.now() < E.simUntil && energy > 0.25)
      if (alive) requestAnimationFrame(step); else E.running = false
    }
    function labelVisible(id: string) {
      if (E.enqueteSet) return true
      return id === E.center || id === E.hoverNode || (neigh[E.center] ?? new Set()).has(id)
    }
    function draw() {
      ctx.clearRect(0, 0, W, H)
      ctx.save(); ctx.translate(E.view.tx, E.view.ty); ctx.scale(E.view.k, E.view.k)
      const surface = dark() ? '#1E1A25' : '#FFFFFF'
      const inkC = dark() ? '#F0EDF6' : '#1C1B22'
      const mutedC = dark() ? '#A49DB3' : '#6B6577'
      const grabbed = E.dragId || E.hoverNode
      const grabSet = grabbed ? new Set([grabbed, ...(neigh[grabbed] ?? [])]) : null
      const soft = !E.dragId && E.hoverNode
      const hl = E.hlType // survol de la légende : halo léger, jamais un clignotement
      for (const e of graph.edges) {
        const A = E.P[e.a], B = E.P[e.b]; if (!A || !B) continue
        const al = Math.min(A.alpha, B.alpha); if (al < 0.02) continue
        const touch = grabbed && (e.a === grabbed || e.b === grabbed)
        const active = e === E.hoverEdge || e.a === E.center || e.b === E.center
        ctx.strokeStyle = col(e.type)
        ctx.globalAlpha = al * (touch ? 0.95 : grabbed ? (soft ? 0.18 : 0.12) : e === E.hoverEdge ? 1 : active ? 0.8 : 0.3)
        ctx.lineWidth = e === E.hoverEdge || touch ? 2.5 : 1.4
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke()
      }
      for (const n of graph.nodes) {
        const p = E.P[n.id]; if (!p || p.alpha < 0.02) continue
        const r = (n.id === E.center ? SIZE[n.type] + 6 : SIZE[n.type]) + (hl === n.type ? 2 : 0)
        ctx.globalAlpha = p.alpha
          * (grabSet && !grabSet.has(n.id) ? (soft ? 0.4 : 0.22) : 1)
          * (hl && hl !== n.type ? 0.45 : 1)
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7)
        ctx.fillStyle = surface; ctx.fill()
        ctx.lineWidth = (n.id === E.center ? 3.5 : n.id === E.hoverNode ? 3 : 2.2) + (hl === n.type ? 1 : 0)
        ctx.strokeStyle = col(n.type); ctx.stroke()
        if (n.count) {
          ctx.beginPath(); ctx.arc(p.x + r * 0.8, p.y - r * 0.8, 9, 0, 7)
          ctx.fillStyle = col(n.type); ctx.fill()
          ctx.fillStyle = surface; ctx.font = '700 10px system-ui'
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
          ctx.fillText(String(n.count), p.x + r * 0.8, p.y - r * 0.8)
        }
        if (labelVisible(n.id)) {
          ctx.fillStyle = n.id === E.center ? inkC : mutedC
          ctx.font = (n.id === E.center ? '600 13' : '500 11.5') + 'px system-ui'
          ctx.textAlign = 'center'; ctx.textBaseline = 'top'
          const words = n.label.split(' '), lines: string[] = []; let cur = ''
          for (const w of words) { if ((cur + ' ' + w).trim().length > 18) { lines.push(cur.trim()); cur = w } else cur += ' ' + w }
          lines.push(cur.trim())
          lines.slice(0, 2).forEach((l, i) => ctx.fillText(lines.length > 2 && i === 1 ? l + '…' : l, p.x, p.y + r + 4 + i * 13))
        }
      }
      ctx.globalAlpha = 1; ctx.restore()
    }
    function hitNode(x: number, y: number) {
      let best: string | null = null, bd = 1e9
      for (const n of graph.nodes) {
        const p = E.P[n.id]; if (!p || p.alpha < 0.5) continue
        const d = Math.hypot(p.x - x, p.y - y)
        if (d < Math.max(24, SIZE[n.type] + 10) && d < bd) { bd = d; best = n.id }
      }
      return best
    }
    function hitEdge(x: number, y: number) {
      let best: GraphEdge | null = null, bd = 8
      for (const e of graph.edges) {
        const A = E.P[e.a], B = E.P[e.b]; if (!A || !B || Math.min(A.alpha, B.alpha) < 0.5) continue
        const L2 = (B.x - A.x) ** 2 + (B.y - A.y) ** 2 || 1
        let t = ((x - A.x) * (B.x - A.x) + (y - A.y) * (B.y - A.y)) / L2
        t = Math.max(0.08, Math.min(0.92, t))
        const d = Math.hypot(A.x + t * (B.x - A.x) - x, A.y + t * (B.y - A.y) - y)
        if (d < bd) { bd = d; best = e }
      }
      return best
    }

    function resize() {
      const dpr = devicePixelRatio || 1
      W = wrap.clientWidth; H = wrap.clientHeight
      cv.width = W * dpr; cv.height = H * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      seed(); kick()
    }

    let downAt: { x: number; y: number } | null = null, moved = false
    let panning = false, panFrom = { tx: 0, ty: 0 }
    const onDown = (ev: PointerEvent) => {
      const r = cv.getBoundingClientRect(), sx = ev.clientX - r.left, sy = ev.clientY - r.top
      const { x, y } = toWorld(sx, sy)
      const id = hitNode(x, y); downAt = { x: sx, y: sy }; moved = false
      cv.setPointerCapture(ev.pointerId)
      if (id) { E.dragId = id; cv.style.cursor = 'grabbing' }
      else { panning = true; panFrom = { tx: E.view.tx, ty: E.view.ty }; cv.style.cursor = 'grabbing' }
      kick()
    }
    const onMove = (ev: PointerEvent) => {
      const r = cv.getBoundingClientRect(), sx = ev.clientX - r.left, sy = ev.clientY - r.top
      if (E.dragId) {
        if (downAt && Math.hypot(sx - downAt.x, sy - downAt.y) > 5) moved = true
        const w = toWorld(sx, sy); const p = E.P[E.dragId]
        if (p) { p.x = w.x; p.y = w.y }
        kick(); return
      }
      if (panning) {
        if (downAt && Math.hypot(sx - downAt.x, sy - downAt.y) > 5) moved = true
        E.view.tx = panFrom.tx + (sx - downAt!.x); E.view.ty = panFrom.ty + (sy - downAt!.y)
        draw(); return
      }
      const { x, y } = toWorld(sx, sy)
      const n = hitNode(x, y)
      E.hoverEdge = n ? null : hitEdge(x, y)
      if (n !== E.hoverNode) { E.hoverNode = n; draw() } else if (E.hoverEdge) draw()
      cv.style.cursor = n ? 'pointer' : E.hoverEdge ? 'pointer' : 'grab'
      if (n) {
        const nd = nodeById[n]
        setTip({ x: sx, y: sy, html: `<b>${esc(nd.label)}${nd.count ? ` (${nd.count})` : ''}</b><span>${TYPE_LABEL[nd.type]}${nd.sub ? ' · ' + esc(nd.sub) : ''}</span>` })
      } else if (E.hoverEdge) {
        const e = E.hoverEdge
        setTip({ x: sx, y: sy, html: `<b>${esc(nodeById[e.a].label)} ⟷ ${esc(nodeById[e.b].label)}</b><span>${esc(e.why)}${e.date ? ' · ' + esc(e.date) : ''}</span>` })
      } else setTip(null)
    }
    const onUp = (ev: PointerEvent) => {
      const r = cv.getBoundingClientRect()
      const { x, y } = toWorld(ev.clientX - r.left, ev.clientY - r.top)
      const id = E.dragId; E.dragId = null
      const wasPan = panning; panning = false
      cv.style.cursor = id ? 'pointer' : 'grab'
      if (id && moved) E.pinned.add(id)
      if (id && !moved && id !== E.center) select(id)
      else if (!id && !wasPan && !moved) { const e = hitEdge(x, y); if (e) select(e.a === E.center ? e.b : e.a) }
      else if (wasPan && !moved) {
        E.hoverNode = null; E.hoverEdge = null; setTip(null)
        if (E.center !== 'site') select('site')
        else { E.view = { k: 1, tx: 0, ty: 0 }; kick() }
      }
      kick()
    }
    const onDbl = (ev: MouseEvent) => {
      const r = cv.getBoundingClientRect()
      const { x, y } = toWorld(ev.clientX - r.left, ev.clientY - r.top)
      const id = hitNode(x, y); if (!id) return
      E.view.k = 1.35
      const p = E.P[id]; if (p) { E.view.tx = W / 2 - p.x * E.view.k; E.view.ty = H / 2 - p.y * E.view.k }
      if (id !== E.center) select(id); else kick()
    }
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault()
      const r = cv.getBoundingClientRect(), sx = ev.clientX - r.left, sy = ev.clientY - r.top
      const w = toWorld(sx, sy)
      E.view.k = Math.max(0.45, Math.min(2.6, E.view.k * (ev.deltaY < 0 ? 1.12 : 0.89)))
      E.view.tx = sx - w.x * E.view.k; E.view.ty = sy - w.y * E.view.k
      draw()
    }
    const onLeave = () => { E.hoverNode = null; E.hoverEdge = null; setTip(null); draw() }

    function select(id: string) {
      setCenter(id)
      setRevealed(new Set())
      setPanelMode('fiche')
      setTrail((t) => { const i = t.indexOf(id); return i >= 0 ? t.slice(0, i + 1) : [...t, id] })
      setTimeout(() => { placeNew(); kick(700) }, 0)
    }
    E.doSelect = select
    E.refreshVis = () => { placeNew(); kick(700) }
    E.redraw = () => draw()
    E.reset = () => {
      E.pinned.clear(); E.view = { k: 1, tx: 0, ty: 0 }
      const ring = [...(neigh[E.center] ?? [])]
      const c = E.P[E.center]; if (c) { c.x = W / 2; c.y = H / 2; c.vx = 0; c.vy = 0 }
      ring.forEach((id, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, ring.length)
        const p = E.P[id]; if (p) { p.x = W / 2 + 140 * Math.cos(a); p.y = H / 2 + 140 * Math.sin(a); p.vx = 0; p.vy = 0 }
      })
      kick()
    }

    resize()
    const ro = new ResizeObserver(resize); ro.observe(wrap)
    cv.addEventListener('pointerdown', onDown)
    cv.addEventListener('pointermove', onMove)
    cv.addEventListener('pointerup', onUp)
    cv.addEventListener('dblclick', onDbl)
    cv.addEventListener('wheel', onWheel, { passive: false })
    cv.addEventListener('pointerleave', onLeave)
    const mo = new MutationObserver(() => draw())
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      ro.disconnect(); mo.disconnect()
      cv.removeEventListener('pointerdown', onDown)
      cv.removeEventListener('pointermove', onMove)
      cv.removeEventListener('pointerup', onUp)
      cv.removeEventListener('dblclick', onDbl)
      cv.removeEventListener('wheel', onWheel)
      cv.removeEventListener('pointerleave', onLeave)
    }
  }, [graph, neigh, nodeById])

  const selectFromPanel = (id: string) => engine.current.doSelect?.(id)

  // ▶ Rejouer cette histoire : on remonte au premier jour puis on avance.
  const playRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function play() {
    if (playRef.current) clearTimeout(playRef.current)
    let i = 0
    const stepPlay = () => {
      setTimeIdx(i)
      if (i < days.length - 1) { i++; playRef.current = setTimeout(stepPlay, 1100) }
      else playRef.current = setTimeout(() => setTimeIdx(null), 1400)
    }
    stepPlay()
  }
  useEffect(() => () => { if (playRef.current) clearTimeout(playRef.current) }, [])

  function startEnquete(root: string) {
    setEnquete({ root, set: [...dependencySet(root, neigh, nodeById)] })
  }

  const n = nodeById[center]
  const chain = useMemo(() => chainToSource(center, neigh), [center, neigh])
  const links = graph.edges.filter((e) => e.a === center || e.b === center)
  const phrase = useMemo(() => enUnePhrase(n, graph, neigh, nodeById), [n, graph, neigh, nodeById])
  const gone = n.type === 'acteur' ? ifGone(n, neigh, nodeById) : null

  return (
    <main className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Cliquer = ouvrir · maintenir et glisser = déplacer · molette = zoom · un nœud posé reste posé.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ModeBtn pressed={depth === 1 && !enquete} onClick={() => { setEnquete(null); setDepth(1) }}>Isoler</ModeBtn>
          <ModeBtn pressed={depth === 2 && !enquete} onClick={() => { setEnquete(null); setDepth(2) }}>Étendre</ModeBtn>
          <ModeBtn pressed={false} onClick={() => engine.current.reset?.()}>Réorganiser</ModeBtn>
          <button
            type="button"
            onClick={() => setPanelMode(panelMode === 'gaps' ? 'fiche' : 'gaps')}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-sm font-medium',
              'border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/30',
            )}
          >
            ⚠ Aujourd&apos;hui ({gaps.length})
          </button>
        </div>
      </div>

      {/* La légende n'est pas une légende : c'est le panneau de contrôle.
          Clic = afficher/masquer la catégorie · survol = mise en évidence
          subtile (halo, le reste s'atténue — jamais de clignotement) ·
          compteur = le CONTEXTE exploré, pas tout le chantier. Les preuves
          repliées par le niveau de détail s'affichent « ▸ » : un clic les
          déplie autour du contexte courant. */}
      <div className="flex flex-wrap gap-1.5 text-[12px]">
        {(['visite', 'memo', 'action', 'ech', 'dec', 'vigilance', 'acteur', 'photo', 'know'] as GraphNodeType[]).map((t) => {
          const c = contextCounts[t] ?? 0
          if (c === 0 && !hidden.has(t)) return null
          const near = [...(neigh[center] ?? [])].some((id) => nodeById[id]?.type === t)
          const defaultOn = center === 'site' ? GLOBAL_DEFAULT.has(t) : !PROOF.has(t) || near
          const on = !hidden.has(t) && (!!enquete || revealed.has(t) || defaultOn)
          const folded = !on && !hidden.has(t)
          return (
            <button
              key={t}
              type="button"
              aria-pressed={on}
              title={on ? 'Masquer cette catégorie' : folded ? 'Déplier cette catégorie dans la carte' : 'Afficher cette catégorie'}
              onClick={() => {
                if (on) {
                  setHidden((h) => new Set(h).add(t))
                  setRevealed((r) => { const n = new Set(r); n.delete(t); return n })
                } else {
                  setHidden((h) => { const n = new Set(h); n.delete(t); return n })
                  setRevealed((r) => new Set(r).add(t))
                }
              }}
              onMouseEnter={() => { engine.current.hlType = t; engine.current.redraw?.() }}
              onMouseLeave={() => { engine.current.hlType = null; engine.current.redraw?.() }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1',
                on ? 'text-muted-foreground hover:text-foreground hover:border-foreground/30'
                  : folded ? 'text-muted-foreground/70 hover:text-foreground hover:border-foreground/30'
                  : 'text-muted-foreground/50 line-through',
              )}
            >
              <i className="inline-block h-2 w-2 rounded-full" style={{ background: COLOR[t], opacity: on ? 1 : 0.35 }} />
              {folded && <span aria-hidden>▸</span>}
              {TYPE_LABEL[t]}
              <span className="tabular-nums">({c})</span>
            </button>
          )
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div ref={wrapRef} className="relative h-[420px] overflow-hidden rounded-[22px] border bg-card shadow-sm lg:h-[560px]">
          <canvas ref={cvRef} className="absolute inset-0 h-full w-full touch-none" aria-label="Carte des connexions du chantier" />
          <div className="absolute left-2 top-2 z-10 flex max-w-[70%] flex-wrap gap-1.5 text-[12px]">
            {trail.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => selectFromPanel(id)}
                className={cn(
                  'rounded-full border bg-card px-2.5 py-1 shadow-sm',
                  id === center ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {nodeById[id].label.length > 22 ? nodeById[id].label.slice(0, 21) + '…' : nodeById[id].label}
              </button>
            ))}
          </div>
          {/* L'enquête en cours — le reste du graphe s'est effacé. */}
          {enquete && (
            <div className="absolute left-1/2 top-2 z-10 flex max-w-[92%] -translate-x-1/2 items-center gap-2 rounded-full border bg-card px-3.5 py-1.5 text-[12.5px] shadow-md">
              <b className="truncate">🔍 Les conséquences de {nodeById[enquete.root].label} — {enquete.set.length} éléments</b>
              <button type="button" onClick={() => setEnquete(null)} className="shrink-0 rounded-full border bg-muted px-2.5 py-0.5 text-[12px] font-medium text-muted-foreground">
                Quitter
              </button>
            </div>
          )}
          {/* ▶ Rejouer cette histoire — les nœuds apparaissent à leur vraie date. */}
          {days.length > 1 && (
            <div className="absolute bottom-2 left-2 z-10 w-[min(340px,70%)] rounded-2xl border bg-card px-3.5 py-2 shadow-md">
              <button type="button" onClick={play} className="text-[12px] font-bold hover:underline">
                ▶ Rejouer cette histoire
              </button>
              <input
                type="range"
                min={0}
                max={days.length - 1}
                value={timeIdx ?? days.length - 1}
                onChange={(e) => setTimeIdx(+e.target.value >= days.length - 1 ? null : +e.target.value)}
                className="w-full accent-sky-600"
                aria-label="Replay temporel"
              />
              <div className="flex justify-between text-[10.5px] text-muted-foreground">
                <span>{frDay(days[0])}</span>
                <span className={cn(timeIdx !== null && 'font-semibold text-foreground')}>
                  {timeIdx === null ? "Aujourd'hui" : frDay(days[timeIdx])}
                </span>
              </div>
            </div>
          )}
          {tip && (
            <div
              className="pointer-events-none absolute z-20 max-w-[260px] rounded-xl border bg-card p-2.5 text-[12.5px] shadow-lg [&_b]:block [&_span]:text-muted-foreground"
              style={{ left: tip.x + 14, top: tip.y + 14 }}
              dangerouslySetInnerHTML={{ __html: tip.html }}
            />
          )}
        </div>

        {/* ── LA FICHE : le graphe repère, elle explique. ── */}
        <aside className="rounded-[22px] border bg-card p-5 shadow-sm">
          {panelMode === 'gaps' ? (
            <GapsPanel gaps={gaps} open={gapsOpen} onOpen={() => setGapsOpen(true)} onBack={() => { setPanelMode('fiche'); setGapsOpen(false) }} onSelect={(id) => { setPanelMode('fiche'); selectFromPanel(id) }} />
          ) : panelMode === 'recit' ? (
            <div>
              <button type="button" onClick={() => setPanelMode('fiche')} className="mb-3 rounded-full border bg-muted px-3 py-1 text-[12px] font-medium text-muted-foreground">
                ← Retour à la fiche
              </button>
              <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: COLOR[n.type] }}>Résumé de 20 secondes</p>
              <h2 className="mb-3 mt-1 text-lg font-semibold leading-snug">{n.label}</h2>
              {recit(n, graph, neigh, nodeById).map((t, i) => (
                <p key={i} className="mb-2.5 text-[14px] leading-relaxed">{t}</p>
              ))}
              <p className="text-[11px] text-muted-foreground">Composé automatiquement depuis les traces — rien n&apos;est inventé, chaque phrase a une provenance.</p>
            </div>
          ) : (
            <>
              <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: COLOR[n.type] }}>
                {TYPE_LABEL[n.type]}
              </p>
              <h2 className="mt-1 text-lg font-semibold leading-snug">{n.label}{n.count ? ` (${n.count})` : ''}</h2>
              {n.sub && <p className="mt-0.5 text-[13px] text-muted-foreground">{n.sub}</p>}

              <div className="mt-3 flex flex-wrap gap-2">
                {['site', 'visite', 'memo', 'acteur'].includes(n.type) && (
                  <WowBtn onClick={() => setPanelMode('recit')}>🎙️ Résumé de 20 secondes</WowBtn>
                )}
                {n.type !== 'site' && n.type !== 'photo' && (
                  <WowBtn onClick={() => startEnquete(center)}>🔍 Voir les conséquences</WowBtn>
                )}
              </div>

              <SectionLabel>En une phrase</SectionLabel>
              <p className="text-[13.5px]">{phrase}</p>

              {n.type === 'site' && <SiteStats graph={graph} />}

              {/* Les VRAIES photos — l'objet réel, pas un nœud abstrait. */}
              {n.type === 'photo' && n.photos && n.photos.length > 0 && (
                <>
                  <SectionLabel>Les photos de la visite</SectionLabel>
                  <div className="grid grid-cols-2 gap-2">
                    {n.photos.map((p) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={p.id}
                        src={p.url}
                        alt="Photo de visite"
                        className="aspect-[4/3] w-full cursor-zoom-in rounded-xl border object-cover"
                        onClick={() => setLightbox(p.url)}
                      />
                    ))}
                  </div>
                </>
              )}

              {n.excerpt && (
                <>
                  <SectionLabel>La trace, mot pour mot</SectionLabel>
                  <p className="rounded-r-xl border-l-2 border-teal-600/60 bg-muted/40 p-3 text-[13px] italic leading-snug">
                    «&nbsp;{n.excerpt}&nbsp;»
                  </p>
                </>
              )}

              {gone && gone.length > 0 && (
                <>
                  <SectionLabel>Si {n.label.split(' (')[0]} disparaissait aujourd&apos;hui…</SectionLabel>
                  <ul className="space-y-1.5">
                    {gone.map((t, i) => (
                      <li key={i} className="flex items-start gap-2 text-[13px]">
                        <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                        {t}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {chain && chain.length > 1 && (
                <>
                  <SectionLabel>Pourquoi c&apos;est ici</SectionLabel>
                  <ol className="space-y-1.5">
                    {chain.map((id, i) => (
                      <li key={id}>
                        <button
                          type="button"
                          disabled={id === center}
                          onClick={() => selectFromPanel(id)}
                          className={cn('flex items-start gap-2 text-left text-[13px]', id !== center && 'hover:underline')}
                        >
                          <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full" style={{ background: COLOR[nodeById[id].type] }} />
                          <span>{i > 0 && <span className="mr-1 text-muted-foreground">↳</span>}{nodeById[id].label}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </>
              )}

              {links.length > 0 && (
                <>
                  <SectionLabel>Connexions directes</SectionLabel>
                  <ul className="divide-y">
                    {links.map((e, i) => {
                      const other = e.a === center ? e.b : e.a
                      const m = nodeById[other]
                      return (
                        <li key={i}>
                          <button
                            type="button"
                            onClick={() => selectFromPanel(other)}
                            className="group flex w-full items-start gap-2.5 py-2 text-left"
                          >
                            <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full" style={{ background: COLOR[m.type] }} />
                            <span className="min-w-0">
                              <span className="block text-[13px] group-hover:underline">{m.label}{m.count ? ` (${m.count})` : ''}</span>
                              <span className="block text-[11.5px] text-muted-foreground">{e.why}{e.date ? ` · ${e.date}` : ''}</span>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}
            </>
          )}
        </aside>
      </div>

      {/* Plein écran — clic n'importe où pour fermer. */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/85"
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="Photo de visite" className="max-h-[92vh] max-w-[94vw] rounded-xl" />
        </div>
      )}
    </main>
  )
}

/* ── UI ─────────────────────────────────────────────────────────────────────── */

function ModeBtn({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'rounded-lg border px-3 py-1.5 text-sm font-medium',
        pressed ? 'border-foreground/40 bg-card text-foreground' : 'text-muted-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  )
}

function WowBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border bg-muted/50 px-3 py-1.5 text-[12.5px] font-semibold hover:border-foreground/30"
    >
      {children}
    </button>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{children}</p>
}

function SiteStats({ graph }: { graph: SiteGraph }) {
  const count = (t: GraphNodeType) => graph.nodes.filter((n) => n.type === t).length
  const stats = ([
    ['Visites', count('visite')],
    ['Actions', count('action')],
    ['Échéances', count('ech')],
    ['Décisions', count('dec')],
    ['Vigilances', count('vigilance')],
    ['À confirmer', graph.nodes.filter((n) => n.sub?.includes('à confirmer')).reduce((s, n) => s + (n.count ?? 1), 0)],
  ] as Array<[string, number]>).filter(([, v]) => v > 0)
  return (
    <>
      <SectionLabel>Ce que la mémoire contient</SectionLabel>
      <div className="grid grid-cols-3 gap-2">
        {stats.map(([l, v]) => (
          <div key={l} className="rounded-xl border p-2">
            <p className="text-lg font-semibold tabular-nums">{v}</p>
            <p className="text-[11px] text-muted-foreground">{l}</p>
          </div>
        ))}
      </div>
    </>
  )
}

function GapsPanel({ gaps, open, onOpen, onBack, onSelect }: {
  gaps: Array<{ id: string; txt: string }>
  open: boolean
  onOpen: () => void
  onBack: () => void
  onSelect: (id: string) => void
}) {
  const top = gaps.slice(0, 3)
  const rest = gaps.slice(3)
  return (
    <div>
      <button type="button" onClick={onBack} className="mb-3 rounded-full border bg-muted px-3 py-1 text-[12px] font-medium text-muted-foreground">
        ← Retour à la fiche
      </button>
      <p className="text-[11px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">Aujourd&apos;hui</p>
      <h2 className="mt-1 text-lg font-semibold">Ce qui mérite ton attention</h2>
      <p className="mt-0.5 text-[13px] text-muted-foreground">Des règles, pas des jugements — chaque ligne est un fait vérifiable.</p>
      <ul className="mt-3 space-y-1">
        {top.map((g) => (
          <li key={g.id}>
            <button type="button" onClick={() => onSelect(g.id)} className="flex w-full items-start gap-2.5 border-l-2 border-amber-500 py-1.5 pl-2.5 text-left text-[13.5px] hover:underline">
              {g.txt}
            </button>
          </li>
        ))}
      </ul>
      {rest.length > 0 && !open && (
        <button type="button" onClick={onOpen} className="mt-2 text-[13px] text-muted-foreground hover:underline">
          Voir les {rest.length} autres…
        </button>
      )}
      {open && rest.length > 0 && (
        <ul className="mt-3 space-y-1 border-t pt-3">
          {rest.map((g) => (
            <li key={g.id}>
              <button type="button" onClick={() => onSelect(g.id)} className="flex w-full items-start gap-2.5 py-1 text-left text-[13px] text-muted-foreground hover:underline">
                {g.txt}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ── Générateurs — depuis les DONNÉES du graphe, jamais écrits à la main ────── */

type Neigh = Record<string, Set<string>>
type ById = Record<string, GraphNode>

function linkedOf(id: string, types: GraphNodeType[], neigh: Neigh, byId: ById): GraphNode[] {
  return [...(neigh[id] ?? [])].map((m) => byId[m]).filter((m) => m && types.includes(m.type))
}

/** LE vrai wow du cadrage : une phrase par objet, uniquement des faits. */
function enUnePhrase(n: GraphNode, graph: SiteGraph, neigh: Neigh, byId: ById): string {
  const d = frDay(n.t)
  const memos = linkedOf(n.id, ['memo'], neigh, byId)
  const src = memos.length > 0 ? ' depuis un mémo de visite' : ''
  if (n.type === 'site') {
    const c = (t: GraphNodeType) => graph.nodes.filter((x) => x.type === t).length
    const conf = graph.nodes.filter((x) => x.sub?.includes('à confirmer')).reduce((s, x) => s + (x.count ?? 1), 0)
    return `${c('visite')} visite${c('visite') > 1 ? 's' : ''}, ${c('action')} action${c('action') > 1 ? 's' : ''}, ${c('ech')} échéance${c('ech') > 1 ? 's' : ''}, ${c('dec')} décision${c('dec') > 1 ? 's' : ''}${conf > 0 ? ` — ${conf} élément${conf > 1 ? 's' : ''} encore à confirmer` : ''}.`
  }
  if (n.type === 'visite') {
    const suites = [...(neigh[n.id] ?? [])].length - 1
    return `Visite${d ? ` du ${d}` : ''}. ${suites} élément${suites > 1 ? 's' : ''} de la mémoire en descend${suites > 1 ? 'ent' : ''}.`
  }
  if (n.type === 'memo') {
    const suites = linkedOf(n.id, ['action', 'ech', 'dec', 'vigilance', 'acteur', 'know'], neigh, byId)
    return `Dicté pendant la visite${d ? ` du ${d}` : ''}. ${suites.length} fait${suites.length > 1 ? 's' : ''} en ${suites.length > 1 ? 'sont issus' : 'est issu'}.`
  }
  if (n.type === 'photo') return `${n.count ?? 0} photo${(n.count ?? 0) > 1 ? 's' : ''} prise${(n.count ?? 0) > 1 ? 's' : ''} pendant la visite${d ? ` du ${d}` : ''}.`
  if (n.type === 'action') return `Créée${d ? ` le ${d}` : ''}${src}. ${n.sub ?? ''}.`
  if (n.type === 'ech') return `Extraite${src} et confirmée${d ? ` le ${d}` : ''}. ${n.sub ?? ''}.`
  if (n.type === 'dec') {
    const acts = linkedOf(n.id, ['action'], neigh, byId)
    return `Actée${d ? ` le ${d}` : ''}${src}, confirmée par un humain.${acts.length === 0 ? ' Aucune action n’en découle pour l’instant.' : ''}`
  }
  if (n.type === 'acteur') {
    const a = linkedOf(n.id, ['action'], neigh, byId).length
    const e = linkedOf(n.id, ['ech'], neigh, byId).length
    return `Cité${d ? ` le ${d}` : ''} dans un mémo de visite — jamais encore confirmé comme intervenant.${a > 0 ? ` ${a} action${a > 1 ? 's' : ''} le concerne${a > 1 ? 'nt' : ''}.` : ''}${e > 0 ? ` ${e} échéance${e > 1 ? 's' : ''} liée${e > 1 ? 's' : ''}.` : ''}`
  }
  if (n.type === 'know') return `${n.count ?? 0} information${(n.count ?? 0) > 1 ? 's' : ''} extraite${(n.count ?? 0) > 1 ? 's' : ''} des mémos, en attente d’un choix humain.`
  return n.sub ?? ''
}

/** Le récit court — 3 phrases max, le ton d'un collègue, uniquement des faits. */
function recit(n: GraphNode, graph: SiteGraph, neigh: Neigh, byId: ById): string[] {
  const d = frDay(n.t)
  if (n.type === 'acteur') {
    const acts = linkedOf(n.id, ['action'], neigh, byId)
    const echs = linkedOf(n.id, ['ech'], neigh, byId)
    const ps = [`${n.label} apparaît${d ? ` le ${d}` : ''}, cité dans un mémo vocal de visite.`]
    const bits: string[] = []
    if (acts.length) bits.push(`${acts.length} action${acts.length > 1 ? 's' : ''} ouverte${acts.length > 1 ? 's' : ''} le concerne${acts.length > 1 ? 'nt' : ''} (${acts.slice(0, 2).map((a) => `« ${a.label} »`).join(', ')})`)
    if (echs.length) bits.push(`${echs.length} échéance${echs.length > 1 ? 's' : ''} l’attend${echs.length > 1 ? 'ent' : ''}`)
    if (bits.length) ps.push(bits.join(' et ') + ', mais il n’a jamais été confirmé comme intervenant.')
    else ps.push('Il n’a jamais été confirmé comme intervenant.')
    return ps
  }
  if (n.type === 'memo') {
    const suites = linkedOf(n.id, ['action', 'ech', 'dec', 'vigilance', 'acteur', 'know'], neigh, byId)
    return [
      `Mémo dicté sur place${d ? ` le ${d}` : ''}.`,
      suites.length > 0
        ? `${suites.length} fait${suites.length > 1 ? 's' : ''} en ${suites.length > 1 ? 'sont sortis' : 'est sorti'} : ${suites.slice(0, 3).map((s) => s.label.toLowerCase()).join(', ')}${suites.length > 3 ? '…' : ''}.`
        : 'Aucun fait n’en a encore été extrait.',
      'La voix d’origine reste attachée à chaque fait — c’est elle qui fait foi.',
    ]
  }
  if (n.type === 'visite') {
    const kids = [...(neigh[n.id] ?? [])].map((m) => byId[m]).filter(Boolean)
    const photos = kids.find((k) => k.type === 'photo')?.count ?? 0
    const memos = kids.filter((k) => k.type === 'memo').length
    return [
      `Visite${d ? ` du ${d}` : ''} — ${photos} photo${photos > 1 ? 's' : ''}, ${memos} mémo${memos > 1 ? 's' : ''}.`,
      `${kids.length} élément${kids.length > 1 ? 's' : ''} de la mémoire en descend${kids.length > 1 ? 'ent' : ''}.`,
    ]
  }
  // site
  return [
    enUnePhrase(n, graph, neigh, byId),
    'Chaque élément de cette carte peut expliquer d’où il vient — cliquez, la fiche remonte la chaîne.',
  ]
}

/** L'importance d'un acteur — jamais pour le supprimer. */
function ifGone(n: GraphNode, neigh: Neigh, byId: ById): string[] {
  const a = linkedOf(n.id, ['action'], neigh, byId).length
  const e = linkedOf(n.id, ['ech'], neigh, byId).length
  const out: string[] = []
  if (a) out.push(`${a} action${a > 1 ? 's' : ''} restera${a > 1 ? 'ient' : 'it'} sans destinataire`)
  if (e) out.push(`${e} échéance${e > 1 ? 's' : ''} serai${e > 1 ? 'ent' : 't'} bloquée${e > 1 ? 's' : ''}`)
  out.push('sa trace resterait : le mémo d’origine fait foi')
  return out
}

/** « Aujourd'hui » — des règles déterministes sur le graphe, 3 en évidence. */
function computeGaps(graph: SiteGraph, neigh: Neigh): Array<{ id: string; txt: string }> {
  const g: Array<{ id: string; txt: string }> = []
  const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]))
  for (const n of graph.nodes.filter((x) => x.type === 'acteur' && x.sub?.includes('à confirmer'))) {
    g.push({ id: n.id, txt: `${n.label} est cité mais n’a jamais été confirmé comme intervenant.` })
  }
  const know = graph.nodes.find((x) => x.type === 'know')
  if (know?.count) g.push({ id: know.id, txt: `${know.count} information${know.count > 1 ? 's' : ''} « à savoir » attend${know.count > 1 ? 'ent' : ''} une décision humaine.` })
  const toPlan = graph.nodes.filter((x) => x.type === 'ech' && x.sub?.startsWith('À planifier'))
  if (toPlan.length) g.push({ id: toPlan[0].id, txt: `${toPlan.length} échéance${toPlan.length > 1 ? 's' : ''} confirmée${toPlan.length > 1 ? 's' : ''} sans date.` })
  for (const d of graph.nodes.filter((x) => x.type === 'dec')) {
    const acts = [...(neigh[d.id] ?? [])].filter((m) => byId[m]?.type === 'action')
    if (acts.length === 0) g.push({ id: d.id, txt: `La décision « ${d.label} » n’a déclenché aucune action.` })
  }
  return g
}

/** « Voir les conséquences » : la dépendance se propage à travers les faits et
 *  s'arrête aux sources (mémos, visites, acteurs) — incluses comme preuves. */
function dependencySet(root: string, neigh: Neigh, byId: ById): Set<string> {
  const EXPAND = new Set<GraphNodeType>(['action', 'ech', 'dec', 'know', 'vigilance'])
  const out = new Set([root])
  const q = [root]
  while (q.length) {
    const cur = q.shift()!
    for (const nx of neigh[cur] ?? []) {
      if (nx === 'site' || out.has(nx)) continue
      out.add(nx)
      if (EXPAND.has(byId[nx]?.type)) q.push(nx)
    }
  }
  return out
}

/** Le plus court chemin vers le chantier — la même chaîne que « Pourquoi ? ». */
function chainToSource(id: string, neigh: Neigh): string[] | null {
  if (id === 'site') return null
  const prev: Record<string, string | null> = { [id]: null }
  const q = [id]
  while (q.length) {
    const cur = q.shift()!
    if (cur === 'site') break
    for (const nx of neigh[cur] ?? []) if (!(nx in prev)) { prev[nx] = cur; q.push(nx) }
  }
  if (!('site' in prev)) return null
  const path: string[] = []
  let cur: string | null = 'site'
  while (cur !== null) { path.push(cur); cur = prev[cur] }
  return path
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
