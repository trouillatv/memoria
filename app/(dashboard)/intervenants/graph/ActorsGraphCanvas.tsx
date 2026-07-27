'use client'

// ── CANVAS DU GRAPHE DES ACTEURS (Lot 2B.4) ──────────────────────────────────
// Moteur force-directed 2D maison (0 dépendance), consommant un ActorsGraph.
//
// ⚠ DUPLICATION TEMPORAIRE CONTRÔLÉE (Vincent 2026-07-27) : la physique (répulsion
// N-body + ressorts + friction) et les interactions (zoom/pan/drag/hit/sélection)
// sont volontairement RÉÉCRITES ici, plus légères, plutôt que forkées depuis
// ExplorerWorkspace (graphe Mémoire, 1000 lignes couplées à ses 10 types). CIBLE
// finale : extraire un moteur générique `ForceGraphCanvas` partagé par les deux
// graphes ; en attendant, ce fichier isole déjà « moteur » vs « config acteurs »
// (COLORS/SIZE/href) pour rendre cette extraction facile. NE PAS mélanger avec le
// graphe Mémoire : même moteur, deux histoires (organisationnel vs causal).

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ActorsGraph, ActorGraphKind, ActorGraphNode } from '@/lib/knowledge/actors-graph'

export type SelectableKind = 'person' | 'company' | 'team'

// ── Config propre aux ACTEURS (le reste du fichier est générique) ────────────
const LEVEL_COLOR = { urgent: '#dc2626', attention: '#f59e0b', ok: '#3b82f6' } as const
const HISTORICAL_COLOR = '#94a3b8'
// Hiérarchie visuelle (Vincent) : entreprise > chantier > personne = équipe > action.
const SIZE: Record<ActorGraphKind, number> = { company: 24, site: 19, person: 14, team: 14, action: 9 }

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy || 1
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}
const KIND_LABEL: Record<ActorGraphKind, string> = { person: 'Personne', company: 'Entreprise', team: 'Équipe', site: 'Chantier', action: 'Action' }

function nodeColor(n: ActorGraphNode): string {
  if (n.historical) return HISTORICAL_COLOR
  return LEVEL_COLOR[n.level]
}

/** Surface propriétaire d'un nœud (id préfixé). null si non navigable (action). */
function nodeHref(n: ActorGraphNode): string | null {
  const raw = n.id.slice(n.id.indexOf('_') + 1)
  switch (n.kind) {
    case 'person': return `/intervenants/personne/${raw}`
    case 'company': return `/intervenants/entreprise/${raw}`
    case 'team': return `/equipes/${raw}`
    case 'site': return `/sites/${raw}`
    default: return null
  }
}

type Pt = { x: number; y: number; vx: number; vy: number }

