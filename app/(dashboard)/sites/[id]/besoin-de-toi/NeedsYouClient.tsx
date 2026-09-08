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
import { computeQuestionPriority, MEMORIA_NEEDS_YOU_PRIORITY_ORDER } from '@/lib/knowledge/tracked-point-needs-you-priority'
import type { MemoriaNeedsYouPriority } from '@/lib/knowledge/tracked-point-needs-you-priority'
import type { MemoriaNeedsYouCategorySummary, MemoriaNeedsYouQuestion } from '@/lib/knowledge/tracked-point-needs-you-summary'

type FilterValue = 'all' | MemoriaNeedsYouCategory
// 6E.4A UI-pass — Importance et tri sont deux axes distincts (mandat Vincent : "Historique ≠
// faible importance, Récent ≠ important") : l'un filtre (PriorityFilterValue), l'autre trie
// (SortMode) — jamais fusionnés dans un seul contrôle.
type SortMode = 'priority' | 'recent' | 'oldest'
type PriorityFilterValue = 'all' | 'PRIORITAIRE' | 'IMPORTANT' | 'A_CLARIFIER'

// 6E.4A.6 — Charge cognitive : n'afficher qu'un lot de cartes à la fois plutôt que toute la file
// (une file de 152 questions rendues d'un coup est le problème signalé, pas juste un style de
// pagination). 20 = même ordre de grandeur que le plafond WOW-2 (cap-7 très inférieur, mais ici la
// file peut légitimement dépasser la centaine).
const PAGE_SIZE = 20

const FILTER_LABELS: Record<FilterValue, string> = {
  all: 'Tous',
  duplicate_points: 'Identité',
  attach_information: 'À rattacher',
  confirm_trackability: 'À suivre',
  assign_resolution: 'Résolutions',
  clarify_evidence: 'Preuves',
}
const FILTER_ORDER: FilterValue[] = ['all', ...MEMORIA_NEEDS_YOU_CATEGORY_ORDER]

const PRIORITY_FILTER_LABELS: Record<PriorityFilterValue, string> = {
  all: 'Toutes',
  PRIORITAIRE: 'Prioritaires',
  IMPORTANT: 'Importantes',
  A_CLARIFIER: 'À clarifier',
}
const PRIORITY_FILTER_ORDER: PriorityFilterValue[] = ['all', 'PRIORITAIRE', 'IMPORTANT', 'A_CLARIFIER']

// Vérité temporelle (6E.4A.1) : le tri "Plus récent" doit classer par date métier (PV/visite,
// `*DocumentEffectiveDate`) — jamais par date d'import (`sourceDate`/`createdAt`), sinon un vieux
// PV importé aujourd'hui remonterait devant un PV récent importé la semaine dernière. La date
// d'import ne sert qu'en repli quand la date métier est inconnue, jamais l'inverse.
// duplicate_points reste sans date de tri : une paire de Points n'est pas une source datée.
function questionDate(question: MemoriaNeedsYouQuestion): string | null {
  switch (question.category) {
    case 'attach_information':
    case 'confirm_trackability':
    case 'assign_resolution':
      return question.entry.sourceDocumentEffectiveDate ?? question.entry.sourceDate ?? null
    case 'clarify_evidence': {
      const firstProposal = question.entry.proposals[0] ?? null
      return firstProposal?.documentEffectiveDate ?? firstProposal?.createdAt ?? question.entry.createdAt ?? null
    }
    case 'duplicate_points':
    default:
      return null
  }
}

// 6E.4A.5 — Mode Dernier PV : date métier tronquée au jour, jamais l'instant complet, pour que
// deux questions du même PV comptent comme le même "PV du DD/MM/YYYY" quel que soit l'ordre
// d'insertion. duplicate_points reste sans date (questionDate() le dit déjà) : ces questions
// n'apparaissent que sous "Tous les PV", jamais fabriquées sous un PV précis.
function questionDateOnly(question: MemoriaNeedsYouQuestion): string | null {
  const date = questionDate(question)
  if (!date) return null
  const parsed = Date.parse(date)
  if (Number.isNaN(parsed)) return null
  return new Date(parsed).toISOString().slice(0, 10)
}

