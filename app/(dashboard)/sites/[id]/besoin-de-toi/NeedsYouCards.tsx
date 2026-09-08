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
import { CheckCircle2, Copy, FileSearch, HelpCircle, Link2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MemoriaNeedsYouQuestion } from '@/lib/knowledge/tracked-point-needs-you-summary'
import { MEMORIA_NEEDS_YOU_CATEGORY_LABELS, type MemoriaNeedsYouCategory } from '@/lib/knowledge/tracked-point-needs-you-categories'
import { MEMORIA_NEEDS_YOU_PRIORITY_LABEL, type MemoriaNeedsYouPriority } from '@/lib/knowledge/tracked-point-needs-you-priority'

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

function SourceExcerpt({
  label,
  documentFilename,
  effectiveDate,
  page,
  importedAt,
}: {
  label: string | null
  documentFilename?: string | null
  effectiveDate?: string | null
  page?: number | null
  importedAt?: string | null
}) {
  const dateLine = provenanceLine(effectiveDate, page, importedAt)
  if (!label && !documentFilename) return null
  return (
    <div className="rounded-lg border border-dashed bg-muted/30 px-2.5 py-2 text-[12px] text-foreground/80">
      {label && <p className="line-clamp-3">{label}</p>}
      {(documentFilename || dateLine) && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {[documentFilename, dateLine].filter(Boolean).join(' · ')}
        </p>
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

export type QuestionCardProps = {
  question: MemoriaNeedsYouQuestion
  siteId: string
  pending: boolean
  error?: string
  sitePoints: SitePointOption[]
  priority: MemoriaNeedsYouPriority
  runAction: (action: () => Promise<ActionResult>) => void
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
  return (
    <CardShell category="duplicate_points" title="Ces deux suivis sont-ils les mêmes ?">
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
                {side.cboCount} preuve{side.cboCount > 1 ? 's' : ''} · {side.hardMemberCount} élément{side.hardMemberCount > 1 ? 's' : ''} rattaché{side.hardMemberCount > 1 ? 's' : ''}
              </p>
              {firstFr && <p className="mt-1 text-[11px] text-muted-foreground/80">Première apparition : {firstFr}</p>}
              {lastFr && <p className="mt-0.5 text-[11px] text-muted-foreground/80">Dernière activité : {lastFr}</p>}
            </div>
          )
        })}
      </div>
      <ErrorLine error={error} />
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          className={btnPrimary}
          disabled={pending}
          onClick={() => runAction(() => import('../tracked-point-consolidation-actions').then((m) => m.consolidateTrackedPointsAction({ siteId, pairId: entry.pairId })))}
        >
          Oui, c&apos;est le même suivi
        </button>
        <button
          type="button"
          className={btnSecondary}
          disabled={pending}
          onClick={() => runAction(() => import('../tracked-point-consolidation-actions').then((m) => m.rejectPointIdentityPairAction({ siteId, pairId: entry.pairId })))}
        >
          Non, ce sont deux suivis différents
        </button>
      </div>
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

  const dispatchAccept = (candidateId: string) =>
    runAction(() => import('../tracked-point-trace-actions').then((m) => m.acceptTraceIdentityCandidateAction({ siteId, candidateId })))

  return (
    <CardShell category="attach_information" title="Cette information concerne-t-elle ce suivi ?">
      <SourceExcerpt
        label={entry.sourceLabel}
        documentFilename={entry.sourceDocumentFilename}
        effectiveDate={entry.sourceDocumentEffectiveDate}
        page={entry.sourcePage}
        importedAt={entry.sourceDate}
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
          <ErrorLine error={error} />
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" className={btnPrimary} disabled={pending} onClick={() => dispatchAccept(entry.targets[0].candidateId)}>
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
          <ErrorLine error={error} />
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              className={btnPrimary}
              disabled={pending || !selectedCandidateId}
              onClick={() => selectedCandidateId && dispatchAccept(selectedCandidateId)}
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
      <SourceExcerpt
        label={entry.sourceLabel}
        documentFilename={entry.sourceDocumentFilename}
        effectiveDate={entry.sourceDocumentEffectiveDate}
        page={entry.sourcePage}
        importedAt={entry.sourceDate}
      />
      {entry.subjectLabel && <p className="text-[11px] text-muted-foreground">À propos de : {entry.subjectLabel}</p>}
      <ErrorLine error={error} />
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          className={btnPrimary}
          disabled={pending}
          onClick={() => runAction(() => import('../tracked-point-trackability-actions').then((m) => m.confirmPendingTrackabilityAction({ siteId, pendingTraceId: entry.pendingTraceId })))}
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
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Preuve à rattacher</p>
        <SourceExcerpt
          label={entry.sourceLabel}
          documentFilename={entry.sourceDocumentFilename}
          effectiveDate={entry.sourceDocumentEffectiveDate}
          page={entry.sourcePage}
          importedAt={entry.sourceDate}
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

      <ErrorLine error={error} />
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          className={btnPrimary}
          disabled={pending || !selected}
          onClick={() =>
            selected &&
            runAction(() =>
              import('../tracked-point-resolution-actions').then((m) =>
                m.associatePendingResolutionToPointAction({ siteId, pendingTraceId: entry.pendingTraceId, targetPointId: selected.pointId, candidateId: selected.candidateId }),
              ),
            )
          }
        >
          {selected ? `Associer à « ${selected.label} »` : 'Associer'}
        </button>
        <button
          type="button"
          className={btnSecondary}
          disabled={pending}
          onClick={() => runAction(() => import('../tracked-point-pending-trace-actions').then((m) => m.dismissPendingTraceAction({ siteId, pendingTraceId: entry.pendingTraceId })))}
        >
          Laisser pour plus tard
        </button>
      </div>
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
      {entry.subjectLabel && <p className="text-[11px] text-muted-foreground">À propos de : {entry.subjectLabel}</p>}
      <p className="text-[12px] text-foreground/80">{hint}</p>
      <div className="space-y-1.5">
        {entry.proposals.map((p) => {
          const dateLine = provenanceLine(p.documentEffectiveDate, p.sourcePage, p.createdAt)
          return (
            <label key={p.proposalId} className="flex items-start gap-2 rounded-lg border bg-background px-2.5 py-2 text-[12px]">
              <input type="checkbox" className="mt-0.5" checked={selectedIds.has(p.proposalId)} onChange={() => toggle(p.proposalId)} />
              <span className="min-w-0">
                <span className="block truncate">{p.label ?? p.documentFilename ?? 'Document'}</span>
                {(p.documentFilename || dateLine) && <span className="mt-0.5 block text-[11px] text-muted-foreground">{[p.documentFilename, dateLine].filter(Boolean).join(' · ')}</span>}
              </span>
            </label>
          )
        })}
      </div>
      <ErrorLine error={error} />
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          className={btnPrimary}
          disabled={pending || selectedIds.size === 0}
          onClick={() =>
            runAction(() =>
              import('../tracked-point-evidence-scope-actions').then((m) =>
                m.resolvePendingEvidenceScopeAction({ siteId, pendingTraceId: entry.pendingTraceId, proposalIds: [...selectedIds] }),
              ),
            )
          }
        >
          Confirmer la sélection
        </button>
      </div>
    </CardShell>
  )
}
