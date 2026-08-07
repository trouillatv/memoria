'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { KnowledgeNode, KnowledgeEdge } from '@/lib/documents/site-synthesis'
import { createForceGraphEngine } from '@/components/graph/force-graph-engine'
import type { EdgeRef, FrameInfo } from '@/components/graph/force-graph-engine'

// ── Constants ─────────────────────────────────────────────────────────────────

const DIRECTIONAL = new Set(['requires', 'enables', 'causes', 'validates', 'replaces'])
const MAX_LABEL = 13

const R: Record<string, number> = { subject: 15, person: 13, company: 15 }

function trunc(s: string): string {
  return s.length <= MAX_LABEL ? s : s.slice(0, MAX_LABEL - 1) + '…'
}

interface Props {
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
  siteId: string
  canvasHeight: number
}

export default function SiteRelationsGraph({ nodes, edges, siteId, canvasHeight }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef   = useRef<HTMLDivElement>(null)
  const router    = useRouter()

  const semanticCount     = edges.filter((e) => e.edgeType === 'semantic').length
  const responsibleCount  = edges.filter((e) => e.edgeType === 'responsible_for').length

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap   = wrapRef.current
    if (!canvas || !wrap) return

    const nodeIds  = nodes.map((n) => n.id)
    const nodeMap  = new Map(nodes.map((n) => [n.id, n]))
    const edgeRefs: EdgeRef[] = edges.map((e) => ({ a: e.from, b: e.to }))

    const engine = createForceGraphEngine(canvas, wrap, {
      nodeIds: () => nodeIds,
      edges:   () => edgeRefs,

      seed(P, { W, H }) {
        nodes.forEach((n, i) => {
          if (!P[n.id]) {
            const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2
            const r = Math.min(W, H) * 0.35
            P[n.id] = { x: W / 2 + r * Math.cos(angle), y: H / 2 + r * Math.sin(angle), vx: 0, vy: 0, alpha: 1 }
          }
        })
      },

      draw(ctx, f: FrameInfo) {
        const dark = document.documentElement.classList.contains('dark')

        // Couleurs sémantiques
        const semEdge  = dark ? 'rgba(100,150,230,0.65)' : 'rgba(59,130,246,0.55)'
        const semMuted = dark ? 'rgba(150,150,150,0.3)'  : 'rgba(120,120,120,0.25)'
        // Couleurs responsabilité
        const respEdge = dark ? 'rgba(250,160,50,0.6)'   : 'rgba(234,107,0,0.5)'

        // Couleurs nœuds
        const fillSubject = dark ? 'hsl(215,45%,45%)'   : 'hsl(215,60%,58%)'
        const fillPerson  = dark ? 'hsl(35,65%,45%)'    : 'hsl(35,80%,55%)'
        const fillCompany = dark ? 'hsl(270,40%,45%)'   : 'hsl(270,55%,58%)'
        const borderClr   = dark ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.8)'
        const lblSubject  = dark ? '#d1d5db' : '#374151'
        const lblActor    = dark ? '#fcd34d' : '#92400e'

        // ── Arêtes ──────────────────────────────────────────────────────────
        for (const edge of edges) {
          const pa = f.P[edge.from]
          const pb = f.P[edge.to]
          if (!pa || !pb) continue

          const dx   = pb.x - pa.x
          const dy   = pb.y - pa.y
          const dist = Math.hypot(dx, dy) || 1
          const nx   = dx / dist
          const ny   = dy / dist

          const rA = R[nodeMap.get(edge.from)?.kind ?? 'subject'] ?? 15
          const rB = R[nodeMap.get(edge.to)?.kind   ?? 'subject'] ?? 15

          const sx = pa.x + nx * rA
          const sy = pa.y + ny * rA
          const ex = pb.x - nx * rB
          const ey = pb.y - ny * rB

          if (edge.edgeType === 'semantic') {
            const isDir = DIRECTIONAL.has(edge.linkType)
            ctx.beginPath()
            ctx.moveTo(sx, sy)
            ctx.lineTo(ex, ey)
            ctx.strokeStyle = isDir ? semEdge : semMuted
            ctx.lineWidth   = isDir ? 1.5 : 1
            ctx.setLineDash(isDir ? [] : [4, 4])
            ctx.stroke()
            ctx.setLineDash([])

            if (isDir) {
              const ars = 6
              ctx.beginPath()
              ctx.moveTo(ex, ey)
              ctx.lineTo(ex - ars * nx + ars * 0.4 * ny, ey - ars * ny - ars * 0.4 * nx)
              ctx.lineTo(ex - ars * nx - ars * 0.4 * ny, ey - ars * ny + ars * 0.4 * nx)
              ctx.closePath()
              ctx.fillStyle = semEdge
              ctx.fill()
            }
          } else {
            // responsible_for : trait pointillé orange, sans flèche
            ctx.beginPath()
            ctx.moveTo(sx, sy)
            ctx.lineTo(ex, ey)
            ctx.strokeStyle = respEdge
            ctx.lineWidth   = 1.5
            ctx.setLineDash([3, 5])
            ctx.stroke()
            ctx.setLineDash([])
          }
        }

        // ── Nœuds ────────────────────────────────────────────────────────────
        for (const id of nodeIds) {
          const p    = f.P[id]
          if (!p) continue
          const node = nodeMap.get(id)!
          const r    = R[node.kind] ?? 15
          const fill = node.kind === 'company' ? fillCompany
                     : node.kind === 'person'  ? fillPerson
                     : fillSubject

          ctx.beginPath()
          ctx.arc(p.x, p.y, r, 0, 2 * Math.PI)
          ctx.fillStyle = fill
          ctx.fill()
          ctx.strokeStyle = borderClr
          ctx.lineWidth = 1.5
          ctx.stroke()

          const isActor = node.kind !== 'subject'
          ctx.font         = isActor ? 'bold 9px system-ui,sans-serif' : '9px system-ui,sans-serif'
          ctx.fillStyle    = isActor ? lblActor : lblSubject
          ctx.textAlign    = 'center'
          ctx.textBaseline = 'top'
          ctx.fillText(trunc(node.label), p.x, p.y + r + 3)
        }
      },

      physics: {
        repulsion: 4200,
        spring:    0.018,
        rest:      () => 120,
        friction:  0.82,
        gravity:   0.004,
      },

      fade: null,
      loop: 'settle',
      zoom: { min: 0.5, max: 3, factorIn: 1.15, factorOut: 0.88 },
      dprCap: 2,

      hitNodeRadius: (id) => R[nodeMap.get(id)?.kind ?? 'subject'] ?? 15,
      edgeHit:  null,
      features: { pin: false, dblClick: false, edgeTap: false },

      onTapNode(id) {
        router.push(`/m/site/${siteId}/sujets/${id}`)
      },
    })

    engine.kick(1200)
    return () => engine.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-2">
      <div
        ref={wrapRef}
        className="relative overflow-hidden rounded-2xl border bg-card"
        style={{ height: canvasHeight, touchAction: 'pan-y' }}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        <p className="pointer-events-none absolute bottom-2 right-3 text-[10px] text-muted-foreground/50">
          {nodes.length} nœud{nodes.length !== 1 ? 's' : ''}
          {semanticCount > 0 && ` · ${semanticCount} rel.`}
          {responsibleCount > 0 && ` · ${responsibleCount} resp.`}
        </p>
      </div>

      {/* Légende compacte */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-1">
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-500/70" />
          Sujet
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-violet-500/70" />
          Entreprise
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500/70" />
          Personne
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="inline-block h-0.5 w-4 bg-orange-400/70" style={{ borderTop: '2px dashed currentColor' }} />
          Responsable de
        </span>
      </div>
    </div>
  )
}
