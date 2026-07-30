'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { ProposalCard } from './ProposalCard'
import { createHistoricalVisitAction, acceptAllPendingAction, toggleEvidencePinAction, pinAllSnapshotsAction } from './review-actions'
import type { DocumentExtractionProposalWithEvidence, DbDocumentExtractionEvidence, DocumentEvidenceRelationType } from '@/types/db'
import type { ReviewSummary } from '@/lib/documents/effective-proposal'

// ─── Constants ───────────────────────────────────────────────────────────────

const FAMILY_ORDER = ['reservation', 'action', 'decision', 'observation', 'deadline', 'knowledge_fact', 'person', 'company']
const FAMILY_TITLE: Record<string, string> = {
  reservation: 'Réserves', action: 'Actions', decision: 'Décisions',
  observation: 'Observations', deadline: 'Échéances', knowledge_fact: 'Éléments de mémoire',
  person: 'Intervenants détectés', company: 'Entreprises détectées',
}

type Filter = 'all' | 'pending' | 'accepted' | 'edited' | 'rejected' | 'materialized'

function getRelevanceScore(proposal: import('@/types/db').DbDocumentExtractionProposal): 'strong' | 'medium' | 'weak' {
  const payload = proposal.source_payload as { relevanceScore?: string } | null
  const s = payload?.relevanceScore
  if (s === 'strong' || s === 'medium' || s === 'weak') return s
  return 'medium' // propositions antérieures sans score
}

const FILTER_LABELS: { key: Filter; label: string; field: keyof ReviewSummary }[] = [
  { key: 'all', label: 'Toutes', field: 'total' },
  { key: 'pending', label: 'À examiner', field: 'pending' },
  { key: 'accepted', label: 'Acceptées', field: 'accepted' },
  { key: 'edited', label: 'Modifiées', field: 'edited' },
  { key: 'rejected', label: 'Refusées', field: 'rejected' },
  { key: 'materialized', label: 'Matérialisées', field: 'materialized' },
]

const RELATION_LABEL: Record<string, string> = {
  supports: 'Preuve', illustrates: 'Illustration', source: 'Source', candidate: 'À confirmer',
}

// ─── Orphan evidence display ─────────────────────────────────────────────────

function OrphanEvidenceItem({
  evidence,
  signedUrls,
  isPinned,
  isPending,
  onToggle,
}: {
  evidence: DbDocumentExtractionEvidence
  signedUrls: Record<string, string>
  isPinned: boolean
  isPending: boolean
  onToggle: () => void
}) {
  const imgUrl = signedUrls[evidence.id]
  const excerptText = (evidence.metadata as { text?: string } | null)?.text
  const isPhoto = evidence.evidence_type === 'page_snapshot' || evidence.evidence_type === 'image'
  const typeLabel = evidence.evidence_type === 'image' ? 'Photo' : evidence.evidence_type === 'page_snapshot' ? 'Snapshot' : 'Extrait'

  return (
    <div className={`rounded border p-3 space-y-1.5 text-xs transition-colors ${isPinned ? 'border-sky-300 bg-sky-50 dark:border-sky-700 dark:bg-sky-950/20' : 'bg-muted/30'}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-muted-foreground">
          {typeLabel} · Page {evidence.source_page}
        </p>
        {isPhoto && (
          <button
            type="button"
            onClick={onToggle}
            disabled={isPending}
            className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-50 ${
              isPinned
                ? 'bg-sky-200 text-sky-800 hover:bg-sky-300 dark:bg-sky-800 dark:text-sky-100'
                : 'bg-muted text-muted-foreground hover:bg-muted-foreground/20'
            }`}
          >
            {isPending ? '…' : isPinned ? 'Incluse dans la visite' : 'Inclure dans la visite'}
          </button>
        )}
      </div>
      {evidence.caption && <p className="text-muted-foreground italic">{evidence.caption}</p>}
      {excerptText && <p className="text-muted-foreground line-clamp-3">{excerptText}</p>}
      {evidence.nearby_text && <p className="text-muted-foreground line-clamp-2">{evidence.nearby_text}</p>}
      {imgUrl && (
        <a href={imgUrl} target="_blank" rel="noopener noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imgUrl}
            alt={evidence.caption ?? `Page ${evidence.source_page}`}
            className="max-h-40 rounded border object-contain"
          />
        </a>
      )}
    </div>
  )
}

// ─── Bloc de création (top / bottom) ─────────────────────────────────────────

