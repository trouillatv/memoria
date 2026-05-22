// /handovers — Passages de témoin : centre de continuité opérationnelle.
//
// Vincent 2026-05-22 — Sprint Équipes C, puis P0 « décrire → orchestrer ».
//
// Doctrine : la page liste des briefs MAIS doit aussi RESPIRER quand il n'y a
// rien à transmettre — montrer que la mémoire continue d'exister et que le
// système surveille. Pas de « top créateurs », pas de classement, pas de score.
// Volume = mémoire PRÉSERVÉE. Le seul nom de personne = « reconnu par X »
// (fait de processus). Sujet = la mémoire / le lieu.

import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowRightLeft,
  ChevronRight,
  FileText,
  CheckCircle2,
  Share2,
  Archive,
  ShieldCheck,
  AlertTriangle,
  MapPin,
  Pin,
  Users,
  BookOpen,
  Eye,
  Clock,
} from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import {
  listHandoverBriefs,
  countHandoverBriefsByStatus,
  getMemoryTransmittedThisMonth,
  listRecentPassations,
  listLivingASavoir,
  type RecentPassationEntry,
  type MemoryTransmittedSummary,
  type LivingASavoirCard,
} from '@/lib/db/handover'
import { listContinuityRisks } from '@/lib/db/continuity'
import type { HandoverStatus } from '@/types/db'

export const dynamic = 'force-dynamic'

const VALID_STATUSES: HandoverStatus[] = ['draft', 'shared', 'acknowledged', 'archived']

const STATUS_LABEL: Record<HandoverStatus, string> = {
  draft: 'À transmettre',
  shared: 'Partagé',
  acknowledged: 'Reconnu',
  archived: 'Archivé',
}

const STATUS_ICON: Record<HandoverStatus, React.ComponentType<{ className?: string }>> = {
  draft: FileText,
  shared: Share2,
  acknowledged: CheckCircle2,
  archived: Archive,
}

const KIND_LABEL: Record<string, string> = {
  member_change: 'Changement d’équipe',
  team_takes_site: 'Prise de site',
  manual: 'Ad-hoc',
}

