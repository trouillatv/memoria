import Link from 'next/link'
import { Calendar, ClipboardList, SearchX } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { FiltersBar } from '@/components/ui/filters-bar'
import { FilterSelect } from '@/components/ui/filter-select'
import { PaginationBar } from '@/components/ui/pagination-bar'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureTodayInterventions } from '@/lib/recurrence/ensure-today'
import {
  listInterventionsSupervisor,
  type SupervisorDateRange,
} from '@/lib/db/interventions'
import { listSites } from '@/lib/db/sites'
import type { InterventionStatus } from '@/types/db'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 50

const STATUS_BADGES: Record<string, string> = {
  planned:     'bg-slate-50 border-slate-200 text-slate-700',
  in_progress: 'bg-sky-50 border-sky-200 text-sky-700',
  completed:   'bg-indigo-50 border-indigo-200 text-indigo-700',
  validated:   'bg-emerald-50 border-emerald-200 text-emerald-700',
  skipped:     'bg-amber-50 border-amber-200 text-amber-800',
}

const STATUS_LABELS: Record<string, string> = {
  planned: 'Planifiée', in_progress: 'En cours', completed: 'Terminée', validated: 'Validée', skipped: 'Sautée',
}

const STATUS_OPTIONS: Array<{ value: InterventionStatus; label: string }> = [
  { value: 'planned',     label: 'Planifiée' },
  { value: 'in_progress', label: 'En cours' },
  { value: 'completed',   label: 'Terminée' },
  { value: 'validated',   label: 'Validée' },
  { value: 'skipped',     label: 'Sautée' },
]

const DATE_OPTIONS: Array<{ value: SupervisorDateRange; label: string }> = [
  { value: 'today', label: "Aujourd'hui" },
  { value: '7d',    label: '7 derniers jours' },
  { value: '30d',   label: '30 derniers jours' },
  { value: 'all',   label: 'Toute la période' },
]

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s
}

function parsePage(raw: string | undefined): number {
  if (!raw) return 1
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 1) return 1
  return n
}

function parseDateRange(raw: string | undefined): SupervisorDateRange {
  if (raw === 'today' || raw === '7d' || raw === '30d' || raw === 'all') return raw
  // Default: voir tout ce qui est de la veille à venir (similaire à l'ancien comportement).
  // On expose explicitement '30d' comme défaut visible.
  return '30d'
}

