import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listTenderMemory } from '@/lib/db/tenders'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { FiltersBar } from '@/components/ui/filters-bar'
import { FilterSelect } from '@/components/ui/filter-select'
import { PaginationBar } from '@/components/ui/pagination-bar'
import { buttonVariants } from '@/components/ui/button'
import { TenderMemoryEntry } from './TenderMemoryEntry'
import { History, ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TenderOutcome, TenderOutcomeTag } from '@/types/db'

const PAGE_SIZE = 30

const OUTCOME_OPTIONS: Array<{ value: TenderOutcome; label: string }> = [
  { value: 'won',           label: 'Gagné' },
  { value: 'lost',          label: 'Perdu' },
  { value: 'withdrawn',     label: 'Retiré' },
  { value: 'not_responded', label: 'Sans réponse' },
]

const TAG_OPTIONS: Array<{ value: TenderOutcomeTag; label: string }> = [
  { value: 'prix',     label: 'Prix' },
  { value: 'qualite',  label: 'Qualité' },
  { value: 'relation', label: 'Relation' },
  { value: 'timing',   label: 'Timing' },
  { value: 'autre',    label: 'Autre' },
]

const VALID_OUTCOMES = new Set<TenderOutcome>([
  'won', 'lost', 'withdrawn', 'not_responded',
])
const VALID_TAGS = new Set<TenderOutcomeTag>([
  'prix', 'qualite', 'relation', 'timing', 'autre',
])

function parsePage(raw: string | undefined): number {
  if (!raw) return 1
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 1) return 1
  return n
}

interface PageProps {
  searchParams: Promise<{
    outcome?: string
    tag?: string
    search?: string
    page?: string
  }>
}

/**
 * /tenders/memoire — Mémoire des AO (journal calme).
 *
 * Doctrine V5 verrou V1 (mémoire ≠ recommandation) + V4 (formulations
 * descriptives uniquement). C'est un journal chronologique des AO
 * finalisés. Patrick l'ouvre quand il veut se rappeler — pas chaque
 * matin. Aucun KPI, aucun graph, aucun compteur "perdus ce mois",
 * aucune comparaison N vs N-1. Juste une liste.
 */
export default async function TenderMemoirePage({ searchParams }: PageProps) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const params = await searchParams
  const outcome = VALID_OUTCOMES.has(params.outcome as TenderOutcome)
    ? (params.outcome as TenderOutcome)
    : undefined
  const tag = VALID_TAGS.has(params.tag as TenderOutcomeTag)
    ? (params.tag as TenderOutcomeTag)
    : undefined
  const search = params.search?.trim() || undefined
  const page = parsePage(params.page)
  const offset = (page - 1) * PAGE_SIZE

  const { items, total } = await listTenderMemory({
    outcome,
    tag,
    search,
    offset,
    limit: PAGE_SIZE,
  })

  const hasActiveFilters = Boolean(outcome || tag || search)

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <header className="space-y-2">
        <Link
          href="/tenders"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Retour aux AO en cours
        </Link>
        <h1 className="text-2xl font-semibold">Mémoire des AO</h1>
        <p className="text-sm text-muted-foreground">
          Journal des appels d&apos;offres finalisés. Gagnés, perdus, retirés, sans réponse.
        </p>
      </header>

      <FiltersBar
        searchPlaceholder="Rechercher un AO ou un client…"
        hasActiveFilters={hasActiveFilters}
        resetParams={['outcome', 'tag', 'search']}
      >
        <FilterSelect
          paramName="outcome"
          label="Statut"
          emptyLabel="Tous"
          options={OUTCOME_OPTIONS}
        />
        <FilterSelect
          paramName="tag"
          label="Raison"
          emptyLabel="Toutes"
          options={TAG_OPTIONS}
        />
      </FiltersBar>

      {items.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={History}
              title={hasActiveFilters
                ? 'Aucun AO ne correspond'
                : "Aucun AO finalisé pour l'instant"
              }
              description={
                hasActiveFilters
                  ? "Essayez d'autres filtres pour parcourir la mémoire."
                  : "Les AO clôturés (gagnés, perdus, retirés, sans réponse) apparaîtront ici. La mémoire se construit avec le temps."
              }
              primaryAction={
                hasActiveFilters ? (
                  <Link
                    href="/tenders/memoire"
                    className={cn(buttonVariants({ variant: 'outline' }))}
                  >
                    Réinitialiser les filtres
                  </Link>
                ) : undefined
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {total} AO finalisé{total > 1 ? 's' : ''}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y" data-testid="tender-memory-list">
                {items.map((entry) => (
                  <TenderMemoryEntry key={entry.id} entry={entry} />
                ))}
              </ul>
            </CardContent>
          </Card>
          <PaginationBar page={page} pageSize={PAGE_SIZE} total={total} />
        </>
      )}
    </div>
  )
}
