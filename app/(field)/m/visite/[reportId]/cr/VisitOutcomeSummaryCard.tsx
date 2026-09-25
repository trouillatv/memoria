'use client'

// SUIVI-1 — « Ce que cette visite a produit / laissé en attente » — lecture
// seule, assemblée depuis getVisitOutcomeSummary. AUCUNE écriture déclenchée
// par le rendu ; aucun seuil de réconciliation, aucune Action/Point créé ici.
//
// Ne montre que ce que le read-model a réellement trouvé : une section vide
// disparaît plutôt que d'afficher un zéro qui n'apprend rien.

import { useState } from 'react'
import { ChevronDown, ChevronUp, CheckCircle2, HelpCircle, Clock3, Users } from 'lucide-react'
import type { VisitOutcomeSummary } from '@/lib/db/visit-outcome-summary'
import type { SiteReportStatus } from '@/types/db'
import { cn } from '@/lib/utils'

const KIND_LABEL: Record<string, string> = {
  action: 'Action',
  decision: 'Décision',
  deadline: 'Échéance',
  vigilance: 'Vigilance',
  knowledge: 'Mémoire',
  stakeholder: 'Intervenant',
}

// Même wording que app/(dashboard)/meetings/[id]/page.tsx#statusLabel — un CR
// non `curated`/`archived` n'a pas franchi la validation humaine.
function crStatusLabel(status: SiteReportStatus): string {
  switch (status) {
    case 'curated':
    case 'archived':
      return 'Validé'
    case 'proposed':
      return 'Analysé — à valider'
    case 'failed':
      return 'Échec'
    default:
      return 'Brouillon — à valider'
  }
}

export function VisitOutcomeSummaryCard({ summary }: { summary: VisitOutcomeSummary | null }) {
  const [open, setOpen] = useState(false)
  if (!summary) return null

  const materializedCount = summary.materialized.proposals.length
  const pendingCount = summary.pending.traces.length
  const orphanedCount = summary.unresolved.orphanedProposals.length
  const actorsCount = summary.unresolved.actors.length
  const totalProduced = summary.produced.proposals.length

  if (totalProduced === 0 && pendingCount === 0 && actorsCount === 0) return null

  return (
    <div className="rounded-2xl border bg-background p-3.5 shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <div>
          <p className="text-sm font-semibold">Ce que cette visite a produit</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {materializedCount > 0 && `${materializedCount} rattaché${materializedCount > 1 ? 's' : ''}`}
            {orphanedCount > 0 && `${materializedCount > 0 ? ' · ' : ''}${orphanedCount} en attente de rattachement`}
            {pendingCount > 0 && `${materializedCount > 0 || orphanedCount > 0 ? ' · ' : ''}${pendingCount} à suivre`}
            {actorsCount > 0 && `${materializedCount > 0 || orphanedCount > 0 || pendingCount > 0 ? ' · ' : ''}${actorsCount} intervenant${actorsCount > 1 ? 's' : ''} à identifier`}
            {materializedCount === 0 && orphanedCount === 0 && pendingCount === 0 && actorsCount === 0 && 'rien à signaler'}
          </p>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {materializedCount > 0 && (
            <OutcomeGroup icon={CheckCircle2} iconCls="text-emerald-600" title="Rattaché à un sujet suivi">
              <ul className="space-y-1.5">
                {summary.materialized.proposals.map((p) => (
                  <li key={p.ref.id} className="text-[12px] leading-snug">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{KIND_LABEL[p.kind] ?? p.kind}</span>
                    <span className="block">{p.title}</span>
                    {p.canonicalSubjectLabel && (
                      <span className="text-muted-foreground"> → {p.canonicalSubjectLabel}</span>
                    )}
                  </li>
                ))}
              </ul>
            </OutcomeGroup>
          )}

          {orphanedCount > 0 && (
            <OutcomeGroup icon={HelpCircle} iconCls="text-amber-600" title="À rattacher à un sujet">
              <ul className="space-y-1.5">
                {summary.unresolved.orphanedProposals.map((p) => (
                  <li key={p.ref.id} className="text-[12px] leading-snug">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{KIND_LABEL[p.kind] ?? p.kind}</span>
                    <span className="block">{p.title}</span>
                  </li>
                ))}
              </ul>
            </OutcomeGroup>
          )}

          {pendingCount > 0 && (
            <OutcomeGroup icon={Clock3} iconCls="text-sky-600" title="En attente d'une décision de suivi">
              <ul className="space-y-1.5">
                {summary.pending.traces.map((t) => (
                  <li key={t.ref.id} className="text-[12px] leading-snug">
                    <span className="block">{t.canonicalSubjectLabel ?? 'Sujet sans libellé'}</span>
                    {t.reason && <span className="text-muted-foreground">{t.reason}</span>}
                  </li>
                ))}
              </ul>
            </OutcomeGroup>
          )}

          {actorsCount > 0 && (
            <OutcomeGroup icon={Users} iconCls="text-violet-600" title="Intervenants à identifier">
              <ul className="flex flex-wrap gap-1.5">
                {summary.unresolved.actors.map((a) => (
                  <li
                    key={a.ref.id}
                    className={cn('rounded-full bg-violet-50 px-2 py-0.5 text-[12px] text-violet-700 dark:bg-violet-950/30 dark:text-violet-300')}
                  >
                    {a.rawText}
                  </li>
                ))}
              </ul>
            </OutcomeGroup>
          )}

          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">État de la visite</p>
            <ul className="space-y-0.5 text-[12px] text-muted-foreground">
              <li>Compte-rendu : <span className="font-medium text-foreground">{crStatusLabel(summary.crStatus)}</span></li>
              <li>Mémoire : <span className="font-medium text-foreground">{summary.memoryIndexed ? 'Indexée' : 'Pas encore indexée'}</span></li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

function OutcomeGroup({
  icon: Icon, iconCls, title, children,
}: {
  icon: typeof CheckCircle2
  iconCls: string
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className={cn('h-3.5 w-3.5', iconCls)} /> {title}
      </p>
      {children}
    </div>
  )
}
