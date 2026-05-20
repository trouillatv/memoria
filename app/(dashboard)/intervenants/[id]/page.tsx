// Page Intervenant détail — vue descriptive opérationnelle.
//
// Vincent 2026-05-21 — TRANSGRESSION DOCTRINALE ASSUMÉE.
// Doctrine source : mémoire projet `page-personne-pivot-transgression`.
//
// Garde-fous techniques appliqués (les 6 du pivot) :
//   #1 Audit log obligatoire à chaque consultation (logAuditEvent)
//   #2 Pas de score numérique calculé — uniquement compteurs descriptifs
//   #3 Pas de comparaison côte à côte — une seule personne par page
//   #4 Wording descriptif uniquement
//   #5 Kill switch ENV `INTERVENANTS_PAGE_ENABLED` — 404 si désactivé
//   #6 Allowlist user_id : agrégats dans lib/db/intervenants.ts uniquement

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import {
  Calendar, MapPin, FileText, AlertTriangle, Camera, Mic, ArrowRight, FileSignature,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/status-badge'
import { TeamBadge } from '@/components/ui/team-badge'
import { checkIntervenantsPageAccess } from '@/lib/intervenants/access'
import {
  getIntervenantOverview,
  listIntervenantSitesAccumulated,
  listIntervenantContractsKnown,
  listIntervenantRecentInterventions,
  getIntervenantTracesSummary,
  getIntervenantHeatmap,
} from '@/lib/db/intervenants'
import { logAuditEvent } from '@/lib/audit/log'
import { formatInterventionTimeLabel } from '@/lib/time/prestation-slot'
import type { InterventionSlot } from '@/types/db'

export const dynamic = 'force-dynamic'

const MONTHS_FR_LONG = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

function formatDateFr(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return iso
    return `${date.getUTCDate()} ${MONTHS_FR_LONG[date.getUTCMonth()] ?? ''} ${date.getUTCFullYear()}`
  }
  return `${d} ${MONTHS_FR_LONG[m - 1] ?? ''} ${y}`
}

