'use client'

// 6E.4A — les 5 corps de carte, un par catégorie métier de MemoriaNeedsYouQuestion. Aucune
// carte ne rend de vocabulaire DB (proposal_set, identity_candidate, PROVISIONAL...) — seul le
// libellé de catégorie déjà en langage métier (MEMORIA_NEEDS_YOU_CATEGORY_LABELS) sert d'entête.
//
// Langage visuel réutilisé tel quel (aucune nouvelle identité graphique, cf. arbitrage Vincent) :
// carte = ActionsPilotageClient/CopilotProposalCards (rounded-2xl border border-foreground/10
// bg-card p-3), bouton primaire = violet-500 (CopilotProposalCards), sélection radio =
// MemoryReviewPanel (border-primary bg-primary/10).

import { useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Copy, FileSearch, FileText, HelpCircle, Link2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MemoriaNeedsYouQuestion } from '@/lib/knowledge/tracked-point-needs-you-summary'
import { MEMORIA_NEEDS_YOU_CATEGORY_LABELS, type MemoriaNeedsYouCategory } from '@/lib/knowledge/tracked-point-needs-you-categories'
import { MEMORIA_NEEDS_YOU_PRIORITY_LABEL, type MemoriaNeedsYouPriority } from '@/lib/knowledge/tracked-point-needs-you-priority'
import type { PendingResolutionTargetingMode } from '@/lib/knowledge/tracked-point-pending-resolution-queue'
import type { PointProofView } from '@/lib/knowledge/tracked-point-consolidation-queue'
import { documentHref } from '@/lib/knowledge/document-href'
import {
  duplicatePointsImpact,
  duplicatePointsConservedLabel,
  attachInformationImpact,
  confirmTrackabilityImpact,
  assignResolutionImpact,
  clarifyEvidenceImpact,
} from '@/lib/knowledge/tracked-point-needs-you-impact'

// Palette réutilisée telle quelle depuis MemoryReviewPanel.KIND_TONE (border-*-200 bg-*-50
// text-*-700) — aucune nouvelle couleur, simple ré-application par catégorie 6E.4A pour que
// chaque carte se distingue au premier coup d'œil dans la file.
export const CATEGORY_TONE: Record<MemoriaNeedsYouCategory, { border: string; iconBg: string; iconText: string; accent: string }> = {
  duplicate_points: { border: 'border-l-violet-400', iconBg: 'bg-violet-100 dark:bg-violet-900/40', iconText: 'text-violet-700 dark:text-violet-300', accent: 'text-violet-700 dark:text-violet-300' },
  attach_information: { border: 'border-l-sky-400', iconBg: 'bg-sky-100 dark:bg-sky-900/40', iconText: 'text-sky-700 dark:text-sky-300', accent: 'text-sky-700 dark:text-sky-300' },
  confirm_trackability: { border: 'border-l-amber-400', iconBg: 'bg-amber-100 dark:bg-amber-900/40', iconText: 'text-amber-700 dark:text-amber-300', accent: 'text-amber-700 dark:text-amber-300' },
  assign_resolution: { border: 'border-l-indigo-400', iconBg: 'bg-indigo-100 dark:bg-indigo-900/40', iconText: 'text-indigo-700 dark:text-indigo-300', accent: 'text-indigo-700 dark:text-indigo-300' },
  clarify_evidence: { border: 'border-l-emerald-400', iconBg: 'bg-emerald-100 dark:bg-emerald-900/40', iconText: 'text-emerald-700 dark:text-emerald-300', accent: 'text-emerald-700 dark:text-emerald-300' },
}

export const CATEGORY_ICON: Record<MemoriaNeedsYouCategory, typeof Copy> = {
  duplicate_points: Copy,
  attach_information: Link2,
  confirm_trackability: HelpCircle,
  assign_resolution: CheckCircle2,
  clarify_evidence: FileSearch,
}

// 6E.4A.4 — badge de priorité auditable : le tri "Plus important" ne doit jamais rester un score
// invisible, chaque carte affiche le palier réellement calculé (tracked-point-needs-you-priority.ts).
const PRIORITY_TONE: Record<MemoriaNeedsYouPriority, string> = {
  PRIORITAIRE: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  A_CLARIFIER: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  IMPORTANT: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  HISTORIQUE: 'bg-muted text-muted-foreground',
}

function PriorityBadge({ priority }: { priority: MemoriaNeedsYouPriority }) {
  return (
    <span className={cn('absolute right-3 top-3 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold', PRIORITY_TONE[priority])}>
      {MEMORIA_NEEDS_YOU_PRIORITY_LABEL[priority]}
    </span>
  )
}

const btnPrimary = 'rounded-full bg-violet-500 px-3.5 py-1.5 text-[12px] font-medium text-white hover:bg-violet-600 disabled:opacity-40'
const btnSecondary = 'rounded-full border border-border px-3.5 py-1.5 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-40'

