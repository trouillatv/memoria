'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { KnowledgeNode, KnowledgeEdge } from '@/lib/documents/site-synthesis'
import { createForceGraphEngine } from '@/components/graph/force-graph-engine'
import type { EdgeRef, FrameInfo } from '@/components/graph/force-graph-engine'
import { wrapLabel } from '@/lib/graph/graph-utils'
import { useGraphCanvas } from '@/lib/graph/use-graph-canvas'
import { GraphToolbar } from '@/components/graph/GraphToolbar'
import type { FitItem } from '@/lib/graph/graph-utils'

// ── Constants ─────────────────────────────────────────────────────────────────

const DIRECTIONAL = new Set(['requires', 'enables', 'causes', 'validates', 'replaces'])

// Rayon logique pour le hit + arêtes. Company = square donc rayon = demi-côté.
const R: Record<string, number> = { subject: 15, person: 13, company: 15 }

// ── Formes ────────────────────────────────────────────────────────────────────

function drawRoundedSquare(ctx: CanvasRenderingContext2D, cx: number, cy: number, half: number) {
  const cr = 3
  ctx.beginPath()
  ctx.moveTo(cx - half + cr, cy - half)
  ctx.lineTo(cx + half - cr, cy - half)
  ctx.arcTo(cx + half, cy - half, cx + half, cy - half + cr, cr)
  ctx.lineTo(cx + half, cy + half - cr)
  ctx.arcTo(cx + half, cy + half, cx + half - cr, cy + half, cr)
  ctx.lineTo(cx - half + cr, cy + half)
  ctx.arcTo(cx - half, cy + half, cx - half, cy + half - cr, cr)
  ctx.lineTo(cx - half, cy - half + cr)
  ctx.arcTo(cx - half, cy - half, cx - half + cr, cy - half, cr)
  ctx.closePath()
}

function drawDiamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(cx, cy - r)
  ctx.lineTo(cx + r, cy)
  ctx.lineTo(cx, cy + r)
  ctx.lineTo(cx - r, cy)
  ctx.closePath()
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
  siteId: string
  canvasHeight: number
}

