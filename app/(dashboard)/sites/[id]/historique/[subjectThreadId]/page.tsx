import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Calendar, FileText, Link2, Plus, X } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getSubjectTimeline, getSiteSubjectMatrix } from '@/lib/documents/pv-history'
import type { SubjectOccurrence } from '@/lib/documents/pv-history'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'
import { listLinksForThread, LINK_TYPE_LABELS } from '@/lib/db/subject-thread-links'
import type { SubjectThreadLink, SubjectLinkType } from '@/lib/db/subject-thread-links'
import { cn } from '@/lib/utils'
import { createLinkAction, deleteLinkAction } from './link-actions'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string; subjectThreadId: string }>
}

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
}

const TRANSITION_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  nouveau:       { label: 'Nouveau',              icon: '+', color: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  réalisé:       { label: 'Réalisé',              icon: '✓', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  levé:          { label: 'Levé',                 icon: '✓', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  réouvert:      { label: 'Réouvert',             icon: '↩', color: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
  aggravé:       { label: 'Aggravé',              icon: '!', color: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
  progressé:     { label: 'En progression',       icon: '↑', color: 'bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-300' },
  annulé:        { label: 'Annulé',               icon: '×', color: 'bg-muted text-muted-foreground' },
  maintenu:      { label: 'Inchangé',             icon: '→', color: 'bg-muted text-muted-foreground' },
  non_mentionné: { label: 'Non mentionné',        icon: '○', color: 'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300' },
  réapparu:      { label: 'Réapparu',             icon: '↗', color: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300' },
  changé:        { label: 'Changement',           icon: '~', color: 'bg-muted text-muted-foreground' },
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function TransitionBadge({ transition }: { transition: string }) {
  const cfg = TRANSITION_CONFIG[transition] ?? { label: transition, icon: '·', color: 'bg-muted text-muted-foreground' }
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', cfg.color)}>
      <span>{cfg.icon}</span>
      <span>{cfg.label}</span>
    </span>
  )
}

function OccurrenceCard({ occurrence, siteId }: { occurrence: SubjectOccurrence; siteId: string }) {
  if (occurrence.isGap) {
    return (
      <div className="rounded-xl border border-dashed bg-muted/20 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm text-muted-foreground">
            ○
          </div>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{formatDate(occurrence.effectiveDate)}</p>
            <p className="mt-0.5 text-sm italic text-muted-foreground">
              Non mentionné dans ce PV — état précédent conservé
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <article className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="h-3.5 w-3.5 shrink-0" />
          <span>{formatDate(occurrence.effectiveDate)}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {occurrence.transition && <TransitionBadge transition={occurrence.transition} />}
          {occurrence.status && (
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {STATUS_LABELS[occurrence.status] ?? occurrence.status}
            </span>
          )}
        </div>
      </div>

      {occurrence.label && (
        <p className="mt-2 font-medium leading-snug">{occurrence.label}</p>
      )}

      {occurrence.description && (
        <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{occurrence.description}</p>
      )}

      {occurrence.thematicCategory && (
        <p className="mt-1 text-xs text-muted-foreground">Catégorie : {occurrence.thematicCategory}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={`/documents/${occurrence.documentId}`}
          className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
        >
          <FileText className="h-3.5 w-3.5" />
          Ouvrir le PV source
          {occurrence.sourcePage != null && <span className="text-muted-foreground">· p.{occurrence.sourcePage}</span>}
        </Link>
      </div>
    </article>
  )
}

export default async function SubjectThreadPage({ params }: PageProps) {
  const user = await getCurrentUserWithProfile().catch(() => null)
  if (!user) redirect('/login')

  const { id: siteId, subjectThreadId } = await params

  const [site, timeline, links, matrix] = await Promise.all([
    getSiteIdentity(siteId).catch(() => null),
    getSubjectTimeline(subjectThreadId).catch(() => null),
    listLinksForThread(subjectThreadId).catch(() => ({ outgoing: [], incoming: [] })),
    getSiteSubjectMatrix(siteId).catch(() => null),
  ])

  if (!site) notFound()
  if (!timeline) notFound()

  const realOccurrences = timeline.occurrences.filter((o) => !o.isGap)
  const currentStatus = timeline.currentStatus

  // Labels des threads du même chantier (pour le formulaire de création de lien)
  const otherThreads = (matrix?.rows ?? [])
    .filter((r) => r.subjectThreadId !== subjectThreadId)
    .map((r) => ({ id: r.subjectThreadId, label: r.canonicalLabel, family: r.family }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'))

  const canManageLinks = user.role === 'admin' || user.role === 'manager' || user.role === 'chef_equipe'

  return (
    <>
      <BreadcrumbPrefix crumbs={[{ href: '/sites', label: 'Sites' }, { href: `/sites/${siteId}`, label: site.name }]} />
      <DynamicCrumb segmentId="subjectThreadId" label={timeline.canonicalLabel} />

      <main className="mx-auto max-w-2xl space-y-6 px-4 py-6">
        <div>
          <Link
            href={`/sites/${siteId}?tab=chronologie`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Retour à la chronologie
          </Link>
        </div>

        <section className="rounded-[22px] border bg-card p-5 shadow-sm">
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {FAMILY_LABELS[timeline.family] ?? timeline.family}
                {timeline.thematicCategory ? ` · ${timeline.thematicCategory}` : ''}
              </p>
              <h1 className="mt-1 text-xl font-semibold leading-snug">{timeline.canonicalLabel}</h1>
            </div>
            {currentStatus && (
              <span className="shrink-0 rounded-full border px-3 py-1 text-sm font-medium">
                {STATUS_LABELS[currentStatus] ?? currentStatus}
              </span>
            )}
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Premier PV</dt>
              <dd className="mt-0.5">{formatDate(timeline.firstSeenAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Dernier PV</dt>
              <dd className="mt-0.5">{formatDate(timeline.lastSeenAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Occurrences</dt>
              <dd className="mt-0.5">{realOccurrences.length} PV</dd>
            </div>
          </dl>
        </section>

        {/* Section Dépendances */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <Link2 className="mr-1.5 inline h-3.5 w-3.5" />
              Relations avec d'autres sujets
            </h2>
          </div>

          <LinksDisplay
            outgoing={links.outgoing}
            incoming={links.incoming}
            siteId={siteId}
            currentThreadId={subjectThreadId}
          />

          {canManageLinks && otherThreads.length > 0 && (
            <details className="group rounded-xl border bg-card">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium">
                <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                Ajouter une relation
                <span className="ml-auto text-xs text-muted-foreground transition-transform group-open:rotate-180">▾</span>
              </summary>
              <div className="border-t p-4">
                <form action={createLinkAction}>
                  <input type="hidden" name="siteId" value={siteId} />
                  <input type="hidden" name="fromThreadId" value={subjectThreadId} />
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Ce sujet…</label>
                      <select name="linkType" required className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm">
                        {(Object.entries(LINK_TYPE_LABELS) as [SubjectLinkType, typeof LINK_TYPE_LABELS[SubjectLinkType]][]).map(([key, cfg]) => (
                          <option key={key} value={key}>{cfg.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Sujet cible</label>
                      <select name="toThreadId" required className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm">
                        <option value="">— Choisir un sujet —</option>
                        {otherThreads.map((t) => (
                          <option key={t.id} value={t.id}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Justification (optionnelle)</label>
                      <textarea
                        name="justification"
                        rows={2}
                        placeholder="Ex. : le rapport G3 est requis avant la validation MOE"
                        className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                      />
                    </div>
                    <button
                      type="submit"
                      className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
                    >
                      Confirmer la relation
                    </button>
                  </div>
                </form>
              </div>
            </details>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Chronologie ({timeline.occurrences.length} entrées)
          </h2>
          <ol className="space-y-2">
            {timeline.occurrences.map((occurrence, i) => (
              <li key={`${occurrence.runId}-${i}`}>
                <OccurrenceCard occurrence={occurrence} siteId={siteId} />
              </li>
            ))}
          </ol>

          {timeline.occurrences.some((o) => o.isGap) && (
            <p className="text-xs text-muted-foreground">
              Les entrées en pointillé représentent des PV où ce sujet n'a pas été mentionné — son état reste inchangé, son absence ne signifie pas sa résolution.
            </p>
          )}
        </section>
      </main>
    </>
  )
}

// ── Affichage des liens ───────────────────────────────────────────────────────

const LINK_GROUP_LABELS: Partial<Record<SubjectLinkType, { out: string; in: string }>> = {
  requires:   { out: 'Ce sujet nécessite',    in: 'Ce sujet est requis par' },
  enables:    { out: 'Ce sujet permet',        in: 'Ce sujet est rendu possible par' },
  causes:     { out: 'Ce sujet entraîne',      in: 'Ce sujet est causé par' },
  validates:  { out: 'Ce sujet valide',        in: 'Ce sujet est validé par' },
  replaces:   { out: 'Ce sujet remplace',      in: 'Ce sujet est remplacé par' },
  relates_to: { out: 'Ce sujet est associé à', in: 'Ce sujet est associé à' },
}

function LinksDisplay({
  outgoing,
  incoming,
  siteId,
  currentThreadId,
}: {
  outgoing: SubjectThreadLink[]
  incoming: SubjectThreadLink[]
  siteId: string
  currentThreadId: string
}) {
  const confirmed = [...outgoing, ...incoming].filter((l) => l.status === 'confirmed')
  const suggested = [...outgoing, ...incoming].filter((l) => l.status === 'suggested')

  if (confirmed.length === 0 && suggested.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aucune relation définie. Les relations permettent de construire le graphe causal du chantier.
      </p>
    )
  }

  function LinkRow({ link, direction }: { link: SubjectThreadLink; direction: 'out' | 'in' }) {
    const cfg = LINK_GROUP_LABELS[link.linkType]
    const groupLabel = direction === 'out' ? cfg?.out : cfg?.in
    const targetThreadId = direction === 'out' ? link.toThreadId : link.fromThreadId
    const targetLabel = direction === 'out'
      ? (link.toLabel ?? link.toThreadId.slice(0, 8) + '…')
      : (link.fromLabel ?? link.fromThreadId.slice(0, 8) + '…')
    const isRelatesTo = link.linkType === 'relates_to'

    return (
      <div className={cn('flex items-start gap-2 rounded-lg border px-3 py-2.5', isRelatesTo ? 'border-dashed' : '')}>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{groupLabel ?? link.linkType}</p>
          <Link
            href={`/sites/${siteId}/historique/${targetThreadId}`}
            className="mt-0.5 block text-sm font-medium hover:underline"
          >
            {targetLabel}
          </Link>
          {link.justification && (
            <p className="mt-1 text-xs text-muted-foreground italic">{link.justification}</p>
          )}
        </div>
        {link.source === 'human' && (
          <form action={deleteLinkAction}>
            <input type="hidden" name="linkId" value={link.id} />
            <input type="hidden" name="siteId" value={siteId} />
            <input type="hidden" name="fromThreadId" value={currentThreadId} />
            <button type="submit" className="rounded p-1 hover:bg-muted" title="Supprimer cette relation">
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </form>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {confirmed.length > 0 && (
        <div className="space-y-1.5">
          {outgoing.filter((l) => l.status === 'confirmed').map((l) => (
            <LinkRow key={l.id} link={l} direction="out" />
          ))}
          {incoming.filter((l) => l.status === 'confirmed').map((l) => (
            <LinkRow key={l.id} link={l} direction="in" />
          ))}
        </div>
      )}
      {suggested.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Liens suggérés (à confirmer) :</p>
          {outgoing.filter((l) => l.status === 'suggested').map((l) => (
            <div key={l.id} className="rounded-lg border border-dashed bg-muted/20 px-3 py-2.5 opacity-70">
              <LinkRow link={l} direction="out" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
