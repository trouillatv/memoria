'use client'

// ── EXPLORER COLLABORATION / ÉCOSYSTÈME (V3 UX-1B) ───────────────────────────
// Lecture « Collaboration » (tous les acteurs pondérés) et « Écosystème »
// (ENTREPRISES seules ; clic → déploiement EXPLICITE et réversible des personnes).
// Inspecteur minimal : un lien épais doit toujours pouvoir s'expliquer.

import { useMemo, useState } from 'react'
import { Building2, User, Users, ChevronDown, ChevronUp } from 'lucide-react'
import { trendUiLabel } from '@/lib/knowledge/actor-relation-view'
import type { CollaborationGraphView, CollaborationNodeView, CollaborationEdgeView } from '@/lib/knowledge/collaboration-graph'
import { CollaborationCanvas, type CollaborationControl } from './CollaborationCanvas'

type Sel = { type: 'node'; key: string } | { type: 'edge'; index: number } | null

const fmt = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export function CollaborationExplorer({ data, mode }: { data: CollaborationGraphView; mode: 'collaboration' | 'ecosystem' }) {
  const [sel, setSel] = useState<Sel>(null)
  const [deployed, setDeployed] = useState<Set<string>>(() => new Set())
  const nodeByKey = useMemo(() => new Map(data.nodes.map((n) => [n.key, n])), [data])

  // ── Nœuds / arêtes AFFICHÉS ──
  // Collaboration ET Écosystème : ENTREPRISES seules au premier niveau (pas de
  // personnes, pas d'actions) — « qui travaille avec qui ». On déploie les personnes
  // d'une entreprise à la demande (double-clic, ou bouton en Écosystème).
  const view = useMemo(() => {
    const companies = data.nodes.filter((n) => n.kind === 'company')
    const edges = data.edges.filter((e) => nodeByKey.get(e.a)?.kind === 'company' && nodeByKey.get(e.b)?.kind === 'company')
    const nodes: CollaborationNodeView[] = [...companies]
    const membership: Array<{ a: string; b: string }> = []
    for (const co of companies) {
      if (!deployed.has(co.key)) continue
      for (const p of data.nodes) {
        if (p.kind === 'person' && p.companyId === co.id) { nodes.push(p); membership.push({ a: co.key, b: p.key }) }
      }
    }
    return { nodes, edges, membership }
  }, [data, nodeByKey, deployed])

  const toggleDeploy = (key: string) => setDeployed((d) => { const n = new Set(d); if (n.has(key)) n.delete(key); else n.add(key); return n })

  const control: CollaborationControl = {
    selectedKey: sel?.type === 'node' ? sel.key : null,
    selectedEdgeIndex: sel?.type === 'edge' ? sel.index : null,
    onTapNode: (key) => setSel({ type: 'node', key }),
    onTapEdge: (index) => setSel({ type: 'edge', index }),
    onTapVoid: () => setSel(null),
    // Double-clic sur une entreprise = déployer/replier ses personnes.
    onDblClickNode: (key) => { if (nodeByKey.get(key)?.kind === 'company') toggleDeploy(key) },
  }

  const selEdge = sel?.type === 'edge' ? view.edges[sel.index] ?? null : null
  const selNode = sel?.type === 'node' ? nodeByKey.get(sel.key) ?? null : null

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <CollaborationCanvas nodes={view.nodes} edges={view.edges} membershipEdges={view.membership} control={control} heightClass="h-[70vh]" />

      <aside className="rounded-2xl border bg-card p-5 shadow-sm lg:max-h-[70vh] lg:overflow-y-auto">
        {selEdge ? (
          <EdgeInspector edge={selEdge} a={nodeByKey.get(selEdge.a)} b={nodeByKey.get(selEdge.b)} onSelectNode={(k) => setSel({ type: 'node', key: k })} />
        ) : selNode ? (
          <NodeInspector node={selNode} mode={mode} deployed={deployed.has(selNode.key)} onToggleDeploy={() => toggleDeploy(selNode.key)} />
        ) : (
          <p className="text-[13px] text-muted-foreground">
            {mode === 'ecosystem'
              ? 'Écosystème : uniquement les entreprises. Cliquez-en une, puis « Afficher les personnes » (ou double-clic) pour explorer.'
              : 'Uniquement les entreprises : l’épaisseur dit la force, la pâleur l’ancienneté. Double-cliquez une entreprise pour voir ses personnes ; cliquez un lien pour l’expliquer.'}
            <br />{view.nodes.filter((n) => n.kind === 'company').length} entreprises · {view.edges.length} collaborations.
          </p>
        )}
      </aside>
    </div>
  )
}