export default async function MissionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    date?: string
    status?: string
    site?: string
    page?: string
  }>
}) {
  const params = await searchParams
  const page = parsePage(params.page)
  const dateRange = parseDateRange(params.date)
  const status = (params.status as InterventionStatus | undefined) || undefined
  const siteId = params.site || undefined

  // Slice 6.3 — Génération paresseuse silencieuse à l'échelle tenant.
  const supabase = createAdminClient()
  const { data: activeTemplates } = await supabase
    .from('intervention_templates')
    .select('id')
    .eq('active', true)
    .is('deleted_at', null)
  const activeTemplateIds = (activeTemplates ?? []).map((t) => t.id)
  if (activeTemplateIds.length > 0) {
    await ensureTodayInterventions({ templateIds: activeTemplateIds, daysAhead: 1 })
  }

  // Fetch list of sites for the dropdown (sobre, tenant-scope via RLS admin).
  const sites = await listSites()

  const { items, total } = await listInterventionsSupervisor({
    dateRange,
    status,
    siteId,
    offset: (page - 1) * PAGE_SIZE,
    limit: PAGE_SIZE,
  })

  const hasActiveFilters = Boolean(
    (params.date && params.date !== '30d') || params.status || params.site,
  )
  const isEmpty = total === 0

  const today = new Date().toISOString().split('T')[0]
  const upcoming = items.filter((i) => i.scheduled_at.split('T')[0] >= today)
  const past = items.filter((i) => i.scheduled_at.split('T')[0] < today)

  return (
    <div className="space-y-6 max-w-4xl">
      <header>
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
          <Calendar className="h-5 w-5 text-sky-600" />
          Planning des interventions
        </h1>
        <p className="text-sm text-muted-foreground">Vue cross-contrats des interventions à venir et récentes.</p>
      </header>

      <FiltersBar
        hideSearch
        hasActiveFilters={hasActiveFilters}
        resetParams={['date', 'status', 'site']}
      >
        <FilterSelect
          paramName="date"
          label="Période"
          emptyLabel="30 derniers jours"
          options={DATE_OPTIONS}
        />
        <FilterSelect
          paramName="status"
          label="Statut"
          emptyLabel="Tous les statuts"
          options={STATUS_OPTIONS}
        />
        <FilterSelect
          paramName="site"
          label="Site"
          emptyLabel="Tous les sites"
          options={sites.map((s) => ({ value: s.id, label: s.name }))}
        />
      </FiltersBar>

      {isEmpty && hasActiveFilters && (
        <div className="rounded-lg border bg-card">
          <EmptyState
            icon={SearchX}
            title="Aucune intervention ne correspond à ces filtres"
            description="Essayez de modifier ou de retirer les filtres."
            primaryAction={
              <Link href="/missions" className={cn(buttonVariants({ variant: 'outline' }))}>
                Réinitialiser les filtres
              </Link>
            }
            variant="compact"
          />
        </div>
      )}

      {isEmpty && !hasActiveFilters && (
        <div className="rounded-lg border bg-card">
          <EmptyState
            icon={ClipboardList}
            title="Aucune intervention planifiée"
            description="Créez une mission depuis un contrat actif, ou ajoutez une récurrence pour générer automatiquement des interventions chaque jour."
            primaryAction={
              <Link href="/contracts" className={cn(buttonVariants({ variant: 'default' }))}>
                Voir mes contrats
              </Link>
            }
          />
        </div>
      )}

      {upcoming.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-emerald-700">
            À venir ({upcoming.length})
          </h2>
          <ul className="space-y-1.5">
            {upcoming.map((i) => <InterventionRow key={i.id} item={i} />)}
          </ul>
        </section>
      )}

      {past.length > 0 && (
        <section className="space-y-2 mt-6">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Récentes ({past.length})
          </h2>
          <ul className="space-y-1.5">
            {past.map((i) => <InterventionRow key={i.id} item={i} />)}
          </ul>
        </section>
      )}

      <PaginationBar page={page} pageSize={PAGE_SIZE} total={total} />
    </div>
  )
}

function InterventionRow({ item }: { item: { id: string; scheduled_at: string; status: string; skipped_reason: string | null; mission?: { name: string; site?: { name: string; contract?: { id: string; name: string; client_name: string } | null } | null } | null } }) {
  const date = new Date(item.scheduled_at)
  const dateLabel = date.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' })
  const timeLabel = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  const isSkipped = item.status === 'skipped'
  return (
    <li className={`rounded border p-3 bg-card ${isSkipped ? 'opacity-70 bg-muted/30' : ''}`}>
      <Link href={`/interventions/${item.id}`} className="flex items-start justify-between gap-3 -m-3 p-3 hover:bg-muted/20 rounded transition-colors">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-medium">{dateLabel}</span>
            <span className="text-xs text-muted-foreground">{timeLabel}</span>
          </div>
          <div className={`text-sm ${isSkipped ? 'line-through decoration-amber-700/40' : ''}`}>
            {item.mission?.name ?? '—'}
          </div>
          <div className="text-xs text-muted-foreground">
            {item.mission?.site?.contract?.name ?? '—'} · {item.mission?.site?.name ?? '—'}
          </div>
          {isSkipped && item.skipped_reason && (
            <div
              className="text-xs italic text-amber-900/80 mt-1 truncate"
              title={item.skipped_reason}
            >
              — {truncate(item.skipped_reason, 80)}
            </div>
          )}
        </div>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] uppercase font-semibold tracking-widest shrink-0 ${STATUS_BADGES[item.status] ?? STATUS_BADGES.planned}`}>
          {STATUS_LABELS[item.status] ?? item.status}
        </span>
      </Link>
    </li>
  )
}
