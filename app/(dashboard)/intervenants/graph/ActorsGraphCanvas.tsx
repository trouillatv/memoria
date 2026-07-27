'use client'

// ── CANVAS DU GRAPHE DES ACTEURS (client du moteur partagé) ──────────────────
// V2.1 (direction Vincent) : le graphe reste UN GRAPHE.
//   · AUCUNE étiquette permanente sur les liens — libellé au survol, et conservé
//     quand le lien est SÉLECTIONNÉ ;
//   · AUCUNE popup flottante — l'explication vit dans le panneau de droite
//     (ActorsExplorer) ;
//   · AUCUNE navigation au clic — la sélection remonte au parent, tout se met à
//     jour dans la même vue ;
//   · mode « Suivre » : un chemin surligné, le reste s'atténue.
// Deux usages : CONTRÔLÉ (ActorsExplorer : sélection nœud/lien + chemin) ou
// EMBARQUÉ (fiches / panneau maître-détail : onSelectActor reconfigure la page).

import { useEffect, useRef } from 'react'
import { graphTimeline, type ActorsGraph, type ActorGraphKind, type ActorGraphNode } from '@/lib/knowledge/actors-graph-model'
import { createForceGraphEngine, type ForceGraphEngine, type Vec } from '@/components/graph/force-graph-engine'

export type SelectableKind = 'person' | 'company' | 'team'

/** Pilotage par l'Explorer : sélection, chemin et chronologie vivent chez le parent. */
export interface GraphControl {
  selectedNodeId: string | null
  selectedEdgeIndex: number | null
  pathNodes: ReadonlySet<string> | null
  pathEdges: ReadonlySet<number> | null
  /** CHRONOLOGIE (le film) : n'afficher que ce qui existait à cette date — les
   *  relations sans date restent visibles (« depuis toujours »). null = aujourd'hui. */
  timeMax?: string | null
  /** COUCHES : natures de nœuds visibles (null = toutes). Pilote les perspectives —
   *  on change la LECTURE du graphe, pas les données. */
  visibleKinds?: ReadonlySet<ActorGraphKind> | null
  onTapNode(node: ActorGraphNode): void
  onTapEdge(index: number): void
  onTapVoid(): void
}

// ── Config propre aux ACTEURS ────────────────────────────────────────────────
const LEVEL_COLOR = { urgent: '#dc2626', attention: '#f59e0b', ok: '#3b82f6' } as const
const HISTORICAL_COLOR = '#94a3b8'
// Hiérarchie visuelle : entreprise > chantier > personne = équipe > action.
const SIZE: Record<ActorGraphKind, number> = { company: 24, site: 19, person: 14, team: 14, action: 9 }

function nodeColor(n: ActorGraphNode): string {
  if (n.historical) return HISTORICAL_COLOR
  return LEVEL_COLOR[n.level]
}

