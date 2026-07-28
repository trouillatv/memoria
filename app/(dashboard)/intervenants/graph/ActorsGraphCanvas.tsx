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
import { graphTimeline, type ActorsGraph, type ActorGraphKind, type ActorGraphNode, type ActorGraphRel } from '@/lib/knowledge/actors-graph-model'
import { createForceGraphEngine, type ForceGraphEngine, type Vec } from '@/components/graph/force-graph-engine'
import { RING_COLOR, HISTORICAL_COLOR, NEUTRAL_FILL, companyFill } from './actor-colors'
import { hierarchicalLayout, radialLayout, layeredLayout, type GraphLayoutKind } from '@/lib/knowledge/graph-layouts'

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
  /** ENQUÊTE : sous-graphe de l'acteur inspecté. Sert à la mise en évidence (le
   *  reste s'estompe) ou, si `isolate`, à n'afficher QUE lui. null = pas d'enquête. */
  focusSet?: ReadonlySet<string> | null
  isolate?: boolean
  /** Liens colorés par NATURE de relation seulement si activé (défaut : neutres). */
  colorEdgesByNature?: boolean
  onTapNode(node: ActorGraphNode): void
  onTapEdge(index: number): void
  onTapVoid(): void
}

// ── Langage visuel des ACTEURS (V2) ──────────────────────────────────────────
// FOND = organisation (entreprise) → « qui travaille avec qui » d'un coup d'œil.
// ANNEAU = état d'attention (rouge/orange) → « où sont les points d'attention ».
// LIENS = couleur par type de relation → le sens sans avoir à lire les libellés.
// Couleurs (fond/halo) PARTAGÉES avec le graphe de collaboration (actor-colors).
// Hiérarchie visuelle FORTE : le CHANTIER est un HUB dominant (centre de gravité),
// l'entreprise une ancre, la personne secondaire, l'action minime.
const SIZE: Record<ActorGraphKind, number> = { site: 36, company: 30, person: 13, team: 15, action: 8 }
// Couleur de HUB (chantier) : distincte des entreprises → le centre saute aux yeux.
const SITE_HUB_FILL = '#334155'

function nodeFill(n: ActorGraphNode): string {
  if (n.historical) return HISTORICAL_COLOR
  if (n.kind === 'site') return SITE_HUB_FILL // hub, pas une entreprise
  if (n.companyId) return companyFill(n.companyId)
  return NEUTRAL_FILL
}

// Couleur NEUTRE des liens (langage épuré par défaut) — la couleur par nature
// n'apparaît que si l'utilisateur active cette lecture.
const EDGE_NEUTRAL = '#94a3b8'
// Couleur des LIENS par type de relation (le sens même labels cachés) — lecture optionnelle.
const REL_COLOR: Record<ActorGraphRel, string> = {
  belongs_to: '#60a5fa',      // appartient à (entreprise) — bleu
  member_of: '#a78bfa',       // membre d'équipe — violet
  mobilized_on: '#34d399',    // équipe mobilisée sur un chantier — vert
  intervenes_on: '#22c55e',   // entreprise intervient sur un chantier — vert
  referent_of: '#fbbf24',     // référent d'une action — ambre
  responsible_of: '#fb923c',  // responsable d'une action — orange
}

/** Signature stable des couches visibles — pour ne relancer la simulation QUE
 *  quand la géométrie change vraiment (pas à chaque sélection). */
function kindSig(vk: ReadonlySet<ActorGraphKind> | null | undefined): string {
  return vk ? [...vk].sort().join(',') : 'all'
}

/** Signature de l'ISOLEMENT : ne change la géométrie que si l'on isole (le contenu
 *  affiché varie). En mise en évidence, le sous-graphe ne change pas la visibilité. */
function isoSig(ctrl: GraphControl | undefined): string {
  return ctrl?.isolate && ctrl.focusSet ? [...ctrl.focusSet].sort().join(',') : ''
}

