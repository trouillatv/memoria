import Link from 'next/link'
import { Calendar, ClipboardList, MapPin, SearchX, ChevronRight, AlertTriangle, Users } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { FiltersBar } from '@/components/ui/filters-bar'
import { FilterSelect } from '@/components/ui/filter-select'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureTodayInterventions } from '@/lib/recurrence/ensure-today'
import { todayLocalIso, localDateOf } from '@/lib/time/local-date'
import {
  listInterventionsSupervisor,
  type SupervisorDateRange,
} from '@/lib/db/interventions'
import { StatusBadge } from '@/components/ui/status-badge'
import { listSites } from '@/lib/db/sites'
import { isSystemMissionName } from '@/lib/db/system-missions'
import type { InterventionStatus } from '@/types/db'
import { cn } from '@/lib/utils'
import { collectMemorySignals } from '@/lib/memory/signals/collect'
import { planningSignalsBySite } from '@/lib/memory/signals/surface'
import type { MemorySignal } from '@/lib/memory/signals/types'
import { SIGNAL_REGISTRY, type SignalFamily } from '@/lib/memory/signals/registry'
import { MemorySignalBadge } from '@/components/memory/MemorySignalBadge'

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

function relDaysFr(dateIso: string, todayIso: string): string {
  const a = new Date(dateIso + 'T00:00:00Z').getTime()
  const b = new Date(todayIso + 'T00:00:00Z').getTime()
  const days = Math.round((b - a) / 86_400_000)
  if (days <= 0) return "aujourd'hui"
  if (days === 1) return 'hier'
  if (days < 30) return `il y a ${days} j`
  const m = Math.floor(days / 30)
  return m <= 1 ? 'il y a 1 mois' : `il y a ${m} mois`
}

interface SiteFootprint {
  openAnomalies: number
  aSavoir: number
}

/** Empreinte mémoire directe (sans le moteur) par site : anomalies ouvertes +
 * « à savoir » actifs. Sert au « signal faible » visible immédiatement. */
