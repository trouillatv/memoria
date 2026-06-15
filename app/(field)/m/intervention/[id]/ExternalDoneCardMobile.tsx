// Carte mobile « Réalisée par l'externe » — affichée quand un intervenant externe
// a validé via /i/[token] mais que l'intervention est encore planned. L'externe ne
// clôture jamais : on montre ce qui a été fait + on propose « Contrôler et clôturer »
// (qui démarre l'intervention pour que le chef contrôle puis termine).

import { CheckCircle2, Hourglass, ListChecks, Camera, PenLine, MessageSquare } from 'lucide-react'
import { StartInterventionButton } from './start-intervention-button'

interface Summary {
  name: string
  validatedAt: string
  comment: string | null
  signatureDataUrl: string | null
  validatorCount: number
  photos: Array<{ thumb: string; full: string }>
  checklistDone: number
  checklistTotal: number
}

function formatFullDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
    + ' à ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

export function ExternalDoneCardMobile({
  interventionId,
  summary,
}: {
  interventionId: string
  summary: Summary
}) {
  return (
    <section className="rounded-xl border-2 border-sky-300 bg-sky-50/60 p-4 space-y-3">
      <div className="flex items-start gap-2.5">
        <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="text-base font-bold text-sky-950">Réalisée par l&apos;externe</div>
          <div className="text-sm text-sky-800/80 mt-0.5">
            Validée par <span className="font-medium text-sky-900">{summary.name}</span>
            {' '}le {formatFullDateTime(summary.validatedAt)}
            {summary.validatorCount > 1 && (
              <span className="text-sky-700/70"> · {summary.validatorCount} intervenants</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs flex-wrap">
        {summary.checklistTotal > 0 && (
          <span className={`inline-flex items-center gap-1 ${summary.checklistDone >= summary.checklistTotal ? 'text-emerald-700' : 'text-amber-700'}`}>
            <ListChecks className="h-3.5 w-3.5" />
            Checklist {summary.checklistDone}/{summary.checklistTotal}
          </span>
        )}
        <span className="inline-flex items-center gap-1 text-sky-800">
          <Camera className="h-3.5 w-3.5" />
          {summary.photos.length} photo{summary.photos.length > 1 ? 's' : ''}
        </span>
        {summary.signatureDataUrl && (
          <span className="inline-flex items-center gap-1 text-emerald-700">
            <PenLine className="h-3.5 w-3.5" />Signature
          </span>
        )}
      </div>

      {summary.photos.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {summary.photos.map((p, i) => (
            <a key={i} href={p.full} target="_blank" rel="noopener noreferrer" className="block rounded-lg overflow-hidden border bg-muted active:opacity-80 transition-opacity">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.thumb} alt={`Photo externe ${i + 1}`} className="aspect-square w-full object-cover" />
            </a>
          ))}
        </div>
      )}

      {summary.comment && (
        <p className="text-sm text-sky-900/80 italic border-l-2 border-sky-200 pl-2 flex items-start gap-1">
          <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0 text-sky-600" />
          « {summary.comment} »
        </p>
      )}

      {summary.signatureDataUrl && (
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={summary.signatureDataUrl} alt="Signature de l'externe" className="h-14 rounded border bg-white" />
        </div>
      )}

      <div className="flex items-center gap-1.5 text-sm font-medium text-amber-700 pt-1">
        <Hourglass className="h-4 w-4" /> Validation interne requise
      </div>

      <StartInterventionButton interventionId={interventionId} label="Contrôler et clôturer" controlMode />

      <p className="text-[11px] text-sky-800/60">
        L&apos;externe ne clôture pas l&apos;intervention. Contrôlez le travail, ajoutez d&apos;éventuelles réserves, puis terminez.
      </p>
    </section>
  )
}
