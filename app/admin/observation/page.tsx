// /admin/observation — Dashboard d'observation pilote (admin only).
//
// Vincent 2026-05-22 — Phase de gel post-Sprint E. Pas une feature pour
// Guillaume, une feature pour TOI : voir si MemorIA reste au centre
// (cf. [[risque-deux-morts-opposees]]).
//
// 5 sections :
//   1. Volumes briefs
//   2. Qualité d'usage
//   3. Engagement utilisateurs
//   4. Centrage (sous-intel vs surconstruction)
//   5. Alertes (règles agrégées)
//
// Période par défaut : 14 jours (fenêtre d'observation pilote).

import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  Eye,
  FileText,
  Share2,
  CheckCircle2,
  Archive,
  Clock,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  AlertOctagon,
  Activity,
  MessageSquare,
} from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import {
  buildObservationSnapshot,
  type PeriodDays,
  type AlertSignal,
} from '@/lib/observability/pilot-metrics'

export const dynamic = 'force-dynamic'

function parsePeriod(raw: string | undefined): PeriodDays {
  const n = Number(raw)
  if (n === 7 || n === 14 || n === 30) return n
  return 14
}

function fmtDays(d: number | null): string {
  if (d === null) return '—'
  if (d < 1) return `<1 jour`
  return `${d.toFixed(1)} jour${d > 1 ? 's' : ''}`
}

function fmtHours(h: number | null): string {
  if (h === null) return '—'
  if (h < 1) return `${(h * 60).toFixed(0)} min`
  if (h < 24) return `${h.toFixed(1)} h`
  return `${(h / 24).toFixed(1)} jours`
}

function fmtPct(p: number | null): string {
  if (p === null) return '—'
  return `${p.toFixed(0)}%`
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  manager: 'Manager',
  chef_equipe: 'Chef d’équipe',
  inconnu: '?',
}

/** Ventilation PAR RÔLE (jamais nommée) : « Manager 40 · Chef 0 ». */
function roleBreakdown(byRole: Record<string, number>): string {
  const parts = Object.entries(byRole)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([role, n]) => `${ROLE_LABELS[role] ?? role} ${n}`)
  return parts.join(' · ')
}