async function getSiteFootprints(siteIds: string[]): Promise<Record<string, SiteFootprint>> {
  const out: Record<string, SiteFootprint> = {}
  if (siteIds.length === 0) return out
  const supabase = createAdminClient()
  const ensure = (sid: string) => (out[sid] ??= { openAnomalies: 0, aSavoir: 0 })

  const [anoms, notes] = await Promise.all([
    supabase
      .from('intervention_anomalies')
      .select('id, intervention:interventions!inner(mission:missions!inner(site_id))')
      .eq('status', 'open'),
    supabase
      .from('site_notes')
      .select('site_id')
      .eq('kind', 'a_savoir')
      .is('deleted_at', null)
      .in('site_id', siteIds),
  ])

  for (const r of (anoms.data ?? []) as Array<{ intervention: unknown }>) {
    const intv = Array.isArray(r.intervention) ? r.intervention[0] : r.intervention
    const mission = intv ? (Array.isArray((intv as { mission: unknown }).mission) ? (intv as { mission: { site_id: string }[] }).mission[0] : (intv as { mission: { site_id: string } }).mission) : null
    const sid = (mission as { site_id?: string } | null)?.site_id
    if (!sid || !siteIds.includes(sid)) continue
    ensure(sid).openAnomalies++
  }
  for (const r of (notes.data ?? []) as Array<{ site_id: string | null }>) {
    if (r.site_id) ensure(r.site_id).aSavoir++
  }
  return out
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
  //
  // V5.1 — On exclut les missions système ("Traces libres du site") des filtres :
  // elles servent uniquement de container interne pour les traces déposées
  // spontanément côté mobile et n'ont pas leur place dans une vue de
  // supervision des missions planifiées. Cf. lib/db/system-missions.ts.
  const sites = await listSites()
  let missionOptions: Array<{ value: string; label: string }> = []
  if (siteId) {
    const { data: missionRows } = await supabase
      .from('missions')
      .select('id, name')
      .eq('site_id', siteId)
      .is('deleted_at', null)
      .order('name', { ascending: true })
    missionOptions = (missionRows ?? [])
      .filter((m) => !isSystemMissionName(m.name))
      .map((m) => ({ value: m.id, label: m.name }))
  } else {
    const { data: missionRows } = await supabase
      .from('missions')
      .select('id, name, site:sites(name)')
      .is('deleted_at', null)
      .order('name', { ascending: true })
      .limit(200)
    missionOptions = (missionRows ?? [])
      .filter((m) => !isSystemMissionName(m.name))
      .map((m) => {
        const site = Array.isArray(m.site) ? m.site[0] : m.site
        const siteName = (site as { name?: string } | null)?.name
        return { value: m.id, label: siteName ? `${m.name} · ${siteName}` : m.name }
      })
  }

  const { items: rawItems, total: rawTotal } = await listInterventionsSupervisor({
    dateRange,
    status,
    siteId,
    missionId,
    offset: 0,
    limit: HARD_LIMIT,
  })

  // V5.1 — Exclure les interventions sur missions système ("Traces libres du
  // site"). Ces interventions sont créées automatiquement côté mobile pour
  // attacher les traces déposées hors workflow planifié — elles polluent la
  // vue de supervision si on les expose. Cf. lib/db/system-missions.ts.
  const items = rawItems.filter(
    (i) => !i.mission?.name || !isSystemMissionName(i.mission.name),
  )
  const total = rawTotal - (rawItems.length - items.length)

  const hasActiveFilters = Boolean(
    (params.date && params.date !== '30d') || params.status || params.site || params.mission,
  )
  const isEmpty = total === 0

  // Date civile de l'intervention. On utilise `scheduled_for` (date pure
  // YYYY-MM-DD, sans fuseau) et JAMAIS `scheduled_at` : ce dernier est un
  // timestamp UTC dérivé (ex. créneau "soir" → 18:00 UTC). En Nouméa (UTC+11),
  // 18:00 UTC dimanche = 05:00 lundi → l'intervention de dimanche soir
  // basculait à tort dans "À venir". `scheduled_for` n'a pas cette ambiguïté.
  const today = todayLocalIso()
  const civilDate = (i: ListItem) =>
    i.scheduled_for ?? localDateOf(new Date(i.scheduled_at))
  const upcoming = items.filter((i) => civilDate(i) >= today)
  const past = items.filter((i) => civilDate(i) < today)

  // Signal faible : le signal mémoire prioritaire de chaque lieu (moteur),
  // injecté sous le titre de groupe. Sujet = le lieu, jamais une personne.
  const signalsBySite = planningSignalsBySite(await collectMemorySignals())

  // Empreinte mémoire DIRECTE (visible tout de suite, sans dépendre du moteur) :
  // anomalies ouvertes + « à savoir » par lieu affiché.
  const shownSiteIds = Array.from(
    new Set(items.map((i) => i.mission?.site?.id).filter((x): x is string => !!x)),
  )
  const footprints = await getSiteFootprints(shownSiteIds)

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
          <SiteGroupedList items={upcoming} accent="emerald" signalsBySite={signalsBySite} footprints={footprints} today={today} />
        </section>
      )}

      {past.length > 0 && (
        <section className="space-y-2 mt-6">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Récentes ({past.length})
          </h2>
          <SiteGroupedList items={past} accent="muted" signalsBySite={signalsBySite} footprints={footprints} today={today} />
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
  scheduled_for: string | null
  slot: 'morning' | 'afternoon' | 'evening' | null
  status: string
  skipped_reason: string | null
  assigned_team_id: string | null
  team: { id: string; name: string; color: string | null } | null
  mission?: {
    name: string
    site?: {
      id?: string
      name: string
      contract?: { id: string; name: string; client_name: string } | null
    } | null
  } | null
}

const SLOT_BADGE: Record<string, { label: string; class: string }> = {
  morning: {
    label: 'matin',
    class: 'bg-amber-50 border-amber-200 text-amber-900',
  },
  afternoon: {
    label: 'après-midi',
    class: 'bg-sky-50 border-sky-200 text-sky-900',
  },
  evening: {
    label: 'soir',
    class: 'bg-indigo-50 border-indigo-200 text-indigo-900',
  },
}

/** Convertit un hex en fond très pâle (10% saturation) pour pastilles équipe. */
function hexToPale(hex: string | null | undefined): string | undefined {
  if (!hex) return undefined
  const clean = hex.replace(/^#/, '').trim()
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return undefined
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  const mix = (c: number) => Math.round(c * 0.12 + 255 * 0.88)
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}

interface Group {
  siteKey: string
  siteName: string
  contractName: string | null
  siteId: string | null
  items: ListItem[]
}

function groupBySiteName(items: ListItem[]): Group[] {
  const map = new Map<string, Group>()
  for (const item of items) {
    const siteName = item.mission?.site?.name ?? 'Sans site'
    const contractName = item.mission?.site?.contract?.name ?? null
    const siteId = item.mission?.site?.id ?? null
    // Clé = site + contrat (pour distinguer si un nom de site existe sur 2 contrats)
    const key = `${siteName}|${contractName ?? ''}`
    const g = map.get(key)
    if (g) {
      g.items.push(item)
      if (!g.siteId && siteId) g.siteId = siteId
    } else {
      map.set(key, { siteKey: key, siteName, contractName, siteId, items: [item] })
    }
  }
  // Tri alphabétique fr par site, sub-tri par contrat
  return Array.from(map.values()).sort((a, b) => {
    const c = a.siteName.localeCompare(b.siteName, 'fr', { sensitivity: 'base' })
    if (c !== 0) return c
    return (a.contractName ?? '').localeCompare(b.contractName ?? '', 'fr', { sensitivity: 'base' })
  })
}

// Liseré gauche subtil par famille de signal — différencie d'un coup d'œil les
// lieux « actifs » (qqch à savoir) des lieux « calmes » (pas de liseré).
const FAMILY_ACCENT: Record<SignalFamily, string> = {
  attention: 'border-l-2 border-l-red-300',
  continuite: 'border-l-2 border-l-amber-300',
  ao: 'border-l-2 border-l-violet-300',
  memoire: 'border-l-2 border-l-sky-300',
}

function SiteGroupedList({
  items,
  accent,
  signalsBySite,
  footprints,
  today,
}: {
  items: ListItem[]
  accent: 'emerald' | 'muted'
  signalsBySite: Record<string, MemorySignal[]>
  footprints: Record<string, SiteFootprint>
  today: string
}) {
  const enriched = groupBySiteName(items).map((g) => {
    const fp = g.siteId ? footprints[g.siteId] : undefined
    const openAnomalies = fp?.openAnomalies ?? 0
    const aSavoir = fp?.aSavoir ?? 0
    const hasUnassigned = g.items.some((i) => i.status === 'planned' && !i.assigned_team_id)
    // Dernière activité documentée (completed/validated) du groupe.
    let lastDone = ''
    for (const i of g.items) {
      if (i.status !== 'completed' && i.status !== 'validated') continue
      const d = i.scheduled_for ?? i.scheduled_at.slice(0, 10)
      if (d > lastDone) lastDone = d
    }
    const topSignal = g.siteId ? signalsBySite[g.siteId]?.[0] : undefined
    const attention = openAnomalies > 0 || hasUnassigned
    return { g, openAnomalies, aSavoir, hasUnassigned, lastDone, topSignal, attention }
  })
  // #4 (léger) : les lieux qui nécessitent attention remontent en premier.
  enriched.sort((a, b) => (a.attention === b.attention ? 0 : a.attention ? -1 : 1))

  return (
    <div className="space-y-1.5">
      {enriched.map(({ g, openAnomalies, aSavoir, hasUnassigned, lastDone, topSignal, attention }) => {
        const accentCls = attention
          ? 'border-l-2 border-l-amber-300'
          : topSignal
            ? FAMILY_ACCENT[SIGNAL_REGISTRY[topSignal.kind].family]
            : ''
        const hasLine =
          openAnomalies > 0 || aSavoir > 0 || hasUnassigned || !!lastDone || !!topSignal
        return (
          <details
            key={g.siteKey}
            className={cn('group rounded-lg border bg-card overflow-hidden', accentCls)}
          >
            <summary
              className={
                'flex items-start justify-between gap-3 px-3 py-2.5 cursor-pointer select-none ' +
                'hover:bg-muted/30 transition-colors list-none [&::-webkit-details-marker]:hidden ' +
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              }
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
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
                {/* #1 signal faible (comptes directs) + #2 différenciation. */}
                {hasLine && (
                  <div className="mt-1 ml-[1.4rem] flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                    {openAnomalies > 0 && (
                      <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="h-3 w-3" aria-hidden />
                        {openAnomalies} anomalie{openAnomalies > 1 ? 's' : ''} ouverte{openAnomalies > 1 ? 's' : ''}
                      </span>
                    )}
                    {hasUnassigned && (
                      <span className="text-amber-700 dark:text-amber-300">· intervention sans équipe</span>
                    )}
                    {aSavoir > 0 && <span>· {aSavoir} à savoir</span>}
                    {lastDone && <span>· dernière activité {relDaysFr(lastDone, today)}</span>}
                    {topSignal && <MemorySignalBadge signal={topSignal} />}
                  </div>
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
        )
      })}
    </div>
  )
}

function InterventionRow({ item }: { item: ListItem }) {
  // Affichage depuis `scheduled_for` (date civile pure) pour éviter le décalage
  // de fuseau du timestamp `scheduled_at` dérivé. Parsé en UTC + formaté en UTC
  // pour rester stable quel que soit le fuseau du serveur.
  const civil = item.scheduled_for ?? item.scheduled_at.slice(0, 10)
  const date = new Date(civil + 'T00:00:00.000Z')
  const dateLabel = date.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' })
  const isSkipped = item.status === 'skipped'
  const isPlanned = item.status === 'planned'
  const slotInfo = item.slot ? SLOT_BADGE[item.slot] : null
  const showNoTeamWarning = isPlanned && !item.assigned_team_id
  return (
    <li className={`rounded border p-3 bg-card ${isSkipped ? 'opacity-70 bg-muted/30' : ''}`}>
      <Link href={`/interventions/${item.id}`} className="flex items-start justify-between gap-3 -m-3 p-3 hover:bg-muted/20 rounded transition-colors">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="text-sm font-medium">{dateLabel}</span>
            {slotInfo && (
              <span
                className={`inline-flex items-center text-[10px] uppercase tracking-wider rounded-full border px-1.5 py-0.5 ${slotInfo.class}`}
                title="Créneau"
              >
                {slotInfo.label}
              </span>
            )}
          </div>
          <div className={`text-sm font-medium ${isSkipped ? 'line-through decoration-amber-700/40' : ''}`}>
            {item.mission?.site?.name ?? '—'}
          </div>
          <div className="text-xs text-muted-foreground">
            {item.mission?.name ?? '—'}
            {item.mission?.site?.contract?.name && (
              <span> · {item.mission.site.contract.name}</span>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
            {item.team ? (
              <span
                className="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full border"
                style={{
                  backgroundColor: hexToPale(item.team.color),
                  borderColor: item.team.color ?? undefined,
                }}
                title="Équipe affectée à l'intervention"
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: item.team.color ?? '#94a3b8' }}
                  aria-hidden
                />
                <Users className="h-2.5 w-2.5" aria-hidden />
                {item.team.name}
              </span>
            ) : showNoTeamWarning ? (
              <span
                className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5"
                title="Aucune équipe affectée à cette intervention"
              >
                <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
                Sans équipe
              </span>
            ) : null}
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
