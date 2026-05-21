// Page Intervenant détail — vue descriptive opérationnelle, refonte visuelle
// inspirée de /sites/[id] (Vincent 2026-05-21).
//
// TRANSGRESSION DOCTRINALE ASSUMÉE — cf. mémoire `page-personne-pivot-transgression`.
// Garde-fous techniques en place :
//   #1 Audit log obligatoire à chaque consultation
//   #2 Pas de score numérique calculé
//   #3 Pas de comparaison côte à côte
//   #4 Wording strictement descriptif
//   #5 Kill switch ENV INTERVENANTS_PAGE_ENABLED
//   #6 Allowlist user_id confinée dans lib/db/intervenants.ts

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import {
  Calendar,
  MapPin,
  FileText,
  AlertTriangle,
  Camera,
  Mic,
  ArrowRight,
  FileSignature,
  UserCircle,
  Phone,
  Mail,
  BriefcaseBusiness,
  Users as UsersIcon,
  History,
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
  listIntervenantRecentPhotos,
  getIntervenantTeamsHistory,
  listIntervenantCollaborators,
  listIntervenantIncidentsPresence,
} from '@/lib/db/intervenants'
import { logAuditEvent } from '@/lib/audit/log'
import { formatInterventionTimeLabel } from '@/lib/time/prestation-slot'
import { IntervenantPhotoGallery } from './IntervenantPhotoGallery'
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

function employmentLabelFr(type: 'cdi' | 'cdd' | 'cdi_chantier' | null): string {
  switch (type) {
    case 'cdi': return 'CDI'
    case 'cdd': return 'CDD'
    case 'cdi_chantier': return 'CDI Chantier'
    default: return '—'
  }
}

