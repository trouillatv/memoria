'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { CanonicalLink } from '@/lib/db/canonical-subject-life'
import { createForceGraphEngine } from '@/components/graph/force-graph-engine'
import type { EdgeRef, FrameInfo } from '@/components/graph/force-graph-engine'

// ── Constants ─────────────────────────────────────────────────────────────────

const DIRECTIONAL = new Set(['requires', 'enables', 'causes', 'validates', 'replaces'])

const LINK_VERB: Record<string, { out: string; in: string }> = {
  requires:   { out: 'nécessite',          in: 'est requis par' },
  enables:    { out: 'permet',             in: 'est rendu possible par' },
  causes:     { out: 'entraîne',           in: 'est causé par' },
  validates:  { out: 'valide',             in: 'est validé par' },
  replaces:   { out: 'remplace',           in: 'est remplacé par' },
  relates_to: { out: 'est associé à',      in: 'est associé à' },
}

const R_CURRENT  = 24
const R_NEIGHBOR = 13
const CANVAS_H   = 280
const MAX_NEIGHBORS = 7
const MAX_LABEL  = 14

function trunc(s: string, n = MAX_LABEL): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…'
}

// ── Types internes ────────────────────────────────────────────────────────────

interface GNode { id: string; label: string; isCurrent: boolean }
interface GEdge { a: string; b: string; linkType: string }
interface TextLine { verb: string; target: string }

// ── Composant canvas (hooks toujours appelés) ─────────────────────────────────

interface CanvasProps {
  nodes: GNode[]
  edges: GEdge[]
  textLines: TextLine[]
  currentId: string
  currentLabel: string
  siteId: string
}

