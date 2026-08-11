'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { DbKnowledgeProposal } from '@/lib/db/knowledge-proposals'

const KIND_META: Record<string, { label: string; labelPlural: string; teinte: string }> = {
  action:      { label: 'Action',       labelPlural: 'Actions',       teinte: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300' },
  deadline:    { label: 'Échéance',     labelPlural: 'Échéances',     teinte: 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300' },
  knowledge:   { label: 'Connaissance', labelPlural: 'Connaissances', teinte: 'bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300' },
  decision:    { label: 'Décision',     labelPlural: 'Décisions',     teinte: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300' },
  vigilance:   { label: 'Vigilance',    labelPlural: 'Vigilances',    teinte: 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300' },
  stakeholder: { label: 'Intervenant',  labelPlural: 'Intervenants',  teinte: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' },
}

const STATUS_META: Record<string, { label: string; teinte: string }> = {
  proposed:   { label: 'En attente',  teinte: 'bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300' },
  confirmed:  { label: 'Confirmée',   teinte: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' },
  fulfilled:  { label: 'Réalisée',    teinte: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' },
  dismissed:  { label: 'Écartée',     teinte: 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300' },
  superseded: { label: 'Remplacée',   teinte: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300' },
  masked:     { label: 'Masquée',     teinte: 'bg-slate-50 text-slate-600 dark:bg-slate-800/30 dark:text-slate-400' },
}

interface Props {
  active: DbKnowledgeProposal[]
  archived: DbKnowledgeProposal[]
  subjectLabels: Record<string, string>
  siteId: string
}

export function FactLedgerView({ active, archived, subjectLabels, siteId }: Props) {
  const [kindFilter, setKindFilter] = useState<string>('all')

  // Index id→title sur les proposals actives — permet "Remplacé par →" pour les superseded
  const activeTitleById = new Map(active.map((p) => [p.id, p.title]))

  const superseded = archived.filter((p) => p.status === 'superseded')
  const dismissed  = archived.filter((p) => p.status === 'dismissed' || p.status === 'masked')

  const allKinds = [...new Set([...active, ...archived].map((p) => p.kind))].sort((a, b) =>
    (KIND_META[a]?.label ?? a).localeCompare(KIND_META[b]?.label ?? b, 'fr'),
  )

  const filteredActive     = kindFilter === 'all' ? active     : active.filter((p) => p.kind === kindFilter)
  const filteredSuperseded = kindFilter === 'all' ? superseded : superseded.filter((p) => p.kind === kindFilter)
  const filteredDismissed  = kindFilter === 'all' ? dismissed  : dismissed.filter((p) => p.kind === kindFilter)

  const hasArchived = filteredSuperseded.length > 0 || filteredDismissed.length > 0

  return (
    <div className="space-y-4">
      {/* Filtres */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setKindFilter('all')}
          className={`rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors ${
            kindFilter === 'all' ? 'border-foreground bg-foreground text-background' : 'bg-card hover:bg-muted'
          }`}
        >
          Tous
        </button>
        {allKinds.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKindFilter(k)}
            className={`rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors ${
              kindFilter === k ? 'border-foreground bg-foreground text-background' : 'bg-card hover:bg-muted'
            }`}
          >
            {KIND_META[k]?.labelPlural ?? k}
          </button>
        ))}
      </div>

      {/* Mémoire active */}
      {filteredActive.length > 0 ? (
        <section>
          <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
            Mémoire active — {filteredActive.length} élément{filteredActive.length > 1 ? 's' : ''}
          </h2>
          <div className="divide-y rounded-xl border bg-card">
            {filteredActive.map((p) => (
              <ProposalRow key={p.id} proposal={p} subjectLabels={subjectLabels} siteId={siteId} activeTitleById={activeTitleById} />
            ))}
          </div>
        </section>
      ) : (
        <p className="text-[13px] text-muted-foreground">Aucun élément actif pour ce filtre.</p>
      )}

      {/* Historique de l'analyse — deux sections distinctes */}
      {hasArchived && (
        <details className="group rounded-xl border bg-card">
          <summary className="flex cursor-pointer select-none list-none items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
            <span className="text-[13px] font-medium text-muted-foreground group-open:text-foreground">
              Historique de l&apos;analyse
            </span>
            <span className="text-[11px] text-muted-foreground">
              {filteredSuperseded.length > 0 && `${filteredSuperseded.length} consolidé${filteredSuperseded.length > 1 ? 's' : ''}`}
              {filteredSuperseded.length > 0 && filteredDismissed.length > 0 && ' · '}
              {filteredDismissed.length > 0 && `${filteredDismissed.length} écarté${filteredDismissed.length > 1 ? 's' : ''}`}
              {' '}· Afficher
            </span>
          </summary>

          <div className="border-t">
            {/* Remplacés — consolidés sous une autre formulation */}
            {filteredSuperseded.length > 0 && (
              <div>
                <p className="px-4 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground border-b bg-muted/30">
                  Formulations consolidées — {filteredSuperseded.length}
                </p>
                <div className="divide-y">
                  {filteredSuperseded.map((p) => (
                    <ProposalRow
                      key={p.id}
                      proposal={p}
                      subjectLabels={subjectLabels}
                      siteId={siteId}
                      activeTitleById={activeTitleById}
                      muted
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Écartés — décision humaine explicite */}
            {filteredDismissed.length > 0 && (
              <div className={filteredSuperseded.length > 0 ? 'border-t' : ''}>
                <p className="px-4 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground border-b bg-muted/30">
                  Écartés — {filteredDismissed.length}
                </p>
                <div className="divide-y">
                  {filteredDismissed.map((p) => (
                    <ProposalRow
                      key={p.id}
                      proposal={p}
                      subjectLabels={subjectLabels}
                      siteId={siteId}
                      activeTitleById={activeTitleById}
                      muted
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  )
}

function ProposalRow({
  proposal, subjectLabels, siteId, activeTitleById, muted = false,
}: {
  proposal: DbKnowledgeProposal
  subjectLabels: Record<string, string>
  siteId: string
  activeTitleById: Map<string, string>
  muted?: boolean
}) {
  const kindMeta   = KIND_META[proposal.kind]
  const statusMeta = STATUS_META[proposal.status]
  const subjectLabel    = proposal.canonical_subject_id ? subjectLabels[proposal.canonical_subject_id] : null
  const replacedByTitle = proposal.superseded_by ? activeTitleById.get(proposal.superseded_by) : null

  return (
    <article className={`px-4 py-3 ${muted ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${kindMeta?.teinte ?? 'bg-muted text-muted-foreground'}`}>
          {kindMeta?.label ?? proposal.kind}
        </span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusMeta?.teinte ?? 'bg-muted text-muted-foreground'}`}>
          {statusMeta?.label ?? proposal.status}
        </span>
      </div>
      <p className="mt-1.5 text-[13.5px] font-medium leading-snug">{proposal.title}</p>
      {proposal.body && (
        <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground line-clamp-3">{proposal.body}</p>
      )}
      <div className="mt-1.5 space-y-0.5">
        {proposal.canonical_subject_id && subjectLabel ? (
          <p className="text-[11.5px] text-muted-foreground">
            Sujet :{' '}
            <Link
              href={`/sites/${siteId}/historique/sujets/${proposal.canonical_subject_id}`}
              className="font-medium text-foreground hover:underline"
            >
              {subjectLabel}
            </Link>
          </p>
        ) : (
          <p className="text-[11.5px] italic text-muted-foreground">Aucun sujet de suivi associé</p>
        )}
        {proposal.status === 'superseded' && (
          <p className="text-[11.5px] text-amber-700 dark:text-amber-400">
            {replacedByTitle
              ? <>Regroupé avec → <span className="font-medium">{replacedByTitle}</span></>
              : "Regroupé lors de l'analyse"}
          </p>
        )}
        {proposal.status === 'dismissed' && proposal.dismiss_reason && (
          <p className="text-[11.5px] text-rose-700 dark:text-rose-400">
            Motif : {proposal.dismiss_reason}
          </p>
        )}
      </div>
    </article>
  )
}
