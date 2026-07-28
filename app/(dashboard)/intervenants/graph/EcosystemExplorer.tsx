'use client'

// ── ÉCOSYSTÈME — EXPLORATEUR DÉPLIABLE (V3 UX) ───────────────────────────────
// PAS un graphe : un ARBRE que l'utilisateur construit progressivement.
//   Entreprise ▼ Personnes ▼ (Équipes · Actions portées) · Équipe ▼ Chantiers
// « Comment est organisé mon réseau ? » — une navigation, pas un nuage.
// Alimenté par le graphe structurel (relations FK), zéro nouvelle donnée.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Building2, User, Users, MapPin, ListTodo, ChevronRight, ChevronDown } from 'lucide-react'
import type { ActorsGraph, ActorGraphNode, ActorGraphKind } from '@/lib/knowledge/actors-graph-model'
import { nodeHref } from './inspector'

const KIND_ICON = { company: Building2, person: User, team: Users, site: MapPin, action: ListTodo } as const

interface Eco {
  companies: ActorGraphNode[]
  childrenOf: (n: ActorGraphNode) => ActorGraphNode[]
}

function useEcosystem(graph: ActorsGraph): Eco {
  return useMemo(() => {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]))
    const personsOfCompany = new Map<string, ActorGraphNode[]>()
    const teamsOfPerson = new Map<string, ActorGraphNode[]>()
    const actionsOfPerson = new Map<string, ActorGraphNode[]>()
    const sitesOfTeam = new Map<string, ActorGraphNode[]>()
    const push = (m: Map<string, ActorGraphNode[]>, k: string, v?: ActorGraphNode) => { if (!v) return; if (!m.has(k)) m.set(k, []); m.get(k)!.push(v) }
    for (const e of graph.edges) {
      if (e.rel === 'belongs_to') push(personsOfCompany, e.b, byId.get(e.a))   // personne → entreprise
      else if (e.rel === 'member_of') push(teamsOfPerson, e.a, byId.get(e.b))  // personne → équipe
      else if (e.rel === 'referent_of') push(actionsOfPerson, e.a, byId.get(e.b)) // personne → action
      else if (e.rel === 'mobilized_on') push(sitesOfTeam, e.a, byId.get(e.b)) // équipe → chantier
    }
    const byLabel = (a: ActorGraphNode, b: ActorGraphNode) => a.label.localeCompare(b.label, 'fr')
    for (const m of [personsOfCompany, teamsOfPerson, actionsOfPerson, sitesOfTeam]) for (const l of m.values()) l.sort(byLabel)
    const companies = graph.nodes.filter((n) => n.kind === 'company')
      .sort((a, b) => (personsOfCompany.get(b.id)?.length ?? 0) - (personsOfCompany.get(a.id)?.length ?? 0) || byLabel(a, b))
    const childrenOf = (n: ActorGraphNode): ActorGraphNode[] => {
      if (n.kind === 'company') return personsOfCompany.get(n.id) ?? []
      if (n.kind === 'person') return [...(teamsOfPerson.get(n.id) ?? []), ...(actionsOfPerson.get(n.id) ?? [])]
      if (n.kind === 'team') return sitesOfTeam.get(n.id) ?? []
      return []
    }
    return { companies, childrenOf }
  }, [graph])
}

export function EcosystemExplorer({ graph }: { graph: ActorsGraph }) {
  const eco = useEcosystem(graph)
  if (eco.companies.length === 0) {
    return <div className="rounded-2xl border border-dashed border-border/60 py-12 text-center text-sm text-muted-foreground italic">Aucune entreprise à explorer pour le moment.</div>
  }
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-2 lg:max-h-[70vh] lg:overflow-y-auto">
      <ul>
        {eco.companies.map((c) => <Row key={c.id} node={c} eco={eco} depth={0} />)}
      </ul>
    </div>
  )
}

const KIND_TINT: Record<ActorGraphKind, string> = {
  company: 'text-brand-700 dark:text-brand-300',
  person: 'text-foreground',
  team: 'text-violet-700 dark:text-violet-300',
  site: 'text-emerald-700 dark:text-emerald-300',
  action: 'text-amber-700 dark:text-amber-300',
}

function Row({ node, eco, depth }: { node: ActorGraphNode; eco: Eco; depth: number }) {
  const [open, setOpen] = useState(false)
  const children = eco.childrenOf(node)
  const hasChildren = children.length > 0
  const Icon = KIND_ICON[node.kind]
  const href = nodeHref(node)
  return (
    <li>
      <div className="flex items-center gap-1 rounded-md py-1 hover:bg-muted/50" style={{ paddingLeft: depth * 18 + 4 }}>
        {hasChildren ? (
          <button type="button" onClick={() => setOpen((o) => !o)} className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground" aria-expanded={open} aria-label={open ? 'Replier' : 'Déplier'}>
            {open ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
          </button>
        ) : <span className="w-5 shrink-0" />}
        <Icon className={`h-4 w-4 shrink-0 ${KIND_TINT[node.kind]}`} aria-hidden />
        {href
          ? <Link href={href} className={`truncate text-[13px] hover:underline ${node.kind === 'company' ? 'font-semibold' : ''}`}>{node.label}</Link>
          : <span className={`truncate text-[13px] ${node.kind === 'company' ? 'font-semibold' : ''}`}>{node.label}</span>}
        {hasChildren && <span className="ml-1 shrink-0 text-[11px] tabular-nums text-muted-foreground">{children.length}</span>}
      </div>
      {open && hasChildren && (
        <ul>{children.map((ch) => <Row key={ch.id} node={ch} eco={eco} depth={depth + 1} />)}</ul>
      )}
    </li>
  )
}
