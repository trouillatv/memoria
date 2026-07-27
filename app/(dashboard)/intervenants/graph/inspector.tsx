'use client'

// ── INSPECTEUR DU GRAPHE DES ACTEURS ─────────────────────────────────────────
// Panneaux PARTAGÉS entre l'Explorer plein écran (vue Graphe) et le réseau FUSIONNÉ
// dans les fiches (même endroit, aucune fenêtre intermédiaire — direction Vincent).
// NodePanel raconte le nœud (narration factuelle + relations cliquables) ;
// EdgePanel explique le LIEN comme un objet (nature, depuis, source, confiance).

import Link from 'next/link'
import { ArrowRight, Route, User, Building2, Users, MapPin, ListTodo } from 'lucide-react'
import type { ActorGraphNode, ActorGraphKind } from '@/lib/knowledge/actors-graph-model'
import { attentionLevelLabel } from '@/lib/knowledge/actor-attention'

const KIND_LABEL: Record<ActorGraphKind, string> = { person: 'Personne', company: 'Entreprise', team: 'Équipe', site: 'Chantier', action: 'Action' }
const KIND_ICON = { person: User, company: Building2, team: Users, site: MapPin, action: ListTodo } as const

/** Surface propriétaire (lien EXPLICITE — jamais une navigation implicite au clic). */
export function nodeHref(n: ActorGraphNode): string | null {
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

export function LevelBadge({ node }: { node: ActorGraphNode }) {
  if (node.historical) return <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">Historique</span>
  if (node.level === 'ok') return <span className="rounded-md border border-border/70 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{attentionLevelLabel('ok')}</span>
  const cls = node.level === 'urgent' ? 'bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300' : 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
  return <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{attentionLevelLabel(node.level)}</span>
}

export function NodePanel({ node, narration, relations, compact, onFollow, onSelectNode, onSelectEdge, onActivateActor }: {
  node: ActorGraphNode
  narration: string[]
  relations: Array<{ e: { a: string; b: string; label: string }; index: number; other: ActorGraphNode }>
  /** Réseau embarqué dans une fiche : typo plus resserrée. */
  compact?: boolean
  onFollow(): void
  onSelectNode(id: string): void
  onSelectEdge(index: number): void
  /** Fourni dans le maître-détail : « Ouvrir sa fiche ici » recharge la fiche EN PLACE
   *  (aucune navigation, aucune fenêtre intermédiaire). */
  onActivateActor?: (node: ActorGraphNode) => void
}) {
  const href = nodeHref(node)
  const Icon = KIND_ICON[node.kind]
  const isActor = node.kind === 'person' || node.kind === 'company' || node.kind === 'team'
  return (
    <div>
      <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" aria-hidden /> {KIND_LABEL[node.kind]}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <h3 className={`${compact ? 'text-base' : 'text-lg'} font-semibold leading-snug`}>{node.label}</h3>
        <LevelBadge node={node} />
      </div>
      {node.sub && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{node.sub}</p>}

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {isActor && onActivateActor && (
          <button type="button" onClick={() => onActivateActor(node)} className="rounded-full border bg-muted/50 px-2.5 py-1 text-[12px] font-semibold hover:border-foreground/30">
            Ouvrir sa fiche ici
          </button>
        )}
        {isActor && (
          <button type="button" onClick={onFollow} className="rounded-full border bg-muted/50 px-2.5 py-1 text-[12px] font-semibold hover:border-foreground/30">
            <Route className="mr-1 inline h-3.5 w-3.5" aria-hidden /> Suivre le chemin…
          </button>
        )}
        {href && !onActivateActor && (
          <Link href={href} className="rounded-full border bg-muted/50 px-2.5 py-1 text-[12px] font-semibold hover:border-foreground/30">
            Ouvrir la fiche complète
          </Link>
        )}
      </div>

      {narration.length > 0 && (
        <>
          <SectionLabel>Pourquoi apparaît-il ici ?</SectionLabel>
          {narration.map((t, i) => (
            <p key={i} className={`mb-1.5 ${compact ? 'text-[12.5px]' : 'text-[13.5px]'} leading-relaxed`}>{t}</p>
          ))}
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
                  <span className="truncate text-[12.5px] group-hover:underline">{other.label}</span>
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
export function EdgePanel({ a, b, label, since, source, onSelectNode }: {
  a: ActorGraphNode; b: ActorGraphNode; label: string; since: string | null; source: string
  onSelectNode(id: string): void
}) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Relation</p>
      <div className="mt-2 space-y-1 text-center">
        <button type="button" onClick={() => onSelectNode(a.id)} className="block w-full truncate text-[14px] font-semibold hover:underline">{a.label}</button>
        <p className="text-[12.5px] text-muted-foreground">{label}</p>
        <span aria-hidden className="block text-muted-foreground">↓</span>
        <button type="button" onClick={() => onSelectNode(b.id)} className="block w-full truncate text-[14px] font-semibold hover:underline">{b.label}</button>
      </div>
      <dl className="mt-3.5 space-y-2 text-[12.5px]">
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
    </div>
  )
}

/** Le chemin est RACONTÉ : « Joseph → travaille chez → Clim Austral → intervient
 *  sur → Petro Attiti ». Chaque étape est cliquable. */
export function PathPanel({ steps, onQuit, onSelectNode }: {
  steps: Array<{ node: ActorGraphNode; relLabel: string | null }>
  onQuit(): void
  onSelectNode(id: string): void
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <Route className="h-3.5 w-3.5" aria-hidden /> Chemin
        </p>
        <button type="button" onClick={onQuit} className="rounded-full border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Quitter</button>
      </div>
      <ol className="mt-2.5">
        {steps.map(({ node, relLabel }, i) => (
          <li key={node.id}>
            {relLabel && <p className="pl-1 text-[11px] italic text-muted-foreground">↓ {relLabel}</p>}
            <button
              type="button"
              onClick={() => onSelectNode(node.id)}
              className={`flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-muted ${i === 0 || i === steps.length - 1 ? 'font-semibold' : ''}`}
            >
              <span className="text-[13.5px]">{node.label}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="mt-3 border-t pt-2.5 text-[11px] text-muted-foreground">Le plus court chemin réel entre ces deux acteurs.</p>
    </div>
  )
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 mt-3.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{children}</p>
}
