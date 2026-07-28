'use client'

// ── CANVAS DU GRAPHE DE COLLABORATION (V3 UX-1B) ─────────────────────────────
// Un AUTRE graphe : une arête par couple, ÉPAISSEUR = force (bornée), PÂLEUR =
// ancienneté, FOND = entreprise, HALO = attention. AUCUNE couleur de lien par
// nature (la tendance/le détail vivent dans l'inspecteur — pas de 4ᵉ variable
// visuelle). Sélection nœud/lien remontée au parent ; aucune navigation au clic.

import { useEffect, useRef } from 'react'
import { createForceGraphEngine, type ForceGraphEngine, type Vec } from '@/components/graph/force-graph-engine'
import {
  collaborationEdgeWidth, collaborationEdgeAlpha,
  type CollaborationNodeView, type CollaborationEdgeView,
} from '@/lib/knowledge/collaboration-graph'
import { RING_COLOR, companyFill } from './actor-colors'

export interface CollaborationControl {
  selectedKey: string | null
  selectedEdgeIndex: number | null
  onTapNode(key: string): void
  onTapEdge(index: number): void
  onTapVoid(): void
}

// Entreprise DOMINANTE, personne secondaire (~2:1) — l'entreprise est l'ancre.
const SIZE = { company: 32, person: 15 } as const
const EDGE_COLOR = '#64748b'      // neutre (slate) — la nature n'est PAS encodée ici
const EDGE_EMPH = '#334155'