export default function SiteRelationsGraph({ nodes, edges, siteId, canvasHeight }: Props) {
  const router = useRouter()
  const { canvasRef, wrapRef, engineRef, navigatingRef, fitVisibleAnimated, zoomBy } = useGraphCanvas()
  const fitItems: FitItem[] = nodes.map((n) => ({ id: n.id, radius: R[n.kind] ?? 15 }))

  const nodeMap  = new Map(nodes.map((n) => [n.id, n]))
  const edgeRefs: EdgeRef[] = edges.map((e) => ({ a: e.from, b: e.to }))
  const nodeIds  = nodes.map((n) => n.id)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap   = wrapRef.current
    if (!canvas || !wrap) return

    const engine = createForceGraphEngine(canvas, wrap, {
      nodeIds: () => nodeIds,
      edges:   () => edgeRefs,

      seed(P, { W, H }) {
        nodes.forEach((n, i) => {
          if (!P[n.id]) {
            const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2
            const r = Math.min(W, H) * 0.33
            P[n.id] = { x: W / 2 + r * Math.cos(angle), y: H / 2 + r * Math.sin(angle), vx: 0, vy: 0, alpha: 1 }
          }
        })
      },

      draw(ctx, f: FrameInfo) {
        const dark = document.documentElement.classList.contains('dark')

        const semEdge  = dark ? 'rgba(100,150,230,0.7)' : 'rgba(59,130,246,0.6)'
        const semMuted = dark ? 'rgba(150,150,150,0.3)' : 'rgba(120,120,120,0.25)'
        const respEdge = dark ? 'rgba(250,160,50,0.65)' : 'rgba(234,107,0,0.55)'

        const fillSubject = dark ? 'hsl(215,45%,45%)'  : 'hsl(215,60%,58%)'
        const fillPerson  = dark ? 'hsl(35,65%,45%)'   : 'hsl(35,80%,55%)'
        const fillCompany = dark ? 'hsl(270,40%,45%)'  : 'hsl(270,55%,58%)'
        const borderClr   = dark ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.8)'
        const lblSubject  = dark ? '#d1d5db' : '#374151'
        const lblActor    = dark ? '#fcd34d' : '#92400e'
        const haloClr     = dark ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.55)'

        // ── Arêtes ──────────────────────────────────────────────────────────
        for (const edge of edges) {
          const pa = f.P[edge.from], pb = f.P[edge.to]
          if (!pa || !pb) continue
          const dx = pb.x - pa.x, dy = pb.y - pa.y
          const dist = Math.hypot(dx, dy) || 1
          const nx = dx / dist, ny = dy / dist
          const rA = R[nodeMap.get(edge.from)?.kind ?? 'subject'] ?? 15
          const rB = R[nodeMap.get(edge.to)?.kind   ?? 'subject'] ?? 15
          const sx = pa.x + nx * rA, sy = pa.y + ny * rA
          const ex = pb.x - nx * rB, ey = pb.y - ny * rB

          if (edge.edgeType === 'semantic') {
            const isDir = DIRECTIONAL.has(edge.linkType)
            ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey)
            ctx.strokeStyle = isDir ? semEdge : semMuted
            ctx.lineWidth   = isDir ? 1.5 : 1
            ctx.setLineDash(isDir ? [] : [4, 4]); ctx.stroke(); ctx.setLineDash([])
            if (isDir) {
              const ars = 6
              ctx.beginPath(); ctx.moveTo(ex, ey)
              ctx.lineTo(ex - ars * nx + ars * 0.4 * ny, ey - ars * ny - ars * 0.4 * nx)
              ctx.lineTo(ex - ars * nx - ars * 0.4 * ny, ey - ars * ny + ars * 0.4 * nx)
              ctx.closePath(); ctx.fillStyle = semEdge; ctx.fill()
            }
          } else {
            ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey)
            ctx.strokeStyle = respEdge; ctx.lineWidth = 1.5
            ctx.setLineDash([3, 5]); ctx.stroke(); ctx.setLineDash([])
          }
        }

        // ── Nœuds ────────────────────────────────────────────────────────────
        for (const id of nodeIds) {
          const p    = f.P[id]; if (!p) continue
          const node = nodeMap.get(id)!
          const r    = R[node.kind] ?? 15
          const fill = node.kind === 'company' ? fillCompany
                     : node.kind === 'person'  ? fillPerson
                     : fillSubject

          if (navigatingRef.current === id) {
            ctx.beginPath(); ctx.arc(p.x, p.y, r + 5, 0, 2 * Math.PI)
            ctx.fillStyle = haloClr; ctx.fill()
          }

          if (node.kind === 'company') {
            drawRoundedSquare(ctx, p.x, p.y, r)
          } else if (node.kind === 'person') {
            drawDiamond(ctx, p.x, p.y, r)
          } else {
            ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI)
          }
          ctx.fillStyle = fill; ctx.fill()
          ctx.strokeStyle = borderClr; ctx.lineWidth = 1.5; ctx.stroke()

          const isActor = node.kind !== 'subject'
          ctx.font = isActor ? 'bold 9px system-ui,sans-serif' : '9px system-ui,sans-serif'
          ctx.fillStyle = isActor ? lblActor : lblSubject
          ctx.textAlign = 'center'; ctx.textBaseline = 'top'
          const [l1, l2] = wrapLabel(node.label)
          ctx.fillText(l1, p.x, p.y + r + 3)
          if (l2) ctx.fillText(l2, p.x, p.y + r + 13)
        }
      },

      physics: {
        repulsion: 3200,
        spring:    0.012,
        rest:      () => 120,
        friction:  0.93,
        gravity:   0.004,
      },

      fade: null,
      loop: 'settle',
      zoom: { min: 0.35, max: 4, factorIn: 1.15, factorOut: 0.88 },
      dprCap: 2,

      hitNodeRadius: (id) => R[nodeMap.get(id)?.kind ?? 'subject'] ?? 15,
      edgeHit:  null,
      features: { pin: true, dblClick: false, edgeTap: false, pinchZoom: true },

      onTapNode(id) {
        if (navigatingRef.current) return
        navigatingRef.current = id
        engine.redraw()
        setTimeout(() => router.push(`/m/site/${siteId}/sujets/${id}`), 220)
      },
    })

    engineRef.current = engine
    // Pas de kick explicite : resize() dans le moteur lance kick(900) par défaut.
    // Avec friction=0.93, l'énergie tombe sous 0.25 bien avant les 900 ms.

    const fitTimer = setTimeout(() => {
      fitVisibleAnimated(fitItems, 20)
    }, 1000)

    return () => {
      engine.destroy()
      engineRef.current = null
      clearTimeout(fitTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-2">
      {/* Canvas */}
      <div className="relative overflow-hidden rounded-2xl border bg-card">
        <div
          ref={wrapRef}
          style={{ height: canvasHeight, touchAction: 'none' }}
        >
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        </div>

        <GraphToolbar
          onZoomIn={() => zoomBy(1.3)}
          onZoomOut={() => zoomBy(0.77)}
          onFit={() => fitVisibleAnimated(fitItems, 20)}
          className="absolute bottom-10 right-3"
        />

        <p className="pointer-events-none absolute bottom-2 right-3 text-[10px] text-muted-foreground/50">
          {nodes.length} nœud{nodes.length !== 1 ? 's' : ''}
          {edges.filter(e => e.edgeType === 'semantic').length > 0 && ` · ${edges.filter(e => e.edgeType === 'semantic').length} rel.`}
          {edges.filter(e => e.edgeType === 'responsible_for').length > 0 && ` · ${edges.filter(e => e.edgeType === 'responsible_for').length} resp.`}
        </p>
      </div>

      {/* Légende */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-1">
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-500/70" />
          Sujet
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-violet-500/70" />
          Entreprise
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="inline-block h-2 w-2 rotate-45 bg-amber-500/70" />
          Personne
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-orange-400/70" />
          Responsable de
        </span>
      </div>
    </div>
  )
}
