'use client'

// ── EXPLORER DES ACTEURS (V2.1) ──────────────────────────────────────────────
// Le graphe devient un NAVIGATEUR : on clique une entreprise, puis une action,
// puis un chantier, sans jamais quitter l'écran. Le panneau de droite raconte ce
// qui est sélectionné (narration factuelle), explique les RELATIONS (le lien est
// un objet : nature, depuis, source, confiance), et le mode « Suivre » surligne
// le chemin entre deux acteurs — le reste s'atténue. AUCUNE navigation au clic ;
// « Ouvrir la fiche complète » est un lien explicite.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Route, User, Building2, Users, MapPin, ListTodo } from 'lucide-react'
import {
  shortestPath, REL_SOURCE_LABEL,
  type ActorsGraph, type ActorGraphNode, type ActorGraphKind,
} from '@/lib/knowledge/actors-graph-model'
import { narrateActorInGraph } from '@/lib/knowledge/actor-narration'
import { attentionLevelLabel } from '@/lib/knowledge/actor-attention'
import { ActorsGraphCanvas } from './ActorsGraphCanvas'

const KIND_LABEL: Record<ActorGraphKind, string> = { person: 'Personne', company: 'Entreprise', team: 'Équipe', site: 'Chantier', action: 'Action' }
const KIND_ICON = { person: User, company: Building2, team: Users, site: MapPin, action: ListTodo } as const

/** Surface propriétaire (lien EXPLICITE — jamais une navigation implicite au clic). */
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

const frDate = (iso: string | null) => (iso ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso)) : null)

type Selection = { type: 'node'; id: string } | { type: 'edge'; index: number } | null

export function ActorsExplorer({ graph, focusId }: { graph: ActorsGraph; focusId?: string | null }) {
  const [sel, setSel] = useState<Selection>(focusId ? { type: 'node', id: focusId } : null)
  const [followFrom, setFollowFrom] = useState<string | null>(null)
  const [path, setPath] = useState<{ nodes: string[]; edgeIndexes: number[] } | null>(null)

  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph])
  const selNode = sel?.type === 'node' ? nodeById.get(sel.id) ?? null : null
  const selEdge = sel?.type === 'edge' ? graph.edges[sel.index] ?? null : null

  const pathNodes = useMemo(() => (path ? new Set(path.nodes) : null), [path])
  const pathEdges = useMemo(() => (path ? new Set(path.edgeIndexes) : null), [path])

  const narration = useMemo(() => (selNode ? narrateActorInGraph(selNode.id, graph) : []), [selNode, graph])
  const relations = useMemo(() => {
    if (!selNode) return []
    return graph.edges
      .map((e, index) => ({ e, index }))
      .filter(({ e }) => e.a === selNode.id || e.b === selNode.id)
      .map(({ e, index }) => ({ e, index, other: nodeById.get(e.a === selNode.id ? e.b : e.a)! }))
      .filter((r) => r.other)
  }, [selNode, graph, nodeById])

  const clearPath = () => { setFollowFrom(null); setPath(null) }

  const control = {
    selectedNodeId: sel?.type === 'node' ? sel.id : null,
    selectedEdgeIndex: sel?.type === 'edge' ? sel.index : null,
    pathNodes,
    pathEdges,
    onTapNode(node: ActorGraphNode) {
      if (followFrom && node.id !== followFrom) {
        // Mode Suivre : le second clic calcule le chemin — tout le reste s'atténue.
        const p = shortestPath(graph, followFrom, node.id)
        setPath(p)
        setFollowFrom(null)
        setSel({ type: 'node', id: node.id })
        return
      }
      setPath(null)
      setSel({ type: 'node', id: node.id })
    },
    onTapEdge(index: number) { setPath(null); setFollowFrom(null); setSel({ type: 'edge', index }) },
    onTapVoid() { setSel(null); clearPath() },
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="relative">
        <ActorsGraphCanvas graph={graph} focusId={focusId} control={control} heightClass="h-[70vh]" />
        {/* Bandeau du mode Suivre. */}
        {followFrom && (
          <div className="absolute left-1/2 top-2 z-10 flex max-w-[92%] -translate-x-1/2 items-center gap-2 rounded-full border bg-card px-3.5 py-1.5 text-[12.5px] shadow-md">
            <Route className="h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden />
            <b className="truncate">Suivre depuis {nodeById.get(followFrom)?.label} — cliquez un second acteur</b>
            <button type="button" onClick={clearPath} className="shrink-0 rounded-full border bg-muted px-2 py-0.5 text-[12px] text-muted-foreground">Quitter</button>
          </div>
        )}
        {path && (
          <div className="absolute left-1/2 top-2 z-10 flex max-w-[92%] -translate-x-1/2 items-center gap-2 rounded-full border bg-card px-3.5 py-1.5 text-[12.5px] shadow-md">
            <Route className="h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden />
            <b className="truncate">{path.nodes.map((id) => nodeById.get(id)?.label).join(' → ')}</b>
            <button type="button" onClick={clearPath} className="shrink-0 rounded-full border bg-muted px-2 py-0.5 text-[12px] text-muted-foreground">Quitter</button>
          </div>
        )}
      </div>

      {/* ── PANNEAU : le graphe repère, le panneau explique. ── */}
      <aside className="rounded-2xl border bg-card p-5 shadow-sm lg:max-h-[70vh] lg:overflow-y-auto">
        {selNode ? (
          <NodePanel
            node={selNode}
            narration={narration}
            relations={relations}
            onFollow={() => { setPath(null); setFollowFrom(selNode.id) }}
            onSelectNode={(id) => { setPath(null); setSel({ type: 'node', id }) }}
            onSelectEdge={(index) => { setPath(null); setSel({ type: 'edge', index }) }}
          />
        ) : selEdge ? (
          <EdgePanel
            a={nodeById.get(selEdge.a)!}
            b={nodeById.get(selEdge.b)!}
            label={selEdge.label}
            since={selEdge.since}
            source={REL_SOURCE_LABEL[selEdge.rel]}
            onSelectNode={(id) => setSel({ type: 'node', id })}
          />
        ) : (
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground/80">Explorer les acteurs</p>
            <p className="mt-1.5">Cliquez un acteur pour comprendre qui il est et avec qui il travaille. Cliquez un lien pour comprendre la relation elle-même.</p>
            <p className="mt-1.5 text-xs">{graph.nodes.length} acteurs et objets · {graph.edges.length} relations structurelles.</p>
          </div>
        )}
      </aside>
    </div>
  )
}

