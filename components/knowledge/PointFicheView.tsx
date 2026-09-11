// ── FICHE POINT — vue présentationnelle unique (6F, mandat Vincent) ──────────
//
// Un seul composant, monté sur desktop ET mobile (la grille 2 colonnes retombe
// naturellement en 1 colonne sous lg). Purement présentationnel : toute la
// logique (état dérivé, tri des preuves, résolution du Point merged) vient de
// `getTrackedPointDetail` — ce composant ne fait AUCUN calcul d'état.
//
// Priorité de lecture (6F.1, mandat Vincent) : « ce qu'il faut retenir
// aujourd'hui » tout en haut (synthèse + divergences/conflits non déjà cités),
// puis §1 À faire (liste unique, dédupliquée), puis §2 Histoire et preuves
// (trajectoire + preuves fusionnées en une lecture chronologique), puis §3
// Acteurs. Informations/Documents liés restent secondaires en colonne latérale.
//
// UX : le conducteur ne doit jamais avoir besoin de comprendre canonical_subject,
// CBO, membership ou les UUID — ces notions restent dans le bloc « Détails
// techniques », replié par défaut (<details> natif, zéro JS).

import Link from 'next/link'
import { ChevronRight, FileText, HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  proposalIdFromSource,
  resolveOrigin,
  originMatchesProvenance,
  type TrackedPointDetail,
  type PointDetailEvidence,
  type PointDetailLinkedObject,
  type PointDetailLinkedObjectGroup,
} from '@/lib/knowledge/tracked-point-detail'
import { MEMORIA_NEEDS_YOU_CATEGORY_LABELS, MEMORIA_NEEDS_YOU_CATEGORY_ORDER } from '@/lib/knowledge/tracked-point-needs-you-categories'
import { needsYouQuestionHref, type MemoriaNeedsYouQuestion } from '@/lib/knowledge/tracked-point-needs-you-summary'
import { PointActionMenu } from '@/components/knowledge/PointActionMenu'
import type { ResponsibleCandidate } from '@/lib/knowledge/action-responsible-candidates'
import type { SiteCandidateCompany } from '@/lib/db/site-intervenants'

const STATE_CLS: Record<TrackedPointDetail['derivedState'], string> = {
  unknown: 'bg-muted text-muted-foreground ring-border',
  open: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900',
  resolved: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900',
  reopened: 'bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:ring-orange-900',
  conflict: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900',
}

const STATE_HERO_CLS: Record<TrackedPointDetail['derivedState'], string> = {
  unknown: 'border-border bg-muted/20',
  open: 'border-sky-300/70 bg-sky-50/50 dark:border-sky-900 dark:bg-sky-950/15',
  resolved: 'border-emerald-300/70 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/15',
  reopened: 'border-orange-300/70 bg-orange-50/50 dark:border-orange-900 dark:bg-orange-950/15',
  conflict: 'border-rose-300/70 bg-rose-50/50 dark:border-rose-900 dark:bg-rose-950/15',
}

const H2 = 'text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground'
const TH = 'px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground'

function ResponsibleLabel({ o }: { o: PointDetailLinkedObject }) {
  if (!o.responsible) return <span className="text-muted-foreground/60">—</span>
  if (o.responsible.kind === 'text') return <span>{o.responsible.label}</span>
  return <span>{o.responsible.name}</span>
}

function LinkedObjectRow({ o }: { o: PointDetailLinkedObject }) {
  return (
    <li className="flex items-start justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <Link href={o.href} className="text-[13.5px] font-medium text-primary hover:underline">{o.title}</Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
          <span>{o.statusLabel}</span>
          {o.dueDateLabel && <span>· échéance {o.dueDateLabel}</span>}
          {o.responsible && (
            <span>
              · {o.responsible.kind === 'text' ? `resp. (ancien suivi) ${o.responsible.label}` : o.responsible.name}
            </span>
          )}
        </div>
      </div>
      {o.isLate && (
        <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[10.5px] font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          En retard
        </span>
      )}
    </li>
  )
}