// 6E.8A — durées fixes uniquement (mandat Vincent, audit 6E.8 ASK_LATER_MODEL_MISSING) : jamais
// de date libre côté client, la même liste que DEFER_DURATION_DAYS (tracked-point-pending-
// resolution.ts), revalidée côté serveur dans deferPendingTraceAction.
const DEFER_DURATION_CHOICES: { days: 1 | 7 | 30; label: string }[] = [
  { days: 1, label: 'Dans 1 jour' },
  { days: 7, label: 'Dans 7 jours' },
  { days: 30, label: 'Dans 30 jours' },
]
const radioRow = (active: boolean, disabled: boolean) =>
  cn(
    'w-full rounded-lg border px-2.5 py-2 text-left text-[12px] transition-colors',
    disabled ? 'cursor-not-allowed bg-muted/30 text-muted-foreground/60' : active ? 'border-primary bg-primary/10 font-semibold text-primary' : 'bg-background hover:bg-muted/40',
  )

function formatDateFr(iso: string | null): string | null {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch {
    return null
  }
}

// Vérité temporelle (6E.4A.1) : la date métier (PV/visite, `documents.effective_date`) est
// TOUJOURS prioritaire sur la date d'import (`created_at`) — un document importé aujourd'hui
// peut décrire une visite d'il y a trois mois. La date d'import n'apparaît qu'en repli explicite,
// jamais confondue avec la date du PV.
function provenanceLine(effectiveDate: string | null | undefined, page: number | null | undefined, importedAt: string | null | undefined): string | null {
  const businessDateFr = formatDateFr(effectiveDate ?? null)
  if (businessDateFr) return `PV du ${businessDateFr}${page ? ` · page ${page}` : ''}`
  const importedDateFr = formatDateFr(importedAt ?? null)
  return importedDateFr ? `Importé le ${importedDateFr} (date du PV inconnue)` : null
}

// 6E.7 — porte unique vers le document source : ne rend un lien QUE quand documentHref peut
// honnêtement déterminer une destination (documentId ET documentType réellement connus). Jamais
// de fabrication de site_id/litige/page ; jamais une copie de la logique de documentHref.
function DocumentSourceLink({
  documentId,
  documentType,
  siteId,
}: {
  documentId?: string | null
  documentType?: string | null
  siteId?: string | null
}) {
  if (!documentId || !documentType) return null
  return (
    <Link
      href={documentHref({ id: documentId, document_type: documentType }, siteId)}
      className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary underline decoration-dotted underline-offset-2 hover:text-primary/80"
    >
      <FileText className="h-3 w-3" />
      Ouvrir le document source
    </Link>
  )
}

// Distinction non négociable (6E.4B/A2, mandat Vincent 2026-09-08) : `sourceExcerpt` est le texte
// PERSISTÉ tel quel au moment de l'extraction (jamais reformulé après coup) — seul ce texte peut
// être présenté comme une citation du PV. `label` est une reformulation de l'IA d'extraction :
// utile comme repère, mais jamais présenté comme « Extrait du PV » quand ce n'en est pas un.
function SourceExcerpt({
  label,
  sourceExcerpt,
  hasVerbatimExcerpt,
  documentFilename,
  effectiveDate,
  page,
  importedAt,
  documentId,
  documentType,
  siteId,
}: {
  label: string | null
  sourceExcerpt?: string | null
  hasVerbatimExcerpt?: boolean
  documentFilename?: string | null
  effectiveDate?: string | null
  page?: number | null
  importedAt?: string | null
  documentId?: string | null
  documentType?: string | null
  siteId?: string | null
}) {
  const dateLine = provenanceLine(effectiveDate, page, importedAt)
  const quote = hasVerbatimExcerpt && sourceExcerpt ? sourceExcerpt : null
  const text = quote ?? label
  if (!text && !documentFilename) return null
  return (
    <div className="rounded-lg border border-dashed bg-muted/30 px-2.5 py-2 text-[12px] text-foreground/80">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
        {quote ? 'Extrait du PV' : 'Information extraite'}
      </p>
      {text && <p className="mt-0.5 line-clamp-3">{quote ? `« ${text} »` : text}</p>}
      {(documentFilename || dateLine) && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {[documentFilename, dateLine].filter(Boolean).join(' · ')}
        </p>
      )}
      <DocumentSourceLink documentId={documentId} documentType={documentType} siteId={siteId} />
    </div>
  )
}

