// /admin/activite — refonte 2026-06-15.
//
// LE cœur que l'admin réclame : qui a fait quoi, qui a vu quoi, + les SEULS
// graphes d'usage utiles (terrain/bureau, appareil) et l'état de la collecte
// (journal d'audit). Les retours utilisateurs (feedback) sont surfacés ici,
// avec lien vers la boîte complète. La santé opérationnelle (taux de clôture…)
// a été SORTIE de l'admin (indicateurs métier/manager).

import { Suspense } from 'react'
import Link from 'next/link'
import { MessageSquare, Smartphone, Monitor, ArrowRight } from 'lucide-react'
import {
  getAdoptionStats,
  getActivityFeed,
  getUsageBreakdown,
  type PeriodDays,
} from '@/lib/db/admin-monitoring'
import { getAuditActivitySummary } from '@/lib/db/activity-logs'
import { getAuditFailureStats } from '@/lib/audit/log'
import { createAdminClient } from '@/lib/supabase/admin'
import { DEVICE_LABEL, type DeviceKind } from '@/lib/navigation/device'
import { AdoptionTab } from '../monitoring/AdoptionTab'

export const dynamic = 'force-dynamic'

function parsePeriod(raw: string | undefined): PeriodDays {
  const n = Number(raw)
  if (n === 7 || n === 30 || n === 90) return n
  return 30
}

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0
}

async function getOpenFeedbackCount(): Promise<number> {
  const sb = createAdminClient()
  const { count } = await sb
    .from('feedback')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'open')
  return count ?? 0
}

async function AuditHealthCard() {
  const [summary, fails] = await Promise.all([
    getAuditActivitySummary(),
    Promise.resolve(getAuditFailureStats()),
  ])
  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—'
  const hasFailures = fails.failures > 0
  return (
    <section className={`rounded-lg border p-4 ${hasFailures ? 'border-red-300 bg-red-50/50 dark:bg-red-950/20' : 'bg-card'}`}>
      <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-2.5">
        Collecte d&apos;activité (journal d&apos;audit)
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-sm">
        <div>
          <div className="text-2xl font-semibold tabular-nums">{summary.count24h}</div>
          <div className="text-xs text-muted-foreground">événements tracés (24h)</div>
        </div>
        <div>
          <div className="text-sm font-medium">{fmt(summary.lastAt)}</div>
          <div className="text-xs text-muted-foreground">dernier événement</div>
        </div>
        <div>
          <div className={`text-2xl font-semibold tabular-nums ${hasFailures ? 'text-red-600' : 'text-emerald-600'}`}>
            {fails.failures}
          </div>
          <div className="text-xs text-muted-foreground">
            échecs d&apos;écriture (cette instance){hasFailures && fails.last ? ` · dernier : ${fails.last.action}` : ''}
          </div>
        </div>
      </div>
      {hasFailures && (
        <p className="mt-2 text-xs text-red-700 dark:text-red-300">
          ⚠️ Des consultations/actions sensibles ont pu ne PAS être tracées. Vérifier la base / les RLS.
        </p>
      )}
    </section>
  )
}

function PeriodTabs({ period }: { period: PeriodDays }) {
  const opts: PeriodDays[] = [7, 30, 90]
  return (
    <div className="flex items-center gap-1.5">
      {opts.map((p) => (
        <Link
          key={p}
          href={`/admin/activite${p !== 30 ? `?period=${p}` : ''}`}
          aria-current={p === period ? 'page' : undefined}
          className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
            p === period
              ? 'border-brand-600 bg-brand-50 text-brand-900 font-medium dark:bg-brand-950/30 dark:text-brand-200'
              : 'border-border bg-card text-muted-foreground hover:text-foreground hover:border-foreground/20'
          }`}
        >
          {p} j
        </Link>
      ))}
    </div>
  )
}

function UsageBlock({
  usage,
}: {
  usage: Awaited<ReturnType<typeof getUsageBreakdown>>
}) {
  const mobile = usage.byDevice.ios + usage.byDevice.android + usage.byDevice.other
  const deviceOrder: DeviceKind[] = ['ios', 'android', 'desktop', 'other']
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        Usage — terrain vs bureau
      </h2>
      {usage.total === 0 ? (
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          Pas encore de visites tracées sur la période.
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Smartphone className="h-4 w-4 text-sky-600" /> Terrain (mobile)
              </div>
              <div className="mt-2 text-3xl font-semibold tabular-nums">{pct(usage.terrain, usage.total)}%</div>
              <div className="text-xs text-muted-foreground">{usage.terrain} visite{usage.terrain > 1 ? 's' : ''} sur /m</div>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Monitor className="h-4 w-4 text-slate-600" /> Bureau (dashboard)
              </div>
              <div className="mt-2 text-3xl font-semibold tabular-nums">{pct(usage.bureau, usage.total)}%</div>
              <div className="text-xs text-muted-foreground">{usage.bureau} visite{usage.bureau > 1 ? 's' : ''} bureau</div>
            </div>
          </div>
          {/* Barre terrain/bureau */}
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="bg-sky-500" style={{ width: `${pct(usage.terrain, usage.total)}%` }} />
            <div className="bg-slate-400" style={{ width: `${pct(usage.bureau, usage.total)}%` }} />
          </div>
          {/* Répartition par appareil */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {deviceOrder.map((k) => (
              <div key={k} className="rounded-lg border bg-card p-3 text-center">
                <div className="text-xl font-semibold tabular-nums">{usage.byDevice[k]}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{DEVICE_LABEL[k]}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {pct(mobile, usage.total)}% des visites depuis un téléphone ou une tablette.
          </p>
        </>
      )}
    </section>
  )
}

export default async function AdminActivitePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const { period: periodRaw } = await searchParams
  const period = parsePeriod(periodRaw)

  const [stats, feed, usage, openFeedback] = await Promise.all([
    getAdoptionStats(period),
    getActivityFeed(period),
    getUsageBreakdown(period),
    getOpenFeedbackCount(),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Activité</h1>
          <p className="text-sm text-muted-foreground">Qui a fait quoi, qui a vu quoi, et comment l&apos;app est utilisée.</p>
        </div>
        <PeriodTabs period={period} />
      </div>

      <Suspense fallback={null}>
        <AuditHealthCard />
      </Suspense>

      <UsageBlock usage={usage} />

      {/* Retours utilisateurs — surfacé ici, boîte complète sur /admin/feedback. */}
      <Link
        href="/admin/feedback"
        className="group flex items-center justify-between gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-foreground/30 hover:bg-muted/20"
      >
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
            <MessageSquare className="h-4 w-4" />
          </span>
          <div>
            <div className="text-sm font-medium">Retours utilisateurs</div>
            <div className="text-xs text-muted-foreground">
              {openFeedback > 0 ? `${openFeedback} retour${openFeedback > 1 ? 's' : ''} à traiter` : 'Aucun retour en attente'}
            </div>
          </div>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
      </Link>

      {/* Feed « qui a fait quoi · qui a vu quoi » + tableau personnes + détails. */}
      <AdoptionTab stats={stats} feed={feed} />
    </div>
  )
}