function NodeIcon({ kind }: { kind: 'person' | 'company' }) {
  return kind === 'company' ? <Building2 className="h-4 w-4" aria-hidden /> : <User className="h-4 w-4" aria-hidden />
}

function NodeInspector({ node, mode, deployed, onToggleDeploy }: { node: CollaborationNodeView; mode: 'collaboration' | 'ecosystem'; deployed: boolean; onToggleDeploy: () => void }) {
  return (
    <div>
      <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        <NodeIcon kind={node.kind} /> {node.kind === 'company' ? 'Entreprise' : 'Personne'}
      </p>
      <h3 className="mt-1 text-lg font-semibold leading-snug">{node.label}</h3>
      {mode === 'ecosystem' && node.kind === 'company' && (
        <button
          type="button"
          onClick={onToggleDeploy}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1 text-[12px] font-semibold hover:border-foreground/30"
        >
          <Users className="h-3.5 w-3.5" aria-hidden />
          {deployed ? <>Replier les personnes <ChevronUp className="h-3.5 w-3.5" aria-hidden /></> : <>Afficher les personnes <ChevronDown className="h-3.5 w-3.5" aria-hidden /></>}
        </button>
      )}
    </div>
  )
}

function EdgeInspector({ edge, a, b, onSelectNode }: {
  edge: CollaborationEdgeView
  a?: CollaborationNodeView; b?: CollaborationNodeView
  onSelectNode: (key: string) => void
}) {
  const [why, setWhy] = useState(false)
  const active = edge.daysSinceLastInteraction === 0 && edge.activeInteractionCount > 0
  const trend = trendUiLabel(edge.trend)
  const bd = edge.breakdown
  const parts = [
    bd.co_casting > 0 ? `${bd.co_casting} chantier${bd.co_casting > 1 ? 's' : ''} en commun` : null,
    bd.co_action > 0 ? `${bd.co_action} action${bd.co_action > 1 ? 's' : ''} partagée${bd.co_action > 1 ? 's' : ''}` : null,
    bd.co_team > 0 ? `${bd.co_team} équipe${bd.co_team > 1 ? 's' : ''} en commun` : null,
  ].filter(Boolean) as string[]

  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Collaboration</p>
      <div className="mt-2 space-y-1 text-center">
        <button type="button" onClick={() => a && onSelectNode(a.key)} className="block w-full truncate text-[14px] font-semibold hover:underline">{a?.label ?? '—'}</button>
        <span aria-hidden className="block text-muted-foreground">↕</span>
        <button type="button" onClick={() => b && onSelectNode(b.key)} className="block w-full truncate text-[14px] font-semibold hover:underline">{b?.label ?? '—'}</button>
      </div>
      <dl className="mt-3.5 space-y-2 text-[12.5px]">
        <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Force de collaboration</dt><dd className="tabular-nums">{fmt(edge.strength)}</dd></div>
        <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Statut</dt>
          <dd>{active ? 'Collaboration active' : `Dernière interaction il y a ${edge.daysSinceLastInteraction} jour${edge.daysSinceLastInteraction > 1 ? 's' : ''}`}{trend ? ` · ${trend}` : ''}</dd>
        </div>
        <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Interactions</dt><dd className="tabular-nums">{edge.interactionCount}</dd></div>
      </dl>

      <button type="button" onClick={() => setWhy((w) => !w)} className="mt-3 inline-flex items-center gap-1 rounded-full border bg-muted/50 px-3 py-1 text-[12px] font-semibold hover:border-foreground/30">
        Pourquoi proches ? {why ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
      </button>
      {why && (
        <ul className="mt-2 space-y-1 text-[12.5px]">
          {parts.length ? parts.map((p, i) => <li key={i}>• {p}.</li>) : <li className="text-muted-foreground">Détail indisponible.</li>}
        </ul>
      )}
    </div>
  )
}
