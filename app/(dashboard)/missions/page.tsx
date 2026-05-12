import Link from 'next/link'
import { Calendar, ClipboardList, MapPin, SearchX, ChevronRight } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { FiltersBar } from '@/components/ui/filters-bar'
import { FilterSelect } from '@/components/ui/filter-select'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureTodayInterventions } from '@/lib/recurrence/ensure-today'
import {
  listInterventionsSupervisor,
  type SupervisorDateRange,
} from '@/lib/db/interventions'
import { StatusBadge } from '@/components/ui/status-badge'
import { listSites } from '@/lib/db/sites'
import type { InterventionStatus } from '@/types/db'
import { cn } from '@/lib/utils'

// Plus de pagination — le regroupement collapsé par site rend la liste lisible
// même longue. Cap dur à 500 par sécurité (un superviseur n'a jamais besoin de
// plus en pratique, et au-delà la page peut être lente).
const HARD_LIMIT = 500

const STATUS_OPTIONS: Array<{ value: InterventionStatus; label: string }> = [
  { value: 'planned',     label: 'Planifiée' },
  { value: 'in_progress', label: 'En cours' },
  { value: 'completed',   label: 'Exécutée' },
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

function parseDateRange(raw: string | undefined): SupervisorDateRange {
  if (raw === 'today' || raw === '7d' || raw === '30d' || raw === 'all') return raw
  return '30d'
}

export default async function MissionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    date?: string
    status?: string
    site?: string
    mission?: string
  }>
}) {
  const params = await searchParams
  const dateRange = parseDateRange(params.date)
  const status = (params.status as InterventionStatus | undefined) || undefined
  const siteId = params.site || undefined
  const missionId = params.mission || undefined

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

  // Sites + missions pour les filtres. Les missions sont scopées au site sélectionné
  // si présent — sinon liste cross-site (peut être longue, on la garde simple).
  const sites = await listSites()
  let missionOptions: Array<{ value: string; label: string }> = []
  if (siteId) {
    const { data: missionRows } = await supabase
      .from('missions')
      .select('id, name')
      .eq('site_id', siteId)
      .is('deleted_at', null)
      .order('name', { ascending: true })
    missionOptions = (missionRows ?? []).map((m) => ({ value: m.id, label: m.name }))
  } else {
    const { data: missionRows } = await supabase
      .from('missions')
      .select('id, name, site:sites(name)')
      .is('deleted_at', null)
      .order('name', { ascending: true })
      .limit(200)
    missionOptions = (missionRows ?? []).map((m) => {
      const site = Array.isArray(m.site) ? m.site[0] : m.site
      const siteName = (site as { name?: string } | null)?.name
      return { value: m.id, label: siteName ? `${m.name} · ${siteName}` : m.name }
    })
  }

  const { items, total } = await listInterventionsSupervisor({
    dateRange,
    status,
    siteId,
    missionId,
    offset: 0,
    limit: HARD_LIMIT,
  })

  const hasActiveFilters = Boolean(
    (params.date && params.date !== '30d') || params.status || params.site || params.mission,
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
        resetParams={['date', 'status', 'site', 'mission']}
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
        <FilterSelect
          paramName="mission"
          label="Mission"
          emptyLabel="Toutes les missions"
          options={missionOptions}
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
          <SiteGroupedList items={upcoming} accent="emerald" />
        </section>
      )}

      {past.length > 0 && (
        <section className="space-y-2 mt-6">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Récentes ({past.length})
          </h2>
          <SiteGroupedList items={past} accent="muted" />
        </section>
      )}

      {total >= HARD_LIMIT && (
        <p className="text-xs text-muted-foreground italic">
          Affichage limité à {HARD_LIMIT} interventions sur cette période. Affinez la période ou le statut pour voir le reste.
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Regroupement par site (collapsé) — quand aucun site n'est filtré.
// `<details>` natif HTML : pas de JS, server-rendable, accessible, mémorisable.
// ---------------------------------------------------------------------------

type ListItem = {
  id: string
  scheduled_at: string
  status: string
  skipped_reason: string | null
  mission?: {
    name: string
    site?: {
      id?: string
      name: string
      contract?: { id: string; name: string; client_name: string } | null
    } | null
  } | null
}

interface Group {
  siteKey: string
  siteName: string
  contractName: string | null
  items: ListItem[]
}

function groupBySiteName(items: ListItem[]): Group[] {
  const map = new Map<string, Group>()
  for (const item of items) {
    const siteName = item.mission?.site?.name ?? 'Sans site'
    const contractName = item.mission?.site?.contract?.name ?? null
    // Clé = site + contrat (pour distinguer si un nom de site existe sur 2 contrats)
    const key = `${siteName}|${contractName ?? ''}`
    const g = map.get(key)
    if (g) {
      g.items.push(item)
    } else {
      map.set(key, { siteKey: key, siteName, contractName, items: [item] })
    }
  }
  // Tri alphabétique fr par site, sub-tri par contrat
  return Array.from(map.values()).sort((a, b) => {
    const c = a.siteName.localeCompare(b.siteName, 'fr', { sensitivity: 'base' })
    if (c !== 0) return c
    return (a.contractName ?? '').localeCompare(b.contractName ?? '', 'fr', { sensitivity: 'base' })
  })
}

function SiteGroupedList({ items, accent }: { items: ListItem[]; accent: 'emerald' | 'muted' }) {
  const groups = groupBySiteName(items)
  return (
    <div className="space-y-1.5">
      {groups.map((g) => (
        <details
          key={g.siteKey}
          className="group rounded-lg border bg-card overflow-hidden"
        >
          <summary
            className={
              'flex items-center justify-between gap-3 px-3 py-2.5 cursor-pointer select-none ' +
              'hover:bg-muted/30 transition-colors list-none [&::-webkit-details-marker]:hidden ' +
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            }
          >
            <div className="min-w-0 flex-1 flex items-center gap-2">
              <ChevronRight
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform group-open:rotate-90"
                aria-hidden
              />
              <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="text-sm font-medium truncate">{g.siteName}</span>
              {g.contractName && (
                <span className="text-xs text-muted-foreground truncate">· {g.contractName}</span>
              )}
            </div>
            <span
              className={
                'text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ' +
                (accent === 'emerald'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-muted text-muted-foreground')
              }
            >
              {g.items.length}
            </span>
          </summary>
          <ul className="space-y-1.5 px-3 pb-3 pt-1 border-t bg-muted/10">
            {g.items.map((i) => (
              <InterventionRow key={i.id} item={i} />
            ))}
          </ul>
        </details>
      ))}
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
        <StatusBadge status={item.status} className="shrink-0" />
      </Link>
    </li>
  )
}