// 6E.4B/A2 — "Voir les preuves" sous chaque Point comparé (mandat Vincent 2026-09-08) : un CBO
// (`cboCount`) est une obligation métier, JAMAIS une preuve documentaire — cette disclosure lit
// exclusivement `PointProofView` (memberships HARD → document_extraction_proposal, cf.
// loadPointProofsByPointId). Repliée par défaut ; `proofs` est déjà plafonné à 3 côté read-model,
// `proofCount` reste le total réel pour "Voir N autres" ; jamais de page/date fabriquée
// (provenanceLine ne complète que si la date métier existe réellement).
function PointProofDisclosure({ proofs, proofCount, siteId }: { proofs: PointProofView[]; proofCount: number; siteId: string }) {
  const [open, setOpen] = useState(false)
  if (proofCount === 0) {
    return <p className="mt-1 text-[11px] text-muted-foreground/70">Aucune preuve documentaire disponible.</p>
  }
  const hiddenCount = proofCount - proofs.length
  return (
    <div className="mt-1">
      <button
        type="button"
        className="text-[11px] font-medium text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Masquer les preuves' : `Voir les preuves (${proofCount})`}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5">
          {proofs.map((proof) => {
            const dateLine = provenanceLine(proof.effectiveDate, proof.sourcePage, null)
            const quote = proof.hasVerbatimExcerpt && proof.sourceExcerpt ? proof.sourceExcerpt : null
            const text = quote ?? proof.extractedLabel
            return (
              <div key={proof.proposalId} className="rounded-lg border border-dashed bg-muted/30 px-2.5 py-2 text-[12px] text-foreground/80">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                  {quote ? 'Extrait du PV' : 'Information extraite'}
                </p>
                <p className="mt-0.5 line-clamp-3">{quote ? `« ${text} »` : text}</p>
                {(proof.documentFilename || dateLine) && (
                  <p className="mt-1 text-[11px] text-muted-foreground">{[proof.documentFilename, dateLine].filter(Boolean).join(' · ')}</p>
                )}
                <DocumentSourceLink documentId={proof.documentId} documentType={proof.documentType} siteId={siteId} />
              </div>
            )
          })}
          {hiddenCount > 0 && (
            <p className="text-[11px] text-muted-foreground/80">Voir {hiddenCount} autre{hiddenCount > 1 ? 's' : ''}</p>
          )}
        </div>
      )}
    </div>
  )
}

const DERIVED_STATE_LABEL: Record<string, string> = {
  open: 'Ouvert',
  reopened: 'Réouvert',
  resolved: 'Résolu',
  unknown: 'Indéterminé',
  conflict: 'En conflit',
}

function derivedStateLabel(state: string | null | undefined): string | null {
  if (!state) return null
  return DERIVED_STATE_LABEL[state] ?? state
}

// 6E.4B/A1 — "Pourquoi MemorIA me demande ça ?" : repliée par défaut, jamais une explication
// inventée. Chaque texte ci-dessous ne s'appuie que sur des champs réels déjà chargés par les
// read-models (jamais un nouveau calcul, jamais le champ brut `reason` dont le contenu réel n'a
// pas pu être confirmé côté extraction — cf. mandat Vincent 2026-09-08).
function QuestionRationale({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        type="button"
        className="text-[11px] font-medium text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Masquer pourquoi MemorIA me demande ça' : 'Pourquoi MemorIA me demande ça ?'}
      </button>
      {open && <p className="mt-1 text-[12px] text-foreground/80">{text}</p>}
    </div>
  )
}

function duplicatePointsRationale(entry: Extract<MemoriaNeedsYouQuestion, { category: 'duplicate_points' }>['entry']): string {
  const sameSubject = entry.pointA.subjectLabel && entry.pointB.subjectLabel && entry.pointA.subjectLabel === entry.pointB.subjectLabel
  const base = sameSubject
    ? `Ces deux suivis sont rattachés au même sujet (« ${entry.pointA.subjectLabel} »), ce qui fait hésiter MemorIA entre un seul suivi ou deux suivis distincts.`
    : "MemorIA a identifié ces deux suivis comme candidats à une vérification d'identité et préfère te demander avant de les réunir."
  const extra = entry.componentSize > 2 ? ' Ils appartiennent à un ensemble de suivis proches, comparés ici deux par deux.' : ''
  return `${base}${extra} Elle ne fusionne jamais automatiquement deux suivis : une fusion incorrecte est plus difficile à corriger qu'une question posée en trop.`
}

function attachInformationRationale(entry: Extract<MemoriaNeedsYouQuestion, { category: 'attach_information' }>['entry']): string {
  if (entry.targetCount <= 1) {
    return "Cette information a été extraite d'un PV sans qu'aucun suivi ne soit mentionné explicitement dedans — MemorIA propose le suivi qui lui semble le plus probable, mais te laisse confirmer avant de l'associer."
  }
  return `Cette information pourrait concerner plusieurs suivis (${entry.targetCount} possibles) — MemorIA ne choisit pas à ta place, à toi d'indiquer lequel est le bon.`
}

function confirmTrackabilityRationale(entry: Extract<MemoriaNeedsYouQuestion, { category: 'confirm_trackability' }>['entry']): string {
  const subject = entry.subjectLabel ? ` (à propos de « ${entry.subjectLabel} »)` : ''
  return `MemorIA a repéré une situation dans un PV${subject} qui n'est encore rattachée à aucun suivi. Elle ne crée jamais de suivi toute seule : elle te demande si cela mérite d'être suivi dans la durée.`
}