function CreateVisitBlock({
  runId, documentId, targetSiteId, effectiveDate, alreadySiteReportId,
  summary, personCount, companyCount, pinnedCount, snapshotCount,
  isPending, createError, onSubmit,
}: {
  runId: string
  documentId: string
  targetSiteId: string | null
  effectiveDate: string | null
  alreadySiteReportId: string | null
  summary: ReviewSummary
  personCount: number
  companyCount: number
  pinnedCount: number
  snapshotCount: number
  isPending: boolean
  createError: string | null
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void
}) {
  const confirmedCount = summary.accepted + summary.edited + summary.materialized
  const noPhoWarn = snapshotCount > 0 && pinnedCount === 0

  if (alreadySiteReportId && targetSiteId) {
    return (
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <h2 className="text-sm font-medium">Créer la visite historique</h2>
        <div className="space-y-1">
          <p className="text-sm text-emerald-700 dark:text-emerald-400">Visite créée avec succès.</p>
          <a
            href={`/sites/${targetSiteId}/visites/${alreadySiteReportId}`}
            className="text-sm underline underline-offset-2 hover:text-foreground text-muted-foreground"
          >
            Voir la visite historique
          </a>
        </div>
      </div>
    )
  }

  if (!targetSiteId) {
    return (
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <h2 className="text-sm font-medium">Créer la visite historique</h2>
        <p className="text-sm text-muted-foreground">
          Aucun chantier associé à ce document. Rattachez le document à un chantier avant de créer la visite.
        </p>
      </div>
    )
  }

  if (!effectiveDate) {
    return (
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <h2 className="text-sm font-medium">Créer la visite historique</h2>
        <p className="text-sm text-muted-foreground">
          La date du PV n'est pas renseignée. Modifiez le document pour ajouter la date d'effet avant de créer la visite.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 pb-3 border-b">
        <div>
          <dt className="text-xs text-muted-foreground">Confirmées</dt>
          <dd className="font-semibold text-sm">{confirmedCount} / {summary.total}</dd>
        </div>
        {personCount > 0 && (
          <div>
            <dt className="text-xs text-muted-foreground">Personnes</dt>
            <dd className="font-semibold text-sm">{personCount}</dd>
          </div>
        )}
        {companyCount > 0 && (
          <div>
            <dt className="text-xs text-muted-foreground">Entreprises</dt>
            <dd className="font-semibold text-sm">{companyCount}</dd>
          </div>
        )}
        {snapshotCount > 0 && (
          <div>
            <dt className="text-xs text-muted-foreground">Pages photo</dt>
            <dd className={`font-semibold text-sm ${noPhoWarn ? 'text-amber-600 dark:text-amber-400' : ''}`}>
              {pinnedCount} / {snapshotCount}
            </dd>
          </div>
        )}
      </dl>
      <h2 className="text-sm font-medium">Créer la visite historique</h2>
      {noPhoWarn && (
        <p className="text-xs rounded bg-amber-50 dark:bg-amber-950/30 px-2 py-1.5 text-amber-700 dark:text-amber-400">
          ⚠ Aucune page photographique sélectionnée — la visite sera créée sans photos.
        </p>
      )}
      <form onSubmit={onSubmit} className="space-y-3">
        <input type="hidden" name="run_id" value={runId} />
        <input type="hidden" name="document_id" value={documentId} />
        {summary.pending > 0 && (
          <p className="text-xs text-muted-foreground">
            {summary.pending} proposition{summary.pending > 1 ? 's' : ''} non examinée{summary.pending > 1 ? 's' : ''} — vous pouvez quand même créer la visite.
          </p>
        )}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Titre de la visite (optionnel)</label>
          <input
            type="text"
            name="visit_title"
            placeholder={`Visite importée — ${effectiveDate}`}
            className="w-full rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground/60"
            disabled={isPending}
          />
        </div>
        {createError && (
          <p className="text-xs text-destructive">{createError}</p>
        )}
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isPending ? 'Création en cours…' : noPhoWarn ? 'Créer sans photos' : 'Créer la visite historique'}
        </button>
      </form>
    </div>
  )
}

// ─── Client principal ─────────────────────────────────────────────────────────