function LevelBadge({ node }: { node: ActorGraphNode }) {
  if (node.historical) return <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">Historique</span>
  if (node.level === 'ok') return <span className="rounded-md border border-border/70 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{attentionLevelLabel('ok')}</span>
  const cls = node.level === 'urgent' ? 'bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300' : 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
  return <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{attentionLevelLabel(node.level)}</span>
}

function NodePanel({ node, narration, relations, onFollow, onSelectNode, onSelectEdge }: {
  node: ActorGraphNode
  narration: string[]
  relations: Array<{ e: { a: string; b: string; label: string }; index: number; other: ActorGraphNode }>
  onFollow(): void
  onSelectNode(id: string): void
  onSelectEdge(index: number): void
}) {
  const href = nodeHref(node)
  const Icon = KIND_ICON[node.kind]
  return (
    <div>
      <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" aria-hidden /> {KIND_LABEL[node.kind]}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold leading-snug">{node.label}</h2>
        <LevelBadge node={node} />
      </div>
      {node.sub && <p className="mt-0.5 text-[13px] text-muted-foreground">{node.sub}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {(node.kind === 'person' || node.kind === 'company' || node.kind === 'team') && (
          <button type="button" onClick={onFollow} className="rounded-full border bg-muted/50 px-3 py-1.5 text-[12.5px] font-semibold hover:border-foreground/30">
            <Route className="mr-1 inline h-3.5 w-3.5" aria-hidden /> Suivre le chemin vers…
          </button>
        )}
        {href && (
          <Link href={href} className="rounded-full border bg-muted/50 px-3 py-1.5 text-[12.5px] font-semibold hover:border-foreground/30">
            Ouvrir la fiche complète
          </Link>
        )}
      </div>

      {narration.length > 0 && (
        <>
          <SectionLabel>Pourquoi apparaît-il ici ?</SectionLabel>
          {narration.map((t, i) => (
            <p key={i} className="mb-1.5 text-[13.5px] leading-relaxed">{t}</p>
          ))}
          <p className="text-[11px] text-muted-foreground">Composé depuis les relations structurelles — rien n’est inventé.</p>
        </>
      )}

      {relations.length > 0 && (
        <>
          <SectionLabel>Relations ({relations.length})</SectionLabel>
          <ul className="divide-y">
            {relations.map(({ e, index, other }) => (
              <li key={index} className="flex items-center gap-1 py-1.5">
                <button type="button" onClick={() => onSelectEdge(index)} className="shrink-0 rounded px-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground" title="Inspecter la relation">
                  {e.label}
                </button>
                <button type="button" onClick={() => onSelectNode(other.id)} className="group flex min-w-0 flex-1 items-center gap-1.5 text-left">
                  <span className="truncate text-[13px] group-hover:underline">{other.label}</span>
                  <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/40 group-hover:text-foreground" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/** Le LIEN est un objet : nature, période, source, confiance. */
function EdgePanel({ a, b, label, since, source, onSelectNode }: {
  a: ActorGraphNode; b: ActorGraphNode; label: string; since: string | null; source: string
  onSelectNode(id: string): void
}) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Relation</p>
      <div className="mt-2 space-y-1 text-center">
        <button type="button" onClick={() => onSelectNode(a.id)} className="block w-full truncate text-[15px] font-semibold hover:underline">{a.label}</button>
        <p className="text-[13px] text-muted-foreground">{label}</p>
        <span aria-hidden className="block text-muted-foreground">↓</span>
        <button type="button" onClick={() => onSelectNode(b.id)} className="block w-full truncate text-[15px] font-semibold hover:underline">{b.label}</button>
      </div>
      <dl className="mt-4 space-y-2.5 text-[13px]">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Depuis</dt>
          <dd>{frDate(since) ?? 'Période inconnue'}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Source</dt>
          <dd>{source}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Confiance</dt>
          <dd>Structurelle — relation réelle, jamais déduite d’un texte.</dd>
        </div>
      </dl>
      <p className="mt-4 border-t pt-3 text-[11px] text-muted-foreground">Un clic dans le vide désélectionne. Cliquez un nom pour explorer l’acteur.</p>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 mt-4 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{children}</p>
}
