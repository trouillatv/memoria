'use client'

// 6E.4A — orchestrateur de la page "MemorIA a besoin de toi". Filtres/tri en langage métier,
// jamais organisés par type technique de backend (mandat Vincent). Une seule file de cartes
// complètes, empilées, à toutes les tailles d'écran (même pattern MemoryInbox — filtres à
// pilules + liste verticale) ; à partir de lg, un panneau récapitulatif sticky s'ajoute à droite
// (même ton que la bannière Aperçu violet-50/50) et sert aussi de filtre rapide par catégorie.
//
// Une question résolue disparaît immédiatement (retrait optimiste local, `done`), puis
// router.refresh() revalide le serveur (queues + bannière Aperçu) — même geste que
// MemoryReviewPanel/ReviewCard (`onDone` + re-render serveur).

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { QuestionCard, CATEGORY_TONE, CATEGORY_ICON, type ActionResult, type SitePointOption } from './NeedsYouCards'
import { MEMORIA_NEEDS_YOU_CATEGORY_LABELS, MEMORIA_NEEDS_YOU_CATEGORY_ORDER, type MemoriaNeedsYouCategory } from '@/lib/knowledge/tracked-point-needs-you-categories'
import type { MemoriaNeedsYouCategorySummary, MemoriaNeedsYouQuestion } from '@/lib/knowledge/tracked-point-needs-you-summary'

type FilterValue = 'all' | MemoriaNeedsYouCategory
type SortMode = 'importance' | 'recent'

const FILTER_LABELS: Record<FilterValue, string> = {
  all: 'Tous',
  duplicate_points: 'Identité',
  attach_information: 'À rattacher',
  confirm_trackability: 'À suivre',
  assign_resolution: 'Résolutions',
  clarify_evidence: 'Preuves',
}
const FILTER_ORDER: FilterValue[] = ['all', ...MEMORIA_NEEDS_YOU_CATEGORY_ORDER]

// La seule notion de date disponible varie par primitive source — duplicate_points n'en a
// aucune (une paire de Points n'est pas datée), donc "Plus récent" la relègue en fin de liste.
function questionDate(question: MemoriaNeedsYouQuestion): string | null {
  switch (question.category) {
    case 'attach_information':
    case 'confirm_trackability':
    case 'assign_resolution':
      return question.entry.sourceDate ?? null
    case 'clarify_evidence':
      return question.entry.createdAt ?? null
    case 'duplicate_points':
    default:
      return null
  }
}

export function NeedsYouClient({
  siteId,
  questions,
  sitePoints,
}: {
  siteId: string
  questions: MemoriaNeedsYouQuestion[]
  categories: MemoriaNeedsYouCategorySummary[]
  sitePoints: SitePointOption[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [done, setDone] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<FilterValue>('all')
  const [sortMode, setSortMode] = useState<SortMode>('importance')

  const remaining = questions.filter((q) => !done.has(q.id))

  const counts = useMemo(() => {
    const c: Record<MemoriaNeedsYouCategory, number> = {
      duplicate_points: 0,
      attach_information: 0,
      confirm_trackability: 0,
      assign_resolution: 0,
      clarify_evidence: 0,
    }
    for (const q of remaining) c[q.category]++
    return c
  }, [remaining])

  const filteredQuestions = filter === 'all' ? remaining : remaining.filter((q) => q.category === filter)

  const sorted = useMemo(() => {
    if (sortMode === 'importance') return filteredQuestions
    return [...filteredQuestions].sort((a, b) => {
      const da = questionDate(a)
      const db = questionDate(b)
      if (da && db) return db.localeCompare(da)
      if (da) return -1
      if (db) return 1
      return 0
    })
  }, [filteredQuestions, sortMode])

  function runActionFor(questionId: string) {
    return (action: () => Promise<ActionResult>) => {
      setErrors((prev) => {
        if (!(questionId in prev)) return prev
        const next = { ...prev }
        delete next[questionId]
        return next
      })
      setPending((prev) => new Set(prev).add(questionId))
      void action()
        .then((result) => {
          setPending((prev) => {
            const next = new Set(prev)
            next.delete(questionId)
            return next
          })
          if (result.ok) {
            setDone((prev) => new Set(prev).add(questionId))
            startTransition(() => router.refresh())
          } else {
            setErrors((prev) => ({ ...prev, [questionId]: result.error ?? 'Action impossible.' }))
          }
        })
        .catch(() => {
          setPending((prev) => {
            const next = new Set(prev)
            next.delete(questionId)
            return next
          })
          setErrors((prev) => ({ ...prev, [questionId]: 'Une erreur est survenue.' }))
        })
    }
  }

  if (remaining.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-card/50 px-4 py-8 text-center">
        <p className="text-sm font-medium">Rien à clarifier pour le moment.</p>
        <p className="mt-1 text-[12px] text-muted-foreground">La mémoire du chantier est à jour.</p>
      </div>
    )
  }

  return (
    <div className="lg:grid lg:grid-cols-[1fr_280px] lg:items-start lg:gap-4">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {FILTER_ORDER.filter((f) => f === 'all' || counts[f] > 0).map((f) => {
              const count = f === 'all' ? remaining.length : counts[f]
              const active = filter === f
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs font-medium',
                    active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted/60',
                  )}
                >
                  {FILTER_LABELS[f]} <span className="tabular-nums">{count}</span>
                </button>
              )
            })}
          </div>
          <div className="flex gap-1.5">
            {(['importance', 'recent'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setSortMode(mode)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs font-medium',
                  sortMode === mode ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted/60',
                )}
              >
                {mode === 'importance' ? 'Plus important' : 'Plus récent'}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          {sorted.map((q) => (
            <QuestionCard
              key={q.id}
              question={q}
              siteId={siteId}
              pending={pending.has(q.id)}
              error={errors[q.id]}
              sitePoints={sitePoints}
              runAction={runActionFor(q.id)}
            />
          ))}
        </div>
      </div>

      {/* Panneau récapitulatif — même ton/structure que la bannière Aperçu (violet-50/50,
          pastille par catégorie) : ici les lignes sont aussi des filtres cliquables, pas
          seulement un rappel. Masqué en dessous de lg, sticky au-delà pour rester visible
          pendant le défilement de la file. */}
      <aside className="mt-4 hidden rounded-[18px] border border-violet-200 bg-violet-50/50 p-4 shadow-sm dark:border-violet-900/40 dark:bg-violet-950/20 lg:sticky lg:top-4 lg:mt-0 lg:block">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/40">
            <HelpCircle className="h-4 w-4 text-violet-600 dark:text-violet-300" />
          </span>
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-violet-900 dark:text-violet-200">
            MemorIA a besoin de toi
          </h2>
        </div>
        <ul className="mt-3 space-y-1">
          {MEMORIA_NEEDS_YOU_CATEGORY_ORDER.filter((c) => counts[c] > 0).map((c) => {
            const tone = CATEGORY_TONE[c]
            const Icon = CATEGORY_ICON[c]
            const active = filter === c
            return (
              <li key={c}>
                <button
                  type="button"
                  onClick={() => setFilter(active ? 'all' : c)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition-colors',
                    active ? 'bg-white dark:bg-violet-900/30' : 'hover:bg-white/60 dark:hover:bg-violet-900/20',
                  )}
                >
                  <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full', tone.iconBg)}>
                    <Icon className={cn('h-3 w-3', tone.iconText)} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-foreground/90">{MEMORIA_NEEDS_YOU_CATEGORY_LABELS[c]}</span>
                  <span className="shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">{counts[c]}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </aside>
    </div>
  )
}