function formatPvOptionDate(dateOnly: string): string {
  const [y, m, d] = dateOnly.split('-')
  return `${d}/${m}/${y}`
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
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilterValue>('all')
  const [sortMode, setSortMode] = useState<SortMode>('priority')
  // 6E.4A.5 — 'all' | 'latest' | date-only (YYYY-MM-DD) sélectionnée dans le menu "PV du ...".
  const [pvMode, setPvMode] = useState<string>('all')
  // 6E.4A.6 — combien de cartes de `sorted` sont effectivement rendues. Remis à PAGE_SIZE dès que
  // filtre/tri/PV change (setFilter/setSortMode/setPvMode enveloppés ci-dessous), sinon un lot
  // affiché sous un ancien filtre resterait affiché après un changement de sélection.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  function updateFilter(next: FilterValue) {
    setFilter(next)
    setVisibleCount(PAGE_SIZE)
  }

  function updatePriorityFilter(next: PriorityFilterValue) {
    setPriorityFilter(next)
    setVisibleCount(PAGE_SIZE)
  }

  function updateSortMode(next: SortMode) {
    setSortMode(next)
    setVisibleCount(PAGE_SIZE)
  }

  function updatePvMode(next: string) {
    setPvMode(next)
    setVisibleCount(PAGE_SIZE)
  }

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

  // Importance (6E.4A UI-pass) : compteurs stables sur `remaining`, même politique que `counts`
  // et `distinctPvDates` — un compteur de filtre ne dépend jamais des autres filtres actifs.
  const priorityCounts = useMemo(() => {
    const c: Record<MemoriaNeedsYouPriority, number> = { PRIORITAIRE: 0, A_CLARIFIER: 0, IMPORTANT: 0, HISTORIQUE: 0 }
    for (const q of remaining) c[computeQuestionPriority(q)]++
    return c
  }, [remaining])

  const filteredQuestions = filter === 'all' ? remaining : remaining.filter((q) => q.category === filter)

  // 6E.4A.5 — dates distinctes calculées sur `remaining` (pas `filteredQuestions`) : le menu PV
  // reste stable quel que soit le filtre catégorie actif, pour ne pas faire disparaître une option
  // déjà sélectionnée quand on change de catégorie. Le plus récent en tête.
  const distinctPvDates = useMemo(() => {
    const set = new Set<string>()
    for (const q of remaining) {
      const d = questionDateOnly(q)
      if (d) set.add(d)
    }
    return [...set].sort((a, b) => b.localeCompare(a))
  }, [remaining])
  const latestPvDate = distinctPvDates[0] ?? null
  const olderPvDates = distinctPvDates.slice(1)

  const pvFilteredQuestions = useMemo(() => {
    if (pvMode === 'all') return filteredQuestions
    const targetDate = pvMode === 'latest' ? latestPvDate : pvMode
    if (!targetDate) return filteredQuestions
    return filteredQuestions.filter((q) => questionDateOnly(q) === targetDate)
  }, [filteredQuestions, pvMode, latestPvDate])

  // Importance = filtre (jamais un tri) : appliqué après catégorie/PV, avant le tri lui-même.
  const priorityFilteredQuestions = useMemo(() => {
    if (priorityFilter === 'all') return pvFilteredQuestions
    return pvFilteredQuestions.filter((q) => computeQuestionPriority(q) === priorityFilter)
  }, [pvFilteredQuestions, priorityFilter])

  const sorted = useMemo(() => {
    if (sortMode === 'priority') {
      // Tri réel (6E.4A.4) : ordre de palier calculé par computeQuestionPriority, jamais un score
      // additionné. Array.prototype.sort est stable (ES2019+) : à palier égal, l'ordre d'origine
      // (déjà déterministe côté serveur) est conservé — pas de départage supplémentaire nécessaire.
      return [...priorityFilteredQuestions].sort(
        (a, b) =>
          MEMORIA_NEEDS_YOU_PRIORITY_ORDER.indexOf(computeQuestionPriority(a)) -
          MEMORIA_NEEDS_YOU_PRIORITY_ORDER.indexOf(computeQuestionPriority(b)),
      )
    }
    return [...priorityFilteredQuestions].sort((a, b) => {
      const da = questionDate(a)
      const db = questionDate(b)
      if (da && db) return sortMode === 'oldest' ? da.localeCompare(db) : db.localeCompare(da)
      if (da) return -1
      if (db) return 1
      return 0
    })
  }, [priorityFilteredQuestions, sortMode])

  const visibleQuestions = sorted.slice(0, visibleCount)
  const remainingToShow = sorted.length - visibleQuestions.length

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
        {/* Zone de filtres — sections nommées (Type de question / Période / Importance / Trier
            par) : Importance FILTRE la file, Trier par ORDONNE la sélection filtrée. Les deux
            axes ne sont jamais fusionnés dans un seul contrôle (mandat Vincent : "Historique ≠
            faible importance, Récent ≠ important"). */}
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Type de question</p>
            <div className="flex flex-wrap gap-1.5">
              {FILTER_ORDER.filter((f) => f === 'all' || counts[f] > 0).map((f) => {
                const count = f === 'all' ? remaining.length : counts[f]
                const active = filter === f
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => updateFilter(f)}
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
          </div>

          {/* 6E.4A.5 — Mode Dernier PV : n'apparaît que si au moins une question porte une date
              métier (duplicate_points seules ne l'affiche jamais, rien à filtrer par PV). */}
          {distinctPvDates.length > 0 && (
            <div>
              <label htmlFor="pv-mode" className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Période
              </label>
              <select
                id="pv-mode"
                value={pvMode}
                onChange={(e) => updatePvMode(e.target.value)}
                className="rounded-lg border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <option value="all">Tous les PV</option>
                {latestPvDate && <option value="latest">Dernier PV ({formatPvOptionDate(latestPvDate)})</option>}
                {olderPvDates.map((d) => (
                  <option key={d} value={d}>
                    PV du {formatPvOptionDate(d)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Importance</p>
            <div className="flex flex-wrap gap-1.5">
              {PRIORITY_FILTER_ORDER.filter((p) => p === 'all' || priorityCounts[p] > 0).map((p) => {
                const count = p === 'all' ? remaining.length : priorityCounts[p]
                const active = priorityFilter === p
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => updatePriorityFilter(p)}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-xs font-medium',
                      active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted/60',
                    )}
                  >
                    {PRIORITY_FILTER_LABELS[p]} <span className="tabular-nums">{count}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label htmlFor="sort-mode" className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Trier par
            </label>
            <select
              id="sort-mode"
              value={sortMode}
              onChange={(e) => updateSortMode(e.target.value as SortMode)}
              className="rounded-lg border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <option value="priority">Priorité</option>
              <option value="recent">Plus récent</option>
              <option value="oldest">Plus ancien</option>
            </select>
          </div>
        </div>

        <div className="space-y-3">
          {sorted.length === 0 && (
            <div className="rounded-2xl border border-dashed bg-card/50 px-4 py-6 text-center">
              <p className="text-sm text-muted-foreground">Rien à clarifier pour cette sélection.</p>
            </div>
          )}
          {visibleQuestions.map((q) => (
            <QuestionCard
              key={q.id}
              question={q}
              siteId={siteId}
              pending={pending.has(q.id)}
              error={errors[q.id]}
              sitePoints={sitePoints}
              priority={computeQuestionPriority(q)}
              runAction={runActionFor(q.id)}
            />
          ))}
        </div>

        {/* 6E.4A.6 — pagination progressive : n'apparaît que si la file dépasse un lot (auto-absent
            sous PAGE_SIZE questions, donc invisible dans l'immense majorité des chantiers). */}
        {remainingToShow > 0 && (
          <div className="flex flex-col items-center gap-2 pt-2">
            <p className="text-xs text-muted-foreground">
              {visibleQuestions.length} affichées sur {sorted.length}
            </p>
            <button
              type="button"
              onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              className="rounded-full border border-border px-3.5 py-1.5 text-[12px] text-muted-foreground hover:text-foreground"
            >
              Afficher {Math.min(PAGE_SIZE, remainingToShow)} de plus
            </button>
          </div>
        )}
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
                  onClick={() => updateFilter(active ? 'all' : c)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition-colors',
                    active ? 'bg-white dark:bg-violet-900/30' : 'hover:bg-white/60 dark:hover:bg-violet-900/20',
                  )}
                >
                  <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full', tone.iconBg)}>
                    <Icon className={cn('h-3 w-3', tone.iconText)} />
                  </span>
                  <span className="min-w-0 flex-1 text-foreground/90">{MEMORIA_NEEDS_YOU_CATEGORY_LABELS[c]}</span>
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
