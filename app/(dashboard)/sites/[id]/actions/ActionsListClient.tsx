'use client'

import Link from 'next/link'
import { Search, FileText, History, ChevronDown, ListTodo, CalendarDays, UserSquare } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'

export interface ActionGroupDisplay {
  id: string
  title: string
  count: number
  docCount: number
  provenanceLabel: string
  provenanceDate: string | null
  due_date: string | null
  assignedTo: string | null
  corpsEtat: string | null
  urgency: 'late' | 'late_unconfirmed' | 'today' | 'week' | 'later' | 'undated'
  actionHref: string
  /** Fiche du sujet canonique — présent uniquement si l'action porte déjà la FK.
   *  `null` = la carte reste strictement inchangée. */
  subjectHref: string | null
}

function formatDue(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
}

function UrgencyBadge({ urgency, dueDate }: { urgency: ActionGroupDisplay['urgency']; dueDate: string | null }) {
  if (urgency === 'late') {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-rose-300 bg-rose-50 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-rose-900 shrink-0 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
        En retard
      </span>
    )
  }
  if (urgency === 'late_unconfirmed') {
    return (
      <span title="Échéance dépassée mais non confirmée — pas nécessairement en retard" className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-amber-900 shrink-0 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
        Échéance dépassée
      </span>
    )
  }
  if (urgency === 'today') {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-amber-900 shrink-0 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
        Aujourd&apos;hui
      </span>
    )
  }
  if (urgency === 'week' && dueDate) {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-blue-300 bg-blue-50 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-blue-900 shrink-0 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-300">
        {formatDue(dueDate)}
      </span>
    )
  }
  return null
}

function Expandable({ children }: { children: ReactNode }) {
  return <div className="space-y-2.5 border-t pt-2.5 mt-1">{children}</div>
}

function ActionRow({ group }: { group: ActionGroupDisplay }) {
  const [expanded, setExpanded] = useState(false)
  const provenanceBadge = [group.provenanceLabel, group.provenanceDate].filter(Boolean).join(' · ')
  const mentionLabel = group.count > 1 ? `${group.count} mentions` : null

  return (
    <div className="rounded-lg border bg-card p-4 space-y-1.5">
      {/* Ligne titre : libellé + urgence + toggle */}
      <div className="flex items-start gap-2 flex-wrap">
        <ListTodo className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" aria-hidden />
        <Link
          href={group.actionHref}
          className="font-medium text-sm flex-1 hover:underline"
        >
          {group.title}
        </Link>
        <UrgencyBadge urgency={group.urgency} dueDate={group.due_date} />
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
          aria-label={expanded ? 'Réduire' : 'Développer'}
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Chips info — toujours visibles */}
      {(group.corpsEtat || group.assignedTo) && (
        <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
          {group.corpsEtat && <span>{group.corpsEtat}</span>}
          {group.assignedTo && (
            <span className="inline-flex items-center gap-1">
              <UserSquare className="h-3 w-3" aria-hidden />
              {group.assignedTo}
            </span>
          )}
        </div>
      )}

      {/* Détails — affichés uniquement si expanded */}
      {expanded && (
        <Expandable>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
              <FileText className="h-3 w-3" />
              {provenanceBadge}
            </span>
            {mentionLabel && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                {mentionLabel}
              </span>
            )}
            {group.due_date && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <CalendarDays className="h-3 w-3" aria-hidden />
                Échéance le {formatDue(group.due_date)}
              </span>
            )}
          </div>

          {!group.assignedTo && (
            <p className="text-[11px] italic text-muted-foreground">Non affecté</p>
          )}

          {/* Mémoire du sujet. La carte dit QUOI faire ; ce lien dit POURQUOI et
              DEPUIS QUAND. L'action reste un objet distinct : rien n'est fusionné. */}
          {group.subjectHref && (
            <Link
              href={group.subjectHref}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
            >
              <History className="h-3 w-3" />
              Voir l&apos;historique du sujet
            </Link>
          )}
        </Expandable>
      )}
    </div>
  )
}

export function ActionsListClient({
  groups,
  siteId,
}: {
  groups: ActionGroupDisplay[]
  siteId: string
}) {
  const [query, setQuery] = useState('')

  const filtered = query.trim()
    ? groups.filter((g) => g.title.toLowerCase().includes(query.toLowerCase()))
    : groups

  const late            = filtered.filter((g) => g.urgency === 'late')
  const lateUnconfirmed = filtered.filter((g) => g.urgency === 'late_unconfirmed')
  const today_  = filtered.filter((g) => g.urgency === 'today')
  const week    = filtered.filter((g) => g.urgency === 'week')
  const undated = filtered.filter((g) => g.urgency === 'undated' || g.urgency === 'later')

  return (
    <div className="space-y-5">
      {/* Recherche */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Rechercher un sujet d'action…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-9 w-full rounded-lg border bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {query && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {filtered.length}/{groups.length}
          </span>
        )}
      </div>

      {/* En retard */}
      {late.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-rose-600">En retard ({late.length})</h2>
          <div className="space-y-2">{late.map((g) => <ActionRow key={g.id} group={g} />)}</div>
        </section>
      )}

      {/* Échéance dépassée · non confirmée — la date (déduite IA) est passée mais
          n'a pas été confirmée : jamais « en retard » au sens fort (règle canonique
          partagée avec l'Aperçu). Catégorie calme, distincte du rouge. */}
      {lateUnconfirmed.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-amber-700 dark:text-amber-400">Échéance dépassée · à confirmer ({lateUnconfirmed.length})</h2>
          <div className="space-y-2">{lateUnconfirmed.map((g) => <ActionRow key={g.id} group={g} />)}</div>
        </section>
      )}

      {/* Aujourd'hui */}
      {today_.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-amber-600">Aujourd&apos;hui ({today_.length})</h2>
          <div className="space-y-2">{today_.map((g) => <ActionRow key={g.id} group={g} />)}</div>
        </section>
      )}

      {/* Cette semaine */}
      {week.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-blue-600">Cette semaine ({week.length})</h2>
          <div className="space-y-2">{week.map((g) => <ActionRow key={g.id} group={g} />)}</div>
        </section>
      )}

      {/* Sans date · À planifier */}
      {undated.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Sans date · À planifier ({undated.length})
          </h2>
          <div className="space-y-2">{undated.map((g) => <ActionRow key={g.id} group={g} />)}</div>
        </section>
      )}

      {filtered.length === 0 && query && (
        <p className="rounded-xl border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          Aucun sujet correspondant à « {query} ».
        </p>
      )}
    </div>
  )
}
