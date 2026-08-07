import { notFound } from 'next/navigation'
import React, { Suspense } from 'react'
import Link from 'next/link'
import { AlertCircle, ArrowLeft, Building2, FileText, Link2, MapPin, User, Users } from 'lucide-react'
import { requireSiteAccess } from '@/lib/field/site-access'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCanonicalSubjectLife } from '@/lib/db/canonical-subject-life'
import type { CanonicalSubjectLife, CanonicalLink, SubjectOccurrenceMerged, MaterializedEvent, MaterializedEntityType } from '@/lib/db/canonical-subject-life'
import { getActorIdentity, getActorResponsibilities } from '@/lib/db/actor-subject-life'
import type { ActorLinkedIdentity, ActorResponsibilities } from '@/lib/db/actor-subject-life'
import { SubjectTrajectorySection, SubjectTrajectorySkeleton } from './SubjectTrajectorySection'
import SubjectContextGraph from './SubjectContextGraph'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ siteId: string; canonicalSubjectId: string }>
}

// ── Display constants ─────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  open:               'Ouvert',
  in_progress:        'En cours',
  planned:            'Planifié',
  done:               'Clôturé',
  non_compliant:      'Non conforme',
  awaiting_validation:'En attente',
  cancelled:          'Annulé',
  informational:      'Informatif',
  field_checked:      'Vérifié terrain',
  still_open:         'Toujours ouvert',
  not_applicable:     'Sans objet',
  mentioned:          'Évoqué en réunion',
}

const STATUS_COLORS: Record<string, string> = {
  done:               'bg-emerald-100 text-emerald-800',
  non_compliant:      'bg-red-100 text-red-700',
  open:               'bg-orange-100 text-orange-700',
  in_progress:        'bg-blue-100 text-blue-700',
  planned:            'bg-sky-100 text-sky-700',
  awaiting_validation:'bg-amber-100 text-amber-700',
  cancelled:          'bg-muted text-muted-foreground',
  informational:      'bg-muted text-muted-foreground',
  field_checked:      'bg-teal-100 text-teal-700',
  still_open:         'bg-orange-100 text-orange-700',
  not_applicable:     'bg-muted text-muted-foreground',
  mentioned:          'bg-violet-100 text-violet-700',
}

const ENTITY_TYPE_META: Record<MaterializedEntityType, { label: string; plural: string; color: string }> = {
  site_action:   { label: 'Action',   plural: 'Actions',   color: 'bg-blue-100 text-blue-700' },
  site_decision: { label: 'Décision', plural: 'Décisions', color: 'bg-violet-100 text-violet-700' },
  site_reserve:  { label: 'Réserve',  plural: 'Réserves',  color: 'bg-red-100 text-red-700' },
  site_deadline: { label: 'Échéance', plural: 'Échéances', color: 'bg-amber-100 text-amber-700' },
}

const ENTITY_STATUS_LABELS: Record<string, string> = {
  open:       'Ouverte',
  done:       'Clôturée',
  cancelled:  'Annulée',
  planned:    'Planifiée',
  actee:      'Actée',
  appliquee:  'Appliquée',
  caduque:    'Caduque',
  proposee:   'Proposée',
  contredite: 'Contredite',
  lifted:     'Levée',
  to_plan:    'À planifier',
  superseded: 'Remplacée',
}