export function ActorsGraphCanvas({ graph, focusId, heightClass = 'h-[70vh]', onSelectActor }: {
  graph: ActorsGraph
  focusId?: string | null
  heightClass?: string
  /** Fourni par le panneau maître-détail : cliquer un acteur RECONFIGURE la page en place
   *  (fiche + graphe) au lieu de naviguer. Absent (page dédiée) → navigation classique. */
  onSelectActor?: (kind: SelectableKind, id: string) => void
}) {
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pos = useRef<Map<string, Pt>>(new Map())
  const view = useRef({ tx: 0, ty: 0, k: 1 })
  const drag = useRef<{ id: string | null; moved: boolean; sx: number; sy: number } | null>(null)
  const size = useRef({ w: 0, h: 0 })
  const [selected, setSelected] = useState<ActorGraphNode | null>(null)
  const selectedRef = useRef<string | null>(null)
  const hoverRef = useRef<string | null>(null)
  const hoverEdgeRef = useRef<number | null>(null)
  const onSelectRef = useRef(onSelectActor)
  useEffect(() => { onSelectRef.current = onSelectActor }, [onSelectActor])

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))
  const adjacency = useRef<Map<string, Set<string>>>(new Map())

  // Positions initiales des nouveaux nœuds (anneau autour du centre monde 0,0).
  useEffect(() => {
    const m = pos.current
    const ids = new Set(graph.nodes.map((n) => n.id))
    for (const id of [...m.keys()]) if (!ids.has(id)) m.delete(id)
    let i = 0
    for (const n of graph.nodes) {
      if (!m.has(n.id)) {
        const a = i * 2.399963 // angle d'or → dispersion régulière
        const r = 40 + 12 * Math.sqrt(i + 1)
        m.set(n.id, { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0 })
      }
      i++
    }
    // Index d'adjacence pour la mise en avant du voisinage.
    const adj = new Map<string, Set<string>>()
    for (const e of graph.edges) {
      if (!adj.has(e.a)) adj.set(e.a, new Set())
      if (!adj.has(e.b)) adj.set(e.b, new Set())
      adj.get(e.a)!.add(e.b)
      adj.get(e.b)!.add(e.a)
    }
    adjacency.current = adj
  }, [graph])

  // Centrage initial sur le nœud « Voir son réseau ».
  useEffect(() => {
    if (!focusId) return
    const p = pos.current.get(focusId)
    if (p && size.current.w) {
      view.current.k = 1.1
      view.current.tx = size.current.w / 2 - p.x * view.current.k
      view.current.ty = size.current.h / 2 - p.y * view.current.k
      selectedRef.current = focusId
      setSelected(nodeById.get(focusId) ?? null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, graph])

  // Boucle physique + rendu.
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let raf = 0

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = container.clientWidth
      const h = container.clientHeight
      size.current = { w, h }
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (view.current.tx === 0 && view.current.ty === 0) { view.current.tx = w / 2; view.current.ty = h / 2 }
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(container)

    const step = () => {
      const nodes = graph.nodes
      const m = pos.current
      // Répulsion N-body (O(n²), suffisant pour la V1 filtrée).
      for (let i = 0; i < nodes.length; i++) {
        const a = m.get(nodes[i]!.id)!
        for (let j = i + 1; j < nodes.length; j++) {
          const b = m.get(nodes[j]!.id)!
          let dx = a.x - b.x, dy = a.y - b.y
          let d2 = dx * dx + dy * dy
          if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.5 }
          const f = 5200 / d2
          const d = Math.sqrt(d2)
          const fx = (dx / d) * f, fy = (dy / d) * f
          a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy
        }
      }
      // Attraction par ressort le long des liens.
      for (const e of graph.edges) {
        const a = m.get(e.a), b = m.get(e.b)
        if (!a || !b) continue
        const dx = b.x - a.x, dy = b.y - a.y
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01
        const f = 0.02 * (d - 150)
        const fx = (dx / d) * f, fy = (dy / d) * f
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy
      }
      // Gravité douce vers le centre + intégration + friction.
      for (const n of nodes) {
        const p = m.get(n.id)!
        if (drag.current?.id === n.id) continue
        p.vx += -p.x * 0.0015; p.vy += -p.y * 0.0015
        p.vx *= 0.82; p.vy *= 0.82
        p.x += p.vx; p.y += p.vy
      }
    }

    const draw = () => {
      const { w, h } = size.current
      const { tx, ty, k } = view.current
      ctx.clearRect(0, 0, w, h)
      const sx = (x: number) => x * k + tx
      const sy = (y: number) => y * k + ty
      const sel = selectedRef.current
      const hov = hoverRef.current
      const focus = sel ?? hov
      const neigh = focus ? adjacency.current.get(focus) : null

      // Arêtes — les LIENS PARLENT : libellé de relation au voisinage du nœud focalisé
      // ET au survol direct du lien (« travaille chez », « intervient sur »…).
      const hoverEdge = hoverEdgeRef.current
      graph.edges.forEach((e, i) => {
        const a = pos.current.get(e.a), b = pos.current.get(e.b)
        if (!a || !b) return
        const on = (focus && (e.a === focus || e.b === focus)) || i === hoverEdge
        ctx.strokeStyle = on ? '#475569' : '#e2e8f0'
        ctx.lineWidth = on ? 1.8 : 1
        ctx.beginPath(); ctx.moveTo(sx(a.x), sy(a.y)); ctx.lineTo(sx(b.x), sy(b.y)); ctx.stroke()
        if (on) {
          const mx = (sx(a.x) + sx(b.x)) / 2, my = (sy(a.y) + sy(b.y)) / 2
          ctx.font = '10px system-ui, sans-serif'
          ctx.textAlign = 'center'
          const tw = ctx.measureText(e.label).width
          ctx.fillStyle = 'rgba(255,255,255,0.9)'
          ctx.fillRect(mx - tw / 2 - 3, my - 13, tw + 6, 13)
          ctx.fillStyle = '#475569'
          ctx.fillText(e.label, mx, my - 3)
        }
      })

      // Nœuds.
      for (const n of graph.nodes) {
        const p = pos.current.get(n.id)!
        const r = SIZE[n.kind]
        const dim = focus && n.id !== focus && !(neigh && neigh.has(n.id))
        ctx.globalAlpha = dim ? 0.28 : 1
        ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), r, 0, Math.PI * 2)
        ctx.fillStyle = nodeColor(n)
        ctx.fill()
        if (n.id === sel) { ctx.lineWidth = 3; ctx.strokeStyle = '#0f172a'; ctx.stroke() }
        // Étiquette.
        ctx.globalAlpha = dim ? 0.4 : 1
        ctx.fillStyle = '#0f172a'
        ctx.font = `${n.kind === 'site' ? 12 : 11}px system-ui, sans-serif`
        ctx.textAlign = 'center'
        const label = n.label.length > 22 ? n.label.slice(0, 21) + '…' : n.label
        ctx.fillText(label, sx(p.x), sy(p.y) + r + 12)
      }
      ctx.globalAlpha = 1
    }

    const loop = () => { step(); draw(); raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop)

    // ── Interactions ──────────────────────────────────────────────────────────
    const toWorld = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect()
      const px = clientX - rect.left, py = clientY - rect.top
      return { x: (px - view.current.tx) / view.current.k, y: (py - view.current.ty) / view.current.k, px, py }
    }
    const hitNode = (wx: number, wy: number): string | null => {
      let best: string | null = null; let bestD = Infinity
      for (const n of graph.nodes) {
        const p = pos.current.get(n.id)!
        const d = Math.hypot(p.x - wx, p.y - wy)
        const r = SIZE[n.kind] / view.current.k + 6 / view.current.k
        if (d < r && d < bestD) { best = n.id; bestD = d }
      }
      return best
    }
    const hitEdge = (wx: number, wy: number): number | null => {
      let best = -1; let bestD = 8 / view.current.k
      graph.edges.forEach((e, i) => {
        const a = pos.current.get(e.a), b = pos.current.get(e.b)
        if (!a || !b) return
        const d = distToSeg(wx, wy, a.x, a.y, b.x, b.y)
        if (d < bestD) { bestD = d; best = i }
      })
      return best >= 0 ? best : null
    }
    const onDown = (ev: PointerEvent) => {
      canvas.setPointerCapture(ev.pointerId)
      const { x, y } = toWorld(ev.clientX, ev.clientY)
      const id = hitNode(x, y)
      drag.current = { id, moved: false, sx: ev.clientX, sy: ev.clientY }
    }
    const onMove = (ev: PointerEvent) => {
      const { x, y } = toWorld(ev.clientX, ev.clientY)
      if (!drag.current) {
        const hn = hitNode(x, y)
        hoverRef.current = hn
        hoverEdgeRef.current = hn ? null : hitEdge(x, y)
        canvas.style.cursor = hn || hoverEdgeRef.current != null ? 'pointer' : 'grab'
        return
      }
      const dxs = ev.clientX - drag.current.sx, dys = ev.clientY - drag.current.sy
      if (Math.abs(dxs) + Math.abs(dys) > 3) drag.current.moved = true
      if (drag.current.id) {
        const p = pos.current.get(drag.current.id)!
        p.x = x; p.y = y; p.vx = 0; p.vy = 0
      } else {
        view.current.tx += ev.movementX; view.current.ty += ev.movementY
      }
    }
    const onUp = (ev: PointerEvent) => {
      const d = drag.current
      drag.current = null
      if (!d) return
      if (!d.moved) {
        const node = d.id ? nodeById.get(d.id) ?? null : null
        if (node && (node.kind === 'person' || node.kind === 'company' || node.kind === 'team')) {
          // NAVIGATION DANS LE RÉSEAU (effet « graphe de connaissances ») : dans le
          // panneau, on RECONFIGURE la page en place ; sur la page dédiée, on navigue.
          const raw = node.id.slice(node.id.indexOf('_') + 1)
          if (onSelectRef.current) onSelectRef.current(node.kind, raw)
          else { const h = nodeHref(node); if (h) router.push(h) }
        } else if (node) {
          selectedRef.current = node.id; setSelected(node) // chantier / action → panneau d'info
        } else {
          selectedRef.current = null; setSelected(null)
        }
      }
      try { canvas.releasePointerCapture(ev.pointerId) } catch { /* noop */ }
    }
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault()
      const { px, py } = toWorld(ev.clientX, ev.clientY)
      const k0 = view.current.k
      const k1 = Math.max(0.2, Math.min(3, k0 * (ev.deltaY < 0 ? 1.12 : 0.893)))
      // Zoom centré sous le curseur.
      view.current.tx = px - ((px - view.current.tx) / k0) * k1
      view.current.ty = py - ((py - view.current.ty) / k0) * k1
      view.current.k = k1
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('wheel', onWheel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph])

  const selHref = selected ? nodeHref(selected) : null

  return (
    <div ref={containerRef} className={`relative w-full overflow-hidden rounded-2xl border border-border/60 bg-card ${heightClass}`}>
      <canvas ref={canvasRef} className="block touch-none" style={{ cursor: 'grab' }} />

      {/* Légende — couleur = état d'attention. */}
      <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1 rounded-lg border border-border/60 bg-background/90 px-2.5 py-2 text-[11px] text-muted-foreground backdrop-blur">
        <span className="flex items-center gap-1.5"><Dot c={LEVEL_COLOR.urgent} /> À traiter</span>
        <span className="flex items-center gap-1.5"><Dot c={LEVEL_COLOR.attention} /> À surveiller</span>
        <span className="flex items-center gap-1.5"><Dot c={LEVEL_COLOR.ok} /> À jour</span>
        <span className="flex items-center gap-1.5"><Dot c={HISTORICAL_COLOR} /> Historique</span>
      </div>

      {/* Panneau de sélection. */}
      {selected && (
        <div className="absolute right-3 top-3 w-60 rounded-lg border border-border/60 bg-background/95 p-3 text-sm shadow-sm backdrop-blur">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{KIND_LABEL[selected.kind]}</div>
          <div className="font-semibold">{selected.label}</div>
          {selected.sub && <div className="text-xs text-muted-foreground">{selected.sub}</div>}
          {selHref && (
            <Link href={selHref} className="mt-2 inline-block text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
              Ouvrir la fiche →
            </Link>
          )}
        </div>
      )}

      <p className="pointer-events-none absolute bottom-3 left-3 text-[11px] text-muted-foreground">
        Molette : zoom · glisser : déplacer · clic sur un acteur : y naviguer
      </p>
    </div>
  )
}

function Dot({ c }: { c: string }) {
  return <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: c }} />
}
