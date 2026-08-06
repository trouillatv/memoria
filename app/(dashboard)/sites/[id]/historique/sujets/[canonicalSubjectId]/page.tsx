import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Calendar, Check, FileText, Link2, LayoutList, Trash2, X } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getCanonicalSubjectLife, listActiveCanonicalSubjects } from '@/lib/db/canonical-subject-life'
import type { SubjectOccurrenceMerged, CanonicalLink, MaterializedEvent, MaterializedEntityType, CanonicalSubjectSummary } from '@/lib/db/canonical-subject-life'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'
import { cn } from '@/lib/utils'
import { confirmSuggestedLink, rejectSuggestedLink, createCanonicalLinkAction, deleteCanonicalLinkAction } from './link-actions'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string; canonicalSubjectId: string }>
}

// ── Constantes d'affichage ────────────────────────────────────────────────────

const FAMILY_LABELS: Record<string, string> = {
  observation: 'Observation',
  reservation: 'Réserve',
  non_conformity: 'Non-conformité',
  action: 'Action',
  decision: 'Décision',
  knowledge_fact: 'Fait de connaissance',
  deadline: 'Échéance',
  person: 'Personne',
  company: 'Entreprise',
}

const STATUS_LABELS: Record<string, string> = {
  open: 'Ouvert',
  in_progress: 'En cours',
  planned: 'Planifié',
  done: 'Clôturé',
  non_compliant: 'Non conforme',
  awaiting_validation: 'En attente de validation',
  cancelled: 'Annulé',
  informational: 'Informatif',
  // statuts visites terrain
  field_checked:   'Vérifié sur le terrain',
  still_open:      'Toujours ouvert',
  not_applicable:  'Sans objet',
  // statut réunion
  mentioned:       'Évoqué en réunion',
}

const STATUS_COLORS: Record<string, string> = {
  done:               'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  non_compliant:      'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  open:               'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  in_progress:        'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  planned:            'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  awaiting_validation:'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  cancelled:          'bg-muted text-muted-foreground',
  informational:      'bg-muted text-muted-foreground',
  // statuts visites terrain
  field_checked:      'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
  still_open:         'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  not_applicable:     'bg-muted text-muted-foreground',
  // statut réunion
  mentioned:          'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
}