const TARGETING_MODE_RATIONALE: Record<PendingResolutionTargetingMode, string> = {
  KNOWN_SINGLE: 'Cette preuve semble correspondre à un suivi déjà identifié — MemorIA te demande de confirmer avant de le faire évoluer.',
  KNOWN_MULTI: 'Cette preuve pourrait correspondre à plusieurs suivis déjà identifiés — MemorIA ne choisit pas à ta place.',
  SUBJECT_SINGLE: 'Cette preuve concerne un sujet que MemorIA connaît, mais aucun suivi précis ne s\'impose de lui-même.',
  SUBJECT_MULTI: 'Cette preuve concerne un sujet pour lequel plusieurs suivis existent — indique lequel est concerné.',
  SEARCH_REQUIRED: "MemorIA n'a trouvé aucun suivi apparenté à cette preuve parmi ce qu'elle connaît déjà — c'est à toi de le retrouver.",
  EVIDENCE_SCOPE_UNRESOLVED: "MemorIA doit d'abord savoir quelle information constitue la preuve avant de pouvoir proposer un suivi.",
}

function assignResolutionRationale(entry: Extract<MemoriaNeedsYouQuestion, { category: 'assign_resolution' }>['entry']): string {
  return TARGETING_MODE_RATIONALE[entry.targetingMode]
}

function clarifyEvidenceRationale(entry: Extract<MemoriaNeedsYouQuestion, { category: 'clarify_evidence' }>['entry']): string {
  const topic = entry.kind === 'TRACKABILITY_UNDETERMINED' ? 'si cette situation doit être suivie' : 'quel suivi cette preuve résout'
  const count = entry.proposalCount > 1 ? `${entry.proposalCount} informations ont été extraites du même passage` : 'Une seule information a été extraite ici'
  const lead = entry.proposalCount > 1 ? `${count.charAt(0).toUpperCase()}${count.slice(1)}` : count
  return `${lead}, mais MemorIA ne sait pas laquelle permet de trancher ${topic}. Choisis celle(s) qui font vraiment foi.`
}