const LINK_LABELS: Record<string, { out: string; in: string }> = {
  requires:   { out: 'nécessite',            in: 'est requis par' },
  enables:    { out: 'permet',               in: 'est rendu possible par' },
  causes:     { out: 'entraîne',             in: 'est causé par' },
  validates:  { out: 'valide',               in: 'est validé par' },
  replaces:   { out: 'remplace',             in: 'est remplacé par' },
  relates_to: { out: 'est associé à',        in: 'est associé à' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function frDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

function frDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ConfirmedRelationsSection({
  links,
  siteId,
  csLabel,
}: {
  links: CanonicalLink[]
  siteId: string
  csLabel: string
}) {
  const confirmed = links.filter((l) => l.status === 'confirmed')
  if (confirmed.length === 0) return null

  return (
    <section>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <Link2 className="h-3 w-3" />
        Relations ({confirmed.length})
      </h2>
      <ul className="space-y-1.5">
        {confirmed.map((l) => {
          const cfg = LINK_LABELS[l.linkType]
          const verb = l.direction === 'outgoing' ? cfg?.out : cfg?.in
          const targetLabel = l.direction === 'outgoing' ? l.toLabel : l.fromLabel
          const targetCsId = l.direction === 'outgoing' ? l.toCanonicalSubjectId : l.fromCanonicalSubjectId
          return (
            <li key={l.id} className="rounded-xl border bg-card px-3 py-2.5">
              <p className="text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">{csLabel}</span>{' '}
                <span>{verb}</span>
              </p>
              {targetCsId ? (
                <Link
                  href={`/m/site/${siteId}/sujets/${targetCsId}`}
                  className="mt-0.5 block text-[13px] font-medium hover:underline"
                >
                  {targetLabel}
                </Link>
              ) : (
                <p className="mt-0.5 text-[13px] font-medium">{targetLabel}</p>
              )}
              {l.justification && (
                <p className="mt-0.5 text-[11px] text-muted-foreground italic">{l.justification}</p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function SourceBadge({ sourceKind }: { sourceKind: SubjectOccurrenceMerged['sourceKind'] }) {
  if (sourceKind === 'field_visit') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700">
        <MapPin className="h-3 w-3" />
        Visite terrain
      </span>
    )
  }
  if (sourceKind === 'meeting') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">
        <Users className="h-3 w-3" />
        Réunion
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
      <FileText className="h-3 w-3" />
      PV
    </span>
  )
}

function OccurrenceRow({ occ, index, total }: { occ: SubjectOccurrenceMerged; index: number; total: number }) {
  const sourceHref =
    occ.sourceKind === 'field_visit' && occ.reportId
      ? `/m/visite/${occ.reportId}/cr`
      : occ.sourceKind === 'meeting' && occ.reportId
        ? `/m/reunion/${occ.reportId}`
        : null

  const statusKey = occ.visitStatus ?? occ.documentStatus
  const statusLabel = statusKey ? (STATUS_LABELS[statusKey] ?? statusKey) : null
  const statusColor = statusKey ? (STATUS_COLORS[statusKey] ?? 'bg-muted text-muted-foreground') : null

  const dotColor =
    occ.sourceKind === 'field_visit'
      ? 'bg-teal-500 ring-teal-200'
      : occ.sourceKind === 'meeting'
        ? 'bg-violet-500 ring-violet-200'
        : 'bg-sky-500 ring-sky-200'

  return (
    <div className="relative pl-8">
      {/* Vertical connector — skip for last item */}
      {index < total - 1 && (
        <div className="absolute left-[11px] top-4 h-full w-px bg-border" />
      )}
      {/* Timeline dot */}
      <span className={cn(
        'absolute left-[7px] top-[7px] h-2.5 w-2.5 rounded-full ring-2 ring-background',
        dotColor,
      )} />

      {/* Date label above card */}
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {frDateShort(occ.effectiveDate)}
      </p>

      {/* Card */}
      <div className="rounded-xl border bg-card px-3.5 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <SourceBadge sourceKind={occ.sourceKind} />
          {statusLabel && statusColor && (
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', statusColor)}>
              {statusLabel}
            </span>
          )}
        </div>

        {occ.label && (
          <p className="mt-2 text-[14px] font-medium leading-snug">{occ.label}</p>
        )}

        {occ.description && (
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground line-clamp-3">
            {occ.description}
          </p>
        )}

        {occ.additionalLabels.length > 0 && (
          <div className="mt-1 space-y-0.5">
            {occ.additionalLabels.slice(0, 2).map((l, i) => (
              <p key={i} className="text-[12px] italic text-muted-foreground">+ {l}</p>
            ))}
          </div>
        )}

        {sourceHref && (
          <Link
            href={sourceHref}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium active:bg-muted transition-colors"
          >
            <FileText className="h-3 w-3" />
            {occ.sourceKind === 'field_visit' ? 'Voir la visite' : 'Voir la réunion'}
          </Link>
        )}
        {!sourceHref && occ.sourcePage != null && (
          <p className="mt-1.5 text-[11px] text-muted-foreground">p. {occ.sourcePage}</p>
        )}
      </div>
    </div>
  )
}

function EventsSection({ events }: { events: MaterializedEvent[] }) {
  const ORDER: MaterializedEntityType[] = ['site_reserve', 'site_action', 'site_decision', 'site_deadline']
  const byType = new Map<MaterializedEntityType, MaterializedEvent[]>()
  for (const e of events) {
    const list = byType.get(e.entityType) ?? []
    list.push(e)
    byType.set(e.entityType, list)
  }

  return (
    <div className="space-y-3">
      {ORDER.filter((t) => byType.has(t)).map((t) => {
        const meta = ENTITY_TYPE_META[t]
        const items = byType.get(t)!
        return (
          <div key={t}>
            <p className="mb-1.5 text-[11px] text-muted-foreground">
              {meta.plural} ({items.length})
            </p>
            <ul className="space-y-1.5">
              {items.map((ev) => (
                <li key={ev.entityId} className="flex items-start gap-2.5 rounded-xl border bg-card px-3 py-2.5">
                  <span className={cn('mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', meta.color)}>
                    {meta.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium leading-snug">{ev.title}</p>
                    {ev.description && (
                      <p className="mt-0.5 text-[12px] text-muted-foreground line-clamp-2">{ev.description}</p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      {ev.date && <span>{frDate(ev.date)}</span>}
                      {ev.status && (
                        <span className={cn(
                          'rounded-full px-1.5 py-0.5',
                          STATUS_COLORS[ev.status] ?? 'bg-muted text-muted-foreground',
                        )}>
                          {ENTITY_STATUS_LABELS[ev.status] ?? ev.status}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

// ── Actor fiche components ────────────────────────────────────────────────────

interface ActorFicheProps {
  life: CanonicalSubjectLife
  identity: ActorLinkedIdentity | null
  resp: ActorResponsibilities | null
  realOccs: SubjectOccurrenceMerged[]
  pills: string[]
}

function ActorIdentityBlock({ identity, label }: { identity: ActorLinkedIdentity; label: string }) {
  const hasDetails =
    identity.kind === 'company'
      ? !!(identity.phone || identity.email || identity.name !== label || identity.shortName)
      : !!(identity.function || identity.companyName || identity.phone || identity.mobile)

  if (!hasDetails) {
    return (
      <p className="mt-2 text-[12px] text-violet-600 dark:text-violet-400">
        Entreprise identifiée dans le répertoire
      </p>
    )
  }

  return (
    <div className="mt-2 space-y-0.5">
      {identity.kind === 'company' ? (
        <>
          {identity.name !== label && (
            <p className="text-[13px] font-medium">{identity.name}</p>
          )}
          {identity.shortName && identity.shortName !== label && identity.shortName !== identity.name && (
            <p className="text-[12px] text-muted-foreground">{identity.shortName}</p>
          )}
          {identity.phone && <p className="text-[12px] text-muted-foreground">{identity.phone}</p>}
          {identity.email && <p className="text-[12px] text-muted-foreground">{identity.email}</p>}
        </>
      ) : (
        <>
          {identity.fullName !== label && (
            <p className="text-[13px] font-medium">{identity.fullName}</p>
          )}
          {identity.function && <p className="text-[12px] text-muted-foreground">{identity.function}</p>}
          {identity.companyName && <p className="text-[12px] text-muted-foreground">{identity.companyName}</p>}
          {(identity.phone ?? identity.mobile) && (
            <p className="text-[12px] text-muted-foreground">{identity.phone ?? identity.mobile}</p>
          )}
        </>
      )}
      {identity.linkSource === 'manual' && identity.linkValidatedAt && (
        <p className="text-[11px] text-violet-600 dark:text-violet-400">
          Lien validé le {frDate(identity.linkValidatedAt)}
        </p>
      )}
    </div>
  )
}

function ActorRolePill({ role }: { role: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-violet-100 px-2.5 py-0.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-900/20 dark:text-violet-300">
      {role}
    </span>
  )
}


function CompactItemList({ items }: { items: { id: string; title: string; sub?: string | null; date?: string | null }[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map(item => (
        <li key={item.id} className="rounded-xl border bg-card px-3 py-2.5">
          <p className="text-[13px] font-medium leading-snug">{item.title}</p>
          {(item.sub || item.date) && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {[item.sub, item.date].filter(Boolean).join(' · ')}
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}

function ActorFicheView({ life, identity, resp, realOccs, pills }: ActorFicheProps) {
  const isCompany = life.primaryFamily === 'company'

  // Active roles only (effective_to IS NULL) — historical ones never shown as current
  const activeRoles = resp?.roles.filter(r => !r.effectiveTo) ?? []
  const primaryRole = activeRoles[0]?.role ?? null

  // Counts
  const openActionsCount   = resp?.openActions.length ?? 0
  const openReservesCount  = resp?.openReserves.length ?? 0
  const openDeadlinesCount = resp?.openDeadlines.length ?? 0
  const totalOpen = openActionsCount + openReservesCount + openDeadlinesCount

  const doneActionsCount  = resp?.doneActions.length ?? 0
  const liftedCount       = resp?.liftedReserves.length ?? 0
  const decisionsCount    = (resp?.openDecisions.length ?? 0) + (resp?.doneDecisions.length ?? 0)
  const totalDone = doneActionsCount + liftedCount + decisionsCount

  const linkedSubjects = resp?.linkedSubjects ?? []
  const lastActivity   = resp?.lastActivityAt ?? life.lastSeenAt

  // Build summary text fragments
  const aFaireFrags = [
    openActionsCount   > 0 ? `${openActionsCount} action${openActionsCount > 1 ? 's' : ''}`   : null,
    openReservesCount  > 0 ? `${openReservesCount} réserve${openReservesCount > 1 ? 's' : ''}` : null,
    openDeadlinesCount > 0 ? `${openDeadlinesCount} échéance${openDeadlinesCount > 1 ? 's' : ''}` : null,
  ].filter(Boolean) as string[]

  const realiseFrags = [
    doneActionsCount > 0 ? `${doneActionsCount} action${doneActionsCount > 1 ? 's' : ''} terminée${doneActionsCount > 1 ? 's' : ''}` : null,
    liftedCount      > 0 ? `${liftedCount} réserve${liftedCount > 1 ? 's' : ''} levée${liftedCount > 1 ? 's' : ''}` : null,
    decisionsCount   > 0 ? `${decisionsCount} décision${decisionsCount > 1 ? 's' : ''}` : null,
  ].filter(Boolean) as string[]

  return (
    <>
      {/* ── 1. Header ── */}
      <header className="rounded-2xl border bg-card px-4 py-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/20 dark:text-violet-300">
            {isCompany ? <Building2 className="h-5 w-5" aria-hidden /> : <User className="h-5 w-5" aria-hidden />}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold leading-snug">{life.label}</h1>
            <div className="mt-1 flex flex-wrap gap-1">
              {primaryRole
                ? <ActorRolePill role={primaryRole} />
                : <span className="text-[12px] text-muted-foreground">
                    {isCompany ? 'Entreprise intervenante' : 'Acteur du chantier'}
                  </span>
              }
              {activeRoles.length > 1 && activeRoles.slice(1).map(r => (
                <ActorRolePill key={r.id} role={r.role} />
              ))}
            </div>
          </div>
        </div>

        {identity && <ActorIdentityBlock identity={identity} label={life.label} />}

        {life.threadIds.length > 1 && (
          <p className="mt-2.5 text-[11px] text-muted-foreground/60">
            {life.threadIds.length} formulations regroupées
          </p>
        )}
        <div className="mt-2 space-y-0.5">
          {pills.length > 0 && <p className="text-[12px] text-muted-foreground">{pills.join(' · ')}</p>}
          {lastActivity
            ? <p className="text-[12px] text-muted-foreground">Dernière activité le {frDate(lastActivity)}</p>
            : life.firstSeenAt
              ? <p className="text-[12px] text-muted-foreground">Première mention le {frDate(life.firstSeenAt)}</p>
              : null
          }
        </div>
      </header>

      {/* ── 2. Synthèse compacte ── */}
      {(totalOpen > 0 || totalDone > 0) && (
        <div className="rounded-2xl border bg-card px-4 shadow-sm divide-y">
          {totalOpen > 0 && (
            <div className="flex items-baseline gap-3 py-3">
              <span className="shrink-0 text-[12px] font-semibold text-orange-700 w-16">À faire</span>
              <p className="text-[13px] text-foreground">{aFaireFrags.join(' · ')}</p>
            </div>
          )}
          {totalDone > 0 && (
            <div className="flex items-baseline gap-3 py-3">
              <span className="shrink-0 text-[12px] font-semibold text-emerald-700 w-16">Réalisé</span>
              <p className="text-[13px] text-foreground">{realiseFrags.join(' · ')}</p>
            </div>
          )}
        </div>
      )}

      {/* ── 3. Sujets principaux ── */}
      {linkedSubjects.length > 0 && (
        <section>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Sujets concernés
          </h2>
          <div className="flex flex-wrap gap-2">
            {linkedSubjects.map(s => (
              <span key={s.canonicalSubjectId}
                className="rounded-full border bg-card px-3 py-1.5 text-[13px] font-medium">
                {s.label}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* ── 4. Détail : actions ouvertes ── */}
      {openActionsCount > 0 && (
        <section>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Actions ouvertes ({openActionsCount})
          </h2>
          <CompactItemList items={resp!.openActions.map(a => ({
            id: a.id,
            title: a.title,
            sub: a.status === 'planned' ? 'Planifiée' : a.status === 'in_progress' ? 'En cours' : null,
            date: a.dueDate ? `échéance ${frDateShort(a.dueDate)}` : null,
          }))} />
        </section>
      )}

      {/* ── 5. Détail : réserves ouvertes ── */}
      {openReservesCount > 0 && (
        <section>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Réserves sous responsabilité ({openReservesCount})
          </h2>
          <CompactItemList items={resp!.openReserves.map(r => ({
            id: r.id,
            title: r.label,
            sub: r.location,
            date: r.issuedOn ? `émise le ${frDateShort(r.issuedOn)}` : null,
          }))} />
        </section>
      )}

      {/* ── 6. Détail : échéances ouvertes ── */}
      {openDeadlinesCount > 0 && (
        <section>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Échéances ({openDeadlinesCount})
          </h2>
          <CompactItemList items={resp!.openDeadlines.map(d => ({
            id: d.id,
            title: d.title,
            sub: d.status === 'to_plan' ? 'À planifier' : 'Planifiée',
            date: d.dueDate ? frDateShort(d.dueDate) : null,
          }))} />
        </section>
      )}

      {/* ── 7. Détail : actions terminées (3 max + overflow) ── */}
      {doneActionsCount > 0 && (
        <section>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Actions terminées ({doneActionsCount})
          </h2>
          <CompactItemList items={resp!.doneActions.slice(0, 3).map(a => ({
            id: a.id,
            title: a.title,
            date: a.doneAt ? `clôturée le ${frDateShort(a.doneAt)}` : null,
          }))} />
          {doneActionsCount > 3 && (
            <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
              + {doneActionsCount - 3} autres
            </p>
          )}
        </section>
      )}

      {/* ── 8. Présence sur le chantier ── */}
      {realOccs.length > 0 ? (
        <section>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Présence sur le chantier
          </h2>
          <ol className="space-y-4">
            {realOccs.map((occ, i) => (
              <li key={`${occ.runId ?? occ.reportId}-${i}`}>
                <OccurrenceRow occ={occ} index={i} total={realOccs.length} />
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-[13px] text-muted-foreground">
          Aucune occurrence enregistrée pour cet acteur.
        </p>
      )}
    </>
  )
}

// Statuts considérés comme "actifs" (objet encore en cours / à traiter)
const ACTIVE_STATUSES = new Set([
  'open', 'in_progress', 'to_plan', 'planned', 'non_compliant',
  'still_open', 'awaiting_validation', 'proposee',
])

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function SubjectLifeMobilePage({ params }: PageProps) {
  const { siteId, canonicalSubjectId } = await params
  await requireSiteAccess(siteId)

  const [life, siteRow, actorIdentity, actorResp] = await Promise.all([
    getCanonicalSubjectLife(canonicalSubjectId).catch(() => null),
    createAdminClient().from('sites').select('name').eq('id', siteId).single()
      .then(({ data }) => data as { name: string } | null, () => null as null),
    getActorIdentity(canonicalSubjectId).catch(() => null as ActorLinkedIdentity | null),
    getActorResponsibilities(siteId, canonicalSubjectId).catch(() => null as ActorResponsibilities | null),
  ])
  if (!life || life.siteId !== siteId) notFound()

  const realOccs = life.occurrences
    .filter((o) => !o.isGap)
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))

  const visitCount   = realOccs.filter((o) => o.sourceKind === 'field_visit').length
  const meetingCount = realOccs.filter((o) => o.sourceKind === 'meeting').length

  const pills: string[] = []
  if (life.pvCount > 0)    pills.push(`${life.pvCount} PV`)
  if (visitCount > 0)      pills.push(`${visitCount} visite${visitCount > 1 ? 's' : ''} terrain`)
  if (meetingCount > 0)    pills.push(`${meetingCount} réunion${meetingCount > 1 ? 's' : ''}`)

  const latestOcc        = realOccs.length > 0 ? realOccs[realOccs.length - 1] : null
  const currentStateText = latestOcc?.description ?? latestOcc?.label ?? null
  const activeEvents     = life.materializedEvents.filter((e) => !e.status || ACTIVE_STATUSES.has(e.status))

  void siteRow // utilisé uniquement si l'orbe est réintégré plus tard

  // Acteur du chantier : rendu différencié, pas de trajectoire ni de stagnation
  const isActorSubject = life.primaryFamily === 'person' || life.primaryFamily === 'company'

  // Mirrors computeAttentionSignals() — lib/subjects/attention.ts
  const isClosedSubject      = new Set(['done', 'cancelled', 'not_applicable']).has(life.currentStatus ?? '')
  const isOperationalKind    = !new Set(['person', 'company', 'knowledge_fact']).has(life.primaryFamily ?? '')
  const watchReasons: Array<'open_objects' | 'non_conformity' | 'reservation' | 'awaiting' | 'stagnant'> = []
  if (isOperationalKind && !isClosedSubject) {
    if (activeEvents.length > 0)                       watchReasons.push('open_objects')
    if (life.currentStatus === 'non_compliant')         watchReasons.push('non_conformity')
    if (life.primaryFamily === 'reservation')           watchReasons.push('reservation')
    if (life.currentStatus === 'awaiting_validation')   watchReasons.push('awaiting')
    if (life.isStagnant)                               watchReasons.push('stagnant')
  }

  return (
    <div className="mx-auto max-w-md space-y-5 px-4 pb-28 pt-5">

      {/* Back */}
      <Link
        href={`/m/site/${siteId}/sujets`}
        className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground active:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Sujets
      </Link>

      {isActorSubject ? (
        <ActorFicheView
          life={life}
          identity={actorIdentity}
          resp={actorResp}
          realOccs={realOccs}
          pills={pills}
        />
      ) : (
        <>
          {/* Header sujet opérationnel */}
          <header className="rounded-2xl border bg-card px-4 py-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <h1 className="min-w-0 text-lg font-semibold leading-snug">{life.label}</h1>
              {life.currentStatus && (
                <span className={cn(
                  'shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium',
                  STATUS_COLORS[life.currentStatus] ?? 'bg-muted text-muted-foreground',
                )}>
                  {STATUS_LABELS[life.currentStatus] ?? life.currentStatus}
                </span>
              )}
            </div>

            {life.threadIds.length > 1 && (
              <p className="mt-0.5 text-[11px] text-muted-foreground/60">
                {life.threadIds.length} formulations regroupées
              </p>
            )}
            {pills.length > 0 && (
              <p className="mt-2.5 text-[12px] text-muted-foreground">{pills.join(' · ')}</p>
            )}
            {life.firstSeenAt && (
              <p className="mt-1 text-[12px] text-muted-foreground">
                Apparu le {frDate(life.firstSeenAt)}
              </p>
            )}
          </header>

          {/* 1 — Situation actuelle */}
          {currentStateText && (
            <section className="rounded-2xl border bg-card px-4 py-3 shadow-sm">
              <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Situation actuelle
              </h2>
              <p className="text-[14px] leading-snug">{currentStateText}</p>
              {latestOcc && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {latestOcc.sourceKind === 'field_visit'
                    ? `Visite du ${frDateShort(latestOcc.effectiveDate)}`
                    : latestOcc.sourceKind === 'meeting'
                      ? `Réunion du ${frDateShort(latestOcc.effectiveDate)}`
                      : `PV du ${frDateShort(latestOcc.effectiveDate)}`}
                </p>
              )}
            </section>
          )}

          {/* 2 — Ce qui s'est passé (trajectoire synthétique — async, ne bloque pas la page) */}
          <Suspense fallback={<SubjectTrajectorySkeleton />}>
            <SubjectTrajectorySection life={life} />
          </Suspense>

          {/* Autour de ce sujet — mini-graphe des relations confirmées */}
          <SubjectContextGraph
            links={life.links}
            currentSubjectId={canonicalSubjectId}
            currentSubjectLabel={life.label}
            siteId={siteId}
          />

          {/* 3 — À surveiller (multi-signal) */}
          {watchReasons.length > 0 && (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-sm">
              <div className="flex items-center gap-2 mb-1.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                <h2 className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                  À surveiller
                </h2>
              </div>
              <p className="text-[13px] leading-snug text-amber-900">
                {[
                  watchReasons.includes('open_objects')
                    ? `${activeEvents.length} objet${activeEvents.length > 1 ? 's' : ''} actif${activeEvents.length > 1 ? 's' : ''}`
                    : null,
                  watchReasons.includes('non_conformity') ? 'non conforme' : null,
                  watchReasons.includes('reservation')    ? 'réserve ouverte' : null,
                  watchReasons.includes('awaiting')       ? 'en attente de validation' : null,
                  watchReasons.includes('stagnant') && life.stagnationDays
                    ? `sans évolution depuis ${life.stagnationDays} j`
                    : null,
                ].filter(Boolean).join(' · ')}
              </p>
              {watchReasons.includes('stagnant') && life.firstSeenAt && life.stagnationDays !== null && (
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  Mentionné{realOccs.length > 1 ? ` ${realOccs.length} fois` : ''} depuis le {frDate(life.firstSeenAt)}.
                </p>
              )}
            </section>
          )}

          {/* 4 — Objets actifs */}
          {activeEvents.length > 0 && (
            <section>
              <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Objets actifs
              </h2>
              <EventsSection events={activeEvents} />
            </section>
          )}

          {/* 5 — Relations confirmées */}
          <ConfirmedRelationsSection links={life.links} siteId={siteId} csLabel={life.label} />

          {/* 6 — Ligne de vie */}
          {realOccs.length > 0 ? (
            <section>
              <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Ligne de vie
              </h2>
              <ol className="space-y-4">
                {realOccs.map((occ, i) => (
                  <li key={`${occ.runId ?? occ.reportId}-${i}`}>
                    <OccurrenceRow occ={occ} index={i} total={realOccs.length} />
                  </li>
                ))}
              </ol>
            </section>
          ) : (
            <p className="rounded-xl border border-dashed px-4 py-8 text-center text-[13px] text-muted-foreground">
              Aucune occurrence enregistrée pour ce sujet.
            </p>
          )}
        </>
      )}

    </div>
  )
}
