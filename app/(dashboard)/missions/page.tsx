import Link from 'next/link'
import { Calendar, ClipboardList } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureTodayInterventions } from '@/lib/recurrence/ensure-today'
import { cn } from '@/lib/utils'

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

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s
}

export default async function MissionsPage() {
  // Show all upcoming + recent interventions cross-contract
  const supabase = createAdminClient()
  const today = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  // Slice 6.3 — Génération paresseuse silencieuse à l'échelle tenant.
  // On scope par tous les templates actifs (RLS standard côté DB). Le helper
  // est idempotent et silencieux (try/catch) — n'altère pas le rendu en cas
  // d'échec. daysAhead=1 : on génère uniquement aujourd'hui pour le first paint
  // superviseur (les 6 prochains jours seront générés au boot suivant ou par
  // cron complémentaire à ajouter en complément si besoin futur).
  const { data: activeTemplates } = await supabase
    .from('intervention_templates')
    .select('id')
    .eq('active', true)
    .is('deleted_at', null)
  const activeTemplateIds = (activeTemplates ?? []).map((t) => t.id)
  if (activeTemplateIds.length > 0) {
    await ensureTodayInterventions({ templateIds: activeTemplateIds, daysAhead: 1 })
  }

  const { data: interventions } = await supabase
    .from('interventions')
    .select(`
      id, scheduled_at, status, mission_id, skipped_reason,
      mission:missions(id, name, site_id, site:sites(id, name, contract_id, contract:contracts(id, name, client_name)))
    `)
    .gte('scheduled_at', `${yesterday}T00:00:00`)
    .order('scheduled_at', { ascending: true })
    .limit(100)

  // Supabase typing returns relations as arrays; normalize first
  type RawIntervention = {
    id: string
    scheduled_at: string
    status: string
    mission_id: string
    skipped_reason: string | null
    mission?: unknown
  }
  type NormalizedItem = {
    id: string
    scheduled_at: string
    status: string
    skipped_reason: string | null
    mission?: { name: string; site?: { name: string; contract?: { id: string; name: string; client_name: string } | null } | null } | null
  }

  function pickOne<T>(value: unknown): T | null {
    if (Array.isArray(value)) return (value[0] as T) ?? null
    return (value as T | null) ?? null
  }

  const raw = (interventions ?? []) as unknown as RawIntervention[]
  const items: NormalizedItem[] = raw.map((r) => {
    const missionRaw = pickOne<{ name: string; site?: unknown }>(r.mission)
    const siteRaw = missionRaw ? pickOne<{ name: string; contract?: unknown }>(missionRaw.site) : null
    const contractRaw = siteRaw ? pickOne<{ id: string; name: string; client_name: string }>(siteRaw.contract) : null
    return {
      id: r.id,
      scheduled_at: r.scheduled_at,
      status: r.status,
      skipped_reason: r.skipped_reason,
      mission: missionRaw
        ? {
            name: missionRaw.name,
            site: siteRaw ? { name: siteRaw.name, contract: contractRaw } : null,
          }
        : null,
    }
  })

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

      {upcoming.length === 0 && past.length === 0 && (
        <div className="rounded-lg border bg-card">
          <EmptyState
            icon={ClipboardList}
            title="Aucune intervention planifiée"
            description="Créez une mission depuis un contrat actif, ou ajoutez une récurrence pour générer automatiquement des interventions chaque jour."
            primaryAction={
              <Link
                href="/contracts"
                className={cn(buttonVariants({ variant: 'default' }))}
              >
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
