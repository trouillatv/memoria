'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { SiteGraph, GraphNodeType } from '@/lib/knowledge/site-graph'
import { createForceGraphEngine } from '@/components/graph/force-graph-engine'
import { useGraphCanvas } from '@/lib/graph/use-graph-canvas'
import { GraphToolbar } from '@/components/graph/GraphToolbar'
import { GraphTimeline } from '@/app/(dashboard)/intervenants/graph/GraphTimeline'
import {
  COLOR, COLOR_DARK, SIZE, TYPE_LABEL,
  PROOF, GLOBAL_DEFAULT,
  computeVisible, enUnePhrase, recit, ifGone, chainToSource,
} from '@/lib/graph/site-graph-logic'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import Link from 'next/link'
import { cn } from '@/lib/utils'

const LEGEND_TYPES: GraphNodeType[] = [
  'visite', 'memo', 'action', 'ech', 'dec', 'vigilance', 'acteur', 'photo', 'know',
]

interface Props {
  graph: SiteGraph
  canvasHeight?: number
}

export function MobileExplorerCanvas({ graph, canvasHeight }: Props) {
  const { canvasRef, wrapRef, engineRef, fitToView, zoomBy } = useGraphCanvas()

  const [center, setCenter] = useState('site')
  const [depth,  setDepth]  = useState<1 | 2>(2)
  const [hidden, setHidden] = useState<ReadonlySet<GraphNodeType>>(new Set())
  const [sheetId, setSheetId] = useState<string | null>(null)
  const [showRecit, setShowRecit] = useState(false)

  const nodeById = useMemo(
    () => Object.fromEntries(graph.nodes.map((n) => [n.id, n])),
    [graph],
  )
  const neigh = useMemo(() => {
    const m: Record<string, Set<string>> = {}
    for (const e of graph.edges) {
      ;(m[e.a] ??= new Set()).add(e.b)
      ;(m[e.b] ??= new Set()).add(e.a)
    }
    return m
  }, [graph])
  const days = useMemo(() => {
    const s = new Set<string>()
    for (const n of graph.nodes) if (n.t) s.add(n.t.slice(0, 10))
    return [...s].sort()
  }, [graph])
  const typeCounts = useMemo(() => {
    const c = {} as Record<GraphNodeType, number>
    for (const n of graph.nodes) if (n.type !== 'site') c[n.type] = (c[n.type] ?? 0) + (n.count ?? 1)
    return c
  }, [graph])

  // ── Miroir hors-React pour le moteur ─────────────────────────────────────────
  const E = useRef({
    center:      'site',
    depth:       2 as 1 | 2,
    timeMax:     null as string | null,
    hiddenTypes: new Set<GraphNodeType>() as ReadonlySet<GraphNodeType>,
    revealedTypes: new Set<GraphNodeType>() as ReadonlySet<GraphNodeType>,
    selectedId:  null as string | null,
    refreshVis:  undefined as (() => void) | undefined,
    redraw:      undefined as (() => void) | undefined,
  })

  // Sync selectedId → redraw (aucune physique)
  useEffect(() => {
    E.current.selectedId = sheetId
    E.current.redraw?.()
  }, [sheetId])

  // ── Helpers d'action ─────────────────────────────────────────────────────────

  // Naviguer vers un nœud (changer le centre) : kick court pour réajustement local.
  function navigateTo(id: string, newDepth: 1 | 2 = 2) {
    E.current.center      = id
    E.current.depth       = newDepth
    E.current.selectedId  = null
    setCenter(id)
    setDepth(newDepth)
    setSheetId(null)
    setShowRecit(false)
    E.current.refreshVis?.()
    engineRef.current?.kick(280)
  }

  function toggleHidden(t: GraphNodeType) {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t); else next.add(t)
      E.current.hiddenTypes = next
      E.current.refreshVis?.()
      return next
    })
  }

  // ── Moteur canvas (créé une fois) ─────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap   = wrapRef.current
    if (!canvas || !wrap) return

    const dark = () =>
      document.documentElement.dataset.theme === 'dark' ||
      (document.documentElement.dataset.theme !== 'light' &&
        matchMedia('(prefers-color-scheme: dark)').matches)
    const col = (t: GraphNodeType) => (dark() ? COLOR_DARK : COLOR)[t]

    const visible = () => computeVisible({
      center:        E.current.center,
      depth:         E.current.depth,
      enqueteSet:    null,
      timeMax:       E.current.timeMax,
      hiddenTypes:   E.current.hiddenTypes,
      revealedTypes: E.current.revealedTypes,
      neigh,
      nodeById,
    })

    const api = createForceGraphEngine(canvas, wrap, {
      nodeIds: () => graph.nodes.map((n) => n.id),
      edges:   () => graph.edges,
      visible,

      seed(P, { W, H }) {
        const ring = [...(neigh[E.current.center] ?? [])]
        P[E.current.center] ??= { x: W / 2, y: H / 2, vx: 0, vy: 0, alpha: 0 }
        ring.forEach((id, i) => {
          const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, ring.length)
          P[id] ??= { x: W / 2 + 130 * Math.cos(a), y: H / 2 + 130 * Math.sin(a), vx: 0, vy: 0, alpha: 0 }
        })
        for (const n of graph.nodes)
          P[n.id] ??= { x: W / 2 + (Math.random() - 0.5) * 280, y: H / 2 + (Math.random() - 0.5) * 280, vx: 0, vy: 0, alpha: 0 }
      },

      draw(ctx, f) {
        const surface = dark() ? '#1E1A25' : '#FFFFFF'
        const inkC    = dark() ? '#F0EDF6' : '#1C1B22'
        const mutedC  = dark() ? '#A49DB3' : '#6B6577'

        const sel      = E.current.selectedId
        const selNeigh = sel ? (neigh[sel] ?? new Set<string>()) : null
        const labelVisible = (id: string) =>
          id === E.current.center || (neigh[E.current.center] ?? new Set()).has(id) || id === sel

        // ── Arêtes ──
        for (const e of graph.edges) {
          const A = f.P[e.a], B = f.P[e.b]; if (!A || !B) continue
          const al = Math.min(A.alpha, B.alpha); if (al < 0.02) continue
          const isSelEdge = sel ? (e.a === sel || e.b === sel) : false
          const active    = e.a === E.current.center || e.b === E.current.center
          const dim       = sel && !isSelEdge ? 0.10 : 1
          ctx.strokeStyle = col(e.type)
          ctx.globalAlpha = al * dim * (active ? 0.8 : isSelEdge ? 0.9 : 0.3)
          ctx.lineWidth   = isSelEdge ? 2.2 : active ? 1.4 : 1
          ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke()
        }

        // ── Nœuds ──
        for (const n of graph.nodes) {
          const p = f.P[n.id]; if (!p || p.alpha < 0.02) continue
          const isSel   = sel ? n.id === sel : false
          const isNear  = selNeigh ? selNeigh.has(n.id) : false
          const dim     = sel && !isSel && !isNear ? 0.25 : 1
          const baseR   = n.id === E.current.center ? SIZE[n.type] + 6 : SIZE[n.type]
          const r       = isSel ? Math.round(baseR * 1.3) : baseR

          // Halo sélection
          if (isSel) {
            ctx.globalAlpha = p.alpha * 0.28
            ctx.beginPath(); ctx.arc(p.x, p.y, r + 11, 0, 7)
            ctx.fillStyle = col(n.type); ctx.fill()
          }

          ctx.globalAlpha = p.alpha * dim
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7)
          ctx.fillStyle = surface; ctx.fill()
          ctx.lineWidth   = isSel ? 4 : n.id === E.current.center ? 3.5 : 2.2
          ctx.strokeStyle = col(n.type); ctx.stroke()

          if (n.count) {
            ctx.beginPath(); ctx.arc(p.x + r * 0.8, p.y - r * 0.8, 9, 0, 7)
            ctx.fillStyle = col(n.type); ctx.fill()
            ctx.fillStyle = surface; ctx.font = '700 10px system-ui'
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
            ctx.fillText(String(n.count), p.x + r * 0.8, p.y - r * 0.8)
          }

          if (labelVisible(n.id)) {
            ctx.globalAlpha = p.alpha * dim
            ctx.fillStyle = n.id === E.current.center ? inkC : mutedC
            ctx.font = (n.id === E.current.center ? '600 13' : '500 11') + 'px system-ui'
            ctx.textAlign = 'center'; ctx.textBaseline = 'top'
            const words = n.label.split(' '), lines: string[] = []; let cur = ''
            for (const w of words) {
              if ((cur + ' ' + w).trim().length > 18) { lines.push(cur.trim()); cur = w }
              else cur += ' ' + w
            }
            lines.push(cur.trim())
            lines.slice(0, 2).forEach((l, i) =>
              ctx.fillText(lines.length > 2 && i === 1 ? l + '…' : l, p.x, p.y + r + 4 + i * 13),
            )
          }
        }
        ctx.globalAlpha = 1
      },

      physics: {
        repulsion: 4200,
        spring:    0.022,
        rest:      (e) => (e.a === E.current.center || e.b === E.current.center ? 150 : 105),
        friction:  0.85,
        bounds:    { padX: 30, padTop: 34, padBottom: 80 },
      },
      fade:               { in: 0.12, out: 0.14 },
      loop:               'settle',
      zoom:               { min: 0.35, max: 2.6, factorIn: 1.12, factorOut: 0.89 },
      placeNewNearNeighbors: true,
      hitNodeRadius:      (id) => Math.max(26, SIZE[nodeById[id]?.type ?? 'visite'] + 12),
      edgeHit:            null,
      features:           { pin: true, dblClick: false, edgeTap: false, pinchZoom: true },
      watchTheme:         true,

      // Tap = inspecter (ouvrir/fermer le sheet). Aucune relance physique.
      onTapNode(id) {
        setSheetId((prev) => (prev === id ? null : id))
        // selectedId sync via useEffect → redraw() automatique
      },
      onTapVoid() {
        setSheetId(null)
      },
    })

    engineRef.current = api
    E.current.refreshVis = () => api.refreshVisibility()
    E.current.redraw     = () => api.redraw()
    // Kick initial : long pour un bon settle. Ensuite, navigateTo utilise kick(280).
    api.kick(1200)

    return () => { api.destroy(); engineRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, neigh, nodeById])

  // ── Données fiche ─────────────────────────────────────────────────────────────
  const selected = sheetId ? nodeById[sheetId] : null
  const phrase   = selected ? enUnePhrase(selected, graph, neigh, nodeById) : null
  const story    = selected ? recit(selected, graph, neigh, nodeById) : null
  const gone     = selected?.type === 'acteur' ? ifGone(selected, neigh, nodeById) : null
  const chain    = sheetId ? chainToSource(sheetId, neigh) : null
  const links    = selected ? graph.edges.filter((e) => e.a === sheetId || e.b === sheetId) : []

  const height = canvasHeight ?? 520

  return (
    <>
      {/* ── Canvas ──────────────────────────────────────────────────────────── */}
      <div
        ref={wrapRef}
        className="relative overflow-hidden rounded-2xl border bg-card"
        style={{ height, touchAction: 'none' }}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

        {/* Breadcrumb + Étendre */}
        <div className="absolute left-2 top-2 z-10 flex gap-1.5">
          {center !== 'site' && (
            <button
              type="button"
              onClick={() => navigateTo('site', 2)}
              className="rounded-full border bg-card/90 px-2.5 py-1 text-[12px] text-muted-foreground shadow-sm backdrop-blur-sm"
            >
              ← Chantier
            </button>
          )}
          {depth === 1 && (
            <button
              type="button"
              onClick={() => navigateTo(center, 2)}
              className="rounded-full border bg-card/90 px-2.5 py-1 text-[12px] text-muted-foreground shadow-sm backdrop-blur-sm"
            >
              Étendre
            </button>
          )}
        </div>

        {/* Zoom / Recentrer */}
        <GraphToolbar
          onZoomIn={() => zoomBy(1.3)}
          onZoomOut={() => zoomBy(0.77)}
          onFit={() => fitToView(graph.nodes.map((n) => ({ id: n.id, radius: SIZE[n.type] + 6 })), 28)}
          className="absolute bottom-24 right-3"
        />

        {/* Timeline — ne relance pas la physique */}
        {days.length > 1 && (
          <GraphTimeline
            days={days}
            onChange={(d) => {
              E.current.timeMax = d
              E.current.refreshVis?.()
              // Pas de kick : les nœuds existants gardent leur position.
            }}
          />
        )}
      </div>

      {/* ── Légende interactive ──────────────────────────────────────────────── */}
      <div className="scrollbar-hide -mx-1 overflow-x-auto px-1">
        <div className="flex w-max gap-1.5 py-1 text-[12px]">
          {LEGEND_TYPES.map((t) => {
            const count = typeCounts[t] ?? 0
            if (count === 0) return null
            const off = hidden.has(t)
            return (
              <button
                key={t}
                type="button"
                aria-pressed={!off}
                onClick={() => toggleHidden(t)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-opacity',
                  off ? 'opacity-40' : 'opacity-100',
                )}
              >
                <i className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: COLOR[t] }} />
                {TYPE_LABEL[t]}
                <span className="tabular-nums text-muted-foreground">({count})</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Bottom-sheet fiche ──────────────────────────────────────────────── */}
      <Sheet
        open={!!sheetId}
        onOpenChange={(open) => { if (!open) { setSheetId(null); setShowRecit(false) } }}
      >
        <SheetContent side="bottom" className="max-h-[75dvh] overflow-y-auto rounded-t-2xl pb-safe">
          {selected && (
            <>
              <SheetHeader className="pb-2">
                {/* Pastille couleur = lien visuel avec le nœud dans le graphe */}
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: COLOR[selected.type] }} />
                  <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: COLOR[selected.type] }}>
                    {TYPE_LABEL[selected.type]}
                  </p>
                </div>
                <SheetTitle className="text-base leading-snug">
                  {selected.label}{selected.count ? ` (${selected.count})` : ''}
                </SheetTitle>
                {selected.sub && (
                  <p className="text-[13px] text-muted-foreground">{selected.sub}</p>
                )}
              </SheetHeader>

              <div className="space-y-4 px-4 pb-6">
                {/* Actions */}
                <div className="flex flex-wrap gap-2">
                  {selected.type !== 'site' && (
                    <button
                      type="button"
                      onClick={() => navigateTo(sheetId!, 1)}
                      className="rounded-full border bg-muted/50 px-3 py-1.5 text-[12.5px] font-semibold"
                    >
                      Isoler
                    </button>
                  )}
                  {['site', 'visite', 'memo', 'acteur'].includes(selected.type) && (
                    <button
                      type="button"
                      onClick={() => setShowRecit((v) => !v)}
                      className="rounded-full border bg-muted/50 px-3 py-1.5 text-[12.5px] font-semibold"
                    >
                      🎙️ Résumé
                    </button>
                  )}
                  {selected.type === 'acteur' && sheetId?.startsWith('int_') && (
                    <Link
                      href={`/m/site/${graph.siteId}/intervenants/${sheetId.slice(4)}`}
                      onClick={() => setSheetId(null)}
                      className="rounded-full border bg-muted/50 px-3 py-1.5 text-[12.5px] font-semibold"
                    >
                      👤 Fiche
                    </Link>
                  )}
                </div>

                {showRecit && story ? (
                  <div className="space-y-2">
                    {story.map((t, i) => (
                      <p key={i} className="text-[14px] leading-relaxed">{t}</p>
                    ))}
                  </div>
                ) : (
                  <>
                    {phrase && (
                      <div>
                        <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">En une phrase</p>
                        <p className="text-[13.5px]">{phrase}</p>
                      </div>
                    )}
                    {selected.excerpt && (
                      <div>
                        <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">La trace</p>
                        <p className="rounded-r-xl border-l-2 border-teal-600/60 bg-muted/40 p-3 text-[13px] italic leading-snug">
                          «&nbsp;{selected.excerpt}&nbsp;»
                        </p>
                      </div>
                    )}
                    {gone && gone.length > 0 && (
                      <div>
                        <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                          Si {selected.label.split(' (')[0]} disparaissait…
                        </p>
                        <ul className="space-y-1.5">
                          {gone.map((t, i) => (
                            <li key={i} className="flex items-start gap-2 text-[13px]">
                              <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                              {t}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {chain && chain.length > 1 && (
                      <div>
                        <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Pourquoi c'est ici</p>
                        <ol className="space-y-1">
                          {chain.map((id, i) => (
                            <li key={id} className="flex items-start gap-2 text-[13px]">
                              <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full" style={{ background: COLOR[nodeById[id]?.type ?? 'visite'] }} />
                              <span>{i > 0 && <span className="mr-1 text-muted-foreground">↳</span>}{nodeById[id]?.label}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {links.length > 0 && (
                      <div>
                        <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Connexions directes</p>
                        <ul className="divide-y">
                          {links.map((e, i) => {
                            const otherId = e.a === sheetId ? e.b : e.a
                            const m = nodeById[otherId]
                            if (!m) return null
                            return (
                              <li key={i}>
                                <button
                                  type="button"
                                  onClick={() => navigateTo(otherId, 2)}
                                  className="flex w-full items-start gap-2.5 py-2 text-left"
                                >
                                  <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full" style={{ background: COLOR[m.type] }} />
                                  <span className="min-w-0">
                                    <span className="block text-[13px] hover:underline">{m.label}{m.count ? ` (${m.count})` : ''}</span>
                                    <span className="block text-[11.5px] text-muted-foreground">{e.why}{e.date ? ` · ${e.date}` : ''}</span>
                                  </span>
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}
