'use client'

import Link from 'next/link'
import { Search, FileText, History } from 'lucide-react'
import { useState } from 'react'

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
  urgency: 'late' | 'today' | 'week' | 'later' | 'undated'
  actionHref: string
  /** Fiche du sujet canonique — présent uniquement si l'action porte déjà la FK.
   *  `null` = la carte reste strictement inchangée. */
  subjectHref: string | null
}

function formatDue(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
}

function ActionRow({ group }: { group: ActionGroupDisplay }) {
  const isLate = group.urgency === 'late'
  const isToday = group.urgency === 'today'
  const isWeek = group.urgency === 'week'

  const rowClass = isLate
    ? 'border-rose-200 bg-rose-50/40 dark:border-rose-900/40 dark:bg-rose-950/20'
    : isToday
    ? 'border-amber-200 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/20'
    : isWeek
    ? 'border-blue-200 bg-blue-50/30 dark:border-blue-900/40 dark:bg-blue-950/20'
    : 'border-dashed border-muted-foreground/20'

  const provenanceBadge = [group.provenanceLabel, group.provenanceDate].filter(Boolean).join(' · ')
  const mentionLabel = group.count > 1 ? `${group.count} mentions` : null

  return (
    <li className={`rounded-xl border px-4 py-3 ${rowClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Link
            href={group.actionHref}
            className="block text-sm font-medium leading-snug hover:underline"
          >
            {group.title}
          </Link>

          <div className="flex flex-wrap items-center gap-2">
            {/* Provenance */}
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
              <FileText className="h-3 w-3" />
              {provenanceBadge}
            </span>

            {/* Nb mentions */}
            {mentionLabel && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                {mentionLabel}
              </span>
            )}

            {/* Corps d'état */}
            {group.corpsEtat && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                {group.corpsEtat}
              </span>
            )}

            {/* Échéance */}
            {group.due_date && isLate && (
              <span className="text-[11px] text-rose-600">depuis le {formatDue(group.due_date)}</span>
            )}
            {group.due_date && (isToday || isWeek) && (
              <span className="text-[11px] text-amber-600">le {formatDue(group.due_date)}</span>
            )}
          </div>

          {/* Responsable */}
          <p className="text-[11px] text-muted-foreground">
            {group.assignedTo
              ? <span>Responsable : <span className="font-medium text-foreground">{group.assignedTo}</span></span>
              : <span className="italic">Non affecté</span>
            }
          </p>

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
        </div>

      </div>
    </li>
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

  const late    = filtered.filter((g) => g.urgency === 'late')
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
          <ul className="space-y-1.5">{late.map((g) => <ActionRow key={g.id} group={g} />)}</ul>
        </section>
      )}

      {/* Aujourd'hui */}
      {today_.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-amber-600">Aujourd&apos;hui ({today_.length})</h2>
          <ul className="space-y-1.5">{today_.map((g) => <ActionRow key={g.id} group={g} />)}</ul>
        </section>
      )}

      {/* Cette semaine */}
      {week.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-blue-600">Cette semaine ({week.length})</h2>
          <ul className="space-y-1.5">{week.map((g) => <ActionRow key={g.id} group={g} />)}</ul>
        </section>
      )}

      {/* Sans date · À planifier */}
      {undated.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Sans date · À planifier ({undated.length})
          </h2>
          <ul className="space-y-1.5">{undated.map((g) => <ActionRow key={g.id} group={g} />)}</ul>
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