export function ExtractionReviewClient({
  proposals,
  orphanEvidence,
  signedUrls,
  documentId,
  runId,
  summary,
  effectiveDate,
  targetSiteId,
  alreadySiteReportId,
}: {
  proposals: DocumentExtractionProposalWithEvidence[]
  orphanEvidence: DbDocumentExtractionEvidence[]
  signedUrls: Record<string, string>
  documentId: string
  runId: string
  summary: ReviewSummary
  effectiveDate: string | null
  targetSiteId: string | null
  alreadySiteReportId: string | null
}) {
  const router = useRouter()
  const [filter, setFilter] = useState<Filter>('all')
  const [showWeak, setShowWeak] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [acceptAllMsg, setAcceptAllMsg] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [pinAllPending, setPinAllPending] = useState(false)

  // Snapshots épinglés — état local optimiste, synchronisé depuis les props
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(
    () => new Set(orphanEvidence.filter((e) => e.pinned_for_visit).map((e) => e.id)),
  )
  const [pendingPins, setPendingPins] = useState<Set<string>>(new Set())

  async function togglePin(evidenceId: string) {
    const newPinned = !pinnedIds.has(evidenceId)
    setPinnedIds((prev) => {
      const next = new Set(prev)
      if (newPinned) next.add(evidenceId)
      else next.delete(evidenceId)
      return next
    })
    setPendingPins((prev) => new Set([...prev, evidenceId]))
    const fd = new FormData()
    fd.set('evidence_id', evidenceId)
    fd.set('document_id', documentId)
    fd.set('pinned', String(newPinned))
    const result = await toggleEvidencePinAction(fd)
    setPendingPins((prev) => { const next = new Set(prev); next.delete(evidenceId); return next })
    if (!result.ok) {
      setPinnedIds((prev) => {
        const next = new Set(prev)
        if (newPinned) next.delete(evidenceId)
        else next.add(evidenceId)
        return next
      })
    }
  }

  function handleAcceptAll() {
    setAcceptAllMsg(null)
    const fd = new FormData()
    fd.set('run_id', runId)
    fd.set('document_id', documentId)
    startTransition(async () => {
      const result = await acceptAllPendingAction(fd)
      if (result.ok) {
        setAcceptAllMsg(`${result.count ?? 0} proposition${(result.count ?? 0) > 1 ? 's' : ''} confirmée${(result.count ?? 0) > 1 ? 's' : ''}.`)
        router.refresh()
      } else {
        setAcceptAllMsg(result.error ?? 'Erreur')
      }
    })
  }

  async function handlePinAll(pinAll: boolean) {
    setPinAllPending(true)
    const photoIds = orphanEvidence.filter((e) => e.evidence_type === 'page_snapshot' || e.evidence_type === 'image').map((e) => e.id)
    setPinnedIds(pinAll ? new Set(photoIds) : new Set())
    const fd = new FormData()
    fd.set('run_id', runId)
    fd.set('document_id', documentId)
    fd.set('pinned', String(pinAll))
    await pinAllSnapshotsAction(fd)
    setPinAllPending(false)
    router.refresh()
  }

  function handleCreateVisit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setCreateError(null)
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await createHistoricalVisitAction(fd)
      if (result.ok && result.siteReportId && result.siteId) {
        router.push(`/sites/${result.siteId}/visites/${result.siteReportId}`)
      } else {
        setCreateError(result.error ?? 'Erreur inconnue')
      }
    })
  }

  const weakCount = proposals.filter((p) => getRelevanceScore(p.proposal) === 'weak').length
  const personCount = proposals.filter((p) => p.proposal.proposal_family === 'person').length
  const companyCount = proposals.filter((p) => p.proposal.proposal_family === 'company').length
  const snapshotCount = orphanEvidence.filter((e) => e.evidence_type === 'page_snapshot' || e.evidence_type === 'image').length

  const filtered = proposals
    .filter((p) => filter === 'all' || p.proposal.review_status === filter)
    .filter((p) => showWeak || getRelevanceScore(p.proposal) !== 'weak')

  // Regroupement par famille
  const grouped = new Map<string, DocumentExtractionProposalWithEvidence[]>()
  for (const p of filtered) {
    const family = p.proposal.proposal_family
    if (!grouped.has(family)) grouped.set(family, [])
    grouped.get(family)!.push(p)
  }

  return (
    <div className="space-y-6">
      {/* Bilan */}
      <div className="rounded-[18px] border bg-card p-4 space-y-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <p className="text-sm font-medium">
            {summary.total} proposition{summary.total !== 1 ? 's' : ''}
            {summary.materialized > 0 && <> · <span className="text-purple-700 dark:text-purple-400">{summary.materialized} matérialisée{summary.materialized !== 1 ? 's' : ''}</span></>}
            {summary.accepted > 0 && <> · <span className="text-green-700 dark:text-green-400">{summary.accepted} acceptée{summary.accepted !== 1 ? 's' : ''}</span></>}
            {summary.edited > 0 && <> · <span className="text-blue-700 dark:text-blue-400">{summary.edited} modifiée{summary.edited !== 1 ? 's' : ''}</span></>}
            {summary.rejected > 0 && <> · <span className="text-red-700 dark:text-red-400">{summary.rejected} refusée{summary.rejected !== 1 ? 's' : ''}</span></>}
            {summary.pending > 0 && <> · <span className="text-muted-foreground">{summary.pending} à examiner</span></>}
          </p>
          {summary.pending > 0 && (
            <button
              type="button"
              onClick={handleAcceptAll}
              disabled={isPending}
              className="shrink-0 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              {isPending ? '…' : `Tout confirmer (${summary.pending})`}
            </button>
          )}
        </div>
        {acceptAllMsg && <p className="text-xs text-muted-foreground">{acceptAllMsg}</p>}
        {summary.pending === 0 && summary.total > 0 && (
          <p className="text-xs text-muted-foreground">Toutes les propositions ont été examinées.</p>
        )}
      </div>

      <CreateVisitBlock
        runId={runId}
        documentId={documentId}
        targetSiteId={targetSiteId}
        effectiveDate={effectiveDate}
        alreadySiteReportId={alreadySiteReportId}
        summary={summary}
        personCount={personCount}
        companyCount={companyCount}
        pinnedCount={pinnedIds.size}
        snapshotCount={snapshotCount}
        isPending={isPending}
        createError={createError}
        onSubmit={handleCreateVisit}
      />

      {/* Filtres */}
      <div className="flex gap-2 flex-wrap items-center">
        {FILTER_LABELS.map(({ key, label, field }) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
              filter === key
                ? 'bg-foreground text-background border-foreground'
                : 'border-muted-foreground/30 text-muted-foreground hover:border-foreground hover:text-foreground'
            }`}
          >
            {label} {summary[field] > 0 && <span className="ml-1 opacity-70">({summary[field]})</span>}
          </button>
        ))}
        {weakCount > 0 && (
          <button
            type="button"
            onClick={() => setShowWeak((v) => !v)}
            className="ml-auto px-3 py-1.5 rounded-full text-xs border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-muted-foreground hover:text-foreground transition-colors"
          >
            {showWeak ? `Masquer les ${weakCount} faibles` : `Voir les ${weakCount} faibles`}
          </button>
        )}
      </div>

      {/* Propositions groupées */}
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Aucune proposition dans ce filtre.</p>
      ) : (
        FAMILY_ORDER.filter((fam) => grouped.has(fam)).map((family) => {
          const items = grouped.get(family)!
          return (
            <section key={family} className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                {FAMILY_TITLE[family] ?? family}
                <span className="font-normal normal-case">({items.length})</span>
              </h2>
              <div className="space-y-3">
                {items.map((p) => (
                  <ProposalCard
                    key={p.proposal.id}
                    proposal={p.proposal}
                    evidence={p.evidence as Array<{
                      evidence: import('@/types/db').DbDocumentExtractionEvidence
                      relationType: DocumentEvidenceRelationType
                      confidence: number | null
                    }>}
                    signedUrls={signedUrls}
                    documentId={documentId}
                  />
                ))}
              </div>
            </section>
          )
        })
      )}

      {/* Photos et snapshots non associés */}
      {orphanEvidence.length > 0 && (() => {
        const extractedPhotos = orphanEvidence.filter((e) => e.evidence_type === 'image')
        const snapshots = orphanEvidence.filter((e) => e.evidence_type === 'page_snapshot')
        const others = orphanEvidence.filter((e) => e.evidence_type !== 'page_snapshot' && e.evidence_type !== 'image')
        const allPhotos = [...extractedPhotos, ...snapshots]
        const pinnedCount = allPhotos.filter((e) => pinnedIds.has(e.id)).length
        if (allPhotos.length === 0 && others.length === 0) return null
        return (
          <section className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {extractedPhotos.length > 0 ? 'Photos extraites' : 'Pages photographiques'}
              </h2>
              {allPhotos.length > 0 && (
                <span className="text-xs font-medium">
                  {pinnedCount} / {allPhotos.length} sélectionnée{pinnedCount !== 1 ? 's' : ''}
                </span>
              )}
              {allPhotos.length > 0 && (
                <button
                  type="button"
                  onClick={() => handlePinAll(pinnedCount < allPhotos.length)}
                  disabled={pinAllPending || isPending}
                  className="ml-auto text-xs border rounded px-2 py-1 text-muted-foreground hover:text-foreground hover:border-foreground transition-colors disabled:opacity-50"
                >
                  {pinAllPending ? '…' : pinnedCount === allPhotos.length ? 'Tout désélectionner' : 'Importer toutes'}
                </button>
              )}
            </div>
            {extractedPhotos.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Photos extraites de la structure du PDF. Sélectionnez celles à afficher dans la visite.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Sélectionnez les pages à afficher dans la fiche de la visite historique.
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {allPhotos.map((ev) => (
                <OrphanEvidenceItem
                  key={ev.id}
                  evidence={ev}
                  signedUrls={signedUrls}
                  isPinned={pinnedIds.has(ev.id)}
                  isPending={pendingPins.has(ev.id)}
                  onToggle={() => togglePin(ev.id)}
                />
              ))}
              {others.map((ev) => (
                <OrphanEvidenceItem
                  key={ev.id}
                  evidence={ev}
                  signedUrls={signedUrls}
                  isPinned={false}
                  isPending={false}
                  onToggle={() => {}}
                />
              ))}
            </div>
          </section>
        )
      })()}
    </div>
  )
}
