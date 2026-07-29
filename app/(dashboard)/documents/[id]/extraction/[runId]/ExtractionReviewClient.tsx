'use client'

import { useState } from 'react'
import { ProposalCard } from './ProposalCard'
import type { DocumentExtractionProposalWithEvidence, DbDocumentExtractionEvidence, DocumentEvidenceRelationType } from '@/types/db'
import type { ReviewSummary } from '@/lib/documents/effective-proposal'

// ─── Constants ───────────────────────────────────────────────────────────────

const FAMILY_ORDER = ['reservation', 'action', 'decision', 'observation', 'deadline', 'knowledge_fact']
const FAMILY_TITLE: Record<string, string> = {
  reservation: 'Réserves', action: 'Actions', decision: 'Décisions',
  observation: 'Observations', deadline: 'Échéances', knowledge_fact: 'Éléments de mémoire',
}

type Filter = 'all' | 'pending' | 'accepted' | 'edited' | 'rejected'

const FILTER_LABELS: { key: Filter; label: string; field: keyof ReviewSummary }[] = [
  { key: 'all', label: 'Toutes', field: 'total' },
  { key: 'pending', label: 'À examiner', field: 'pending' },
  { key: 'accepted', label: 'Acceptées', field: 'accepted' },
  { key: 'edited', label: 'Modifiées', field: 'edited' },
  { key: 'rejected', label: 'Refusées', field: 'rejected' },
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
  summary,
}: {
  proposals: DocumentExtractionProposalWithEvidence[]
  orphanEvidence: DbDocumentExtractionEvidence[]
  signedUrls: Record<string, string>
  documentId: string
  summary: ReviewSummary
}) {
  const [filter, setFilter] = useState<Filter>('all')

  const filtered = filter === 'all'
    ? proposals
    : proposals.filter((p) => p.proposal.review_status === filter)

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
      <div className="rounded-[18px] border bg-card p-4">
        <p className="text-sm font-medium">
          {summary.total} proposition{summary.total !== 1 ? 's' : ''}
          {summary.accepted > 0 && <> · <span className="text-green-700 dark:text-green-400">{summary.accepted} acceptée{summary.accepted !== 1 ? 's' : ''}</span></>}
          {summary.edited > 0 && <> · <span className="text-blue-700 dark:text-blue-400">{summary.edited} modifiée{summary.edited !== 1 ? 's' : ''}</span></>}
          {summary.rejected > 0 && <> · <span className="text-red-700 dark:text-red-400">{summary.rejected} refusée{summary.rejected !== 1 ? 's' : ''}</span></>}
          {summary.pending > 0 && <> · <span className="text-muted-foreground">{summary.pending} à examiner</span></>}
        </p>
        {summary.pending === 0 && summary.total > 0 && (
          <p className="text-xs text-muted-foreground mt-1">Toutes les propositions ont été examinées.</p>
        )}
      </div>

      {/* Filtres */}
      <div className="flex gap-2 flex-wrap">
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