const TRANSITION_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  nouveau:        { label: 'Nouveau',        icon: '+',  color: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  réalisé:        { label: 'Réalisé',        icon: '✓',  color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  levé:           { label: 'Levé',           icon: '✓',  color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  réouvert:       { label: 'Réouvert',       icon: '↩',  color: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
  aggravé:        { label: 'Aggravé',        icon: '!',  color: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
  progressé:      { label: 'En progression', icon: '↑',  color: 'bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-300' },
  annulé:         { label: 'Annulé',         icon: '×',  color: 'bg-muted text-muted-foreground' },
  maintenu:       { label: 'Inchangé',       icon: '→',  color: 'bg-muted text-muted-foreground' },
  non_mentionné:  { label: 'Non mentionné',  icon: '○',  color: 'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300' },
  réapparu:       { label: 'Réapparu',       icon: '↗',  color: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300' },
  changé:         { label: 'Changé',         icon: '~',  color: 'bg-muted text-muted-foreground' },
}

const ENTITY_TYPE_META: Record<MaterializedEntityType, { label: string; plural: string; color: string }> = {
  site_action:   { label: 'Action',    plural: 'Actions',    color: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  site_decision: { label: 'Décision',  plural: 'Décisions',  color: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300' },
  site_reserve:  { label: 'Réserve',   plural: 'Réserves',   color: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
  site_deadline: { label: 'Échéance',  plural: 'Échéances',  color: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
}

const ENTITY_STATUS_LABELS: Record<string, string> = {
  // actions
  open:       'Ouverte',
  done:       'Clôturée',
  cancelled:  'Annulée',
  planned:    'Planifiée',
  // decisions
  actee:      'Actée',
  appliquee:  'Appliquée',
  caduque:    'Caduque',
  proposee:   'Proposée',
  contredite: 'Contredite',
  // reserves
  lifted:     'Levée',
  // deadlines
  to_plan:    'À planifier',
  superseded: 'Remplacée',
}

const LINK_LABELS: Record<string, { out: string; in: string }> = {
  requires:   { out: 'nécessite',     in: 'est requis par' },
  enables:    { out: 'permet',        in: 'est rendu possible par' },
  causes:     { out: 'entraîne',      in: 'est causé par' },
  validates:  { out: 'valide',        in: 'est validé par' },
  replaces:   { out: 'remplace',      in: 'est remplacé par' },
  relates_to: { out: 'est associé à', in: 'est associé à' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function frDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function frDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}

function dateToMs(iso: string): number {
  return new Date(iso).getTime()
}

/** Position en % sur l'axe temporel [minMs, maxMs]. */
function toPct(ms: number, minMs: number, maxMs: number): number {
  if (maxMs === minMs) return 50
  return Math.round(((ms - minMs) / (maxMs - minMs)) * 100)
}

/** Couleur et symbole du point de la lifeline selon status et transition. */
function lifelineDot(occ: SubjectOccurrenceMerged): { symbol: string; colorClass: string } {
  if (occ.isGap) return { symbol: '○', colorClass: 'text-muted-foreground/40' }
  if (occ.sourceKind === 'field_visit') {
    if (occ.visitStatus === 'field_checked')  return { symbol: '✓', colorClass: 'text-teal-600 dark:text-teal-400' }
    if (occ.visitStatus === 'still_open')     return { symbol: '●', colorClass: 'text-orange-500 dark:text-orange-400' }
    if (occ.visitStatus === 'not_applicable') return { symbol: '○', colorClass: 'text-muted-foreground/60' }
    return { symbol: '▶', colorClass: 'text-teal-500' }
  }
  if (occ.sourceKind === 'meeting') {
    return { symbol: '◇', colorClass: 'text-violet-600 dark:text-violet-400' }
  }
  const status = occ.documentStatus
  if (status === 'done')          return { symbol: '✓', colorClass: 'text-emerald-600 dark:text-emerald-400' }
  if (status === 'non_compliant') return { symbol: '⚠', colorClass: 'text-red-600 dark:text-red-400' }
  if (status === 'open')          return { symbol: '●', colorClass: 'text-orange-500 dark:text-orange-400' }
  if (status === 'in_progress')   return { symbol: '↗', colorClass: 'text-blue-600 dark:text-blue-400' }
  if (status === 'planned')       return { symbol: '○', colorClass: 'text-sky-500' }
  if (!occ.transition)            return { symbol: '●', colorClass: 'text-blue-500' }
  return { symbol: '●', colorClass: 'text-muted-foreground' }
}

// ── Composants ────────────────────────────────────────────────────────────────

function TransitionBadge({ transition }: { transition: string }) {
  const cfg = TRANSITION_CONFIG[transition] ?? { label: transition, icon: '·', color: 'bg-muted text-muted-foreground' }
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', cfg.color)}>
      <span>{cfg.icon}</span>
      <span>{cfg.label}</span>
    </span>
  )
}

const LIFELINE_EVENT_ORDER: MaterializedEntityType[] = ['site_reserve', 'site_action', 'site_decision', 'site_deadline']

/**
 * Lifeline horizontale — axe temporel proportionnel à la vraie durée.
 *
 * Chaque PV est positionné en fonction de sa date réelle : un silence de 2 mois
 * occupe 2× plus d'espace qu'un silence de 1 mois.
 * Les PV où le sujet n'est pas mentionné apparaissent en grisé.
 * Sous chaque dot, des badges compacts indiquent les objets métier rattachés à ce PV.
 */
function LifelineBar({
  occurrences,
  materializedEvents,
  siteId,
}: {
  occurrences: SubjectOccurrenceMerged[]
  materializedEvents: MaterializedEvent[]
  siteId: string
}) {
  if (occurrences.length === 0) return null

  const minMs = dateToMs(occurrences[0].effectiveDate)
  const maxMs = dateToMs(occurrences[occurrences.length - 1].effectiveDate)
  const isSingle = minMs === maxMs

  // Index des événements par runId pour éviter une itération dans le render
  const eventsByRun = new Map<string, Map<MaterializedEntityType, number>>()
  for (const ev of materializedEvents) {
    if (!ev.runId) continue
    let typeMap = eventsByRun.get(ev.runId)
    if (!typeMap) { typeMap = new Map(); eventsByRun.set(ev.runId, typeMap) }
    typeMap.set(ev.entityType, (typeMap.get(ev.entityType) ?? 0) + 1)
  }

  // Positions (%) et décalages verticaux anti-collision
  const MIN_PCT_GAP = 4
  const positions = occurrences.map((occ) =>
    isSingle ? 50 : toPct(dateToMs(occ.effectiveDate), minMs, maxMs)
  )
  const yOffsets: number[] = []
  for (let k = 0; k < positions.length; k++) {
    if (k === 0) { yOffsets.push(0); continue }
    if (positions[k] - positions[k - 1] < MIN_PCT_GAP) {
      yOffsets.push(yOffsets[k - 1] <= 0 ? 14 : -14)
    } else {
      yOffsets.push(0)
    }
  }

  return (
    <div className="relative select-none overflow-visible" style={{ minHeight: '6rem' }} aria-hidden="true">
      {/* Ligne de fond */}
      <div className="absolute left-0 right-0 top-8 h-px bg-border" />

      {occurrences.map((occ, i) => {
        const pct = positions[i]
        const yOff = yOffsets[i]
        const { symbol, colorClass } = lifelineDot(occ)
        const typeMap = (!occ.isGap && occ.runId && eventsByRun.get(occ.runId)) || null
        const badges = typeMap
          ? LIFELINE_EVENT_ORDER.filter((t) => typeMap.has(t)).map((t) => ({ t, count: typeMap.get(t)! }))
          : []

        return (
          <div
            key={`${occ.runId ?? occ.reportId ?? 'gap'}-${i}`}
            className="absolute flex flex-col items-center"
            style={{ left: `${pct}%`, top: 0, transform: `translate(-50%, ${yOff}px)` }}
          >
            {/* Lien vers la source — PDF→document, visite→visites, réunion→reunion, null→non cliquable */}
            {(() => {
              const href =
                occ.sourceKind === 'field_visit' && occ.reportId
                  ? `/sites/${siteId}/visites/${occ.reportId}`
                  : occ.sourceKind === 'meeting' && occ.reportId
                    ? `/sites/${siteId}/reunion/${occ.reportId}`
                    : !occ.isGap && occ.documentId
                      ? `/documents/${occ.documentId}`
                      : null
              const cls   = cn('group flex flex-col items-center gap-0.5', occ.isGap ? 'pointer-events-none opacity-40' : '')
              const title = occ.isGap ? 'Non mentionné' : (occ.label ?? '')
              const inner = (
                <>
                  <span className={cn('text-base font-bold leading-none transition-transform group-hover:scale-125', colorClass)}>
                    {symbol}
                  </span>
                  <div className={cn('h-4 w-px', occ.isGap ? 'bg-muted-foreground/20' : 'bg-border')} />
                  <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                    {frDateShort(occ.effectiveDate)}
                  </span>
                </>
              )
              return href
                ? <Link href={href} className={cls} title={title}>{inner}</Link>
                : <div className={cls} title={title}>{inner}</div>
            })()}

            {/* Badges objets métier — groupés par type, compacts */}
            {badges.length > 0 && (
              <div className="mt-1 flex flex-col items-center gap-0.5">
                {badges.map(({ t, count }) => {
                  const meta = ENTITY_TYPE_META[t]
                  const label = count > 1 ? `${count} ${meta.plural.toLowerCase()}` : meta.label
                  return (
                    <a
                      key={t}
                      href={`#objets-metier-${t}`}
                      aria-label={`Voir ${label}`}
                      className={cn(
                        'whitespace-nowrap rounded-full px-1.5 py-px text-[9px] font-semibold leading-4 transition-opacity hover:opacity-80',
                        meta.color,
                      )}
                    >
                      {label}
                    </a>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function OccurrenceCard({ occ, siteId }: { occ: SubjectOccurrenceMerged; siteId: string }) {
  if (occ.isGap) {
    return (
      <div className="rounded-xl border border-dashed bg-muted/20 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted/50 text-sm text-muted-foreground/60">
            ○
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{frDate(occ.effectiveDate)}</p>
            <p className="text-xs italic text-muted-foreground">
              Non mentionné dans ce PV — état précédent conservé
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <article className="rounded-xl border bg-card px-4 py-3.5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="h-3.5 w-3.5 shrink-0" />
          <span>{frDate(occ.effectiveDate)}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {occ.transition && <TransitionBadge transition={occ.transition} />}
          {occ.sourceKind === 'field_visit' && (
            <span className="inline-flex items-center rounded-full bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300 px-2 py-0.5 text-xs font-medium">
              Visite terrain
            </span>
          )}
          {occ.sourceKind === 'meeting' && (
            <span className="inline-flex items-center rounded-full bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300 px-2 py-0.5 text-xs font-medium">
              Réunion
            </span>
          )}
          {occ.documentStatus && (
            <span className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
              STATUS_COLORS[occ.documentStatus] ?? 'bg-muted text-muted-foreground',
            )}>
              {STATUS_LABELS[occ.documentStatus] ?? occ.documentStatus}
            </span>
          )}
          {occ.visitStatus && (
            <span className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
              STATUS_COLORS[occ.visitStatus] ?? 'bg-muted text-muted-foreground',
            )}>
              {STATUS_LABELS[occ.visitStatus] ?? occ.visitStatus}
            </span>
          )}
          {occ.proposalFamily && occ.proposalFamily !== 'knowledge_fact' && (
            <span className="inline-flex items-center rounded-full bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
              {FAMILY_LABELS[occ.proposalFamily] ?? occ.proposalFamily}
            </span>
          )}
        </div>
      </div>

      {occ.label && (
        <p className="mt-2 font-medium leading-snug">{occ.label}</p>
      )}

      {occ.description && (
        <p className="mt-1 text-sm text-muted-foreground leading-relaxed line-clamp-3">{occ.description}</p>
      )}

      {occ.additionalLabels.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {occ.additionalLabels.map((l, i) => (
            <p key={i} className="text-xs text-muted-foreground italic">+ {l}</p>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {occ.sourceKind === 'historical_pdf' && occ.documentId && (
          <Link
            href={`/documents/${occ.documentId}`}
            className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
          >
            <FileText className="h-3.5 w-3.5" />
            Ouvrir le PV source
            {occ.sourcePage != null && (
              <span className="text-muted-foreground">· p.{occ.sourcePage}</span>
            )}
          </Link>
        )}
        {occ.sourceKind === 'field_visit' && occ.reportId && (
          <Link
            href={`/sites/${siteId}/visites/${occ.reportId}`}
            className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
          >
            <FileText className="h-3.5 w-3.5" />
            Voir la visite terrain
          </Link>
        )}
        {occ.sourceKind === 'meeting' && occ.reportId && (
          <Link
            href={`/sites/${siteId}/reunion/${occ.reportId}`}
            className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
          >
            <FileText className="h-3.5 w-3.5" />
            Voir la réunion
          </Link>
        )}
        {occ.evidenceCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {occ.evidenceCount} preuve{occ.evidenceCount > 1 ? 's' : ''}
          </span>
        )}
      </div>
    </article>
  )
}

function MaterializedEventsSection({ events }: { events: MaterializedEvent[] }) {
  const ORDER: MaterializedEntityType[] = ['site_reserve', 'site_action', 'site_decision', 'site_deadline']
  const byType = new Map<MaterializedEntityType, MaterializedEvent[]>()
  for (const e of events) {
    const list = byType.get(e.entityType) ?? []
    list.push(e)
    byType.set(e.entityType, list)
  }

  return (
    <div className="space-y-4">
      {ORDER.filter((t) => byType.has(t)).map((t) => {
        const meta = ENTITY_TYPE_META[t]
        const items = byType.get(t)!
        return (
          <div key={t} id={`objets-metier-${t}`}>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {meta.plural} ({items.length})
            </p>
            <ul className="space-y-1.5">
              {items.map((ev) => (
                <li key={ev.entityId} className="flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm">
                  <span className={cn('mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold', meta.color)}>
                    {meta.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium leading-snug">{ev.title}</p>
                    {ev.description && (
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{ev.description}</p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
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

function RelationsSection({
  links,
  siteId,
  canonicalSubjectId,
  csLabel,
  allSubjects,
}: {
  links: CanonicalLink[]
  siteId: string
  canonicalSubjectId: string
  csLabel: string
  allSubjects: CanonicalSubjectSummary[]
}) {
  const confirmed = links.filter((l) => l.status === 'confirmed')
  const suggested = links.filter((l) => l.status === 'suggested')
  const otherSubjects = allSubjects.filter((s) => s.id !== canonicalSubjectId)

  function LinkRow({ link }: { link: CanonicalLink }) {
    const cfg = LINK_LABELS[link.linkType]
    const verb = link.direction === 'outgoing' ? cfg?.out : cfg?.in
    const targetLabel = link.direction === 'outgoing' ? link.toLabel : link.fromLabel
    const targetCsId = link.direction === 'outgoing' ? link.toCanonicalSubjectId : link.fromCanonicalSubjectId

    return (
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{csLabel}</span>
          {' '}<span>{verb}</span>
        </p>
        {targetCsId ? (
          <Link
            href={`/sites/${siteId}/historique/sujets/${targetCsId}`}
            className="mt-0.5 block font-medium hover:underline"
          >
            {targetLabel}
          </Link>
        ) : (
          <p className="mt-0.5 font-medium">{targetLabel}</p>
        )}
        {link.justification && (
          <p className="mt-1 text-xs text-muted-foreground italic">{link.justification}</p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {confirmed.length === 0 && suggested.length === 0 && (
        <p className="text-sm text-muted-foreground">Aucune relation définie avec d'autres sujets.</p>
      )}

      {confirmed.map((l) => (
        <div key={l.id} className={cn(
          'flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm',
          l.linkType === 'relates_to' ? 'border-dashed' : '',
        )}>
          <LinkRow link={l} />
          {l.source === 'human' && (
            <form action={deleteCanonicalLinkAction}>
              <input type="hidden" name="linkId" value={l.id} />
              <input type="hidden" name="siteId" value={siteId} />
              <input type="hidden" name="canonicalSubjectId" value={canonicalSubjectId} />
              <button
                type="submit"
                title="Supprimer ce lien"
                className="mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground/50 hover:text-destructive hover:bg-muted transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </form>
          )}
        </div>
      ))}

      {suggested.length > 0 && (
        <>
          <p className="text-xs font-medium text-muted-foreground pt-1">
            Suggestion{suggested.length > 1 ? 's' : ''} à valider :
          </p>
          {suggested.map((l) => (
            <div key={l.id} className="rounded-lg border border-dashed bg-muted/20 px-3 py-2.5 text-sm space-y-2">
              <LinkRow link={l} />
              <div className="flex items-center gap-2">
                <form action={confirmSuggestedLink}>
                  <input type="hidden" name="linkId" value={l.id} />
                  <input type="hidden" name="siteId" value={siteId} />
                  <input type="hidden" name="canonicalSubjectId" value={canonicalSubjectId} />
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:hover:bg-emerald-900"
                  >
                    <Check className="h-3 w-3" />
                    Accepter
                  </button>
                </form>
                <form action={rejectSuggestedLink}>
                  <input type="hidden" name="linkId" value={l.id} />
                  <input type="hidden" name="siteId" value={siteId} />
                  <input type="hidden" name="canonicalSubjectId" value={canonicalSubjectId} />
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1 rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/80"
                  >
                    <X className="h-3 w-3" />
                    Refuser
                  </button>
                </form>
                <span className="text-xs text-muted-foreground/60 italic">suggéré · non confirmé</span>
              </div>
            </div>
          ))}
        </>
      )}

      {otherSubjects.length > 0 && (
        <div className="mt-1 rounded-lg border border-dashed bg-muted/10 px-3 py-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Ajouter une relation</p>
          <form action={createCanonicalLinkAction} className="space-y-2">
            <input type="hidden" name="siteId" value={siteId} />
            <input type="hidden" name="canonicalSubjectId" value={canonicalSubjectId} />
            <select
              name="toCanonicalSubjectId"
              required
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">Choisir un sujet…</option>
              {otherSubjects.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            <select
              name="linkType"
              required
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              {Object.entries(LINK_LABELS).map(([type, { out }]) => (
                <option key={type} value={type}>{out}</option>
              ))}
            </select>
            <input
              type="text"
              name="justification"
              placeholder="Justification (optionnel)"
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Link2 className="h-3 w-3" />
              Lier
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function CanonicalSubjectLifePage({ params }: PageProps) {
  const user = await getCurrentUserWithProfile().catch(() => null)
  if (!user) redirect('/login')

  const { id: siteId, canonicalSubjectId } = await params

  const [site, life, allSubjects] = await Promise.all([
    getSiteIdentity(siteId).catch(() => null),
    getCanonicalSubjectLife(canonicalSubjectId).catch(() => null),
    listActiveCanonicalSubjects(siteId).catch(() => [] as CanonicalSubjectSummary[]),
  ])

  if (!site) notFound()
  if (!life || life.siteId !== siteId) notFound()

  const realOccurrences = life.occurrences.filter((o) => !o.isGap)
  const confirmedLinks = life.links.filter((l) => l.status === 'confirmed')

  // Résumé déterministe — dérivé de la provenance sans requête supplémentaire
  const matCounts: Record<MaterializedEntityType, number> = {
    site_reserve: 0, site_action: 0, site_decision: 0, site_deadline: 0,
  }
  for (const e of life.materializedEvents) matCounts[e.entityType]++

  const visitCount = life.occurrences.filter((o) => !o.isGap && o.sourceKind === 'field_visit').length
  const meetingCount = life.occurrences.filter((o) => !o.isGap && o.sourceKind === 'meeting').length

  const summaryParts: string[] = []
  if (life.pvCount > 0) summaryParts.push(`${life.pvCount} PV`)
  if (visitCount > 0) summaryParts.push(`${visitCount} visite${visitCount > 1 ? 's' : ''} terrain`)
  if (meetingCount > 0) summaryParts.push(`${meetingCount} réunion${meetingCount > 1 ? 's' : ''}`)
  if (matCounts.site_reserve > 0) summaryParts.push(`${matCounts.site_reserve} réserve${matCounts.site_reserve > 1 ? 's' : ''}`)
  if (matCounts.site_action > 0) summaryParts.push(`${matCounts.site_action} action${matCounts.site_action > 1 ? 's' : ''}`)
  if (matCounts.site_decision > 0) summaryParts.push(`${matCounts.site_decision} décision${matCounts.site_decision > 1 ? 's' : ''}`)
  if (matCounts.site_deadline > 0) summaryParts.push(`${matCounts.site_deadline} échéance${matCounts.site_deadline > 1 ? 's' : ''}`)
  if (life.lastSeenAt) summaryParts.push(`dernière évolution le ${frDate(life.lastSeenAt)}`)

  return (
    <>
      <BreadcrumbPrefix crumbs={[
        { href: '/sites', label: 'Sites' },
        { href: `/sites/${siteId}`, label: site.name },
        { href: `/sites/${siteId}/historique`, label: 'Historique' },
      ]} />
      <DynamicCrumb segmentId="canonicalSubjectId" label={life.label} />

      <main className="mx-auto max-w-2xl space-y-6 px-4 py-6">
        {/* Retour */}
        <div>
          <Link
            href={`/sites/${siteId}/historique`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Retour à l'historique
          </Link>
        </div>

        {/* Header */}
        <section className="rounded-[22px] border bg-card p-5 shadow-sm">
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              {life.primaryFamily && (
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {FAMILY_LABELS[life.primaryFamily] ?? life.primaryFamily}
                </p>
              )}
              <h1 className="mt-0.5 text-xl font-semibold leading-snug">{life.label}</h1>
              {life.aliases.length > 0 && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Alias : {life.aliases.slice(0, 3).join(', ')}{life.aliases.length > 3 ? ` +${life.aliases.length - 3}` : ''}
                </p>
              )}
            </div>
            {life.currentStatus && (
              <span className={cn(
                'shrink-0 rounded-full px-3 py-1 text-sm font-medium',
                STATUS_COLORS[life.currentStatus] ?? 'bg-muted text-muted-foreground',
              )}>
                {STATUS_LABELS[life.currentStatus] ?? life.currentStatus}
              </span>
            )}
          </div>

          {summaryParts.length > 0 && (
            <p className="mt-3 text-sm text-muted-foreground">{summaryParts.join(' · ')}</p>
          )}

          {life.firstSeenAt && (
            <p className="mt-1 text-xs text-muted-foreground">
              Apparu le {frDate(life.firstSeenAt)}
              {life.threadIds.length > 1 && ` · ${life.threadIds.length} formulations fusionnées`}
              {confirmedLinks.length > 0 && ` · ${confirmedLinks.length} lien${confirmedLinks.length > 1 ? 's' : ''} confirmé${confirmedLinks.length > 1 ? 's' : ''}`}
            </p>
          )}
        </section>

        {/* Ligne de vie horizontale */}
        {life.occurrences.length > 0 && (
          <section className="rounded-[18px] border bg-card px-5 py-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-4">
              Ligne de vie
            </h2>
            <LifelineBar occurrences={life.occurrences} materializedEvents={life.materializedEvents} siteId={siteId} />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Espacé selon les dates réelles · les cercles grisés = PV où le sujet n'est pas mentionné
            </p>
          </section>
        )}

        {/* Objets métier matérialisés */}
        {life.materializedEvents.length > 0 && (
          <section className="rounded-[18px] border bg-card px-5 py-4 space-y-3">
            <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <LayoutList className="h-3.5 w-3.5" />
              Objets métier ({life.materializedEvents.length})
            </h2>
            <MaterializedEventsSection events={life.materializedEvents} />
          </section>
        )}

        {/* Relations */}
        <section id="relations" className="rounded-[18px] border bg-card px-5 py-4 space-y-3">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Link2 className="h-3.5 w-3.5" />
            Relations
          </h2>
          <RelationsSection links={life.links} siteId={siteId} canonicalSubjectId={canonicalSubjectId} csLabel={life.label} allSubjects={allSubjects} />
        </section>

        {/* Fil métier */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Fil métier ({life.occurrences.length} entrée{life.occurrences.length > 1 ? 's' : ''})
          </h2>
          <ol className="space-y-2">
            {life.occurrences.map((occ, i) => (
              <li key={`${occ.runId}-${i}`}>
                <OccurrenceCard occ={occ} siteId={siteId} />
              </li>
            ))}
          </ol>

          {life.occurrences.some((o) => o.isGap) && (
            <p className="text-xs text-muted-foreground">
              Les entrées en pointillé représentent des PV où ce sujet n'est pas mentionné — absence ≠ résolution.
            </p>
          )}
        </section>
      </main>
    </>
  )
}
