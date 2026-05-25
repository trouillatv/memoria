import Link from 'next/link'
import { FileCheck, SearchX, Building2, Calendar, ChevronRight, ListChecks, Sparkles } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { FiltersBar } from '@/components/ui/filters-bar'
import { FilterSelect } from '@/components/ui/filter-select'
import { PaginationBar } from '@/components/ui/pagination-bar'
import { StatusBadge } from '@/components/ui/status-badge'
import { listContractsPaged } from '@/lib/db/contracts'
import { countEngagementsByContracts } from '@/lib/db/engagements'
import { listSitesForContracts } from '@/lib/db/sites'
import { collectMemorySignals } from '@/lib/memory/signals/collect'
import { getAtRiskEngagements, getContractSummaries } from '@/lib/db/dashboard'
import type { MemorySignal } from '@/lib/memory/signals/types'
import { computeContractClimate, type ContractClimate } from '@/lib/contracts/climate'
import type { ContractStatus } from '@/types/db'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 50

const CONTRACT_STATUS_OPTIONS: Array<{ value: ContractStatus; label: string }> = [
  { value: 'active',     label: 'Actif' },
  { value: 'paused',     label: 'En pause' },
  { value: 'terminated', label: 'Terminé' },
  { value: 'archived',   label: 'Archivé' },
]