export default async function AdminObservationPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin') redirect('/dashboard')

  const { period: rawPeriod } = await searchParams
  const period = parsePeriod(rawPeriod)
  const snap = await buildObservationSnapshot(period)

  return (
    <div className="space-y-6 max-w-5xl">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
          <Eye className="h-6 w-6 text-brand-600" />
          Observation pilote
        </h1>
        <p className="text-sm text-muted-foreground">
          Métriques de centrage pendant la phase de gel — pour vérifier que
          MemorIA ne dérive ni en sous-intelligence (ERP banal) ni en
          surconstruction (anxiogène). Cf.{' '}
          <Link href="/manuel" className="underline">manuel</Link>.
        </p>
        <PeriodSwitcher current={period} />
      </header>

      {/* ── Alertes (en haut, prioritaires) ────────────────────────────── */}
      <AlertsSection alerts={snap.alerts} />

      {/* ── 1. Volumes briefs ──────────────────────────────────────────── */}
      <section className="rounded-lg border bg-card p-5 space-y-4">
        <h2 className="text-base font-semibold inline-flex items-center gap-2">
          <FileText className="h-4 w-4 text-brand-600" />
          1. Volumes briefs ({period} derniers jours)
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KPI
            label="Total créés"
            value={snap.volumes.total}
            target="2-10 / sem"
          />
          <KPI
            label="À transmettre"
            value={snap.volumes.byStatus.draft}
            icon={FileText}
          />
          <KPI
            label="Partagés"
            value={snap.volumes.byStatus.shared}
            icon={Share2}
          />
          <KPI
            label="Reconnus"
            value={snap.volumes.byStatus.acknowledged}
            icon={CheckCircle2}
          />
          <KPI
            label="Archivés"
            value={snap.volumes.byStatus.archived}
            icon={Archive}
          />
          <KPI
            label="Consultations totales"
            value={snap.volumes.totalAccessCount}
            icon={Eye}
            help="Cumul des access_count sur /h/[token]"
          />
          <KPI
            label="Archivés sans lecture"
            value={snap.volumes.archivedWithoutConsultation}
            tone={snap.volumes.archivedWithoutConsultation > 2 ? 'warning' : undefined}
            help="Briefs créés pour rien"
          />
        </div>
      </section>

      {/* ── Production de mémoire (Couche A) ───────────────────────────── */}
      <section className="rounded-lg border bg-card p-5 space-y-4">
        <h2 className="text-base font-semibold inline-flex items-center gap-2">
          <Activity className="h-4 w-4 text-brand-600" />
          Production de mémoire — le système se nourrit-il&nbsp;? ({period} j)
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KPI label="« À savoir » créés" value={snap.production.aSavoirCreated} help="Mémoire vivante du lieu" />
          <KPI label="Anomalies documentées" value={snap.production.anomaliesDocumented} />
          <KPI label="Documents importés" value={snap.production.documentsUploaded} />
          <KPI
            label="dont archives froides"
            value={snap.production.documentsCold}
            help="Stockés, non indexés (tri d'ingestion)"
          />
        </div>
      </section>

      {/* ── Santé du moteur (Couche A — production des signaux) ─────────── */}
      <section className="rounded-lg border bg-card p-5 space-y-3">
        <h2 className="text-base font-semibold inline-flex items-center gap-2">
          <Activity className="h-4 w-4 text-brand-600" />
          Santé du moteur — signaux produits actuellement
        </h2>
        <p className="text-xs text-muted-foreground">
          Ce que le moteur surface aujourd&apos;hui, par type. C&apos;est la part
          <strong> production</strong> ; le <em>vu / cliqué / ignoré</em> par signal
          relève de la Couche B (instrumentation agrégée, non encore en place).
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {snap.engineHealth.map((s) => (
            <div
              key={s.kind}
              className={`rounded-md border px-3 py-2 ${
                s.valence === 'fragile'
                  ? 'border-amber-300 bg-amber-50/40 dark:bg-amber-950/20'
                  : s.valence === 'sain'
                    ? 'border-emerald-200 bg-emerald-50/30 dark:bg-emerald-950/15'
                    : 'border-border bg-background'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs min-w-0 truncate">{s.label}</span>
                <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">
                  produit <strong className="text-foreground">{s.count}</strong> · vu{' '}
                  <strong className="text-foreground">{s.shown}</strong>
                </span>
              </div>
              {s.shown > 0 && (
                <p className="text-[10px] text-muted-foreground mt-0.5">{roleBreakdown(s.shownByRole)}</p>
              )}
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground italic">
          « Vu » = nombre d&apos;<strong>impressions</strong> sur le dashboard (par type, agrégé).
          Les signaux sont des badges d&apos;info non cliquables : on mesure l&apos;apparition,
          pas le clic. Croiser avec « Adoption des menus » pour voir s&apos;il a agi.
        </p>
      </section>

      {/* ── Adoption des menus (Couche A — feedback produit) ───────────── */}
      <section className="rounded-lg border bg-card p-5 space-y-3">
        <h2 className="text-base font-semibold inline-flex items-center gap-2">
          <Eye className="h-4 w-4 text-brand-600" />
          Adoption des menus — quelles surfaces servent&nbsp;? ({period} j)
        </h2>
        <p className="text-xs text-muted-foreground">
          Niveau <strong>feature</strong> (route), pas la personne. Un menu jamais ouvert
          = candidat à retirer (« développé pour rien »).
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {snap.menuAdoption.map((m) => (
            <div
              key={m.href}
              className={`rounded-md border px-3 py-2 ${
                m.count === 0
                  ? 'border-amber-300 bg-amber-50/40 dark:bg-amber-950/20'
                  : 'border-border bg-background'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs truncate">
                  {m.label}
                  {m.count === 0 && <span className="text-amber-700 dark:text-amber-300"> · jamais ouvert</span>}
                </span>
                <span className="text-sm font-semibold tabular-nums">{m.count}</span>
              </div>
              {m.count > 0 && (
                <p className="text-[10px] text-muted-foreground mt-0.5">{roleBreakdown(m.byRole)}</p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── 2. Qualité d'usage ─────────────────────────────────────────── */}
      <section className="rounded-lg border bg-card p-5 space-y-4">
        <h2 className="text-base font-semibold inline-flex items-center gap-2">
          <Clock className="h-4 w-4 text-brand-600" />
          2. Qualité d'usage
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <KPI
            label="Délai création → partage"
            value={fmtDays(snap.quality.avgDaysCreatedToShared)}
            target="< 3 jours"
            help="Délai > 3j = pas urgent → qualifier autrement"
          />
          <KPI
            label="Délai partage → consultation"
            value={fmtHours(snap.quality.avgHoursSharedToFirstAccess)}
            target="< 24h"
            help="Délai > 24h = pas le bon moment"
          />
          <KPI
            label="Taux de reconnaissance"
            value={fmtPct(snap.quality.acknowledgmentRate)}
            target="> 60%"
            help="Briefs partagés effectivement lus + confirmés"
          />
          <KPI
            label="Sites moyens / brief"
            value={
              snap.quality.avgSitesPerBrief !== null
                ? snap.quality.avgSitesPerBrief.toFixed(1)
                : '—'
            }
            target="< 6"
            help="> 6 = risque brief fantôme"
            tone={
              (snap.quality.avgSitesPerBrief ?? 0) > 6 ? 'warning' : undefined
            }
          />
        </div>
      </section>

      {/* ── 3. Engagement ──────────────────────────────────────────────── */}
      <section className="rounded-lg border bg-card p-5 space-y-4">
        <h2 className="text-base font-semibold inline-flex items-center gap-2">
          <Activity className="h-4 w-4 text-brand-600" />
          3. Engagement utilisateurs
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <KPI
            label="Utilisateurs actifs distincts"
            value={snap.engagement.activeUserCount}
            help="Via activity_logs sur la période"
          />
          <KPI
            label="Feedbacks reçus"
            value={snap.engagement.feedbackCount}
            icon={MessageSquare}
          />
        </div>

        {snap.engagement.topEntityTypes.length > 0 && (
          <div>
            <p className="text-xs font-medium mb-1.5">Top entités consultées</p>
            <div className="flex flex-wrap gap-1.5">
              {snap.engagement.topEntityTypes.map((t) => (
                <span
                  key={t.entity_type}
                  className="text-xs px-2 py-1 rounded-md border bg-muted/30"
                >
                  {t.entity_type} · <strong className="tabular-nums">{t.count}</strong>
                </span>
              ))}
            </div>
          </div>
        )}

        {snap.engagement.recentFeedbacks.length > 0 && (
          <div>
            <p className="text-xs font-medium mb-1.5">Feedbacks récents</p>
            <ul className="space-y-1.5">
              {snap.engagement.recentFeedbacks.map((f) => (
                <li key={f.id} className="text-xs rounded-md border bg-muted/20 px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2 mb-0.5">
                    <span className="text-muted-foreground">{f.page ?? '—'}</span>
                    <span className="text-[10px] uppercase tracking-wider font-medium px-1 py-0.5 rounded bg-background border">
                      {f.status}
                    </span>
                  </div>
                  <p className="text-foreground">{f.message.slice(0, 200)}</p>
                </li>
              ))}
            </ul>
            <Link
              href="/admin/feedback"
              className="text-xs text-brand-700 hover:underline mt-2 inline-block"
            >
              Voir tous les feedbacks →
            </Link>
          </div>
        )}
      </section>

      {/* ── 4. Centrage anti-deux-morts ────────────────────────────────── */}
      <section className="rounded-lg border-2 border-brand-200 bg-brand-50/30 dark:bg-brand-950/20 p-5 space-y-4">
        <h2 className="text-base font-semibold inline-flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-rose-600" />
          <TrendingDown className="h-4 w-4 text-amber-600" />
          4. Centrage anti-deux-morts
        </h2>
        <p className="text-xs text-muted-foreground">
          Signaux pour détecter une dérive vers la surconstruction (anxiogène)
          ou la sous-intelligence (banal).
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <KPI
            label='Feedback "trop X"'
            value={snap.centering.feedbackTrop}
            target="< 2"
            tone={snap.centering.feedbackTrop >= 3 ? 'error' : undefined}
            help="Indicateur fort de surconstruction"
          />
          <KPI
            label='Feedback "pas compris"'
            value={snap.centering.feedbackNonCompris}
            target="< 2"
            tone={snap.centering.feedbackNonCompris >= 3 ? 'warning' : undefined}
            help="Indicateur de confusion UX"
          />
          <KPI
            label='Feedback "anxiogène"'
            value={snap.centering.feedbackAnxiogene}
            target="0"
            tone={snap.centering.feedbackAnxiogene >= 1 ? 'error' : undefined}
            help="⚠️ Glissement vers surveillance"
          />
          <KPI
            label='Feedback "inutile"'
            value={snap.centering.feedbackInutile}
            target="< 2"
            tone={snap.centering.feedbackInutile >= 3 ? 'warning' : undefined}
            help="Indicateur de sous-intelligence"
          />
          <KPI
            label="Briefs > 10 sites"
            value={snap.centering.briefsOversized}
            target="0"
            tone={snap.centering.briefsOversized > 0 ? 'warning' : undefined}
            help="Risque brief fantôme"
          />
          <KPI
            label="Briefs archivés sans lecture"
            value={snap.centering.briefsCreatedThenArchivedUnread}
            target="< 2"
            tone={
              snap.centering.briefsCreatedThenArchivedUnread > 2 ? 'warning' : undefined
            }
            help="Créés pour rien"
          />
        </div>
      </section>

      {/* ── Limitations connues / à instrumenter ───────────────────────── */}
      <section className="rounded-lg border border-dashed bg-muted/30 p-4 space-y-2">
        <h2 className="text-sm font-medium">À instrumenter en V2 (non disponible)</h2>
        <ul className="text-xs text-muted-foreground space-y-1">
          <li>
            • <strong>Scroll depth dans /h/[token]</strong> — savoir si Joseph lit
            tout ou abandonne au 1ᵉʳ paragraphe
          </li>
          <li>
            • <strong>Latence du 1ᵉʳ clic utile</strong> — temps entre ouverture
            d'une page et 1ᵉʳ action (cible &lt;5s, alerte &gt;15s)
          </li>
          <li>
            • <strong>Top pages avec URL exacte</strong> — `activity_logs` a
            `entity_type` (site / tender / user) mais pas la page elle-même
          </li>
          <li>
            • <strong>Connexions spontanées Guillaume</strong> — `auth.users.last_sign_in_at`
            existe mais les sessions ne sont pas comptées par jour
          </li>
        </ul>
      </section>

      <p className="text-[11px] text-muted-foreground italic text-center py-2">
        Snapshot {snap.period} jours · Période :{' '}
        {new Date(snap.periodStart).toLocaleDateString('fr-FR')} →{' '}
        {new Date(snap.periodEnd).toLocaleDateString('fr-FR')}
        {' · '}
        <Link href="/admin/monitoring" className="underline">
          Monitoring IA
        </Link>
        {' · '}
        <Link href="/admin/feedback" className="underline">
          Feedback
        </Link>
      </p>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function PeriodSwitcher({ current }: { current: PeriodDays }) {
  const periods: PeriodDays[] = [7, 14, 30]
  return (
    <nav className="inline-flex gap-1 rounded-md border bg-card p-1" aria-label="Période">
      {periods.map((p) => (
        <Link
          key={p}
          href={`/admin/observation?period=${p}`}
          aria-current={current === p ? 'page' : undefined}
          className={`px-3 py-1 text-xs rounded transition-colors ${
            current === p
              ? 'bg-brand-600 text-white font-medium'
              : 'text-muted-foreground hover:bg-muted/50'
          }`}
        >
          {p} jours
        </Link>
      ))}
    </nav>
  )
}

function KPI({
  label,
  value,
  target,
  tone,
  icon: Icon,
  help,
}: {
  label: string
  value: number | string
  target?: string
  tone?: 'warning' | 'error'
  icon?: React.ComponentType<{ className?: string }>
  help?: string
}) {
  const toneClass =
    tone === 'error'
      ? 'border-rose-300 bg-rose-50/40 dark:bg-rose-950/20'
      : tone === 'warning'
        ? 'border-amber-300 bg-amber-50/40 dark:bg-amber-950/20'
        : 'border-border bg-background'
  return (
    <div className={`rounded-md border ${toneClass} px-3 py-2.5 space-y-0.5`}>
      <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      {target && (
        <p className="text-[10px] text-muted-foreground italic">cible {target}</p>
      )}
      {help && <p className="text-[10px] text-muted-foreground">{help}</p>}
    </div>
  )
}

function AlertsSection({ alerts }: { alerts: AlertSignal[] }) {
  if (alerts.length === 0) {
    return (
      <div className="rounded-lg border border-emerald-300 bg-emerald-50/40 dark:bg-emerald-950/20 px-5 py-3 flex items-center gap-3">
        <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
        <div>
          <p className="text-sm font-medium">Aucun signal d'alerte</p>
          <p className="text-xs text-muted-foreground">
            Le centre tient. Continuer l'observation.
          </p>
        </div>
      </div>
    )
  }

  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold inline-flex items-center gap-2">
        <AlertOctagon className="h-4 w-4 text-rose-600" />
        Signaux d'alerte ({alerts.length})
      </h2>
      <ul className="space-y-2">
        {alerts.map((a, i) => {
          const Icon = a.level === 'red' ? AlertOctagon : AlertTriangle
          const colorClass =
            a.level === 'red'
              ? 'border-rose-400 bg-rose-50/60 dark:bg-rose-950/30 text-rose-900 dark:text-rose-200'
              : 'border-amber-400 bg-amber-50/60 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200'
          return (
            <li
              key={i}
              className={`rounded-md border-2 ${colorClass} px-4 py-3 flex items-start gap-3`}
            >
              <Icon className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{a.title}</p>
                <p className="text-xs mt-0.5">{a.detail}</p>
                <span className="text-[10px] uppercase tracking-wider font-medium mt-1 inline-block opacity-70">
                  {a.category === 'sub-intelligence'
                    ? 'Sous-intelligence'
                    : a.category === 'overconstruction'
                      ? 'Surconstruction'
                      : a.category === 'invisible'
                        ? 'Invisibilité'
                        : 'Engagement'}
                </span>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