function initialsOf(label: string | null): string {
  if (!label) return '?'
  const parts = label.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase()
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

  const [overview, sites, contracts, recent, traces, heatmap, photos, teamsHistory, collaborators, incidents] = await Promise.all([
    getIntervenantOverview(targetId),
    listIntervenantSitesAccumulated(targetId),
    listIntervenantContractsKnown(targetId),
    listIntervenantRecentInterventions(targetId, 20),
    getIntervenantTracesSummary(targetId),
    getIntervenantHeatmap(targetId, 90),
    listIntervenantRecentPhotos(targetId, 12),
    getIntervenantTeamsHistory(targetId, 24), // 2 ans
    listIntervenantCollaborators(targetId, 24), // 2 ans
    listIntervenantIncidentsPresence(targetId, 20),
  ])

  if (!overview) notFound()

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
  const initials = initialsOf(overview.full_name ?? overview.email.split('@')[0] ?? null)

  return (
    <div className="space-y-6 max-w-5xl">
      <Link
        href="/intervenants"
        className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1"
      >
        ← Intervenants
      </Link>

      {/* ── Bandeau pivot doctrinal — discret, en haut ─────────────────── */}
      <div
        role="note"
        className="flex items-start gap-2 rounded-md border border-amber-200/70 bg-amber-50/40 px-3 py-1.5 text-[11px] text-amber-900/80 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-200/70"
      >
        <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" aria-hidden />
        <p>
          Vue descriptive opérationnelle — chiffres = faits cumulés, jamais scores ni
          classements. Consultation tracée.
        </p>
      </div>

      {/* ── Header hero — avatar initiales + nom + identité opérationnelle */}
      <header className="flex items-start gap-4 flex-wrap">
        <div className="shrink-0 h-16 w-16 rounded-full bg-brand-50 dark:bg-brand-600/10 border border-brand-200 dark:border-brand-700/40 flex items-center justify-center text-lg font-semibold text-brand-700 dark:text-brand-300">
          {initials}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-semibold">{displayName}</h1>
            <Badge variant="outline" className="text-xs inline-flex items-center gap-1">
              <UserCircle className="h-3 w-3" />
              {roleLabelFr(overview.role)}
            </Badge>
            {overview.employment_type && (
              <Badge
                variant="outline"
                className="text-xs inline-flex items-center gap-1 bg-slate-50 dark:bg-slate-950/20"
                title="Type de contrat"
              >
                <BriefcaseBusiness className="h-3 w-3" />
                {employmentLabelFr(overview.employment_type)}
              </Badge>
            )}
            {access.access.isSelf && (
              <Badge
                variant="outline"
                className="text-xs bg-sky-50 border-sky-200 text-sky-900 dark:bg-sky-950/30 dark:border-sky-800 dark:text-sky-200"
              >
                Votre propre page
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
            <span className="inline-flex items-center gap-1">
              <Mail className="h-3 w-3" />
              {overview.email}
            </span>
            {overview.phone && (
              <a
                href={`tel:${overview.phone}`}
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                <Phone className="h-3 w-3" />
                {overview.phone}
              </a>
            )}
            {overview.commune && (
              <span className="inline-flex items-center gap-1" title="Commune de résidence">
                <MapPin className="h-3 w-3" />
                {overview.commune}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Inscrit le {formatDateFr(overview.created_at)}
            </span>
          </div>
          {overview.teams.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-muted-foreground">Équipes :</span>
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
        </div>
      </header>

      {/* ── Stats inline (style /sites/[id] CurrentState — sans card wrapper) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pb-3 border-b border-border/40">
        <Stat
          icon={Calendar}
          value={overview.counters.interventionsParticipated}
          label="interventions"
        />
        <Stat
          icon={MapPin}
          value={overview.counters.sitesKnown}
          label={overview.counters.sitesKnown > 1 ? 'sites connus' : 'site connu'}
        />
        <Stat
          icon={FileSignature}
          value={overview.counters.contractsKnown}
          label={overview.counters.contractsKnown > 1 ? 'contrats' : 'contrat'}
        />
        <Stat
          icon={Camera}
          value={
            overview.counters.notesLeft +
            overview.counters.anomaliesSignaled +
            overview.counters.photosTaken +
            overview.counters.voiceNotesRecorded
          }
          label="traces"
        />
      </div>

      {/* ── Galerie photos (NOUVEAU — manquait dans la première version) ── */}
      {photos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base inline-flex items-center gap-2">
              <Camera className="h-4 w-4" />
              Photos déposées ({photos.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <IntervenantPhotoGallery photos={photos} />
          </CardContent>
        </Card>
      )}

      {/* ── Heatmap calendrier — pleine largeur, lisible ─────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activité sur 90 jours</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <HeatmapCalendar cells={heatmap} days={90} />
          {traces.lastTraceAt && (
            <p className="text-[11px] text-muted-foreground">
              Dernière trace déposée : {formatDateFr(traces.lastTraceAt.slice(0, 10))}.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Grid 2 cols : Sites connus | Contrats travaillés ─────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base inline-flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Sites connus ({sites.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {sites.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground italic">Aucun site.</p>
            ) : (
              <ul className="divide-y">
                {sites.slice(0, 8).map((s) => (
                  <li key={s.site_id} className="px-6 py-2.5">
                    <Link
                      href={`/sites/${s.site_id}`}
                      className="flex items-start gap-2 hover:bg-muted/30 -mx-6 px-6 py-1 -my-1 transition-colors group"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{s.site_name}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                          <span className="tabular-nums font-medium text-foreground/70">
                            {s.interventionCount}
                          </span>{' '}
                          {s.interventionCount > 1 ? 'passages' : 'passage'}
                          {s.lastParticipationDate && (
                            <>
                              {' · '}dernier {formatDateFr(s.lastParticipationDate)}
                            </>
                          )}
                          {s.contract_name && (
                            <>
                              {' · '}
                              <span className="text-muted-foreground/80">{s.contract_name}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <ArrowRight className="h-3 w-3 mt-1 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
                    </Link>
                  </li>
                ))}
                {sites.length > 8 && (
                  <li className="px-6 py-2 text-[11px] text-muted-foreground italic">
                    + {sites.length - 8} autres sites
                  </li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base inline-flex items-center gap-2">
              <FileSignature className="h-4 w-4" />
              Contrats ({contracts.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {contracts.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground italic">Aucun contrat.</p>
            ) : (
              <ul className="divide-y">
                {contracts.slice(0, 8).map((c) => (
                  <li key={c.contract_id} className="px-6 py-2.5">
                    <Link
                      href={`/contracts/${c.contract_id}`}
                      className="flex items-start gap-2 hover:bg-muted/30 -mx-6 px-6 py-1 -my-1 transition-colors group"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{c.contract_name}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                          {c.client_name && <span>{c.client_name} · </span>}
                          <span className="tabular-nums font-medium text-foreground/70">
                            {c.interventionCount}
                          </span>{' '}
                          {c.interventionCount > 1 ? 'interventions' : 'intervention'}
                          {c.lastParticipationDate && (
                            <>
                              {' · '}dernière {formatDateFr(c.lastParticipationDate)}
                            </>
                          )}
                        </div>
                      </div>
                      <ArrowRight className="h-3 w-3 mt-1 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
                    </Link>
                  </li>
                ))}
                {contracts.length > 8 && (
                  <li className="px-6 py-2 text-[11px] text-muted-foreground italic">
                    + {contracts.length - 8} autres contrats
                  </li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Historique équipes (2 ans, incl. quittées) ───────────────────── */}
      {teamsHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base inline-flex items-center gap-2">
              <History className="h-4 w-4" />
              Équipes fréquentées (2 ans) — {teamsHistory.length}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {teamsHistory.map((t) => (
                <li key={t.team_id + '-' + (t.joinedAt ?? '')} className="px-6 py-2.5">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
                      <TeamBadge name={t.team_name} color={t.team_color} size="sm" />
                      {t.isCurrent ? (
                        <Badge variant="outline" className="text-[10px] bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-200">
                          actuelle
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground italic">
                          quittée
                        </Badge>
                      )}
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {t.joinedAt && <>depuis {formatDateFr(t.joinedAt.slice(0, 10))}</>}
                        {t.leftAt && <> → {formatDateFr(t.leftAt.slice(0, 10))}</>}
                      </span>
                    </div>
                    {t.interventionsCount > 0 && (
                      <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                        <span className="font-medium text-foreground/70">{t.interventionsCount}</span>{' '}
                        intervention{t.interventionsCount > 1 ? 's' : ''} sur 2 ans
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ── Collaborateurs (équipes partagées 2 ans) ─────────────────────── */}
      {collaborators.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base inline-flex items-center gap-2">
              <UsersIcon className="h-4 w-4" />
              A travaillé avec ({collaborators.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {collaborators.slice(0, 20).map((c) => {
                const name = c.full_name ?? c.email
                return (
                  <li key={c.user_id} className="px-6 py-2.5">
                    <Link
                      href={`/intervenants/${c.user_id}`}
                      className="flex items-center gap-3 hover:bg-muted/30 -mx-6 px-6 py-1 -my-1 transition-colors group"
                    >
                      <div className="shrink-0 h-8 w-8 rounded-full bg-muted border flex items-center justify-center text-[10px] font-semibold text-muted-foreground">
                        {initialsOf(name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate inline-flex items-center gap-2">
                          {name}
                          {c.currentlySharedTeam && (
                            <Badge variant="outline" className="text-[10px] bg-sky-50 border-sky-200 text-sky-900 dark:bg-sky-950/30 dark:border-sky-800 dark:text-sky-200">
                              équipe actuelle
                            </Badge>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          via {c.sharedTeams.slice(0, 3).join(' · ')}
                          {c.sharedTeams.length > 3 && ` · +${c.sharedTeams.length - 3}`}
                        </div>
                      </div>
                      <ArrowRight className="h-3 w-3 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
                    </Link>
                  </li>
                )
              })}
              {collaborators.length > 20 && (
                <li className="px-6 py-2 text-[11px] text-muted-foreground italic">
                  + {collaborators.length - 20} autres
                </li>
              )}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ── Présence lors d'incidents (anomalies sur ses interventions) ──── */}
      {incidents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base inline-flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-300" />
              Présence lors d&apos;incidents ({incidents.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {incidents.map((i) => (
                <li key={i.anomaly_id} className="px-6 py-2.5">
                  <Link
                    href={`/interventions/${i.intervention_id}`}
                    className="flex items-start gap-3 hover:bg-muted/30 -mx-6 px-6 py-1 -my-1 transition-colors group"
                  >
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm truncate">
                        {i.description}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        <span className="font-medium">{i.site_name}</span>
                        {i.scheduled_for && (
                          <>
                            {' · '}
                            <span className="tabular-nums">{formatDateFr(i.scheduled_for)}</span>
                          </>
                        )}
                        {i.signaledBySelf && (
                          <>
                            {' · '}
                            <span className="italic text-foreground/70">signalée par cette personne</span>
                          </>
                        )}
                      </div>
                    </div>
                    <ArrowRight className="h-3 w-3 mt-1 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ── Activité récente (20 dernières) avec plage horaire ───────────── */}
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
                  <li key={i.intervention_id} className="px-6 py-2.5">
                    <Link
                      href={`/interventions/${i.intervention_id}`}
                      className="flex items-center gap-3 hover:bg-muted/30 -mx-6 px-6 py-1 -my-1 transition-colors group"
                    >
                      {/* Heure à gauche, largeur fixe pour alignement */}
                      <span
                        className="text-xs font-mono tabular-nums text-muted-foreground shrink-0 w-14 text-right"
                        title="Horaire de prestation"
                      >
                        {timeLabel}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{i.mission_name}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {i.site_name}
                          {i.scheduled_for && (
                            <>
                              {' · '}
                              <span className="tabular-nums">{formatDateFr(i.scheduled_for)}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <StatusBadge status={i.status} size="sm" />
                      <ArrowRight className="h-3 w-3 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ── Traces laissées (résumé compact en fin) ──────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Traces laissées</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <TraceCell icon={FileText} value={traces.notesLeft} singular="note" plural="notes" />
            <TraceCell
              icon={AlertTriangle}
              value={traces.anomaliesSignaled}
              singular="anomalie"
              plural="anomalies"
            />
            <TraceCell
              icon={Camera}
              value={traces.photosTaken}
              singular="photo"
              plural="photos"
            />
            <TraceCell
              icon={Mic}
              value={traces.voiceNotesRecorded}
              singular="note audio"
              plural="notes audio"
            />
          </ul>
        </CardContent>
      </Card>

      {recent.length === 0 && sites.length === 0 && contracts.length === 0 && photos.length === 0 && (
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
// Sous-composants
// ----------------------------------------------------------------------------

function Stat({
  icon: Icon,
  value,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>
  value: number
  label: string
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wider">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="text-3xl font-semibold tabular-nums mt-1">
        {value.toLocaleString('fr-FR')}
      </div>
    </div>
  )
}

function TraceCell({
  icon: Icon,
  value,
  singular,
  plural,
}: {
  icon: React.ComponentType<{ className?: string }>
  value: number
  singular: string
  plural: string
}) {
  return (
    <li className="inline-flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="tabular-nums font-semibold">{value}</span>
      <span className="text-muted-foreground">{value > 1 ? plural : singular}</span>
    </li>
  )
}

interface HeatmapCalendarProps {
  cells: Array<{ date: string; count: number }>
  days: number
}

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

  const weeks: string[][] = []
  let currentWeek: string[] = []
  for (const date of dates) {
    const dow = new Date(date + 'T00:00:00Z').getUTCDay()
    if (currentWeek.length === 0 && dow !== 1) {
      for (let i = 1; i <= (dow === 0 ? 6 : dow - 1); i++) currentWeek.push('')
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
      <div className="flex gap-1 overflow-x-auto" aria-label={`Activité sur ${days} jours`}>
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
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-1">
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