// ImpactPreview (6E.4C) — "Ce qui va changer" avant une confirmation structurante : rendu
// uniquement à partir de textes produits par lib/knowledge/tracked-point-needs-you-impact.ts,
// eux-mêmes dérivés des mutations réelles des actions serveur déjà utilisées par 6E.4A. Même
// convention visuelle neutre que SourceExcerpt/PointProofDisclosure (jamais le ton violet du
// panneau de confirmation, pour rester réutilisable sur les 5 teintes de carte).
function ImpactPreview({ items }: { items: string[] }) {
  if (items.length === 0) return null
  return (
    <div className="rounded-lg border border-dashed bg-muted/30 px-2.5 py-2 text-[12px] text-foreground/80">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">Ce qui va changer</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

function CardShell({ category, title, children }: { category: MemoriaNeedsYouCategory; title: string; children: React.ReactNode }) {
  const tone = CATEGORY_TONE[category]
  const Icon = CATEGORY_ICON[category]
  return (
    <div className={cn('space-y-2.5 rounded-2xl border border-l-4 border-foreground/10 bg-card p-3', tone.border)}>
      <div className="flex items-center gap-2">
        <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full', tone.iconBg)}>
          <Icon className={cn('h-3.5 w-3.5', tone.iconText)} />
        </span>
        <p className={cn('text-[11px] font-medium uppercase tracking-wide', tone.accent)}>{MEMORIA_NEEDS_YOU_CATEGORY_LABELS[category]}</p>
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </div>
  )
}

function ErrorLine({ error }: { error?: string }) {
  if (!error) return null
  return <p className="text-[12px] text-rose-600 dark:text-rose-400">{error}</p>
}

export type ActionResult = { ok: boolean; error?: string }

export type SitePointOption = { id: string; label: string }

// 6E.4D — `recapLabel` distingue un geste de clarification positif d'un rejet/report : omis
// (undefined) pour "Ce n'est pas ce suivi"/"Non"/"Écarter cette question" (aucune ligne de recap) ;
// passé (string | null) pour les 5 confirmations positives, avec le même libellé déjà affiché à
// l'utilisateur avant confirmation (jamais un texte recalculé) — null quand aucun libellé réel
// n'existe pour ce cas (ex. confirm_trackability sans subjectLabel).
//
// 6E.8A — `deferredDays` est un troisième canal, structurellement séparé de `recapLabel` : un
// report n'est ni un rejet ni une clarification métier, il ne doit JAMAIS alimenter le récap
// 6E.4D (mandat Vincent, audit 6E.8). Seul le bouton "Me le redemander…" le renseigne.
export type QuestionCardProps = {
  question: MemoriaNeedsYouQuestion
  siteId: string
  pending: boolean
  error?: string
  sitePoints: SitePointOption[]
  priority: MemoriaNeedsYouPriority
  runAction: (action: () => Promise<ActionResult>, recapLabel?: string | null, deferredDays?: 1 | 7 | 30) => void
}

export function QuestionCard({ question, siteId, pending, error, sitePoints, priority, runAction }: QuestionCardProps) {
  return (
    <div className="relative">
      <PriorityBadge priority={priority} />
      {(() => {
        switch (question.category) {
          case 'duplicate_points':
            return <DuplicatePointsCard entry={question.entry} siteId={siteId} pending={pending} error={error} runAction={runAction} />
          case 'attach_information':
            return <AttachInformationCard entry={question.entry} siteId={siteId} pending={pending} error={error} runAction={runAction} />
          case 'confirm_trackability':
            return <ConfirmTrackabilityCard entry={question.entry} siteId={siteId} pending={pending} error={error} runAction={runAction} />
          case 'assign_resolution':
            return <AssignResolutionCard entry={question.entry} siteId={siteId} pending={pending} error={error} sitePoints={sitePoints} runAction={runAction} />
          case 'clarify_evidence':
            return <ClarifyEvidenceCard entry={question.entry} siteId={siteId} pending={pending} error={error} runAction={runAction} />
          default:
            return null
        }
      })()}
    </div>
  )
}

// ── 1. Identité — "Ces deux suivis sont-ils les mêmes ?" ──────────────────────────────────────

function DuplicatePointsCard({
  entry,
  siteId,
  pending,
  error,
  runAction,
}: {
  entry: Extract<MemoriaNeedsYouQuestion, { category: 'duplicate_points' }>['entry']
  siteId: string
  pending: boolean
  error?: string
  runAction: QuestionCardProps['runAction']
}) {
  // overmerge > undermerge en toxicité (doctrine identité) : les deux issues doivent avoir le
  // même poids visuel — aucun CTA ne pousse implicitement vers la fusion — et « même suivi »
  // passe par une confirmation explicite avant d'écrire quoi que ce soit (Vincent 2026-09-08).
  const [confirmingMerge, setConfirmingMerge] = useState(false)
  return (
    <CardShell category="duplicate_points" title="Ces deux suivis sont-ils les mêmes ?">
      <QuestionRationale text={duplicatePointsRationale(entry)} />
      {entry.componentSize > 2 && (
        <p className="text-[12px] text-amber-600 dark:text-amber-400">
          Plusieurs suivis proches existent pour ce sujet — comparés ici deux par deux, jamais regroupés en une seule fois.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        {[entry.pointA, entry.pointB].map((side) => {
          const stateLabel = derivedStateLabel(side.derivedState)
          const firstFr = formatDateFr(side.firstAppearanceAt)
          const lastFr = formatDateFr(side.lastAppearanceAt)
          return (
            <div key={side.id} className="rounded-lg border bg-background px-2.5 py-2 text-[12px]">
              <p className="font-medium">{side.label}</p>
              {(stateLabel || side.subjectLabel) && (
                <p className="mt-1 text-muted-foreground">
                  {[stateLabel, side.subjectLabel].filter(Boolean).join(' · ')}
                </p>
              )}
              <p className="mt-1 text-muted-foreground">
                {side.proofCount} preuve{side.proofCount > 1 ? 's' : ''} · {side.hardMemberCount} élément{side.hardMemberCount > 1 ? 's' : ''} rattaché{side.hardMemberCount > 1 ? 's' : ''}
              </p>
              {firstFr && <p className="mt-1 text-[11px] text-muted-foreground/80">Première apparition : {firstFr}</p>}
              {lastFr && <p className="mt-0.5 text-[11px] text-muted-foreground/80">Dernière activité : {lastFr}</p>}
              <PointProofDisclosure proofs={side.proofs} proofCount={side.proofCount} siteId={siteId} />
            </div>
          )
        })}
      </div>
      <ErrorLine error={error} />
      {confirmingMerge ? (
        <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/50 px-2.5 py-2 dark:border-violet-900/40 dark:bg-violet-950/20">
          <p className="text-[12px] text-foreground/80">Réunir ces deux suivis ? Leur historique sera présenté comme un seul suivi.</p>
          <ImpactPreview items={duplicatePointsImpact(entry)} />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={btnPrimary}
              disabled={pending}
              onClick={() =>
                runAction(
                  () => import('../tracked-point-consolidation-actions').then((m) => m.consolidateTrackedPointsAction({ siteId, pairId: entry.pairId })),
                  duplicatePointsConservedLabel(entry),
                )
              }
            >
              Confirmer la fusion
            </button>
            <button type="button" className={btnSecondary} disabled={pending} onClick={() => setConfirmingMerge(false)}>
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" className={btnSecondary} disabled={pending} onClick={() => setConfirmingMerge(true)}>
            C&apos;est le même suivi
          </button>
          <button
            type="button"
            className={btnSecondary}
            disabled={pending}
            onClick={() => runAction(() => import('../tracked-point-consolidation-actions').then((m) => m.rejectPointIdentityPairAction({ siteId, pairId: entry.pairId })))}
          >
            Ce sont deux suivis différents
          </button>
        </div>
      )}
    </CardShell>
  )
}

// ── 2. Rattachement — "Cette information concerne-t-elle ce suivi ?" ──────────────────────────

function AttachInformationCard({
  entry,
  siteId,
  pending,
  error,
  runAction,
}: {
  entry: Extract<MemoriaNeedsYouQuestion, { category: 'attach_information' }>['entry']
  siteId: string
  pending: boolean
  error?: string
  runAction: QuestionCardProps['runAction']
}) {
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)
  const actionableTargets = entry.targets.filter((t) => t.actionability === 'ACTIONABLE')

  const dispatchAccept = (candidateId: string, recapLabel: string) =>
    runAction(() => import('../tracked-point-trace-actions').then((m) => m.acceptTraceIdentityCandidateAction({ siteId, candidateId })), recapLabel)

  return (
    <CardShell category="attach_information" title="Cette information concerne-t-elle ce suivi ?">
      <QuestionRationale text={attachInformationRationale(entry)} />
      <SourceExcerpt
        label={entry.sourceLabel}
        sourceExcerpt={entry.sourceExcerpt}
        hasVerbatimExcerpt={entry.hasVerbatimExcerpt}
        documentFilename={entry.sourceDocumentFilename}
        effectiveDate={entry.sourceDocumentEffectiveDate}
        page={entry.sourcePage}
        importedAt={entry.sourceDate}
        documentId={entry.sourceDocumentId}
        documentType={entry.sourceDocumentType}
        siteId={siteId}
      />

      {actionableTargets.length === 0 ? (
        <p className="text-[12px] text-amber-600 dark:text-amber-400">
          Aucun suivi proposable pour le moment pour cette information — elle reste visible ici jusqu&apos;à ce qu&apos;un suivi devienne disponible.
        </p>
      ) : entry.targets.length === 1 ? (
        <>
          <div className="rounded-lg border bg-background px-2.5 py-2 text-[12px]">
            <p className="font-medium">{entry.targets[0].label ?? 'Suivi sans libellé'}</p>
            {(derivedStateLabel(entry.targets[0].derivedState) || entry.targets[0].subjectLabel) && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {[derivedStateLabel(entry.targets[0].derivedState), entry.targets[0].subjectLabel].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <ImpactPreview items={attachInformationImpact(entry.targets[0].label ?? 'Suivi sans libellé')} />
          <ErrorLine error={error} />
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              className={btnPrimary}
              disabled={pending}
              onClick={() => dispatchAccept(entry.targets[0].candidateId, entry.targets[0].label ?? 'Suivi sans libellé')}
            >
              Associer
            </button>
            <button
              type="button"
              className={btnSecondary}
              disabled={pending}
              onClick={() => runAction(() => import('../tracked-point-trace-actions').then((m) => m.rejectTraceIdentityCandidateAction({ siteId, candidateId: entry.targets[0].candidateId })))}
            >
              Ce n&apos;est pas ce suivi
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="space-y-1.5">
            {entry.targets.map((t) => {
              const disabled = t.actionability !== 'ACTIONABLE'
              return (
                <button
                  key={t.candidateId}
                  type="button"
                  disabled={disabled}
                  className={radioRow(selectedCandidateId === t.candidateId, disabled)}
                  onClick={() => setSelectedCandidateId(t.candidateId)}
                >
                  <span>{t.label ?? 'Suivi sans libellé'}</span>
                  {(derivedStateLabel(t.derivedState) || t.subjectLabel) && (
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {[derivedStateLabel(t.derivedState), t.subjectLabel].filter(Boolean).join(' · ')}
                    </span>
                  )}
                  {disabled && t.blockerReason && <span className="mt-0.5 block text-[11px] text-muted-foreground/80">{t.blockerReason}</span>}
                </button>
              )
            })}
          </div>
          {selectedCandidateId && (
            <ImpactPreview
              items={attachInformationImpact(
                entry.targets.find((t) => t.candidateId === selectedCandidateId)?.label ?? 'Suivi sans libellé',
              )}
            />
          )}
          <ErrorLine error={error} />
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              className={btnPrimary}
              disabled={pending || !selectedCandidateId}
              onClick={() =>
                selectedCandidateId &&
                dispatchAccept(selectedCandidateId, entry.targets.find((t) => t.candidateId === selectedCandidateId)?.label ?? 'Suivi sans libellé')
              }
            >
              Confirmer
            </button>
          </div>
        </>
      )}
    </CardShell>
  )
}

// ── 3. À suivre — "Faut-il suivre cette situation ?" ───────────────────────────────────────────

function ConfirmTrackabilityCard({
  entry,
  siteId,
  pending,
  error,
  runAction,
}: {
  entry: Extract<MemoriaNeedsYouQuestion, { category: 'confirm_trackability' }>['entry']
  siteId: string
  pending: boolean
  error?: string
  runAction: QuestionCardProps['runAction']
}) {
  return (
    <CardShell category="confirm_trackability" title="Faut-il suivre cette situation ?">
      <QuestionRationale text={confirmTrackabilityRationale(entry)} />
      <SourceExcerpt
        label={entry.sourceLabel}
        sourceExcerpt={entry.sourceExcerpt}
        hasVerbatimExcerpt={entry.hasVerbatimExcerpt}
        documentFilename={entry.sourceDocumentFilename}
        effectiveDate={entry.sourceDocumentEffectiveDate}
        page={entry.sourcePage}
        importedAt={entry.sourceDate}
        documentId={entry.sourceDocumentId}
        documentType={entry.sourceDocumentType}
        siteId={siteId}
      />
      {entry.subjectLabel && <p className="text-[11px] text-muted-foreground">À propos de : {entry.subjectLabel}</p>}
      <ImpactPreview items={confirmTrackabilityImpact()} />
      <ErrorLine error={error} />
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          className={btnPrimary}
          disabled={pending}
          onClick={() =>
            runAction(
              () => import('../tracked-point-trackability-actions').then((m) => m.confirmPendingTrackabilityAction({ siteId, pendingTraceId: entry.pendingTraceId })),
              entry.subjectLabel,
            )
          }
        >
          Oui, à suivre
        </button>
        <button
          type="button"
          className={btnSecondary}
          disabled={pending}
          onClick={() => runAction(() => import('../tracked-point-pending-trace-actions').then((m) => m.dismissPendingTraceAction({ siteId, pendingTraceId: entry.pendingTraceId })))}
        >
          Non, ne pas suivre
        </button>
      </div>
    </CardShell>
  )
}

// ── 4. Résolutions — "Quel suivi cette preuve vient-elle résoudre ?" ───────────────────────────

function AssignResolutionCard({
  entry,
  siteId,
  pending,
  error,
  sitePoints,
  runAction,
}: {
  entry: Extract<MemoriaNeedsYouQuestion, { category: 'assign_resolution' }>['entry']
  siteId: string
  pending: boolean
  error?: string
  sitePoints: SitePointOption[]
  runAction: QuestionCardProps['runAction']
}) {
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<{ pointId: string; candidateId: string | null; label: string } | null>(null)
  // 6E.8A — panneau de report, même pattern que confirmingMerge (DuplicatePointsCard) : un choix
  // de durée explicite avant d'écrire quoi que ce soit, jamais un report silencieux.
  const [choosingDefer, setChoosingDefer] = useState(false)

  const suggestions = [
    ...entry.knownIdentityTargets.map((t) => ({
      pointId: t.pointId,
      candidateId: t.candidateId,
      label: t.label ?? 'Suivi sans libellé',
      derivedState: t.derivedState,
      subjectLabel: t.subjectLabel,
      latestMeaningfulEventAt: t.latestMeaningfulEventAt,
    })),
    ...entry.sameSubjectSuggestions.map((t) => ({
      pointId: t.pointId,
      candidateId: null as string | null,
      label: t.label ?? 'Suivi sans libellé',
      derivedState: t.derivedState,
      subjectLabel: t.subjectLabel,
      latestMeaningfulEventAt: t.latestMeaningfulEventAt,
    })),
  ]

  const searchResults = query.trim().length > 0 ? sitePoints.filter((p) => p.label.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8) : []

  return (
    <CardShell category="assign_resolution" title="Quel suivi cette preuve vient-elle résoudre ?">
      <QuestionRationale text={assignResolutionRationale(entry)} />
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Preuve à rattacher</p>
        <SourceExcerpt
          label={entry.sourceLabel}
          sourceExcerpt={entry.sourceExcerpt}
          hasVerbatimExcerpt={entry.hasVerbatimExcerpt}
          documentFilename={entry.sourceDocumentFilename}
          effectiveDate={entry.sourceDocumentEffectiveDate}
          page={entry.sourcePage}
          importedAt={entry.sourceDate}
          documentId={entry.sourceDocumentId}
          documentType={entry.sourceDocumentType}
          siteId={siteId}
        />
      </div>

      {suggestions.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Suggestions du même thème</p>
          <div className="space-y-1.5">
            {suggestions.map((s) => {
              const lastActivityFr = formatDateFr(s.latestMeaningfulEventAt)
              const detail = [derivedStateLabel(s.derivedState), s.subjectLabel, lastActivityFr ? `dernière activité : ${lastActivityFr}` : null].filter(Boolean).join(' · ')
              return (
                <button
                  key={`${s.pointId}-${s.candidateId ?? 'subject'}`}
                  type="button"
                  className={radioRow(selected?.pointId === s.pointId, false)}
                  onClick={() => setSelected({ pointId: s.pointId, candidateId: s.candidateId, label: s.label })}
                >
                  <span className="font-medium">{s.label}</span>
                  {detail && <span className="mt-0.5 block text-[11px] text-muted-foreground">{detail}</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Résultats de recherche du chantier</p>
        {searching ? (
          <div className="space-y-1.5">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un suivi par son libellé…"
              className="w-full rounded-lg border bg-background px-2.5 py-1.5 text-[12px]"
            />
            {searchResults.map((p) => (
              <button
                key={p.id}
                type="button"
                className={radioRow(selected?.pointId === p.id, false)}
                onClick={() => setSelected({ pointId: p.id, candidateId: null, label: p.label })}
              >
                {p.label}
              </button>
            ))}
            {query.trim().length > 0 && searchResults.length === 0 && <p className="text-[11px] text-muted-foreground">Aucun suivi ne correspond.</p>}
          </div>
        ) : (
          <button type="button" className={btnSecondary} disabled={pending} onClick={() => setSearching(true)}>
            Rechercher un suivi du chantier
          </button>
        )}
      </div>

      {selected && <ImpactPreview items={assignResolutionImpact(selected.label)} />}
      <ErrorLine error={error} />
      {choosingDefer ? (
        <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/50 px-2.5 py-2 dark:border-violet-900/40 dark:bg-violet-950/20">
          <p className="text-[12px] text-foreground/80">Dans combien de temps MemorIA doit-elle te la redemander ?</p>
          <div className="flex flex-wrap gap-2">
            {DEFER_DURATION_CHOICES.map((choice) => (
              <button
                key={choice.days}
                type="button"
                className={btnSecondary}
                disabled={pending}
                onClick={() =>
                  runAction(
                    () =>
                      import('../tracked-point-pending-trace-actions').then((m) =>
                        m.deferPendingTraceAction({ siteId, pendingTraceId: entry.pendingTraceId, durationDays: choice.days }),
                      ),
                    undefined,
                    choice.days,
                  )
                }
              >
                {choice.label}
              </button>
            ))}
            <button type="button" className={btnSecondary} disabled={pending} onClick={() => setChoosingDefer(false)}>
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            className={btnPrimary}
            disabled={pending || !selected}
            onClick={() =>
              selected &&
              runAction(
                () =>
                  import('../tracked-point-resolution-actions').then((m) =>
                    m.associatePendingResolutionToPointAction({ siteId, pendingTraceId: entry.pendingTraceId, targetPointId: selected.pointId, candidateId: selected.candidateId }),
                  ),
                selected.label,
              )
            }
          >
            {selected ? `Associer à « ${selected.label} »` : 'Associer'}
          </button>
          <button type="button" className={btnSecondary} disabled={pending} onClick={() => setChoosingDefer(true)}>
            Me le redemander…
          </button>
          <button
            type="button"
            className={btnSecondary}
            disabled={pending}
            onClick={() => runAction(() => import('../tracked-point-pending-trace-actions').then((m) => m.dismissPendingTraceAction({ siteId, pendingTraceId: entry.pendingTraceId })))}
          >
            Écarter cette question
          </button>
        </div>
      )}
    </CardShell>
  )
}

// ── 5. Preuves — "Quelle information constitue réellement la preuve ?" ────────────────────────

function ClarifyEvidenceCard({
  entry,
  siteId,
  pending,
  error,
  runAction,
}: {
  entry: Extract<MemoriaNeedsYouQuestion, { category: 'clarify_evidence' }>['entry']
  siteId: string
  pending: boolean
  error?: string
  runAction: QuestionCardProps['runAction']
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const isTrackability = entry.kind === 'TRACKABILITY_UNDETERMINED'
  const title = isTrackability ? "Quelle information confirme qu'il faut suivre cette situation ?" : 'Quelle information constitue la preuve de résolution ?'
  const hint = isTrackability ? 'Cette preuve pourrait servir à confirmer un nouveau suivi.' : 'Cette preuve pourrait résoudre une situation déjà suivie.'

  return (
    <CardShell category="clarify_evidence" title={title}>
      <QuestionRationale text={clarifyEvidenceRationale(entry)} />
      {entry.subjectLabel && <p className="text-[11px] text-muted-foreground">À propos de : {entry.subjectLabel}</p>}
      <p className="text-[12px] text-foreground/80">{hint}</p>
      <div className="space-y-1.5">
        {entry.proposals.map((p) => {
          const dateLine = provenanceLine(p.documentEffectiveDate, p.sourcePage, p.createdAt)
          const quote = p.hasVerbatimExcerpt && p.sourceExcerpt ? p.sourceExcerpt : null
          const text = quote ?? p.label ?? p.documentFilename ?? 'Document'
          return (
            <label key={p.proposalId} className="flex items-start gap-2 rounded-lg border bg-background px-2.5 py-2 text-[12px]">
              <input type="checkbox" className="mt-0.5" checked={selectedIds.has(p.proposalId)} onChange={() => toggle(p.proposalId)} />
              <span className="min-w-0">
                <span className="block truncate">{quote ? `« ${text} »` : text}</span>
                {(p.documentFilename || dateLine) && <span className="mt-0.5 block text-[11px] text-muted-foreground">{[p.documentFilename, dateLine].filter(Boolean).join(' · ')}</span>}
                <DocumentSourceLink documentId={p.documentId} documentType={p.documentType} siteId={siteId} />
              </span>
            </label>
          )
        })}
      </div>
      {selectedIds.size > 0 && <ImpactPreview items={clarifyEvidenceImpact(selectedIds.size)} />}
      <ErrorLine error={error} />
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          className={btnPrimary}
          disabled={pending || selectedIds.size === 0}
          onClick={() =>
            runAction(
              () =>
                import('../tracked-point-evidence-scope-actions').then((m) =>
                  m.resolvePendingEvidenceScopeAction({ siteId, pendingTraceId: entry.pendingTraceId, proposalIds: [...selectedIds] }),
                ),
              entry.subjectLabel,
            )
          }
        >
          Confirmer la sélection
        </button>
      </div>
    </CardShell>
  )
}