function parsePage(raw: string | undefined): number {
  if (!raw) return 1
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 1) return 1
  return n
}

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; search?: string; page?: string }>
}) {
  const params = await searchParams
  const page = parsePage(params.page)
  const { items: contracts, total } = await listContractsPaged({
    status: params.status as ContractStatus | undefined,
    search: params.search,
    offset: (page - 1) * PAGE_SIZE,
    limit: PAGE_SIZE,
  })

  const contractIds = contracts.map((c) => c.id)
  const activeIds = contracts.filter((c) => c.status === 'active').map((c) => c.id)

  // Données mémoire — toutes batch/globales (constant quel que soit le nombre
  // de cartes, jamais une boucle par contrat). Le moteur de signaux est indexé
  // par SITE → on agrège au contrat via la map site→contrat.
  const [countByContract, sitesRows, signals, atRisk, summaries] = await Promise.all([
    countEngagementsByContracts(contractIds),
    listSitesForContracts(contractIds),
    collectMemorySignals(),
    getAtRiskEngagements(),
    getContractSummaries(activeIds),
  ])

  // contrat → sites
  const siteIdsByContract = new Map<string, string[]>()
  for (const s of sitesRows) {
    const arr = siteIdsByContract.get(s.contract_id) ?? []
    arr.push(s.id)
    siteIdsByContract.set(s.contract_id, arr)
  }
  // site → signaux (tous les détecteurs émettent subjectType='site')
  const signalsBySite = new Map<string, MemorySignal[]>()
  for (const sig of signals) {
    if (sig.subjectType !== 'site') continue
    const arr = signalsBySite.get(sig.subjectId) ?? []
    arr.push(sig)
    signalsBySite.set(sig.subjectId, arr)
  }
  // contrat → nb engagements à risque
  const atRiskByContract = new Map<string, number>()
  for (const e of atRisk) {
    atRiskByContract.set(e.contract_id, (atRiskByContract.get(e.contract_id) ?? 0) + 1)
  }
  // Climat mémoriel — calculé pour les contrats ACTIFS uniquement (pour les
  // autres, le badge de cycle de vie suffit). Pur, zéro requête.
  const climateByContract = new Map<string, ContractClimate>()
  for (const c of contracts) {
    if (c.status !== 'active') continue
    climateByContract.set(
      c.id,
      computeContractClimate({
        siteIds: siteIdsByContract.get(c.id) ?? [],
        signalsBySite,
        atRiskCount: atRiskByContract.get(c.id) ?? 0,
        needsAttention: summaries.get(c.id)?.needsAttention ?? false,
      }),
    )
  }

  const hasActiveFilters = Boolean(params.status || params.search)
  const isEmpty = total === 0

  // Counts par statut pour la stats-bar (utilise les data déjà fetchées + total)
  const statusCounts: Record<ContractStatus, number> = {
    active: 0,
    paused: 0,
    terminated: 0,
    archived: 0,
  }
  for (const c of contracts) {
    statusCounts[c.status] = (statusCounts[c.status] ?? 0) + 1
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header — Doctrine V5 Pilier 6 : sobre, pas marketing.
          Icône brand + titre + sous-titre. Stats-bar à droite (lecture rapide). */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-200 dark:bg-brand-600/10 dark:ring-brand-600/30">
            <FileCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold leading-tight">Contrats</h1>
            <p className="text-sm text-muted-foreground">
              Cockpit boucle de preuve par contrat
            </p>
          </div>
        </div>

        {/* Mini stats-bar — chiffres sobres, pas de pourcentages KPI */}
        {!isEmpty && (
          <div className="inline-flex items-center gap-4 rounded-lg border bg-card px-4 py-2 text-sm">
            <StatPill label="Total" value={total} tone="neutral" />
            {statusCounts.active > 0 && (
              <StatPill label="Actifs" value={statusCounts.active} tone="emerald" />
            )}
            {statusCounts.paused > 0 && (
              <StatPill label="En pause" value={statusCounts.paused} tone="amber" />
            )}
            {statusCounts.terminated > 0 && (
              <StatPill label="Terminés" value={statusCounts.terminated} tone="muted" />
            )}
          </div>
        )}
      </header>

      <FiltersBar
        searchPlaceholder="Rechercher un contrat…"
        hasActiveFilters={hasActiveFilters}
        resetParams={['status', 'search']}
      >
        <FilterSelect
          paramName="status"
          label="Statut"
          emptyLabel="Tous les statuts"
          options={CONTRACT_STATUS_OPTIONS}
        />
      </FiltersBar>

      {isEmpty && hasActiveFilters && (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={SearchX}
              title="Aucun contrat ne correspond à votre recherche"
              description="Essayez de modifier ou de retirer vos filtres."
              primaryAction={
                <Link
                  href="/contracts"
                  className={cn(buttonVariants({ variant: 'outline' }))}
                >
                  Réinitialiser les filtres
                </Link>
              }
              variant="compact"
            />
          </CardContent>
        </Card>
      )}

      {isEmpty && !hasActiveFilters && (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={FileCheck}
              title="Aucun contrat actif"
              description={
                <>
                  Convertissez un AO finalisé en contrat depuis la page{' '}
                  <Link
                    href="/tenders"
                    className="text-foreground underline underline-offset-4 hover:no-underline"
                  >
                    Appels d&apos;offres
                  </Link>
                  . Le contrat devient le point d&apos;ancrage de vos missions et de la boucle de preuve.
                </>
              }
              primaryAction={
                <Link
                  href="/tenders"
                  className={cn(buttonVariants({ variant: 'default' }))}
                >
                  Voir mes AO
                </Link>
              }
            />
          </CardContent>
        </Card>
      )}

      {!isEmpty && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {contracts.map((c) => {
            const engagementsCount = countByContract.get(c.id) ?? 0
            const startDate = new Date(c.start_date).toLocaleDateString('fr-FR', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })
            const endDate = c.end_date
              ? new Date(c.end_date).toLocaleDateString('fr-FR', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })
              : null
            const climate = climateByContract.get(c.id) ?? null
            return (
              <Link
                key={c.id}
                href={`/contracts/${c.id}`}
                className="group block rounded-2xl border border-border/60 bg-stone-50/50 dark:bg-card p-5 shadow-sm transition-[transform,box-shadow,border-color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:shadow-md hover:border-brand-200/70 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] motion-reduce:transition-none motion-reduce:hover:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-semibold leading-tight truncate transition-colors duration-200 group-hover:text-brand-700">
                      {c.name}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5 inline-flex items-center gap-1.5 truncate">
                      <Building2 className="h-3 w-3 shrink-0" />
                      {c.client_name}
                    </p>
                  </div>
                  {/* Contrat actif → climat mémoriel ; sinon → cycle de vie. */}
                  {climate ? (
                    <ClimateChip climate={climate} />
                  ) : (
                    <StatusBadge status={c.status} className="shrink-0" />
                  )}
                </div>

                {/* Ligne mémoire — UNIQUEMENT si réelle (calme = puce seule). */}
                {climate?.line && (
                  <p
                    className={cn(
                      'mt-3 inline-flex items-center gap-1.5 text-xs',
                      climate.tone === 'vigilance' ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground',
                    )}
                  >
                    <Sparkles className="h-3 w-3 shrink-0" />
                    {climate.line}
                  </p>
                )}

                {/* Footer démoté — métadonnées administratives, plus le centre. */}
                <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between gap-3 text-xs">
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    {endDate ? `${startDate} → ${endDate}` : `Depuis ${startDate}`}
                  </span>
                  <span className="inline-flex items-center gap-1 text-muted-foreground tabular-nums">
                    <ListChecks className="h-3 w-3" />
                    {engagementsCount}
                    <span className="hidden sm:inline">&nbsp;engagement{engagementsCount > 1 ? 's' : ''}</span>
                    <ChevronRight className="h-3 w-3 ml-1 opacity-0 group-hover:opacity-100 -translate-x-1 group-hover:translate-x-0 transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] text-brand-600" />
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      )}

      <PaginationBar page={page} pageSize={PAGE_SIZE} total={total} />
    </div>
  )
}

// Puce de climat mémoriel — réutilise les tons du dashboard (sauge = sain,
// ambre = vigilance, neutre = calme). Jamais de rouge ici (plafond ambre).
function ClimateChip({ climate }: { climate: ContractClimate }) {
  const chrome: Record<ContractClimate['tone'], { box: string; dot: string }> = {
    stable: {
      box: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/20 ring-emerald-200/50 dark:ring-emerald-900/40',
      dot: 'bg-emerald-500',
    },
    vigilance: {
      box: 'text-amber-700 dark:text-amber-300 bg-amber-50/70 dark:bg-amber-950/20 ring-amber-200/60 dark:ring-amber-900/40',
      dot: 'bg-amber-500',
    },
    calme: {
      box: 'text-muted-foreground bg-muted/50 ring-border',
      dot: 'bg-muted-foreground/40',
    },
  }
  const c = chrome[climate.tone]
  return (
    <span
      className={cn(
        'shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1',
        c.box,
      )}
    >
      <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', c.dot)} />
      {climate.label}
    </span>
  )
}

function StatPill({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'neutral' | 'emerald' | 'amber' | 'muted'
}) {
  const toneClasses: Record<typeof tone, string> = {
    neutral: 'text-foreground',
    emerald: 'text-emerald-700 dark:text-emerald-400',
    amber: 'text-amber-700 dark:text-amber-400',
    muted: 'text-muted-foreground',
  }
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className={cn('font-semibold tabular-nums', toneClasses[tone])}>{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  )
}
