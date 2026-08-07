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
import Link from 'next/link'
import type { SiteGraph, GraphNodeType } from '@/lib/knowledge/site-graph'
import { cn } from '@/lib/utils'
import { createForceGraphEngine } from '@/components/graph/force-graph-engine'
import {
  COLOR, COLOR_DARK, TYPE_LABEL, SIZE, PROOF, GLOBAL_DEFAULT, frDay,
  computeVisible, enUnePhrase, recit, ifGone, computeGaps,
  dependencySet, chainToSource,
} from '@/lib/graph/site-graph-logic'

type PanelMode = 'fiche' | 'recit' | 'gaps'

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

  // ── L'état MÉTIER de l'exploration, miroité hors React pour le moteur. ──
  // (La mécanique — positions, vue, drag, pins — vit dans le moteur partagé.)
  const engine = useRef<{
    center: string; depth: 1 | 2; enqueteSet: Set<string> | null; timeMax: string | null
    hiddenTypes: ReadonlySet<GraphNodeType>; revealedTypes: ReadonlySet<GraphNodeType>; hlType: GraphNodeType | null
    doSelect?: (id: string) => void; refreshVis?: () => void; reset?: () => void; redraw?: () => void
  }>({ center: 'site', depth: 2, enqueteSet: null, timeMax: null, hiddenTypes: new Set(), revealedTypes: new Set(), hlType: null })

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
    const wrap = wrapRef.current!, cv = cvRef.current!
    const E = engine.current
    const dark = () => document.documentElement.dataset.theme === 'dark'
      || (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)
    const col = (t: GraphNodeType) => (dark() ? COLOR_DARK : COLOR)[t]

    const visible = () => computeVisible({
      center: E.center, depth: E.depth, enqueteSet: E.enqueteSet, timeMax: E.timeMax,
      hiddenTypes: E.hiddenTypes, revealedTypes: E.revealedTypes, neigh, nodeById,
    })

    const api = createForceGraphEngine(cv, wrap, {
      nodeIds: () => graph.nodes.map((n) => n.id),
      edges: () => graph.edges,
      visible,
      // Géographie d'origine : centre au milieu, voisins en anneau 130, le reste dispersé.
      seed(P, { W, H }) {
        const ring = [...(neigh[E.center] ?? [])]
        P[E.center] ??= { x: W / 2, y: H / 2, vx: 0, vy: 0, alpha: 0 }
        ring.forEach((id, i) => {
          const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, ring.length)
          P[id] ??= { x: W / 2 + 130 * Math.cos(a), y: H / 2 + 130 * Math.sin(a), vx: 0, vy: 0, alpha: 0 }
        })
        for (const n of graph.nodes) P[n.id] ??= { x: W / 2 + (Math.random() - 0.5) * 280, y: H / 2 + (Math.random() - 0.5) * 280, vx: 0, vy: 0, alpha: 0 }
      },
      // Rendu Mémoire, pixel-identique (le moteur applique clear + transform).
      draw(ctx, f) {
        const surface = dark() ? '#1E1A25' : '#FFFFFF'
        const inkC = dark() ? '#F0EDF6' : '#1C1B22'
        const mutedC = dark() ? '#A49DB3' : '#6B6577'
        const hoverEdge = f.hoverEdgeIndex == null ? null : graph.edges[f.hoverEdgeIndex]
        const grabbed = f.dragId || f.hoverNode
        const grabSet = grabbed ? new Set([grabbed, ...(neigh[grabbed] ?? [])]) : null
        const soft = !f.dragId && f.hoverNode
        const hl = E.hlType // survol de la légende : halo léger, jamais un clignotement
        const labelVisible = (id: string) => {
          if (E.enqueteSet) return true
          return id === E.center || id === f.hoverNode || (neigh[E.center] ?? new Set()).has(id)
        }
        for (const e of graph.edges) {
          const A = f.P[e.a], B = f.P[e.b]; if (!A || !B) continue
          const al = Math.min(A.alpha, B.alpha); if (al < 0.02) continue
          const touch = grabbed && (e.a === grabbed || e.b === grabbed)
          const active = e === hoverEdge || e.a === E.center || e.b === E.center
          ctx.strokeStyle = col(e.type)
          ctx.globalAlpha = al * (touch ? 0.95 : grabbed ? (soft ? 0.18 : 0.12) : e === hoverEdge ? 1 : active ? 0.8 : 0.3)
          ctx.lineWidth = e === hoverEdge || touch ? 2.5 : 1.4
          ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke()
        }
        for (const n of graph.nodes) {
          const p = f.P[n.id]; if (!p || p.alpha < 0.02) continue
          const r = (n.id === E.center ? SIZE[n.type] + 6 : SIZE[n.type]) + (hl === n.type ? 2 : 0)
          ctx.globalAlpha = p.alpha
            * (grabSet && !grabSet.has(n.id) ? (soft ? 0.4 : 0.22) : 1)
            * (hl && hl !== n.type ? 0.45 : 1)
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7)
          ctx.fillStyle = surface; ctx.fill()
          ctx.lineWidth = (n.id === E.center ? 3.5 : n.id === f.hoverNode ? 3 : 2.2) + (hl === n.type ? 1 : 0)
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
        ctx.globalAlpha = 1
      },
      physics: {
        repulsion: 4200,
        spring: 0.022,
        rest: (e) => (e.a === E.center || e.b === E.center ? 150 : 105),
        friction: 0.8,
        bounds: { padX: 30, padTop: 34, padBottom: 40 },
      },
      fade: { in: 0.12, out: 0.14 },
      loop: 'settle', // figé par défaut — la physique ne vit que pendant un geste
      zoom: { min: 0.45, max: 2.6, factorIn: 1.12, factorOut: 0.89 },
      placeNewNearNeighbors: true,
      hitNodeRadius: (id) => Math.max(24, SIZE[nodeById[id].type] + 10),
      edgeHit: { tolerance: () => 8, clampA: 0.08, clampB: 0.92 },
      hitAlphaGate: 0.5,
      features: { pin: true, dblClick: true },
      watchTheme: true,
      onHover(h) {
        if (!h) { setTip(null); return }
        if (h.kind === 'node') {
          const nd = nodeById[h.nodeId!]
          setTip({ x: h.sx, y: h.sy, html: `<b>${esc(nd.label)}${nd.count ? ` (${nd.count})` : ''}</b><span>${TYPE_LABEL[nd.type]}${nd.sub ? ' · ' + esc(nd.sub) : ''}</span>` })
        } else {
          const e = graph.edges[h.edgeIndex!]
          setTip({ x: h.sx, y: h.sy, html: `<b>${esc(nodeById[e.a].label)} ⟷ ${esc(nodeById[e.b].label)}</b><span>${esc(e.why)}${e.date ? ' · ' + esc(e.date) : ''}</span>` })
        }
      },
      onTapNode(id) { if (id !== E.center) select(id) },
      onTapVoid() {
        setTip(null)
        if (E.center !== 'site') select('site')
        else { api.view.k = 1; api.view.tx = 0; api.view.ty = 0; api.kick() }
      },
      onDblClickNode(id) {
        api.view.k = 1.35
        const p = api.P[id]; const { W, H } = api.size()
        if (p) { api.view.tx = W / 2 - p.x * api.view.k; api.view.ty = H / 2 - p.y * api.view.k }
        if (id !== E.center) select(id); else api.kick()
      },
    })

    function select(id: string) {
      E.center = id // synchrone : seed/rest/placeNew lisent le nouveau centre sans attendre l'effet
      setCenter(id)
      setRevealed(new Set())
      setPanelMode('fiche')
      setTrail((t) => { const i = t.indexOf(id); return i >= 0 ? t.slice(0, i + 1) : [...t, id] })
      setTimeout(() => api.refreshVisibility(), 0)
    }
    E.doSelect = select
    E.refreshVis = () => api.refreshVisibility()
    E.redraw = () => api.redraw()
    E.reset = () => {
      api.pinned.clear(); api.view.k = 1; api.view.tx = 0; api.view.ty = 0
      const { W, H } = api.size()
      const ring = [...(neigh[E.center] ?? [])]
      const c = api.P[E.center]; if (c) { c.x = W / 2; c.y = H / 2; c.vx = 0; c.vy = 0 }
      ring.forEach((id, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, ring.length)
        const p = api.P[id]; if (p) { p.x = W / 2 + 140 * Math.cos(a); p.y = H / 2 + 140 * Math.sin(a); p.vx = 0; p.vy = 0 }
      })
      api.kick()
    }

    return () => api.destroy()
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
                {/* Le graphe REPÈRE, la fiche EXPLIQUE : un intervenant confirmé
                    (nœud int_*) ouvre sa fiche transverse. Les acteurs « à
                    confirmer » (act_*) n'en ont pas encore — on ne lie que le
                    confirmé. */}
                {n.type === 'acteur' && center.startsWith('int_') && (
                  <Link
                    href={`/sites/${graph.siteId}/intervenant/${center.slice(4)}`}
                    scroll={false}
                    className="rounded-full border bg-muted/50 px-3 py-1.5 text-[12.5px] font-semibold hover:border-foreground/30"
                  >
                    👤 Ouvrir la fiche
                  </Link>
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


function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