export function ActorsGraphCanvas({ graph, focusId, heightClass = 'h-[70vh]', onSelectActor, control, centerRequest, layout = 'force' }: {
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
  /** ALGORITHME DE PLACEMENT (V3 UX) : 'force' (physique) ou 'hierarchical'
   *  (Organigramme : positions déterministes, physique coupée). */
  layout?: GraphLayoutKind
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
  // Dernier état de géométrie appliqué (chronologie + couches) : sert à relancer une
  // brève simulation UNIQUEMENT quand ce qui est affiché change — pas à chaque
  // sélection/survol (qui ne font que redessiner).
  const lastTimeMaxRef = useRef<string | null | undefined>(undefined)
  const lastKindSigRef = useRef<string | undefined>(undefined)
  const lastIsoSigRef = useRef<string | undefined>(undefined)
  useEffect(() => { onSelectRef.current = onSelectActor }, [onSelectActor])
  useEffect(() => {
    controlRef.current = control
    const api = apiRef.current
    if (!api) return
    const tm = control?.timeMax ?? null
    const ks = kindSig(control?.visibleKinds)
    const is = isoSig(control)
    if (tm !== lastTimeMaxRef.current || ks !== lastKindSigRef.current || is !== lastIsoSigRef.current) {
      lastTimeMaxRef.current = tm
      lastKindSigRef.current = ks
      lastIsoSigRef.current = is
      api.refreshVisibility() // géométrie changée (couches/chrono/isolement) → repositionne + relance
    } else {
      // Sélection / chemin / survol / mise en évidence : la disposition ne bouge pas,
      // on redessine juste (en mode figé, rien ne redessinerait sinon).
      api.redraw()
    }
  }, [control])

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
    // LAYOUT STATIQUE (Organigramme hiérarchique / Chantiers radial) : positions
    // déterministes + physique coupée.
    const layoutResult = layout === 'hierarchical' ? hierarchicalLayout(graph)
      : layout === 'radial' ? radialLayout(graph)
        : layout === 'layered' ? layeredLayout(graph) : null
    const layoutPos = layoutResult?.positions ?? null
    const layoutBlocks = layoutResult?.blocks ?? null

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
        // Mode « Isoler » : n'afficher QUE le sous-graphe d'enquête (intersecté aux
        // couches / à la chronologie). Sinon tous les nœuds (mise en évidence au draw).
        const iso = ctrl?.isolate ? ctrl.focusSet ?? null : null
        if (!tMax && !vk && !iso) return new Set(ids)
        const s = new Set<string>()
        for (const id of ids) {
          if (iso && !iso.has(id)) continue
          if (vk && !vk.has(nodeById.get(id)!.kind)) continue
          if (tMax) { const fs = firstSeen.get(id) ?? null; if (fs !== null && fs > tMax) continue }
          s.add(id)
        }
        return s
      },
      seed(P, size, view) {
        if (layoutPos) {
          // ORGANIGRAMME : chaque nœud à sa position hiérarchique fixe. Les nœuds hors
          // layout (chantiers/actions, invisibles ici) sont renvoyés hors-champ.
          for (const n of graph.nodes) {
            const lp = layoutPos.get(n.id)
            P[n.id] = lp ? { x: lp.x, y: lp.y, vx: 0, vy: 0, alpha: P[n.id]?.alpha ?? 0 } : { x: 1e6, y: 0, vx: 0, vy: 0, alpha: 0 }
          }
          // Recadrage : ajuster zoom + centre à l'emprise du layout.
          const xs = [...layoutPos.values()].map((p) => p.x), ys = [...layoutPos.values()].map((p) => p.y)
          if (xs.length) {
            const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
            const w = maxX - minX + 240, h = maxY - minY + 160
            view.k = Math.max(0.3, Math.min(1.2, Math.min(size.W / w, size.H / h)))
            view.tx = size.W / 2 - ((minX + maxX) / 2) * view.k
            view.ty = size.H / 2 - ((minY + maxY) / 2) * view.k
          }
          return
        }
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
        // ORGANIGRAMME : cartes de groupe (entreprise/strate) DERRIÈRE tout — le
        // cerveau voit « ces personnes appartiennent ensemble » avant de lire.
        if (layoutBlocks) {
          for (const b of layoutBlocks) {
            const x = b.cx - b.halfWidth, y = b.top, w = b.halfWidth * 2, h = b.bottom - b.top
            ctx.beginPath()
            if (ctx.roundRect) ctx.roundRect(x, y, w, h, 14); else ctx.rect(x, y, w, h)
            ctx.fillStyle = 'rgba(148,163,184,0.07)'; ctx.fill()
            ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(148,163,184,0.35)'; ctx.stroke()
            if (b.title) {
              ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center'
              ctx.fillStyle = '#64748b'; ctx.fillText(b.title.toUpperCase(), b.cx, b.top + 15)
            }
          }
        }
        const ctrl = controlRef.current
        const sel = ctrl ? ctrl.selectedNodeId : localSelRef.current
        const selEdge = ctrl?.selectedEdgeIndex ?? null
        const pathNodes = ctrl?.pathNodes ?? null
        const pathEdges = ctrl?.pathEdges ?? null
        const hov = f.hoverNode
        const focus = sel ?? hov
        const neigh = focus ? adjacency.get(focus) : null
        // ENQUÊTE : le sous-graphe (lentille) définit le CONTEXTE mis en avant quand
        // l'acteur est sélectionné ; sinon on retombe sur le voisinage direct.
        const focusSet = sel && ctrl?.focusSet ? ctrl.focusSet : null
        // TROIS ÉTATS (comme Explorer Mémoire) : FOCUS (inspecté, contour épais) ·
        // CONTEXTE (mis en avant, plein) · HORS CONTEXTE (très estompé, sans label).
        const state = (id: string): 'focus' | 'context' | 'out' => {
          if (pathNodes) return pathNodes.has(id) ? (id === focus ? 'focus' : 'context') : 'out'
          if (!focus) return 'context'
          if (id === focus) return 'focus'
          if (focusSet) return focusSet.has(id) ? 'context' : 'out'
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
          // Neutres par défaut ; colorées par nature seulement si la lecture est active.
          ctx.strokeStyle = ctrl?.colorEdgesByNature ? REL_COLOR[e.rel] : EDGE_NEUTRAL
          ctx.globalAlpha = al * (dimmed ? 0.12 : emphasized ? 1 : nearFocus ? 0.9 : 0.55)
          ctx.lineWidth = emphasized ? 2.6 : nearFocus ? 1.8 : 1.2
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
          // FOND = entreprise (ou neutre) — on regroupe l'organisation à l'œil.
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
          ctx.fillStyle = nodeFill(n)
          ctx.fill()
          // ANNEAU = état d'attention (rouge/orange), toutes natures — préserve le
          // signal « où sont les problèmes » malgré le fond coloré par entreprise.
          const ring = n.historical ? null : RING_COLOR[n.level]
          if (ring) { ctx.lineWidth = 3; ctx.strokeStyle = ring; ctx.stroke() }
          // Sélection : anneau sombre EXTÉRIEUR (n'écrase pas l'anneau d'alerte).
          if (n.id === sel) { ctx.beginPath(); ctx.arc(p.x, p.y, r + 2.5, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.strokeStyle = '#0f172a'; ctx.stroke() }
          // Labels : toujours dans les layouts statiques (organigramme/radial se
          // lisent en entier) ; sinon seulement le focus et son contexte.
          if (layout !== 'force' || st !== 'out') {
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
      // Layouts statiques : AUCUNE force — les positions sont fixes.
      physics: layout !== 'force'
        ? { repulsion: 0, spring: 0, rest: () => 0, friction: 0.9, gravity: 0 }
        : { repulsion: 5200, spring: 0.02, rest: () => 150, friction: 0.82, gravity: 0.0015 },
      // Fondu d'apparition/disparition (replay + entrées de nœuds) — mêmes constantes
      // que Mémoire (0.12 in / 0.14 out).
      fade: { in: 0.12, out: 0.14 },
      // Le graphe se met en place puis SE FIGE (au lieu de bouger indéfiniment) : la
      // simulation ne vit que pendant un geste ou une relance bornée (cf. kick 2 s).
      loop: 'settle',
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
    // Mémorise l'état de géométrie initial (évite une relance parasite au 1er rendu)
    // et laisse jusqu'à 2 s pour se mettre en place, puis STOP (la friction fige avant
    // si l'énergie retombe).
    lastTimeMaxRef.current = controlRef.current?.timeMax ?? null
    lastKindSigRef.current = kindSig(controlRef.current?.visibleKinds)
    lastIsoSigRef.current = isoSig(controlRef.current)
    api.kick(2000)

    return () => {
      // Mémorise les positions pour le prochain graphe FORCE (jamais les positions
      // statiques, qui pollueraient la disposition physique).
      if (layout === 'force') for (const [id, p] of Object.entries(api.P)) cache.set(id, { ...p })
      api.destroy()
      apiRef.current = null
    }
  }, [graph, layout])

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

      <p className="pointer-events-none absolute bottom-3 left-3 text-[11px] text-muted-foreground">
        Molette : zoom · glisser : déplacer · clic : sélectionner
      </p>
    </div>
  )
}