const OBJECT_TYPE_LABEL: Record<PointDetailLinkedObject['objectType'], string> = {
  site_action: 'Action', site_reserve: 'Réserve', site_deadline: 'Échéance',
}

// §1 « À faire » compacté (mandat Vincent, lot UX Point 3F) : une ligne par GROUPE (titre
// exactement identique), jamais une ligne par occurrence — les champs affichés (responsable,
// échéance, statut) viennent du représentant du groupe, purement visuel, aucune donnée modifiée.
//
// Lot Point Actions inline (mandat Vincent) : le titre n'est PLUS un lien — le Point devient
// le cockpit local des Actions plutôt qu'une destination de navigation concurrente. Le menu
// « … » (uniquement pour objectType === 'site_action') porte les gestes déjà supportés
// ailleurs (marquer traitée / rouvrir / modifier Responsable-Entreprise-Échéance) ; « Voir le
// détail » reste disponible mais en élément secondaire du menu.
function LinkedObjectGroupsTable({
  groups,
  emptyLabel,
  siteId,
  responsibleCandidates,
  companies,
}: {
  groups: PointDetailLinkedObjectGroup[]
  emptyLabel: string
  siteId: string
  responsibleCandidates: ResponsibleCandidate[]
  companies: SiteCandidateCompany[]
}) {
  if (groups.length === 0) return <p className="px-1 py-2 text-[13px] text-muted-foreground">{emptyLabel}</p>
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/30">
          <tr>
            <th className={TH}>Type</th>
            <th className={TH}>Responsable</th>
            <th className={TH}>Échéance</th>
            <th className={cn(TH, 'text-right')}>Statut</th>
            <th className={TH} aria-label="Gestes" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {groups.map((g) => {
            const o = g.representative
            return (
              <tr key={g.key} className={cn(o.isLate && 'bg-rose-50/50 dark:bg-rose-950/10')}>
                <td className="px-3 py-2">
                  <span className="text-[13px] font-medium">
                    {g.title}{g.count > 1 && <span className="ml-1.5 text-muted-foreground">— {g.count} occurrences</span>}
                  </span>
                  <div className="text-[11px] text-muted-foreground">{OBJECT_TYPE_LABEL[g.objectType]}</div>
                </td>
                <td className="px-3 py-2 text-[12.5px]"><ResponsibleLabel o={o} /></td>
                <td className="px-3 py-2 text-[12.5px] text-muted-foreground">{o.dueDateLabel ?? '—'}</td>
                <td className="px-3 py-2 text-right">
                  <span className={cn(
                    'inline-block rounded-full px-2 py-0.5 text-[11px] font-medium',
                    o.isLate ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
                      : o.isDone ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                      : 'bg-muted text-muted-foreground',
                  )}>
                    {o.isLate ? 'En retard' : o.statusLabel}
                  </span>
                </td>
                <td className="px-2 py-2 text-right">
                  {o.objectType === 'site_action' && (
                    <PointActionMenu action={o} siteId={siteId} responsibleCandidates={responsibleCandidates} companies={companies} />
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function EvidenceLine({ ev, showDate = true }: { ev: PointDetailEvidence; showDate?: boolean }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-muted-foreground">
        {showDate && ev.dateLabel && <span>{ev.dateLabel}</span>}
        {ev.documentFilename && <span>· {ev.documentFilename}</span>}
        {ev.sourcePage && <span>· p.{ev.sourcePage}</span>}
        {ev.href && (
          <Link href={ev.href} className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
            Ouvrir dans le document <ChevronRight className="h-3 w-3" />
          </Link>
        )}
      </div>
      {ev.sourceExcerpt && <p className="text-[12.5px] italic leading-snug text-foreground/80">« {ev.sourceExcerpt} »</p>}
    </>
  )
}

// Genèse + provenance fusionnées (mandat Vincent, lot UX Cockpit+Points) : un seul bloc
// « Pourquoi ce Point est suivi » au lieu de deux concepts distincts et non reliés. La
// genèse (ouverture réelle) est toujours affichée quand elle existe ; la provenance de
// l'état courant n'est ajoutée en dessous QUE si elle désigne un événement différent —
// jamais la même preuve répétée deux fois.
function WhyTrackedSection({ p }: { p: TrackedPointDetail }) {
  const origin = resolveOrigin(p)
  const sameEvent = originMatchesProvenance(origin, p.provenance)
  if (!origin.dateLabel && !p.provenance) return null

  return (
    <section className="rounded-[16px] border bg-card px-4 py-3 space-y-2.5">
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
        Pourquoi ce Point est suivi
      </p>

      {origin.dateLabel && (
        <div className="space-y-1">
          <p className="text-[12.5px] font-medium text-foreground">Suivi depuis le {origin.dateLabel}</p>
          {origin.evidence && <EvidenceLine ev={origin.evidence} showDate={false} />}
        </div>
      )}

      {p.provenance && !sameEvent && (
        <div className="space-y-1 border-t pt-2">
          <p className="text-[11px] font-medium text-muted-foreground">
            {p.provenance.isCausal ? `Pourquoi c’est « ${p.derivedStateLabel} » aujourd’hui` : 'Dernière preuve enregistrée'}
          </p>
          <EvidenceLine ev={p.provenance} />
        </div>
      )}
    </section>
  )
}

const NEEDS_YOU_CATEGORIES_FOR_POINT = MEMORIA_NEEDS_YOU_CATEGORY_ORDER.filter(
  (c) => c === 'duplicate_points' || c === 'attach_information' || c === 'assign_resolution',
)

// NeedsYou contextuel à l'échelle du Point (mandat Vincent, lot UX Point 3F puis 1.1) : mêmes
// conventions visuelles que MemoriaNeedsYouBlock.tsx (bloc violet), silence total si vide — jamais
// un compteur à zéro. Bouton de traitement direct = deep-link `?q=<id>` vers la question précise
// (needsYouQuestionHref) quand une seule question concerne ce Point ; sinon page besoin-de-toi du
// chantier — jamais un choix arbitraire parmi plusieurs questions concernées.
function NeedsYouForPointSection({ questions, href }: { questions: MemoriaNeedsYouQuestion[]; href?: string }) {
  if (questions.length === 0 || !href) return null
  const targetHref = questions.length === 1 ? needsYouQuestionHref(href, questions[0].id) : href
  return (
    <section className="rounded-[16px] border border-violet-200 bg-violet-50/50 p-4 shadow-sm dark:border-violet-900/40 dark:bg-violet-950/20">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/40">
          <HelpCircle className="h-4 w-4 text-violet-600 dark:text-violet-300" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[11.5px] font-semibold uppercase tracking-wide text-violet-900 dark:text-violet-200">
            MemorIA a besoin de toi sur ce Point
          </h2>
          <p className="text-[13px] font-semibold">
            {questions.length} point{questions.length > 1 ? 's' : ''} à clarifier
          </p>
        </div>
        <Link
          href={targetHref}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-[13px] font-medium text-violet-700 hover:bg-violet-100 dark:border-violet-800 dark:bg-transparent dark:text-violet-300"
        >
          Répondre <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <ul className="mt-2.5 space-y-1">
        {NEEDS_YOU_CATEGORIES_FOR_POINT.map((category) => {
          const count = questions.filter((q) => q.category === category).length
          if (count === 0) return null
          return (
            <li key={category} className="flex items-center gap-2 text-[12.5px] text-foreground/90">
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-violet-100 px-1.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                {count}
              </span>
              <span>{MEMORIA_NEEDS_YOU_CATEGORY_LABELS[category]}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function PointFicheView({
  point,
  backHref,
  backLabel,
  needsYouQuestions = [],
  needsYouHref,
  responsibleCandidates = [],
  companies = [],
}: {
  point: TrackedPointDetail
  backHref: string
  backLabel: string
  needsYouQuestions?: MemoriaNeedsYouQuestion[]
  needsYouHref?: string
  responsibleCandidates?: ResponsibleCandidate[]
  companies?: SiteCandidateCompany[]
}) {
  const p = point

  return (
    <div className="space-y-5">
      <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        ← {backLabel}
      </Link>

      {p.mergeNotice && (
        <p className="rounded-lg border-l-2 border-amber-400/60 bg-amber-50/40 p-3 text-[12.5px] text-muted-foreground dark:bg-amber-950/10">
          Vous consultiez « {p.mergeNotice.requestedLabel} », fusionné dans ce Point — la vérité affichée ci-dessous est celle du Point regroupé.
        </p>
      )}

      {/* Ce qu'il faut retenir aujourd'hui — priorité absolue, surtout mobile.
          6F.1 : n'affiche que les divergences/conflits NON déjà cités dans le
          headline (le premier de chaque liste y est déjà repris pour reopened/
          conflict) — sinon la même information apparaissait deux fois. */}
      <section className={cn('rounded-2xl border-2 px-5 py-3.5 space-y-2', STATE_HERO_CLS[p.derivedState])}>
        <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Ce qu’il faut retenir aujourd’hui</p>
        <p className="mt-1 text-[15px] font-semibold leading-snug sm:text-base">{p.headline}</p>
        {(p.derivedState === 'reopened' ? p.documentaryDivergences.slice(1) : p.documentaryDivergences).map((d, i) => (
          <p key={i} className="rounded-md bg-amber-50/60 px-2.5 py-1.5 text-[12.5px] text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
            Divergence documentaire : {d}
          </p>
        ))}
        {(p.derivedState === 'conflict' ? p.conflicts.slice(1) : p.conflicts).map((c, i) => (
          <p key={i} className="rounded-md bg-rose-50/60 px-2.5 py-1.5 text-[12.5px] text-rose-800 dark:bg-rose-950/20 dark:text-rose-300">
            Conflit : {c}
          </p>
        ))}
      </section>

      <WhyTrackedSection p={p} />
      <NeedsYouForPointSection questions={needsYouQuestions} href={needsYouHref} />

      {/* En-tête */}
      <section className="rounded-[22px] border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {p.ownerCanonicalSubjectLabel && (
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{p.ownerCanonicalSubjectLabel}</p>
            )}
            <h1 className="mt-0.5 text-xl font-semibold leading-snug">{p.label}</h1>
          </div>
          <span className={cn('shrink-0 w-fit rounded-full px-3 py-1 text-sm font-medium ring-1', STATE_CLS[p.derivedState])}>
            {p.derivedStateLabel}
          </span>
        </div>

        {p.markerLabels.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {p.markerLabels.map((m) => (
              <span key={m} className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{m}</span>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px] lg:items-start">
        <div className="min-w-0 space-y-5">
          {/* §1 — À faire : SEULE liste d'actions/échéances/réserves (6F.1 — ne plus
              répéter les mêmes éléments dans un §5 séparé + la colonne latérale). */}
          <section className="rounded-[18px] border bg-card px-5 py-4 space-y-2.5">
            <h2 className={H2}>1. À faire</h2>
            <LinkedObjectGroupsTable
              groups={p.openLinkedObjectGroups}
              emptyLabel="Rien à faire actuellement sur ce Point."
              siteId={p.siteId}
              responsibleCandidates={responsibleCandidates}
              companies={companies}
            />
            {p.closedLinkedObjects.length > 0 && (
              <details className="pt-1">
                <summary className="cursor-pointer text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                  Voir les {p.closedLinkedObjects.length} terminé{p.closedLinkedObjects.length > 1 ? 's' : ''}
                </summary>
                <ul className="mt-2 divide-y divide-border/60">
                  {p.closedLinkedObjects.map((o) => <LinkedObjectRow key={`${o.objectType}:${o.id}`} o={o} />)}
                </ul>
              </details>
            )}
          </section>

          {/* §2 — Histoire et preuves : fusion Évolution + Preuves en une seule
              lecture chronologique (6F.1). Chaque ligne de trajectoire montre sa
              preuve documentaire quand elle en a une (jointure par proposalId) ;
              un événement natif (décision) n'affiche que sa mise en mots — jamais
              de preuve inventée. */}
          <section className="rounded-[18px] border bg-card px-5 py-4 space-y-2">
            <h2 className={H2}>2. Histoire et preuves</h2>
            {p.trajectory.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Aucun événement ni preuve documentaire enregistré pour ce Point.</p>
            ) : (
              <ul className="space-y-3 border-l border-border pl-3.5">
                {(() => {
                  const evidenceByProposalId = new Map(p.evidence.map((e) => [e.proposalId, e]))
                  return p.trajectory.map((t, i) => {
                    const proposalId = proposalIdFromSource(t.source)
                    const ev = proposalId ? evidenceByProposalId.get(proposalId) : undefined
                    return (
                      <li key={i} className="relative text-[13px]">
                        <span className={cn(
                          'absolute -left-[18px] top-1 h-2 w-2 rounded-full ring-2 ring-background',
                          t.isResolving ? 'bg-emerald-500' : 'bg-primary/70',
                        )} />
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className={cn('font-medium', t.isResolving && 'text-emerald-700 dark:text-emerald-400')}>{t.kindLabel}</span>
                          {t.dateLabel && <span className="text-[11px] text-muted-foreground/70">{t.dateLabel}</span>}
                        </div>
                        {ev && (
                          <div className="mt-1 text-[12px] text-muted-foreground">
                            {ev.documentFilename ?? 'Document'}
                            {ev.sourcePage && <span> · p.{ev.sourcePage}</span>}
                            {ev.href && (
                              <>
                                {' · '}
                                <Link href={ev.href} className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
                                  Ouvrir <ChevronRight className="h-3 w-3" />
                                </Link>
                              </>
                            )}
                            {ev.sourceExcerpt && <p className="mt-0.5 italic leading-snug">« {ev.sourceExcerpt} »</p>}
                          </div>
                        )}
                      </li>
                    )
                  })
                })()}
              </ul>
            )}
          </section>

          {/* §3 — Acteurs. Mandat Vincent : distinguer explicitement « acteur mentionné » de
              « responsable d'une Action précise » — jamais un total agrégé qui efface cette
              distinction, jamais une propagation automatique vers un rôle de responsable. */}
          <section className="rounded-[18px] border bg-card px-5 py-4 space-y-2">
            <h2 className={H2}>3. Acteurs</h2>
            {p.actors.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Aucun acteur explicitement identifié pour ce Point.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {p.actors.map((a) => {
                  const responsibleCount = a.responsibleActionCount + a.responsibleReserveCount + a.responsibleDeadlineCount
                  const detail: string[] = []
                  if (a.responsibleActionCount > 0) detail.push(`responsable de ${a.responsibleActionCount} action${a.responsibleActionCount > 1 ? 's' : ''}`)
                  if (a.responsibleReserveCount > 0) detail.push(`de ${a.responsibleReserveCount} réserve${a.responsibleReserveCount > 1 ? 's' : ''}`)
                  if (a.responsibleDeadlineCount > 0) detail.push(`de ${a.responsibleDeadlineCount} échéance${a.responsibleDeadlineCount > 1 ? 's' : ''}`)
                  return (
                    <li key={a.id} className="rounded-lg border px-2.5 py-1 text-[12.5px]">
                      {a.name}{a.fonction ? ` · ${a.fonction}` : ''}
                      <span className="text-muted-foreground">
                        {' — '}
                        {responsibleCount > 0 ? detail.join(', ') : 'mentionné, rôle non précisé'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>

        {/* Colonne latérale — métadonnées et récapitulatifs compacts. */}
        <aside className="space-y-4 lg:sticky lg:top-4">
          <section className="rounded-[16px] border bg-card px-4 py-3.5 space-y-2">
            <h2 className={H2}>Informations</h2>
            <dl className="space-y-1.5 text-[12.5px]">
              {p.ownerCanonicalSubjectLabel && (
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">Sujet lié</dt>
                  <dd className="text-right font-medium">{p.ownerCanonicalSubjectLabel}</dd>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-muted-foreground">Statut</dt>
                <dd className="text-right font-medium">{p.derivedStateLabel}</dd>
              </div>
              {p.createdAtLabel && (
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">Créé le</dt>
                  <dd className="text-right">{p.createdAtLabel}</dd>
                </div>
              )}
              {p.latestMeaningfulEventLabel && (
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">Dernière évolution</dt>
                  <dd className="text-right">{p.latestMeaningfulEventLabel}</dd>
                </div>
              )}
              {p.evidence[0]?.dateLabel && (
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">Dernière preuve</dt>
                  <dd className="text-right">{p.evidence[0].dateLabel}</dd>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 pt-1">
                <dt className="text-muted-foreground">Identité</dt>
                <dd>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{p.identityStatus}</span>
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-[16px] border bg-card px-4 py-3.5 space-y-2">
            <h2 className={H2}>Documents liés</h2>
            {p.evidence.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">Aucun document rattaché.</p>
            ) : (
              <ul className="space-y-1.5">
                {[...new Map(p.evidence.filter((e) => e.href).map((e) => [e.documentId, e])).values()].slice(0, 6).map((e) => (
                  <li key={e.documentId}>
                    <Link href={e.href!} className="flex items-center gap-1.5 text-[12.5px] text-primary hover:underline">
                      <FileText className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{e.documentFilename ?? 'Document'}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      {/* §7 — Identité / mémoire, secondaire, replié par défaut, zéro JS. */}
      <details className="rounded-[18px] border bg-card px-5 py-4">
        <summary className="cursor-pointer text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground/70">
          Détails techniques
        </summary>
        <dl className="mt-3 space-y-1.5 text-[12.5px]">
          <div className="flex gap-2"><dt className="w-40 shrink-0 text-muted-foreground">Point ID</dt><dd className="font-mono text-[11.5px]">{p.id}</dd></div>
          {p.ownerCanonicalSubjectId && (
            <div className="flex gap-2"><dt className="w-40 shrink-0 text-muted-foreground">Sujet canonique</dt><dd className="font-mono text-[11.5px]">{p.ownerCanonicalSubjectId}</dd></div>
          )}
          <div className="flex gap-2"><dt className="w-40 shrink-0 text-muted-foreground">Identité</dt><dd>{p.identityStatus}</dd></div>
          <div className="flex gap-2"><dt className="w-40 shrink-0 text-muted-foreground">Origine</dt><dd>{p.foundingKind}{p.foundingSource ? ` · ${p.foundingSource}` : ''}</dd></div>
          {p.hasUpstreamDefect && (
            <div className="flex gap-2"><dt className="w-40 shrink-0 text-muted-foreground">Défaut amont</dt><dd>oui</dd></div>
          )}
          {p.cboIds.length > 0 && (
            <div className="flex gap-2"><dt className="w-40 shrink-0 text-muted-foreground">Objets métier (CBO)</dt><dd className="font-mono text-[11.5px]">{p.cboIds.join(', ')}</dd></div>
          )}
          {p.mergedFrom.length > 0 && (
            <div className="flex gap-2">
              <dt className="w-40 shrink-0 text-muted-foreground">Fusionné depuis</dt>
              <dd>{p.mergedFrom.map((m) => m.label).join(', ')}</dd>
            </div>
          )}
        </dl>
      </details>
    </div>
  )
}