function roleLabelFr(role: string): string {
  switch (role) {
    case 'admin': return 'Administrateur'
    case 'manager': return 'Manager'
    case 'chef_equipe': return "Chef d'équipe"
    default: return role
  }
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function IntervenantDetailPage({ params }: Props) {
  const { id: targetId } = await params

  const access = await checkIntervenantsPageAccess(targetId)
  if (!access.allowed) {
    if (access.reason === 'unauthenticated') redirect('/login')
    notFound()
  }

  const [overview, sites, contracts, recent, traces, heatmap] = await Promise.all([
    getIntervenantOverview(targetId),
    listIntervenantSitesAccumulated(targetId),
    listIntervenantContractsKnown(targetId),
    listIntervenantRecentInterventions(targetId, 20),
    getIntervenantTracesSummary(targetId),
    getIntervenantHeatmap(targetId, 90),
  ])

  if (!overview) notFound()

  // Audit log obligatoire — sauf self-consultation.
  if (!access.access.isSelf) {
    await logAuditEvent({
      userId: access.access.viewer.id,
      entityType: 'user',
      entityId: targetId,
      action: 'opened',
      metadata: {
        kind: 'intervenants_page_consulted',
        viewer_role: access.access.viewer.role,
        target_id: targetId,
      },
    })
  }

  const displayName = overview.full_name ?? overview.email

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Bandeau pivot doctrinal */}
      <div
        role="note"
        className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-900/90 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200/90"
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
        <p>
          Vue opérationnelle descriptive — <strong>jamais évaluative</strong>. Les chiffres
          sont des faits accumulés, pas des scores ni des classements. Cette consultation
          est tracée dans le journal d&apos;activité.
        </p>
      </div>

      {/* ── Section 1 : Identité opérationnelle ─────────────────────────── */}
      <header className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold">{displayName}</h1>
          <Badge variant="outline" className="text-xs">
            {roleLabelFr(overview.role)}
          </Badge>
          {access.access.isSelf && (
            <Badge variant="outline" className="text-xs bg-sky-50 border-sky-200 text-sky-900">
              Votre propre page
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" />
            Inscrit le {formatDateFr(overview.created_at)}
          </span>
        </div>
        {overview.teams.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground">Équipes actives :</span>
            {overview.teams.map((t) => (
              <TeamBadge
                key={t.team_id}
                name={t.team_name}
                color={t.team_color}
                size="sm"
              />
            ))}
          </div>
        )}
      </header>

      {/* ── Section 2 : Compteurs descriptifs ─────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Présence cumulée</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Interventions</dt>
              <dd className="text-2xl font-semibold tabular-nums">
                {overview.counters.interventionsParticipated.toLocaleString('fr-FR')}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Sites connus</dt>
              <dd className="text-2xl font-semibold tabular-nums">
                {overview.counters.sitesKnown.toLocaleString('fr-FR')}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Contrats</dt>
              <dd className="text-2xl font-semibold tabular-nums">
                {overview.counters.contractsKnown.toLocaleString('fr-FR')}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Traces déposées</dt>
              <dd className="text-2xl font-semibold tabular-nums">
                {(
                  overview.counters.notesLeft +
                  overview.counters.anomaliesSignaled +
                  overview.counters.photosTaken +
                  overview.counters.voiceNotesRecorded
                ).toLocaleString('fr-FR')}
              </dd>
            </div>
          </dl>

          {/* Heatmap calendrier 90 jours — points colorés par densité d'interventions */}
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              Activité des 90 derniers jours
            </h3>
            <HeatmapCalendar cells={heatmap} days={90} />
            {traces.lastTraceAt && (
              <p className="text-[11px] text-muted-foreground">
                Dernière trace déposée : {formatDateFr(traces.lastTraceAt.slice(0, 10))}.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Section 3 : Sites connus (avec thumbnails photos) ────────────── */}
      {sites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base inline-flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Sites connus ({sites.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {sites.map((s) => (
                <li key={s.site_id} className="px-6 py-3">
                  <Link
                    href={`/sites/${s.site_id}`}
                    className="flex items-start gap-3 hover:bg-muted/30 -mx-6 px-6 py-1 -my-1 transition-colors group"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{s.site_name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {s.contract_name ?? '—'} ·{' '}
                        <span className="tabular-nums">
                          {s.interventionCount} intervention{s.interventionCount > 1 ? 's' : ''}
                        </span>
                        {s.firstParticipationDate && s.lastParticipationDate && (
                          <>
                            {' · '}
                            <span className="tabular-nums">
                              {formatDateFr(s.firstParticipationDate)} → {formatDateFr(s.lastParticipationDate)}
                            </span>
                          </>
                        )}
                      </div>
                      {s.recentPhotoIds.length > 0 && (
                        <p className="text-[11px] text-muted-foreground/70 mt-1">
                          {s.recentPhotoIds.length} photo{s.recentPhotoIds.length > 1 ? 's' : ''} récente
                          {s.recentPhotoIds.length > 1 ? 's' : ''}
                        </p>
                      )}
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 mt-1 text-muted-foreground/60 group-hover:text-foreground transition-colors" />
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ── Section 4 : Contrats déjà travaillés ─────────────────────────── */}
      {contracts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base inline-flex items-center gap-2">
              <FileSignature className="h-4 w-4" />
              Contrats déjà travaillés ({contracts.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {contracts.map((c) => (
                <li key={c.contract_id} className="px-6 py-3">
                  <Link
                    href={`/contracts/${c.contract_id}`}
                    className="flex items-start gap-3 hover:bg-muted/30 -mx-6 px-6 py-1 -my-1 transition-colors group"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{c.contract_name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {c.client_name ?? '—'} ·{' '}
                        <span className="tabular-nums">
                          {c.interventionCount} intervention{c.interventionCount > 1 ? 's' : ''}
                        </span>
                        {c.firstParticipationDate && c.lastParticipationDate && (
                          <>
                            {' · '}
                            <span className="tabular-nums">
                              {formatDateFr(c.firstParticipationDate)} → {formatDateFr(c.lastParticipationDate)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 mt-1 text-muted-foreground/60 group-hover:text-foreground transition-colors" />
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ── Section 5 : 20 dernières interventions (avec plage horaire) ──── */}
      {recent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base inline-flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Interventions récentes ({recent.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {recent.map((i) => {
                const timeLabel = formatInterventionTimeLabel({
                  planned_start: i.planned_start,
                  planned_end: i.planned_end,
                  slot: i.slot as InterventionSlot | null,
                })
                return (
                  <li key={i.intervention_id} className="px-6 py-3">
                    <Link
                      href={`/interventions/${i.intervention_id}`}
                      className="flex items-start gap-3 hover:bg-muted/30 -mx-6 px-6 py-1 -my-1 transition-colors group"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{i.mission_name}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          <span className="font-medium">{i.site_name}</span>
                          {i.scheduled_for && (
                            <>
                              {' · '}
                              <span className="tabular-nums">{formatDateFr(i.scheduled_for)}</span>
                            </>
                          )}
                          {timeLabel && timeLabel !== '—' && (
                            <>
                              {' · '}
                              <span className="tabular-nums font-semibold text-foreground/80">
                                {timeLabel}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <StatusBadge status={i.status} size="md" />
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/60 group-hover:text-foreground transition-colors" />
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ── Section 6 : Traces laissées ──────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Traces laissées</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <li className="inline-flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="tabular-nums font-semibold">{traces.notesLeft}</span>
              <span className="text-muted-foreground">note{traces.notesLeft > 1 ? 's' : ''}</span>
            </li>
            <li className="inline-flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
              <span className="tabular-nums font-semibold">{traces.anomaliesSignaled}</span>
              <span className="text-muted-foreground">anomalie{traces.anomaliesSignaled > 1 ? 's' : ''}</span>
            </li>
            <li className="inline-flex items-center gap-2">
              <Camera className="h-4 w-4 text-muted-foreground" />
              <span className="tabular-nums font-semibold">{traces.photosTaken}</span>
              <span className="text-muted-foreground">photo{traces.photosTaken > 1 ? 's' : ''}</span>
            </li>
            <li className="inline-flex items-center gap-2">
              <Mic className="h-4 w-4 text-muted-foreground" />
              <span className="tabular-nums font-semibold">{traces.voiceNotesRecorded}</span>
              <span className="text-muted-foreground">
                note{traces.voiceNotesRecorded > 1 ? 's' : ''} audio
              </span>
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* État vide */}
      {recent.length === 0 && sites.length === 0 && contracts.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground italic">
            Aucune trace opérationnelle pour le moment.
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// HeatmapCalendar — 90 derniers jours, points colorés par densité.
// ----------------------------------------------------------------------------

interface HeatmapCalendarProps {
  cells: Array<{ date: string; count: number }>
  days: number
}

/**
 * Mini-calendrier façon GitHub : 1 point par jour sur N jours glissants,
 * intensité du gris/brand selon le nombre d'interventions ce jour.
 *
 * Pas un score, pas un classement — juste une visualisation factuelle de
 * la densité temporelle.
 */
function HeatmapCalendar({ cells, days }: HeatmapCalendarProps) {
  const countByDate = new Map(cells.map((c) => [c.date, c.count]))
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const dates: string[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setUTCDate(today.getUTCDate() - i)
    dates.push(d.toISOString().slice(0, 10))
  }

  function intensityClass(count: number): string {
    if (count === 0) return 'bg-muted/40'
    if (count === 1) return 'bg-brand-200'
    if (count === 2) return 'bg-brand-400'
    return 'bg-brand-600'
  }

  // 7 lignes (jours de la semaine), colonnes par semaine
  const weeks: string[][] = []
  let currentWeek: string[] = []
  for (const date of dates) {
    const dow = new Date(date + 'T00:00:00Z').getUTCDay() // 0=Sun
    if (currentWeek.length === 0 && dow !== 1) {
      // padding début pour aligner sur lundi
      for (let i = 1; i <= (dow === 0 ? 6 : dow - 1); i++) {
        currentWeek.push('')
      }
    }
    currentWeek.push(date)
    if (currentWeek.length === 7) {
      weeks.push(currentWeek)
      currentWeek = []
    }
  }
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) currentWeek.push('')
    weeks.push(currentWeek)
  }

  return (
    <div className="flex flex-col gap-1">
      <div
        className="flex gap-1 overflow-x-auto"
        aria-label={`Activité sur ${days} jours`}
      >
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {week.map((date, di) => {
              if (!date) return <div key={di} className="w-3 h-3" />
              const count = countByDate.get(date) ?? 0
              return (
                <div
                  key={date}
                  className={`w-3 h-3 rounded-[2px] ${intensityClass(count)}`}
                  title={`${formatDateFr(date)} : ${count} intervention${count > 1 ? 's' : ''}`}
                />
              )
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>Moins</span>
        <div className="w-2.5 h-2.5 rounded-[2px] bg-muted/40" />
        <div className="w-2.5 h-2.5 rounded-[2px] bg-brand-200" />
        <div className="w-2.5 h-2.5 rounded-[2px] bg-brand-400" />
        <div className="w-2.5 h-2.5 rounded-[2px] bg-brand-600" />
        <span>Plus</span>
      </div>
    </div>
  )
}
