'use client'

// ── CANVAS DU GRAPHE DES ACTEURS (client du moteur partagé, V2.0) ────────────
// Depuis V2.0, la MÉCANIQUE (physique, zoom/pan/drag, hit, boucle) vit dans
// components/graph/force-graph-engine.ts, partagée avec l'Explorer Mémoire.
// Ce fichier ne garde que le SENS acteurs : config physique V1 (gravité douce,
// boucle continue), rendu (couleur = attentionState, tailles hiérarchisées,
// libellés de relation au survol), sélection/navigation (onSelectActor) et
// habillage (légende, panneau, hint). Iso-comportement avec la V1.
// NE PAS mélanger avec le graphe Mémoire : même moteur, deux histoires.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ActorsGraph, ActorGraphKind, ActorGraphNode } from '@/lib/knowledge/actors-graph'
import { createForceGraphEngine, type ForceGraphEngine, type Vec } from '@/components/graph/force-graph-engine'

export type SelectableKind = 'person' | 'company' | 'team'

// ── Config propre aux ACTEURS ────────────────────────────────────────────────
const LEVEL_COLOR = { urgent: '#dc2626', attention: '#f59e0b', ok: '#3b82f6' } as const
const HISTORICAL_COLOR = '#94a3b8'
// Hiérarchie visuelle (Vincent) : entreprise > chantier > personne = équipe > action.
const SIZE: Record<ActorGraphKind, number> = { company: 24, site: 19, person: 14, team: 14, action: 9 }
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
  const apiRef = useRef<ForceGraphEngine | null>(null)
  // Positions conservées entre changements de graphe (le maître-détail remplace le
  // graphe sans démonter le composant) — iso avec la V1.
  const cacheRef = useRef<Map<string, Vec>>(new Map())
  const [selected, setSelected] = useState<ActorGraphNode | null>(null)
  const selectedRef = useRef<string | null>(null)
  const onSelectRef = useRef(onSelectActor)
  useEffect(() => { onSelectRef.current = onSelectActor }, [onSelectActor])

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = containerRef.current
    if (!canvas || !wrap) return

    const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))
    const adjacency = new Map<string, Set<string>>()
    for (const e of graph.edges) {
      if (!adjacency.has(e.a)) adjacency.set(e.a, new Set())
      if (!adjacency.has(e.b)) adjacency.set(e.b, new Set())
      adjacency.get(e.a)!.add(e.b)
      adjacency.get(e.b)!.add(e.a)
    }
    const ids = graph.nodes.map((n) => n.id)
    const idSet = new Set(ids)
    const cache = cacheRef.current
    for (const id of [...cache.keys()]) if (!idSet.has(id)) cache.delete(id)

    const api = createForceGraphEngine(canvas, wrap, {
      nodeIds: () => ids,
      edges: () => graph.edges,
      seed(P, size, view) {
        // Anneau à angle d'or autour du centre monde (0,0) — la gravité y ramène.
        let i = 0
        for (const n of graph.nodes) {
          if (!P[n.id]) {
            const cached = cacheRef.current.get(n.id)
            if (cached) P[n.id] = { ...cached }
            else {
              const a = i * 2.399963
              const r = 40 + 12 * Math.sqrt(i + 1)
              P[n.id] = { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, alpha: 1 }
            }
          }
          i++
        }
        if (view.tx === 0 && view.ty === 0) { view.tx = size.W / 2; view.ty = size.H / 2 }
      },
      draw(ctx, f) {
        const sel = selectedRef.current
        const hov = f.hoverNode
        const focus = sel ?? hov
        const neigh = focus ? adjacency.get(focus) : null

        // Arêtes — les LIENS PARLENT : libellé au voisinage du focus ET au survol du lien.
        graph.edges.forEach((e, i) => {
          const A = f.P[e.a], B = f.P[e.b]
          if (!A || !B) return
          const on = (focus && (e.a === focus || e.b === focus)) || i === f.hoverEdgeIndex
          ctx.strokeStyle = on ? '#475569' : '#e2e8f0'
          ctx.lineWidth = on ? 1.8 : 1
          ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke()
          if (on) {
            const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2
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
          const p = f.P[n.id]
          if (!p) continue
          const r = SIZE[n.kind]
          const dim = focus && n.id !== focus && !(neigh && neigh.has(n.id))
          ctx.globalAlpha = dim ? 0.28 : 1
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
          ctx.fillStyle = nodeColor(n)
          ctx.fill()
          if (n.id === sel) { ctx.lineWidth = 3; ctx.strokeStyle = '#0f172a'; ctx.stroke() }
          ctx.globalAlpha = dim ? 0.4 : 1
          ctx.fillStyle = '#0f172a'
          ctx.font = `${n.kind === 'site' ? 12 : 11}px system-ui, sans-serif`
          ctx.textAlign = 'center'
          const label = n.label.length > 22 ? n.label.slice(0, 21) + '…' : n.label
          ctx.fillText(label, p.x, p.y + r + 12)
        }
        ctx.globalAlpha = 1
      },
      physics: { repulsion: 5200, spring: 0.02, rest: () => 150, friction: 0.82, gravity: 0.0015 },
      fade: null,
      loop: 'continuous',
      zoom: { min: 0.2, max: 3, factorIn: 1.12, factorOut: 0.893 },
      dprCap: 2,
      hitNodeRadius: (id, k) => (SIZE[nodeById.get(id)?.kind ?? 'action'] + 6) / k,
      edgeHit: { tolerance: (k) => 8 / k, clampA: 0, clampB: 1 },
      features: { pin: false, dblClick: false },
      onTapNode(id) {
        const node = nodeById.get(id) ?? null
        if (node && (node.kind === 'person' || node.kind === 'company' || node.kind === 'team')) {
          // NAVIGATION DANS LE RÉSEAU : dans le panneau, on RECONFIGURE la page ;
          // sur la page dédiée, on navigue.
          const raw = node.id.slice(node.id.indexOf('_') + 1)
          if (onSelectRef.current) onSelectRef.current(node.kind, raw)
          else { const h = nodeHref(node); if (h) router.push(h) }
        } else if (node) {
          selectedRef.current = node.id; setSelected(node) // chantier / action → panneau d'info
        }
      },
      onTapVoid() { selectedRef.current = null; setSelected(null) },
    })
    apiRef.current = api

    return () => {
      // Mémorise les positions pour le prochain graphe (dédup par id).
      for (const [id, p] of Object.entries(api.P)) cache.set(id, { ...p })
      api.destroy()
      apiRef.current = null
    }
  }, [graph, router])

  // Centrage initial sur le nœud « Voir son réseau ».
  useEffect(() => {
    const api = apiRef.current
    if (!focusId || !api) return
    const p = api.P[focusId]
    const { W, H } = api.size()
    if (p && W) {
      api.view.k = 1.1
      api.view.tx = W / 2 - p.x * api.view.k
      api.view.ty = H / 2 - p.y * api.view.k
      selectedRef.current = focusId
      setSelected(graph.nodes.find((n) => n.id === focusId) ?? null)
      api.redraw()
    }
     
  }, [focusId, graph])

  const selHref = selected ? nodeHref(selected) : null

  return (
    <div ref={containerRef} className={`relative w-full overflow-hidden rounded-2xl border border-border/60 bg-card ${heightClass}`}>
      <canvas ref={canvasRef} className="block h-full w-full touch-none" style={{ cursor: 'grab' }} />

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