export function CollaborationCanvas({ nodes, edges, membershipEdges = [], control, heightClass = 'h-[70vh]' }: {
  nodes: CollaborationNodeView[]
  edges: CollaborationEdgeView[]
  /** Rattachement personne↔entreprise (déploiement écosystème) : trait fin pointillé,
   *  NON cliquable — ce n'est pas une collaboration, juste une appartenance. */
  membershipEdges?: Array<{ a: string; b: string }>
  control: CollaborationControl
  heightClass?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const apiRef = useRef<ForceGraphEngine | null>(null)
  const cacheRef = useRef<Map<string, Vec>>(new Map())
  const controlRef = useRef(control)
  useEffect(() => { controlRef.current = control; apiRef.current?.redraw() }, [control])

  useEffect(() => {
    const canvas = canvasRef.current, wrap = containerRef.current
    if (!canvas || !wrap) return
    const nodeByKey = new Map(nodes.map((n) => [n.key, n]))
    const adjacency = new Map<string, Set<string>>()
    for (const e of edges) {
      if (!adjacency.has(e.a)) adjacency.set(e.a, new Set())
      if (!adjacency.has(e.b)) adjacency.set(e.b, new Set())
      adjacency.get(e.a)!.add(e.b); adjacency.get(e.b)!.add(e.a)
    }
    const ids = nodes.map((n) => n.key)
    const idSet = new Set(ids)
    const cache = cacheRef.current
    for (const id of [...cache.keys()]) if (!idSet.has(id)) cache.delete(id)

    // Physique : collaborations PUIS appartenances (index >= edges.length = membership,
    // non sélectionnables → renvoyées au « vide »).
    const engineEdges = [...edges.map((e) => ({ a: e.a, b: e.b })), ...membershipEdges]

    const api = createForceGraphEngine(canvas, wrap, {
      nodeIds: () => ids,
      edges: () => engineEdges,
      seed(P, size, view) {
        let i = 0
        for (const n of nodes) {
          if (!P[n.key]) {
            const cached = cache.get(n.key)
            if (cached) P[n.key] = { ...cached }
            else { const a = i * 2.399963, r = 40 + 12 * Math.sqrt(i + 1); P[n.key] = { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, alpha: 0 } }
          }
          i++
        }
        if (view.tx === 0 && view.ty === 0) { view.tx = size.W / 2; view.ty = size.H / 2 }
      },
      draw(ctx, f) {
        const ctrl = controlRef.current
        const sel = ctrl?.selectedKey ?? null
        const selEdge = ctrl?.selectedEdgeIndex ?? null
        const focus = sel ?? f.hoverNode
        const neigh = focus ? adjacency.get(focus) : null

        // ── Appartenances (déploiement) : trait fin pointillé, sous les collaborations ──
        if (membershipEdges.length) {
          ctx.setLineDash([3, 3]); ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1
          for (const m of membershipEdges) {
            const A = f.P[m.a], B = f.P[m.b]; if (!A || !B) continue
            const al = Math.min(A.alpha, B.alpha); if (al < 0.02) continue
            ctx.globalAlpha = al * 0.7
            ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke()
          }
          ctx.setLineDash([]); ctx.globalAlpha = 1
        }

        // ── Arêtes pondérées ──
        edges.forEach((e, i) => {
          const A = f.P[e.a], B = f.P[e.b]; if (!A || !B) return
          const al = Math.min(A.alpha, B.alpha); if (al < 0.02) return
          const emph = i === f.hoverEdgeIndex || i === selEdge
          const nearFocus = focus && (e.a === focus || e.b === focus)
          const dimmed = focus && !nearFocus && !emph
          ctx.strokeStyle = emph ? EDGE_EMPH : EDGE_COLOR
          // Épaisseur = force (bornée) ; transparence = ancienneté (plancher visible).
          ctx.globalAlpha = al * collaborationEdgeAlpha(e.daysSinceLastInteraction) * (dimmed ? 0.25 : 1)
          ctx.lineWidth = collaborationEdgeWidth(e.strength) + (emph ? 1.2 : 0)
          ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke()
          if (emph) {
            const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2
            const txt = `${e.interactionCount} interaction${e.interactionCount > 1 ? 's' : ''}`
            ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'center'
            const tw = ctx.measureText(txt).width
            ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fillRect(mx - tw / 2 - 3, my - 13, tw + 6, 13)
            ctx.fillStyle = '#334155'; ctx.fillText(txt, mx, my - 3)
          }
          ctx.globalAlpha = 1
        })

        // ── Nœuds ──
        for (const n of nodes) {
          const p = f.P[n.key]; if (!p || p.alpha < 0.02) continue
          const isFocus = n.key === focus
          const contextual = !focus || isFocus || (neigh?.has(n.key) ?? false)
          const r = SIZE[n.kind] + (isFocus ? 3 : 0)
          ctx.globalAlpha = p.alpha * (contextual ? 1 : 0.25)
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
          ctx.fillStyle = companyFill(n.companyId); ctx.fill()
          const ring = RING_COLOR[n.level]
          if (ring) { ctx.lineWidth = 3; ctx.strokeStyle = ring; ctx.stroke() }
          if (n.key === sel) { ctx.beginPath(); ctx.arc(p.x, p.y, r + 2.5, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.strokeStyle = '#0f172a'; ctx.stroke() }
          // Libellé : entreprises toujours (peu nombreuses, ce sont les ancres) ;
          // personnes seulement au focus/voisinage.
          if (n.kind === 'company' || contextual) {
            ctx.globalAlpha = p.alpha
            ctx.fillStyle = '#0f172a'
            ctx.font = `${isFocus ? '600 ' : ''}${n.kind === 'company' ? 12 : 11}px system-ui, sans-serif`
            ctx.textAlign = 'center'
            const label = n.label.length > 22 ? n.label.slice(0, 21) + '…' : n.label
            ctx.fillText(label, p.x, p.y + r + 12)
          }
        }
        ctx.globalAlpha = 1
      },
      physics: {
        repulsion: 6000, spring: 0.02, friction: 0.82, gravity: 0.0016,
        // FORCE → PROXIMITÉ : un lien fort raccourcit la distance de repos (les
        // entreprises très liées se rapprochent → vraie silhouette d'écosystème,
        // pas « la Collaboration à qui on a masqué les personnes »). Borné [90,210].
        // Les appartenances (index >= edges.length) collent la personne à son entreprise.
        rest: (_e, index) => index < edges.length
          ? Math.max(90, 210 - 26 * Math.sqrt(Math.max(0, edges[index]!.strength)))
          : 64,
      },
      fade: { in: 0.12, out: 0.14 },
      loop: 'settle',
      zoom: { min: 0.2, max: 3, factorIn: 1.12, factorOut: 0.893 },
      dprCap: 2,
      placeNewNearNeighbors: true,
      hitNodeRadius: (id, k) => (SIZE[nodeByKey.get(id)?.kind ?? 'person'] + 6) / k,
      hitAlphaGate: 0.5,
      edgeHit: { tolerance: (k) => 8 / k, clampA: 0, clampB: 1 },
      features: { pin: false, dblClick: false, edgeTap: true },
      onTapNode(id) { controlRef.current?.onTapNode(id) },
      onTapEdge(index) {
        // Seules les collaborations (index < edges.length) sont inspectables ;
        // une appartenance renvoie au vide.
        if (index < edges.length) controlRef.current?.onTapEdge(index)
        else controlRef.current?.onTapVoid()
      },
      onTapVoid() { controlRef.current?.onTapVoid() },
    })
    apiRef.current = api
    api.kick(2000)
    return () => {
      for (const [id, p] of Object.entries(api.P)) cache.set(id, { ...p })
      api.destroy(); apiRef.current = null
    }
  }, [nodes, edges, membershipEdges])

  return (
    <div ref={containerRef} className={`relative w-full overflow-hidden rounded-2xl border border-border/60 bg-card ${heightClass}`}>
      <canvas ref={canvasRef} className="block h-full w-full touch-none" style={{ cursor: 'grab' }} />
      {/* Légende COURTE et fonctionnelle (le détail vit dans l'inspecteur). */}
      <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-0.5 rounded-lg border border-border/60 bg-background/90 px-2.5 py-2 text-[10.5px] leading-tight text-muted-foreground backdrop-blur">
        <span>Épaisseur = force de collaboration</span>
        <span>Pâleur = ancienneté</span>
        <span>Halo = attention</span>
        <span>Fond = organisation</span>
      </div>
      <p className="pointer-events-none absolute bottom-3 left-3 text-[11px] text-muted-foreground">Molette : zoom · glisser : déplacer · clic : sélectionner</p>
    </div>
  )
}