function GraphCanvas({ nodes, edges, textLines, currentId, currentLabel, siteId }: CanvasProps) {
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const wrapRef     = useRef<HTMLDivElement>(null)
  const router      = useRouter()
  const [showText, setShowText] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap   = wrapRef.current
    if (!canvas || !wrap) return

    const nodeIds  = nodes.map((n) => n.id)
    const nodeMap  = new Map(nodes.map((n) => [n.id, n]))
    const edgeRefs: EdgeRef[] = edges.map((e) => ({ a: e.a, b: e.b }))

    const engine = createForceGraphEngine(canvas, wrap, {
      nodeIds: () => nodeIds,
      edges:   () => edgeRefs,

      seed(P, { W, H }) {
        if (!P[currentId]) {
          P[currentId] = { x: W / 2, y: H / 2, vx: 0, vy: 0, alpha: 1 }
        }
        const neighbors = nodeIds.filter((id) => id !== currentId)
        const radius = Math.min(W, H) * 0.30
        neighbors.forEach((id, i) => {
          if (!P[id]) {
            const angle = (2 * Math.PI * i) / neighbors.length - Math.PI / 2
            P[id] = {
              x: W / 2 + radius * Math.cos(angle),
              y: H / 2 + radius * Math.sin(angle),
              vx: 0, vy: 0, alpha: 1,
            }
          }
        })
      },

      draw(ctx, f: FrameInfo) {
        const dark       = document.documentElement.classList.contains('dark')
        const edgeColor  = dark ? 'rgba(100,150,230,0.75)' : 'rgba(59,130,246,0.65)'
        const mutedEdge  = dark ? 'rgba(150,150,150,0.35)' : 'rgba(120,120,120,0.28)'
        const fillCurr   = dark ? 'hsl(215,65%,52%)'       : 'hsl(215,75%,52%)'
        const fillNeigh  = dark ? 'hsl(215,15%,38%)'       : 'hsl(215,12%,82%)'
        const lblCurr    = dark ? '#e5e7eb' : '#111827'
        const lblNeigh   = dark ? '#9ca3af' : '#6b7280'

        // ── Arêtes ────────────────────────────────────────────────────────────
        for (const edge of edges) {
          const pa = f.P[edge.a]
          const pb = f.P[edge.b]
          if (!pa || !pb) continue

          const dx   = pb.x - pa.x
          const dy   = pb.y - pa.y
          const dist = Math.hypot(dx, dy) || 1
          const nx   = dx / dist
          const ny   = dy / dist

          const rA = edge.a === currentId ? R_CURRENT : R_NEIGHBOR
          const rB = edge.b === currentId ? R_CURRENT : R_NEIGHBOR

          // Points de départ/arrivée au bord des nœuds
          const sx = pa.x + nx * rA
          const sy = pa.y + ny * rA
          const ex = pb.x - nx * rB
          const ey = pb.y - ny * rB

          const isDir = DIRECTIONAL.has(edge.linkType)

          ctx.beginPath()
          ctx.moveTo(sx, sy)
          ctx.lineTo(ex, ey)
          ctx.strokeStyle = isDir ? edgeColor : mutedEdge
          ctx.lineWidth   = isDir ? 1.5 : 1
          ctx.setLineDash(isDir ? [] : [4, 4])
          ctx.stroke()
          ctx.setLineDash([])

          // Flèche directionnelle
          if (isDir) {
            const ars = 7
            ctx.beginPath()
            ctx.moveTo(ex, ey)
            ctx.lineTo(ex - ars * nx + ars * 0.4 * ny,  ey - ars * ny - ars * 0.4 * nx)
            ctx.lineTo(ex - ars * nx - ars * 0.4 * ny,  ey - ars * ny + ars * 0.4 * nx)
            ctx.closePath()
            ctx.fillStyle = edgeColor
            ctx.fill()
          }
        }

        // ── Nœuds ─────────────────────────────────────────────────────────────
        for (const id of nodeIds) {
          const p    = f.P[id]
          if (!p) continue
          const node = nodeMap.get(id)!
          const curr = node.isCurrent
          const r    = curr ? R_CURRENT : R_NEIGHBOR

          ctx.beginPath()
          ctx.arc(p.x, p.y, r, 0, 2 * Math.PI)
          ctx.fillStyle = curr ? fillCurr : fillNeigh
          ctx.fill()

          if (curr) {
            ctx.strokeStyle = dark ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.85)'
            ctx.lineWidth   = 2
            ctx.stroke()
          }

          const short = trunc(node.label, curr ? 16 : MAX_LABEL)
          ctx.font         = curr ? 'bold 10px system-ui,sans-serif' : '10px system-ui,sans-serif'
          ctx.fillStyle    = curr ? lblCurr : lblNeigh
          ctx.textAlign    = 'center'
          ctx.textBaseline = 'top'
          ctx.fillText(short, p.x, p.y + r + 3)
        }
      },

      physics: {
        repulsion: 3200,
        spring:    0.022,
        rest:      () => 110,
        friction:  0.82,
        gravity:   0.006,
      },

      fade: null,
      loop: 'settle',
      zoom: { min: 0.8, max: 1.8, factorIn: 1.15, factorOut: 0.88 },
      dprCap: 2,

      hitNodeRadius: (id) => (id === currentId ? R_CURRENT : R_NEIGHBOR),
      edgeHit:   null,
      features:  { pin: false, dblClick: false, edgeTap: false },

      onTapNode(id) {
        if (id !== currentId) {
          router.push(`/m/site/${siteId}/sujets/${id}`)
        }
      },
    })

    engine.kick(800)
    return () => engine.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <section>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Autour de ce sujet
      </h2>
      <div
        ref={wrapRef}
        className="relative overflow-hidden rounded-2xl border bg-card shadow-sm"
        style={{ height: CANVAS_H, touchAction: 'pan-y' }}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      </div>
      {textLines.length > 0 && (
        <div className="mt-1.5">
          <button
            type="button"
            onClick={() => setShowText((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground/70 hover:text-muted-foreground"
          >
            {showText
              ? <ChevronDown className="h-3 w-3" />
              : <ChevronRight className="h-3 w-3" />
            }
            {textLines.length} relation{textLines.length > 1 ? 's' : ''}
          </button>
          {showText && (
            <ul className="mt-1 space-y-0.5 pl-1">
              {textLines.map((line, i) => (
                <li key={i} className="text-[12px] text-muted-foreground">
                  <span className="font-medium text-foreground">{currentLabel}</span>
                  {' '}{line.verb}{' '}
                  <span className="font-medium text-foreground">{line.target}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

// ── Composant public (garde) ──────────────────────────────────────────────────

interface Props {
  links: CanonicalLink[]
  currentSubjectId: string
  currentSubjectLabel: string
  siteId: string
}

export default function SubjectContextGraph({
  links,
  currentSubjectId,
  currentSubjectLabel,
  siteId,
}: Props) {
  const confirmed = links.filter((l) => l.status === 'confirmed')
  if (confirmed.length === 0) return null

  // Dédupliquer les voisins (max 7), en gardant l'ordre d'arrivée
  const neighborMap = new Map<string, string>() // neighborId → label
  for (const l of confirmed) {
    const nId    = l.direction === 'outgoing' ? l.toCanonicalSubjectId   : l.fromCanonicalSubjectId
    const nLabel = l.direction === 'outgoing' ? l.toLabel                 : l.fromLabel
    if (!nId || nId === currentSubjectId) continue
    if (!neighborMap.has(nId)) neighborMap.set(nId, nLabel ?? '—')
    if (neighborMap.size >= MAX_NEIGHBORS) break
  }

  if (neighborMap.size === 0) return null

  const knownIds = new Set([currentSubjectId, ...neighborMap.keys()])

  const nodes: GNode[] = [
    { id: currentSubjectId, label: currentSubjectLabel, isCurrent: true },
    ...Array.from(neighborMap.entries()).map(([id, label]) => ({ id, label, isCurrent: false })),
  ]

  const edges: GEdge[] = confirmed
    .filter((l) => {
      const nId = l.direction === 'outgoing' ? l.toCanonicalSubjectId : l.fromCanonicalSubjectId
      return nId && knownIds.has(nId)
    })
    .map((l) =>
      l.direction === 'outgoing'
        ? { a: currentSubjectId,            b: l.toCanonicalSubjectId!,   linkType: l.linkType }
        : { a: l.fromCanonicalSubjectId!,   b: currentSubjectId,          linkType: l.linkType },
    )

  const textLines: TextLine[] = confirmed
    .filter((l) => {
      const nId = l.direction === 'outgoing' ? l.toCanonicalSubjectId : l.fromCanonicalSubjectId
      return nId && knownIds.has(nId)
    })
    .map((l) => {
      const cfg    = LINK_VERB[l.linkType] ?? { out: l.linkType, in: l.linkType }
      const verb   = l.direction === 'outgoing' ? cfg.out : cfg.in
      const target = l.direction === 'outgoing' ? (l.toLabel ?? '—') : (l.fromLabel ?? '—')
      return { verb, target }
    })

  return (
    <GraphCanvas
      nodes={nodes}
      edges={edges}
      textLines={textLines}
      currentId={currentSubjectId}
      currentLabel={currentSubjectLabel}
      siteId={siteId}
    />
  )
}
