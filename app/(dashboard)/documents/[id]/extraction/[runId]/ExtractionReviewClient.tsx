'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { ProposalCard } from './ProposalCard'
import { createHistoricalVisitAction, acceptAllPendingAction } from './review-actions'
import type { DocumentExtractionProposalWithEvidence, DbDocumentExtractionEvidence, DocumentEvidenceRelationType } from '@/types/db'
import type { ReviewSummary } from '@/lib/documents/effective-proposal'

// ─── Constants ───────────────────────────────────────────────────────────────

const FAMILY_ORDER = ['reservation', 'action', 'decision', 'observation', 'deadline', 'knowledge_fact']
const FAMILY_TITLE: Record<string, string> = {
  reservation: 'Réserves', action: 'Actions', decision: 'Décisions',
  observation: 'Observations', deadline: 'Échéances', knowledge_fact: 'Éléments de mémoire',
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
}: {
  evidence: DbDocumentExtractionEvidence
  signedUrls: Record<string, string>
}) {
  const imgUrl = signedUrls[evidence.id]
  const excerptText = (evidence.metadata as { text?: string } | null)?.text

  return (
    <div className="rounded border bg-muted/30 p-3 space-y-1.5 text-xs">
      <p className="font-medium text-muted-foreground">
        {evidence.evidence_type === 'page_snapshot' ? 'Snapshot' : 'Extrait'} · Page {evidence.source_page}
      </p>
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

      {/* Créer la visite historique */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <h2 className="text-sm font-medium">Créer la visite historique</h2>
        {alreadySiteReportId && targetSiteId ? (
          <div className="space-y-1">
            <p className="text-sm text-emerald-700 dark:text-emerald-400">Visite créée avec succès.</p>
            <a
              href={`/sites/${targetSiteId}/visites/${alreadySiteReportId}`}
              className="text-sm underline underline-offset-2 hover:text-foreground text-muted-foreground"
            >
              Voir la visite historique
            </a>
          </div>
        ) : !targetSiteId ? (
          <p className="text-sm text-muted-foreground">
            Aucun chantier associé à ce document. Rattachez le document à un chantier avant de créer la visite.
          </p>
        ) : !effectiveDate ? (
          <p className="text-sm text-muted-foreground">
            La date du PV n'est pas renseignée. Modifiez le document pour ajouter la date d'effet avant de créer la visite.
          </p>
        ) : (
          <form onSubmit={handleCreateVisit} className="space-y-3">
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
              {isPending ? 'Création en cours…' : 'Créer la visite historique'}
            </button>
          </form>
        )}
      </div>

      {/* Photos non associées */}
      {orphanEvidence.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Photos à classer
            <span className="font-normal normal-case ml-2">({orphanEvidence.length})</span>
          </h2>
          <p className="text-xs text-muted-foreground">
            Ces preuves n'ont pas été associées à une proposition par l'extraction.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {orphanEvidence.map((ev) => (
              <OrphanEvidenceItem key={ev.id} evidence={ev} signedUrls={signedUrls} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
