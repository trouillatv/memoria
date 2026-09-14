// ── FICHE POINT — vue présentationnelle unique (6F, mandat Vincent) ──────────
//
// Un seul composant, monté sur desktop ET mobile (la grille 2 colonnes retombe
// naturellement en 1 colonne sous lg). Purement présentationnel : toute la
// logique (état dérivé, tri des preuves, résolution du Point merged) vient de
// `getTrackedPointDetail` — ce composant ne fait AUCUN calcul d'état.
//
// Priorité de lecture (6F.1, mandat Vincent) : « ce qu'il faut retenir
// aujourd'hui » tout en haut (synthèse + divergences/conflits non déjà cités),
// puis §1 À faire (liste unique, dédupliquée), puis §2 Film du Point (mandat
// Vincent 2026-09-14 : trajectoire documentaire + création/clôture Actions/
// Réserves, dédupliquée par buildPointFilm), puis §3 Acteurs. Informations/
// Documents liés restent secondaires en colonne latérale.
//
// UX : le conducteur ne doit jamais avoir besoin de comprendre canonical_subject,
// CBO, membership ou les UUID — ces notions restent dans le bloc « Détails
// techniques », replié par défaut (<details> natif, zéro JS).

import Link from 'next/link'
import { ChevronRight, FileText, HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  resolveOrigin,
  originMatchesProvenance,
  POINT_STATE_LABEL,
  type TrackedPointDetail,
  type PointDetailEvidence,
  type PointDetailLinkedObject,
  type PointDetailLinkedObjectGroup,
  type PointFilmMajorEvent,
  type PointFilmMajorKind,
  type PointFilmMentionGroup,
} from '@/lib/knowledge/tracked-point-detail'
import { MEMORIA_NEEDS_YOU_CATEGORY_LABELS, MEMORIA_NEEDS_YOU_CATEGORY_ORDER } from '@/lib/knowledge/tracked-point-needs-you-categories'
import { needsYouQuestionHref, type MemoriaNeedsYouQuestion } from '@/lib/knowledge/tracked-point-needs-you-summary'
import { PointActionMenu } from '@/components/knowledge/PointActionMenu'
import { PointCitedCompanyPromote } from '@/components/knowledge/PointCitedCompanyPromote'
import { PointResponsibleCompanyRevoke } from '@/components/knowledge/PointResponsibleCompanyRevoke'
import type { ResponsibleCandidate } from '@/lib/knowledge/action-responsible-candidates'
import type { SiteCandidateCompany } from '@/lib/db/site-intervenants'
import type { SubjectPointMiniContext } from '@/lib/knowledge/tracked-point-subject-context'

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

// Mini-frise Sujet (§2 bis, mandat Vincent 2026-09-14) : pastilles pleines, distinctes des
// badges STATE_CLS (fond+texte+ring, pensés pour un libellé) — ici un simple point de couleur.
const STATE_DOT_CLS: Record<TrackedPointDetail['derivedState'], string> = {
  unknown: 'bg-muted-foreground/40',
  open: 'bg-sky-500',
  resolved: 'bg-emerald-500',
  reopened: 'bg-orange-500',
  conflict: 'bg-rose-500',
}

