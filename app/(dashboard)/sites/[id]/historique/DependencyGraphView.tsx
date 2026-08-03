import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SiteDependencyGraph, SiteDependencyLink } from '@/lib/documents/site-synthesis'
import { LINK_TYPE_LABELS } from '@/lib/db/subject-thread-links'
import type { SubjectLinkType } from '@/lib/db/subject-thread-links'

// ── Couleurs par type de lien ─────────────────────────────────────────────────

const LINK_TYPE_COLORS: Record<SubjectLinkType, string> = {
  requires:   'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  enables:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  causes:     'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400',
  validates:  'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400',
  replaces:   'bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-400',
  relates_to: 'bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-400',
}

// ── Construction des chaînes causales (DAG) ───────────────────────────────────

interface ChainNode {
  id: string
  label: string
  linkFromParent: { type: SubjectLinkType; justification: string | null } | null
  children: ChainNode[]
}

function buildChains(links: SiteDependencyLink[]): ChainNode[] {
  const outgoing = new Map<string, SiteDependencyLink[]>()
  const incomingIds = new Set<string>()
  const labelMap = new Map<string, string>()

  for (const link of links) {
    if (!outgoing.has(link.fromCanonicalSubjectId)) outgoing.set(link.fromCanonicalSubjectId, [])
    outgoing.get(link.fromCanonicalSubjectId)!.push(link)
    if (link.toCanonicalSubjectId) incomingIds.add(link.toCanonicalSubjectId)
    labelMap.set(link.fromCanonicalSubjectId, link.fromLabel)
    if (link.toCanonicalSubjectId) labelMap.set(link.toCanonicalSubjectId, link.toLabel)
  }

  // Racines = nœuds FROM qui n'apparaissent pas comme TO
  const roots = [...outgoing.keys()].filter((id) => !incomingIds.has(id))
  const startIds = roots.length > 0 ? roots : [...outgoing.keys()]

  function buildNode(
    id: string,
    linkFromParent: ChainNode['linkFromParent'],
    path: ReadonlySet<string>,
  ): ChainNode {
    const label = labelMap.get(id) ?? 'Sujet inconnu'
    if (path.has(id)) {
      // Cycle : afficher comme feuille sans récurser
      return { id, label, linkFromParent, children: [] }
    }
    const newPath = new Set(path).add(id)
    const outs = outgoing.get(id) ?? []
    const children = outs.map((link) =>
      buildNode(
        link.toCanonicalSubjectId ?? `__${link.id}`,
        { type: link.linkType, justification: link.justification },
        newPath,
      ),
    )
    return { id, label, linkFromParent, children }
  }

  return startIds.map((rootId) => buildNode(rootId, null, new Set()))
}

// ── Nœud de chaîne (récursif) ─────────────────────────────────────────────────

function ChainNodeView({
  node,
  siteId,
  depth = 0,
}: {
  node: ChainNode
  siteId: string
  depth?: number
}) {
  const isKnown = !node.id.startsWith('__')

  return (
    <div>
      {/* Connecteur parent → enfant */}
      {node.linkFromParent && (
        <div className="mb-1.5 flex items-center gap-1.5 pl-1">
          <div className="h-px w-5 bg-border" />
          <span className={cn(
            'rounded-full px-2 py-0.5 text-[11px] font-medium',
            LINK_TYPE_COLORS[node.linkFromParent.type],
          )}>
            {LINK_TYPE_LABELS[node.linkFromParent.type].label}
          </span>
          <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        </div>
      )}

      {/* Nœud */}
      <div className="flex items-center gap-2">
        <div className={cn(
          'h-2.5 w-2.5 shrink-0 rounded-full',
          depth === 0 ? 'bg-foreground/80' : 'bg-muted-foreground/40 ring-1 ring-border',
        )} />
        {isKnown ? (
          <Link
            href={`/sites/${siteId}/historique/sujets/${node.id}`}
            className={cn(
              'underline-offset-2 hover:underline',
              depth === 0 ? 'text-sm font-semibold' : 'text-sm font-medium',
            )}
          >
            {node.label}
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">{node.label}</span>
        )}
      </div>

      {/* Justification */}
      {node.linkFromParent?.justification && (
        <p className="ml-5 mt-0.5 text-xs italic text-muted-foreground">
          {node.linkFromParent.justification}
        </p>
      )}

      {/* Enfants */}
      {node.children.length > 0 && (
        <div className="ml-1 mt-2 space-y-2 border-l border-border pl-4">
          {node.children.map((child) => (
            <ChainNodeView key={child.id} node={child} siteId={siteId} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Composant principal ────────────────────────────────────────────────────────

export interface DependencyGraphViewProps {
  siteId: string
  graph: SiteDependencyGraph
}

export function DependencyGraphView({ siteId, graph }: DependencyGraphViewProps) {
  if (graph.links.length === 0) {
    return (
      <section className="rounded-[22px] border border-dashed bg-card p-8 text-center shadow-sm">
        <p className="font-medium">Aucun lien entre sujets.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Ajoutez des liens causaux depuis la fiche de chaque sujet canonique.
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          Types disponibles :{' '}
          <span className="font-medium">
            nécessite · permet · entraîne · valide · remplace · est associé à
          </span>
        </p>
      </section>
    )
  }

  const chains = buildChains(graph.links)

  const totalSubjects = new Set([
    ...graph.links.map((l) => l.fromCanonicalSubjectId),
    ...graph.links.filter((l) => l.toCanonicalSubjectId).map((l) => l.toCanonicalSubjectId!),
  ]).size

  return (
    <section className="rounded-[22px] border bg-card p-5 shadow-sm">
      <div className="mb-5 flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-semibold">Dépendances entre sujets</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {graph.links.length} lien{graph.links.length > 1 ? 's' : ''} confirmé{graph.links.length > 1 ? 's' : ''}{' '}
            · {totalSubjects} sujet{totalSubjects > 1 ? 's' : ''} concerné{totalSubjects > 1 ? 's' : ''}
          </p>
        </div>
        <p className="shrink-0 text-xs text-muted-foreground">
          Ajoutez des liens depuis la fiche de chaque sujet.
        </p>
      </div>

      <div className="space-y-5">
        {chains.map((chain) => (
          <div
            key={chain.id}
            className="rounded-[18px] border bg-muted/20 p-4"
          >
            <ChainNodeView node={chain} siteId={siteId} depth={0} />
          </div>
        ))}
      </div>
    </section>
  )
}