function fmtDateShort(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

/** Temps relatif sobre (« hier », « il y a 3 jours », « il y a 2 mois »). */
function relTime(iso: string | null): string {
  if (!iso) return ''
  const diffMs = Date.now() - new Date(iso).getTime()
  if (diffMs < 0) return "à l'instant"
  const days = Math.floor(diffMs / 86_400_000)
  if (days <= 0) {
    const hours = Math.floor(diffMs / 3_600_000)
    if (hours <= 0) return "à l'instant"
    return hours === 1 ? 'il y a 1 heure' : `il y a ${hours} heures`
  }
  if (days === 1) return 'hier'
  if (days < 7) return `il y a ${days} jours`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return weeks === 1 ? 'il y a 1 semaine' : `il y a ${weeks} semaines`
  const months = Math.floor(days / 30)
  return months <= 1 ? 'il y a 1 mois' : `il y a ${months} mois`
}

export default async function HandoversPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const me = await getCurrentUserWithProfile()
  if (!me) redirect('/login')
  if (me.role !== 'admin' && me.role !== 'manager') redirect('/m')

  const { status: rawStatus } = await searchParams
  const filter: HandoverStatus =
    VALID_STATUSES.includes(rawStatus as HandoverStatus)
      ? (rawStatus as HandoverStatus)
      : 'draft'

  const [briefs, counts, summary, recent, aSavoir, continuity] = await Promise.all([
    listHandoverBriefs({ status: filter, limit: 200 }),
    countHandoverBriefsByStatus(),
    getMemoryTransmittedThisMonth(),
    listRecentPassations(6),
    listLivingASavoir(4),
    listContinuityRisks({ horizonDays: 30, viewerUserId: me.id }),
  ])

  const lastAcknowledged = recent.find((p) => p.status === 'acknowledged') ?? null

  return (
    <div className="space-y-6 max-w-5xl">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
          <ArrowRightLeft className="h-6 w-6 text-brand-600" />
          Passages de témoin
        </h1>
        <p className="text-sm text-muted-foreground">
          Briefs de continuité quand quelqu&apos;un bascule ou qu&apos;une équipe
          prend un nouveau site. Documente le site et la mémoire utile, jamais la
          personne.
        </p>
      </header>

      {/* ── Bandeau d'état — indique les fins de contrat proches (30j) ── */}
      <ContinuityStateBanner
        counts={continuity.counts}
        lastAcknowledged={lastAcknowledged}
        summary={summary}
      />

      {/* ── Mémoire transmise ce mois-ci — volume préservé, jamais score ── */}
      <MemoryTransmittedCard summary={summary} />

      {/* ── Timeline des dernières passations ── */}
      <RecentPassationsTimeline entries={recent} />

      {/* ── Cartes « à savoir » actuellement vivantes ── */}
      <LivingASavoirSection cards={aSavoir} />

      {/* ── Zone de travail : briefs filtrés par statut ── */}
      <section className="space-y-3 pt-2">
        <h2 className="text-sm font-medium text-muted-foreground inline-flex items-center gap-1.5">
          <FileText className="h-4 w-4" />
          Tous les briefs
        </h2>

        {/* Tabs */}
        <nav className="flex items-center gap-2 border-b" aria-label="Filtre par statut">
          {VALID_STATUSES.map((s) => {
            const Icon = STATUS_ICON[s]
            return (
              <Link
                key={s}
                href={`/handovers?status=${s}`}
                aria-current={filter === s ? 'page' : undefined}
                className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors inline-flex items-center gap-1.5 ${
                  filter === s
                    ? 'border-brand-600 text-foreground font-medium'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {STATUS_LABEL[s]}
                <span className="ml-1 text-xs tabular-nums text-muted-foreground">
                  ({counts[s]})
                </span>
              </Link>
            )
          })}
        </nav>

        {/* Liste */}
        {briefs.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/30 px-6 py-12 text-center text-sm text-muted-foreground italic">
            {filter === 'draft'
              ? 'Aucun brief à transmettre. Crée-en un depuis une fiche intervenant ou une fiche équipe.'
              : `Aucun brief ${STATUS_LABEL[filter].toLowerCase()}.`}
          </div>
        ) : (
          <ul className="space-y-2">
            {briefs.map((b) => {
              const Icon = STATUS_ICON[b.status as HandoverStatus]
              return (
                <li key={b.id}>
                  <Link
                    href={`/handovers/${b.id}`}
                    className="block rounded-lg border bg-card p-4 hover:border-brand-300 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground inline-flex items-center gap-1">
                            <Icon className="h-3 w-3" />
                            {STATUS_LABEL[b.status as HandoverStatus]}
                          </span>
                          <span className="text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200">
                            {KIND_LABEL[b.kind] ?? b.kind}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {fmtDateShort(b.created_at)}
                          </span>
                        </div>
                        <p className="text-sm font-medium mt-1 truncate">
                          {b.title}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {b.payload?.sites?.length ?? 0} site
                          {(b.payload?.sites?.length ?? 0) > 1 ? 's' : ''}
                          {b.shared_token && b.expires_at && (
                            <>
                              {' · Partagé '}
                              <span className="tabular-nums">
                                (expire le {fmtDateShort(b.expires_at)})
                              </span>
                              {' · '}
                              {b.access_count} consultation
                              {b.access_count > 1 ? 's' : ''}
                            </>
                          )}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

// ----------------------------------------------------------------------------
// Bandeau d'état de continuité — « respiration du vide »
// ----------------------------------------------------------------------------

function ContinuityStateBanner({
  counts,
  lastAcknowledged,
  summary,
}: {
  counts: { j7: number; j14: number; j30: number }
  lastAcknowledged: RecentPassationEntry | null
  summary: MemoryTransmittedSummary
}) {
  const total = counts.j7 + counts.j14 + counts.j30

  if (total > 0) {
    const parts: string[] = []
    if (counts.j7 > 0) parts.push(`${counts.j7} cette semaine`)
    if (counts.j14 > 0) parts.push(`${counts.j14} dans 2 semaines`)
    if (counts.j30 > 0) parts.push(`${counts.j30} dans le mois`)
    return (
      <div className="rounded-lg border-2 border-amber-300 bg-amber-50/50 dark:bg-amber-950/20 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
              {total} passation{total > 1 ? 's' : ''} à préparer
              <span className="font-normal text-amber-800/80 dark:text-amber-200/70">
                {' '}— {parts.join(' · ')}
              </span>
            </p>
            <p className="text-xs text-amber-800/80 dark:text-amber-200/70 mt-0.5">
              Des contrats se terminent bientôt. La mémoire portée par ces équipes
              mérite d&apos;être transmise avant la rupture.{' '}
              <Link href="/continuite" className="underline font-medium">
                Voir la continuité
              </Link>
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border-2 border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/15 p-4">
      <div className="flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-emerald-900 dark:text-emerald-200">
            Continuité stable — aucune fin de contrat dans les 30 jours
          </p>
          <p className="text-xs text-emerald-800/80 dark:text-emerald-200/70 mt-0.5">
            {lastAcknowledged && (
              <>Dernier passage de témoin reconnu {relTime(lastAcknowledged.acknowledgedAt)}. </>
            )}
            {summary.briefsCount > 0 && (
              <>{summary.briefsCount} passage{summary.briefsCount > 1 ? 's' : ''} de témoin préparé{summary.briefsCount > 1 ? 's' : ''} ce mois-ci.</>
            )}
          </p>
        </div>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------
// Mémoire transmise ce mois-ci — volume préservé (pas un score)
// ----------------------------------------------------------------------------

function MemoryTransmittedCard({ summary }: { summary: MemoryTransmittedSummary }) {
  const stats: Array<{ icon: React.ComponentType<{ className?: string }>; value: number; label: string }> = [
    { icon: ArrowRightLeft, value: summary.briefsCount, label: 'passages de témoin' },
    { icon: MapPin, value: summary.sitesCovered, label: 'sites couverts' },
    { icon: Pin, value: summary.aSavoir, label: 'à savoir transmis' },
    { icon: AlertTriangle, value: summary.anomalies, label: 'anomalies relayées' },
    { icon: BookOpen, value: summary.documents, label: 'documents joints' },
    { icon: Users, value: summary.relayTeams, label: 'équipes relais' },
  ]

  return (
    <section className="rounded-lg border bg-card p-4 sm:p-5 space-y-3">
      <h2 className="text-sm font-medium inline-flex items-center gap-1.5">
        <Clock className="h-4 w-4 text-brand-600" />
        Mémoire transmise ce mois-ci
      </h2>
      {summary.briefsCount === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          Aucune mémoire transmise via passage de témoin ce mois-ci. Dès qu&apos;un
          brief est créé, le volume de mémoire préservée apparaît ici.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="flex items-center gap-2">
              <s.icon className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-sm">
                <span className="font-semibold tabular-nums">{s.value}</span>{' '}
                <span className="text-muted-foreground">{s.label}</span>
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground italic">
        Volume de mémoire préservée — pas un score, pas une performance.
      </p>
    </section>
  )
}

// ----------------------------------------------------------------------------
// Timeline des dernières passations
// ----------------------------------------------------------------------------

function passationSubline(e: RecentPassationEntry): string {
  if (e.status === 'acknowledged') {
    const who = e.acknowledgedByLabel ? `reconnu par ${e.acknowledgedByLabel}` : 'reconnu'
    return `${who} · ${relTime(e.acknowledgedAt ?? e.createdAt)}`
  }
  if (e.status === 'shared') {
    return e.accessCount > 0
      ? `partagé · consulté ${e.accessCount} fois`
      : 'partagé · pas encore consulté'
  }
  if (e.status === 'archived') return `passation archivée · ${relTime(e.createdAt)}`
  return `brief généré · ${relTime(e.createdAt)}`
}

function RecentPassationsTimeline({ entries }: { entries: RecentPassationEntry[] }) {
  return (
    <section className="rounded-lg border bg-card p-4 sm:p-5 space-y-3">
      <h2 className="text-sm font-medium inline-flex items-center gap-1.5">
        <ArrowRightLeft className="h-4 w-4 text-brand-600" />
        Dernières passations
      </h2>

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          Aucun passage de témoin n&apos;a encore été préparé. Dès qu&apos;une
          personne change d&apos;équipe ou qu&apos;une équipe prend un site, un
          brief fige la mémoire utile du lieu (à savoir, anomalies, documents,
          équipes relais) pour que rien ne se perde.
        </p>
      ) : (
        <ul className="space-y-0">
          {entries.map((e, i) => {
            const Icon = STATUS_ICON[e.status]
            const inner = (
              <div className="flex items-start gap-3 py-2">
                <div className="flex flex-col items-center shrink-0">
                  <span
                    className={`h-6 w-6 rounded-full border flex items-center justify-center ${
                      e.status === 'acknowledged'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                        : e.status === 'archived'
                          ? 'bg-muted border-border text-muted-foreground'
                          : 'bg-brand-50 border-brand-200 text-brand-600'
                    }`}
                  >
                    <Icon className="h-3 w-3" />
                  </span>
                  {i < entries.length - 1 && <span className="w-px flex-1 bg-border mt-1 min-h-3" />}
                </div>
                <div className="min-w-0 flex-1 pb-1">
                  <p className="text-sm truncate">
                    {e.title}
                    {e.sitesCount > 0 && (
                      <span className="text-muted-foreground"> · {e.sitesCount} site{e.sitesCount > 1 ? 's' : ''}</span>
                    )}
                  </p>
                  <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                    {e.status === 'shared' && e.accessCount > 0 && <Eye className="h-3 w-3" />}
                    {passationSubline(e)}
                  </p>
                </div>
              </div>
            )
            return (
              <li key={e.id}>
                {e.isArchived ? (
                  <div className="opacity-70">{inner}</div>
                ) : (
                  <Link href={`/handovers/${e.id}`} className="block rounded-md hover:bg-muted/40 transition-colors -mx-2 px-2">
                    {inner}
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ----------------------------------------------------------------------------
// Cartes « à savoir » — mémoire condensée, immédiatement utile (sujet = lieu)
// ----------------------------------------------------------------------------

function LivingASavoirSection({ cards }: { cards: LivingASavoirCard[] }) {
  if (cards.length === 0) return null

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium inline-flex items-center gap-1.5">
        <Pin className="h-4 w-4 text-brand-600" />
        À savoir, en ce moment
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {cards.map((c) => (
          <div
            key={c.id}
            className="rounded-lg border bg-amber-50/30 dark:bg-amber-950/15 border-amber-200/70 dark:border-amber-900/30 p-3.5 space-y-1.5"
          >
            <p className="text-sm text-foreground">{c.body}</p>
            <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              <Link href={`/sites/${c.site_id}`} className="hover:underline">
                {c.site_name}
              </Link>
              <span>· noté {relTime(c.notedAt)}</span>
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