const H2 = 'text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground'

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
  pointId,
  responsibleCandidates,
  companies,
}: {
  groups: PointDetailLinkedObjectGroup[]
  emptyLabel: string
  siteId: string
  pointId: string
  responsibleCandidates: ResponsibleCandidate[]
  companies: SiteCandidateCompany[]
}) {
  if (groups.length === 0) return <p className="px-1 py-2 text-[13px] text-muted-foreground">{emptyLabel}</p>
  return (
    <ul className="divide-y rounded-lg border">
      {groups.map((g) => {
        const o = g.representative
        return (
          <li
            key={g.key}
            className={cn('flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-3 py-2.5', o.isLate && 'bg-rose-50/50 dark:bg-rose-950/10')}
          >
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">
                {g.title}{g.count > 1 && <span className="ml-1.5 text-muted-foreground">— {g.count} occurrences</span>}
              </p>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-muted-foreground">
                <span>{OBJECT_TYPE_LABEL[g.objectType]}</span>
                {o.responsible && (
                  <span>
                    · {o.responsible.kind === 'text' ? `resp. (ancien suivi) ${o.responsible.label}` : o.responsible.name}
                  </span>
                )}
                {o.dueDateLabel && <span>· échéance {o.dueDateLabel}</span>}
              </div>
              {g.objectType === 'site_action' && <ActionSourcesLine group={g} />}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className={cn(
                'inline-block rounded-full px-2 py-0.5 text-[11px] font-medium',
                o.isLate ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
                  : o.isDone ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                  : 'bg-muted text-muted-foreground',
              )}>
                {o.isLate ? 'En retard' : o.statusLabel}
              </span>
              {o.objectType === 'site_action' && (
                <PointActionMenu action={o} siteId={siteId} pointId={pointId} responsibleCandidates={responsibleCandidates} companies={companies} />
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// Provenance documentaire d'un groupe d'Actions (mini-lot Vincent, « provenance des
// Actions dans la fiche Point ») — agrège les sources de TOUS les items du groupe
// (une occurrence = un site_actions.id, éventuellement sa propre source). Silence total
// si aucune source connue (saisie humaine/Copilote — jamais un manque affiché). Une seule
// source → ligne discrète cliquable ; plusieurs → `<details>` natif (zéro JS) listant
// chaque occurrence avec date, document, page, extrait, « Ouvrir dans le document » — la
// table principale elle-même n'affiche jamais le nom complet du document.
function ActionSourcesLine({ group }: { group: PointDetailLinkedObjectGroup }) {
  const sources = [...group.items.flatMap((i) => i.sources)].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  if (sources.length === 0) return null

  if (sources.length === 1) {
    const s = sources[0]
    return (
      <div className="mt-0.5 text-[11px] text-muted-foreground">
        Source :{' '}
        <Link href={s.href} className="font-medium text-primary hover:underline">
          PV du {s.dateLabel ?? '—'}{s.sourcePage ? ` · p.${s.sourcePage}` : ''}
        </Link>
      </div>
    )
  }

  const dates = sources.map((s) => s.dateLabel).filter((d): d is string => !!d)
  return (
    <details className="mt-0.5 text-[11px] text-muted-foreground">
      <summary className="cursor-pointer">
        {dates.length > 0 && <>PV {dates.join(' · ')} · </>}Voir les sources
      </summary>
      <ul className="mt-1.5 space-y-1.5 border-l pl-2.5">
        {sources.map((s, i) => (
          <li key={`${s.documentId}-${i}`}>
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              {s.dateLabel && <span>{s.dateLabel}</span>}
              {s.documentFilename && <span>· {s.documentFilename}</span>}
              {s.sourcePage && <span>· p.{s.sourcePage}</span>}
              <Link href={s.href} className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
                Ouvrir dans le document <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
            {s.sourceExcerpt && <p className="italic leading-snug text-foreground/80">« {s.sourceExcerpt} »</p>}
          </li>
        ))}
      </ul>
    </details>
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

// Film du Point (mandat Vincent, GO 2026-09-14) — deux niveaux de densité imposés : un
// événement majeur par ligne développée (date, preuve/source, lien) ; les répétitions
// sans changement d'état regroupées en une seule ligne compacte (jamais une frise de
// 40 mètres sur un Point ancien). Couleur du point = même doctrine que l'ancien §2
// (émeraude = clôture/résolution constatée, orange = réouverture, primaire sinon).
const FILM_DOT_CLS: Record<PointFilmMajorKind, string> = {
  apparition: 'bg-primary/70',
  resolution_constatee: 'bg-emerald-500',
  reouverture: 'bg-orange-500',
  transition_native: 'bg-primary/70',
  action_creee: 'bg-sky-500',
  action_cloturee: 'bg-emerald-500',
  reserve_creee: 'bg-sky-500',
  reserve_levee: 'bg-emerald-500',
}
const FILM_EMPHASIS_KINDS: PointFilmMajorKind[] = ['resolution_constatee', 'action_cloturee', 'reserve_levee']

function FilmMajorEventRow({ event }: { event: PointFilmMajorEvent }) {
  return (
    <li className="relative text-[13px]">
      <span className={cn('absolute -left-[18px] top-1 h-2 w-2 rounded-full ring-2 ring-background', FILM_DOT_CLS[event.kind])} />
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className={cn('font-medium', FILM_EMPHASIS_KINDS.includes(event.kind) && 'text-emerald-700 dark:text-emerald-400')}>
          {event.label}
        </span>
        {event.dateLabel && <span className="text-[11px] text-muted-foreground/70">{event.dateLabel}</span>}
      </div>
      {(event.href || event.documentLabel || event.sourceNote) && (
        <div className="mt-1 text-[12px] text-muted-foreground">
          {event.documentLabel && <span>{event.documentLabel}</span>}
          {event.href ? (
            <>
              {event.documentLabel && ' · '}
              <Link href={event.href} className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
                Ouvrir dans le document <ChevronRight className="h-3 w-3" />
              </Link>
            </>
          ) : (
            event.sourceNote && <span>{event.sourceNote}</span>
          )}
        </div>
      )}
    </li>
  )
}

// Ligne compacte des ré-occurrences sans changement d'état — dates repliées, lien
// « Voir les preuves » uniquement si une preuve documentaire existe pour le bloc.
function FilmMentionGroupRow({ group }: { group: PointFilmMentionGroup }) {
  return (
    <li className="relative text-[12.5px] text-muted-foreground/90">
      <span className="absolute -left-[15px] top-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/30 ring-2 ring-background" />
      <span>{group.label} <span className="text-muted-foreground/70">({group.stateLabel})</span></span>
      {group.dateLabels.length > 0 && <span className="text-muted-foreground/70"> — {group.dateLabels.join(' · ')}</span>}
      {group.href && (
        <>
          {' — '}
          <Link href={group.href} className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
            Voir les preuves <ChevronRight className="h-3 w-3" />
          </Link>
        </>
      )}
    </li>
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
// chantier — jamais un choix arbitraire parmi plusieurs questions concernées. `fromPoint`/
// `fromLabel` (mandat item 6, 2026-09-13 ; TOUJOURS présents depuis la correction recette du même
// jour, y compris quand plusieurs questions concernent le Point) permettent à besoin-de-toi
// d'afficher le Point d'origine, un retour explicite, ET de se recentrer sur les seules questions
// de ce Point plutôt que la boîte générale (correction 3).
function NeedsYouForPointSection({
  questions,
  href,
  pointId,
  pointLabel,
}: {
  questions: MemoriaNeedsYouQuestion[]
  href?: string
  pointId: string
  pointLabel: string
}) {
  if (questions.length === 0 || !href) return null
  const base = questions.length === 1 ? needsYouQuestionHref(href, questions[0].id) : href
  const params = new URLSearchParams({ fromPoint: pointId, fromLabel: pointLabel })
  const targetHref = `${base}${base.includes('?') ? '&' : '?'}${params.toString()}`
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
          Clarifier <ChevronRight className="h-3.5 w-3.5" />
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
  subjectMiniContext = null,
  subjectHref,
}: {
  point: TrackedPointDetail
  backHref: string
  backLabel: string
  needsYouQuestions?: MemoriaNeedsYouQuestion[]
  needsYouHref?: string
  responsibleCandidates?: ResponsibleCandidate[]
  companies?: SiteCandidateCompany[]
  subjectMiniContext?: SubjectPointMiniContext | null
  subjectHref?: string
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
      <NeedsYouForPointSection questions={needsYouQuestions} href={needsYouHref} pointId={p.id} pointLabel={p.label} />

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
              pointId={p.id}
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

          {/* §2 — Film du Point (mandat Vincent, GO 2026-09-14) : composition unique
              (trajectoire documentaire + création/clôture Actions/Réserves), dédupliquée
              en amont par `buildPointFilm`. Deux niveaux de densité : événements majeurs
              développés, ré-occurrences sans changement regroupées en une ligne compacte.
              Échéances et resolution_claimed hors périmètre V1 — jamais d'historique
              d'état natif intermédiaire (cf. lib/knowledge/tracked-point-detail.ts). */}
          <section className="rounded-[18px] border bg-card px-5 py-4 space-y-2">
            <div>
              <h2 className={H2}>2. Film du Point</h2>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                Toute l’histoire connue de ce Point, dans l’ordre chronologique.
              </p>
            </div>
            {p.film.mergeDisclaimer && (
              <p className="rounded-md bg-amber-50/60 px-2.5 py-1.5 text-[12px] text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                {p.film.mergeDisclaimer}
              </p>
            )}
            {p.film.items.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Aucun événement ni preuve documentaire enregistré pour ce Point.</p>
            ) : (
              <ul className="space-y-3 border-l border-border pl-3.5">
                {p.film.items.map((item) => item.type === 'major'
                  ? <FilmMajorEventRow key={item.event.key} event={item.event} />
                  : <FilmMentionGroupRow key={item.group.key} group={item.group} />)}
              </ul>
            )}
            <p className="pt-1 text-[12px] font-medium text-muted-foreground">
              {p.film.todayLabel}{p.film.sinceSummary ? ` · ${p.film.sinceSummary}` : ''}
            </p>
          </section>

          {/* Mini-contexte Sujet (mandat Vincent, GO Option B, 2026-09-14 ; recette validée
              2026-09-14) : rappelle où ce Point se situe dans son sujet, sans reconstruire la fiche
              Sujet. Filtré depuis l'origine à ownerCanonicalSubjectId (jamais un recalcul site
              entier) — cf. loadSubjectPointMiniContext. Volontairement non numéroté : ceci reste un
              aside contextuel entre le Film (§2) et les Acteurs (§3), pas une nouvelle rubrique de
              même rang — confirmé par Vincent (renuméroter Acteurs/Informations/Documents pour ce
              bloc lui donnerait trop de poids). Reste volontairement compact : une ligne de synthèse
              + mini-frise + CTA, jamais une mini-fiche Sujet. Mini-frise en lecture seule (pastilles,
              ordre chronologique — cf. doctrine dans tracked-point-subject-context.ts), pas une
              navigation point-à-point — un seul lien de sortie : le sujet complet. Le Point courant
              est signalé par une pastille agrandie + légende dédiée, jamais par le seul tooltip. */}
          {subjectMiniContext && subjectMiniContext.totalPoints > 0 && (
            <section className="rounded-[18px] border bg-card px-5 py-4 space-y-2">
              <h2 className={H2}>Ce sujet</h2>
              <p className="text-[13px] text-muted-foreground">
                {p.ownerCanonicalSubjectLabel && <span className="font-medium text-foreground">{p.ownerCanonicalSubjectLabel}</span>}
                {p.ownerCanonicalSubjectLabel ? ' — ' : ''}
                {subjectMiniContext.totalPoints} Point{subjectMiniContext.totalPoints > 1 ? 's' : ''}
                {(() => {
                  const parts = [
                    subjectMiniContext.reopened > 0 ? `${subjectMiniContext.reopened} réouvert${subjectMiniContext.reopened > 1 ? 's' : ''}` : null,
                    subjectMiniContext.open > 0 ? `${subjectMiniContext.open} ouvert${subjectMiniContext.open > 1 ? 's' : ''}` : null,
                    subjectMiniContext.conflict > 0 ? `${subjectMiniContext.conflict} en conflit` : null,
                    subjectMiniContext.unknown > 0 ? `${subjectMiniContext.unknown} indéterminé${subjectMiniContext.unknown > 1 ? 's' : ''}` : null,
                    subjectMiniContext.resolved > 0 ? `${subjectMiniContext.resolved} résolu${subjectMiniContext.resolved > 1 ? 's' : ''}` : null,
                  ].filter(Boolean)
                  return parts.length > 0 ? ` (${parts.join(', ')})` : ''
                })()}
              </p>

              {subjectMiniContext.crossSubjectMergeDetected && (
                <p className="rounded-md bg-amber-50/60 px-2.5 py-1.5 text-[11.5px] text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                  Une fusion touche ce sujet au-delà de ce que cette vue peut vérifier — chaque Point est compté isolément par prudence.
                </p>
              )}

              {subjectMiniContext.points.length > 1 && (
                <ul className="flex flex-wrap items-start gap-x-3 gap-y-1 pt-0.5">
                  {/* Point courant identifiable au premier coup d'œil (retour Vincent en recette :
                      pas un tooltip) : pastille nettement plus grande + anneau + légende dédiée,
                      jamais la seule ressource pour repérer le Point courant dans la frise. */}
                  {subjectMiniContext.points.map((sp) => (
                    <li key={sp.id} className="flex flex-col items-center gap-1">
                      <span
                        title={`${sp.label} — ${POINT_STATE_LABEL[sp.derivedState] ?? sp.derivedState}`}
                        className={cn(
                          'rounded-full',
                          STATE_DOT_CLS[sp.derivedState],
                          sp.isCurrent ? 'h-4 w-4 ring-2 ring-offset-2 ring-foreground' : 'h-2 w-2',
                        )}
                      />
                      {sp.isCurrent && (
                        <span className="text-[9px] font-semibold uppercase tracking-wide text-foreground">Ce Point</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {subjectHref && (
                <Link
                  href={`${subjectHref}${subjectHref.includes('?') ? '&' : '?'}${new URLSearchParams({ fromPoint: p.id, fromLabel: p.label }).toString()}`}
                  className="inline-flex items-center gap-1 pt-0.5 text-[12.5px] font-medium text-foreground hover:underline"
                >
                  Voir le sujet complet <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </section>
          )}

          {/* §3 — Responsables / Entreprises citées (mandat Vincent 2026-09-14, lot Entreprise
              citée → Responsable, cas Clim Exp'Air) : deux sections distinctes — un responsable
              structuré (FK explicite sur un objet lié, ou désignation humaine explicite d'une
              entreprise citée) n'est jamais confondu avec une simple citation textuelle. */}
          <section className="rounded-[18px] border bg-card px-5 py-4 space-y-2">
            <h2 className={H2}>3. Responsables</h2>
            {p.actors.length === 0 && p.responsibleCompanyDesignations.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Aucun responsable structuré.</p>
            ) : (
              <>
                {p.actors.length > 0 && (
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
                {p.responsibleCompanyDesignations.length > 0 && (
                  <div className={p.actors.length > 0 ? 'pt-1.5' : undefined}>
                    <p className="text-[11px] font-medium text-muted-foreground">Responsables du Point</p>
                    <p className="text-[11px] text-muted-foreground">
                      La responsabilité du Point ne modifie pas automatiquement les actions et réserves liées.
                    </p>
                    <ul className="mt-1 flex flex-wrap gap-2">
                      {p.responsibleCompanyDesignations.map((d) => (
                        <li key={d.id} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-2.5 py-1 text-[12.5px] dark:border-sky-800 dark:bg-sky-950/30">
                          <span>Responsable : {d.companyName}</span>
                          <PointResponsibleCompanyRevoke siteId={p.siteId} pointId={p.id} designationId={d.id} companyName={d.companyName} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
            {p.citedCompanies.length > 0 && (
              <div className="pt-1.5">
                <p className="text-[11px] font-medium text-muted-foreground">Entreprises citées dans les preuves</p>
                <ul className="mt-1 flex flex-wrap items-center gap-2">
                  {p.citedCompanies.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed px-2.5 py-1 text-[12.5px] text-muted-foreground">
                      <span>{c.name}</span>
                      <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-medium">Citée dans les preuves</span>
                      {c.companyId && (
                        <PointCitedCompanyPromote siteId={p.siteId} pointId={p.id} companyId={c.companyId} companyName={c.name} />
                      )}
                    </li>
                  ))}
                </ul>
              </div>
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