export function ActorsGraphCanvas({ graph, focusId, heightClass = 'h-[70vh]', onSelectActor, control, centerRequest }: {
  graph: ActorsGraph
  focusId?: string | null
  heightClass?: string
  /** Mode EMBARQUÉ (panneau maître-détail) : cliquer un acteur reconfigure la page. */
  onSelectActor?: (kind: SelectableKind, id: string) => void
  /** Mode CONTRÔLÉ (ActorsExplorer) : la sélection/le chemin vivent chez le parent. */
  control?: GraphControl
  /** RECHERCHE : recentrer sur un nœud à la demande (le nonce force le recadrage
   *  même sur le même acteur). La sélection est portée par `control`. */
  centerRequest?: { id: string; nonce: number } | null
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const apiRef = useRef<ForceGraphEngine | null>(null)
  // Positions conservées entre changements de graphe (le maître-détail remplace le
  // graphe sans démonter le composant).
  const cacheRef = useRef<Map<string, Vec>>(new Map())
  // Sélection LOCALE (mode embarqué sans handler) — simple mise en évidence.
  const localSelRef = useRef<string | null>(null)
  const onSelectRef = useRef(onSelectActor)
  const controlRef = useRef(control)
  useEffect(() => { onSelectRef.current = onSelectActor }, [onSelectActor])
  useEffect(() => { controlRef.current = control }, [control])

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
    // Chronologie : première apparition structurelle de chaque nœud (pur).
    const { firstSeen } = graphTimeline(graph)

    const api = createForceGraphEngine(canvas, wrap, {
      nodeIds: () => ids,
      edges: () => graph.edges,
      // Le film + les couches : à la date T, seuls les nœuds déjà apparus (ou
      // « depuis toujours ») ET dont la nature est visible sont affichés — le moteur
      // gère l'apparition/disparition en fondu.
      visible() {
        const ctrl = controlRef.current
        const tMax = ctrl?.timeMax ?? null
        const vk = ctrl?.visibleKinds ?? null
        if (!tMax && !vk) return new Set(ids)
        const s = new Set<string>()
        for (const id of ids) {
          if (vk && !vk.has(nodeById.get(id)!.kind)) continue
          if (tMax) { const fs = firstSeen.get(id) ?? null; if (fs !== null && fs > tMax) continue }
          s.add(id)
        }
        return s
      },
      seed(P, size, view) {
        // Anneau à angle d'or autour du centre monde (0,0) — la gravité y ramène.
        let i = 0
        for (const n of graph.nodes) {
          if (!P[n.id]) {
            const cached = cache.get(n.id)
            if (cached) P[n.id] = { ...cached }
            else {
              const a = i * 2.399963
              const r = 40 + 12 * Math.sqrt(i + 1)
              P[n.id] = { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, alpha: 0 }
            }
          }
          i++
        }
        if (view.tx === 0 && view.ty === 0) { view.tx = size.W / 2; view.ty = size.H / 2 }
      },
      draw(ctx, f) {
        const ctrl = controlRef.current
        const sel = ctrl ? ctrl.selectedNodeId : localSelRef.current
        const selEdge = ctrl?.selectedEdgeIndex ?? null
        const pathNodes = ctrl?.pathNodes ?? null
        const pathEdges = ctrl?.pathEdges ?? null
        const hov = f.hoverNode
        const focus = sel ?? hov
        const neigh = focus ? adjacency.get(focus) : null
        // TROIS ÉTATS (comme Explorer Mémoire) : FOCUS (inspecté, contour épais) ·
        // CONTEXTE (voisinage, plein) · HORS CONTEXTE (très estompé, sans label).
        const state = (id: string): 'focus' | 'context' | 'out' => {
          if (pathNodes) return pathNodes.has(id) ? (id === focus ? 'focus' : 'context') : 'out'
          if (!focus) return 'context'
          if (id === focus) return 'focus'
          return neigh && neigh.has(id) ? 'context' : 'out'
        }

        // Arêtes — libellé UNIQUEMENT au survol ou sur le lien sélectionné (jamais
        // d'étiquettes permanentes). L'alpha du replay (fondu) s'applique partout.
        graph.edges.forEach((e, i) => {
          const A = f.P[e.a], B = f.P[e.b]
          if (!A || !B) return
          const al = Math.min(A.alpha, B.alpha)
          if (al < 0.02) return
          const inPath = pathEdges ? pathEdges.has(i) : null
          const emphasized = i === f.hoverEdgeIndex || i === selEdge || inPath === true
          const nearFocus = focus && (e.a === focus || e.b === focus)
          const dimmed = (pathEdges && !inPath) || (!pathEdges && focus && !nearFocus && !emphasized)
          ctx.strokeStyle = emphasized ? '#334155' : nearFocus ? '#64748b' : '#e2e8f0'
          ctx.globalAlpha = al * (dimmed ? 0.15 : 1)
          ctx.lineWidth = emphasized ? 2.2 : nearFocus ? 1.6 : 1
          ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke()
          if (i === f.hoverEdgeIndex || i === selEdge) {
            const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2
            ctx.font = '10px system-ui, sans-serif'
            ctx.textAlign = 'center'
            const tw = ctx.measureText(e.label).width
            ctx.fillStyle = 'rgba(255,255,255,0.92)'
            ctx.fillRect(mx - tw / 2 - 3, my - 13, tw + 6, 13)
            ctx.fillStyle = '#334155'
            ctx.fillText(e.label, mx, my - 3)
          }
          ctx.globalAlpha = 1
        })

        // Nœuds.
        for (const n of graph.nodes) {
          const p = f.P[n.id]
          if (!p || p.alpha < 0.02) continue
          const st = state(n.id)
          const r = SIZE[n.kind] + (st === 'focus' ? 3 : 0)
          ctx.globalAlpha = p.alpha * (st === 'out' ? 0.16 : 1)
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
          ctx.fillStyle = nodeColor(n)
          ctx.fill()
          if (n.id === sel) { ctx.lineWidth = 3; ctx.strokeStyle = '#0f172a'; ctx.stroke() }
          // Labels : seulement le focus et son contexte quand un focus existe —
          // l'œil comprend immédiatement ce qui est important.
          if (st !== 'out') {
            ctx.globalAlpha = p.alpha
            ctx.fillStyle = '#0f172a'
            ctx.font = `${st === 'focus' ? '600 ' : ''}${n.kind === 'site' ? 12 : 11}px system-ui, sans-serif`
            ctx.textAlign = 'center'
            const label = n.label.length > 22 ? n.label.slice(0, 21) + '…' : n.label
            ctx.fillText(label, p.x, p.y + r + 12)
          }
        }
        ctx.globalAlpha = 1
      },
      physics: { repulsion: 5200, spring: 0.02, rest: () => 150, friction: 0.82, gravity: 0.0015 },
      // Fondu d'apparition/disparition (replay + entrées de nœuds) — mêmes constantes
      // que Mémoire (0.12 in / 0.14 out).
      fade: { in: 0.12, out: 0.14 },
      loop: 'continuous',
      zoom: { min: 0.2, max: 3, factorIn: 1.12, factorOut: 0.893 },
      dprCap: 2,
      placeNewNearNeighbors: true,
      hitNodeRadius: (id, k) => (SIZE[nodeById.get(id)?.kind ?? 'action'] + 6) / k,
      hitAlphaGate: 0.5,
      edgeHit: { tolerance: (k) => 8 / k, clampA: 0, clampB: 1 },
      features: { pin: false, dblClick: false, edgeTap: !!controlRef.current },
      onTapNode(id) {
        const node = nodeById.get(id) ?? null
        if (!node) return
        const ctrl = controlRef.current
        if (ctrl) { ctrl.onTapNode(node); return } // Explorer : AUCUNE navigation
        if ((node.kind === 'person' || node.kind === 'company' || node.kind === 'team') && onSelectRef.current) {
          // Panneau maître-détail : reconfigure la page en place (pas de rechargement).
          onSelectRef.current(node.kind, node.id.slice(node.id.indexOf('_') + 1))
        } else {
          localSelRef.current = node.id // mise en évidence locale, sans popup
        }
      },
      onTapEdge(index) { controlRef.current?.onTapEdge(index) },
      onTapVoid() {
        const ctrl = controlRef.current
        if (ctrl) ctrl.onTapVoid()
        else localSelRef.current = null
      },
    })
    apiRef.current = api

    return () => {
      // Mémorise les positions pour le prochain graphe (dédup par id).
      for (const [id, p] of Object.entries(api.P)) cache.set(id, { ...p })
      api.destroy()
      apiRef.current = null
    }
  }, [graph])

  // Centrage initial (« Voir son réseau » / focus Explorer).
  useEffect(() => {
    const api = apiRef.current
    if (!focusId || !api) return
    const p = api.P[focusId]
    const { W, H } = api.size()
    if (p && W) {
      api.view.k = 1.1
      api.view.tx = W / 2 - p.x * api.view.k
      api.view.ty = H / 2 - p.y * api.view.k
      if (!controlRef.current) localSelRef.current = focusId
      api.redraw()
    }
  }, [focusId, graph])

  // Recherche → recadrage sur le nœud trouvé (le nonce déclenche même à id égal).
  useEffect(() => {
    const api = apiRef.current
    if (!centerRequest || !api) return
    const p = api.P[centerRequest.id]
    const { W, H } = api.size()
    if (p && W) {
      api.view.k = Math.max(api.view.k, 1.1) // ne pas dézoomer un utilisateur déjà zoomé
      api.view.tx = W / 2 - p.x * api.view.k
      api.view.ty = H / 2 - p.y * api.view.k
      api.redraw()
    }
  }, [centerRequest])

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

      <p className="pointer-events-none absolute bottom-3 left-3 text-[11px] text-muted-foreground">
        Molette : zoom · glisser : déplacer · clic : sélectionner
      </p>
    </div>
  )
}

function Dot({ c }: { c: string }) {
  return <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: c }} />
}
