'use client'

// Mémoire de la réunion. UN SEUL geste d'ajout ; la frontière est MÉTIER (photo
// de contexte vs document métier), jamais technique (attachment vs document) —
// le backend route. Le PV figé ne bouge pas ; les enrichissements post-diffusion
// se RACONTENT (journal date · qui · quoi), pas un simple badge.

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Camera, FilePlus2, FileCheck2, RefreshCw, Loader2, History } from 'lucide-react'
import { toast } from 'sonner'
import { addMeetingAttachmentAction, generatePvAction } from './pv-actions'
import type { MeetingEnrichment } from '@/lib/db/meeting-enrichments'

function frDateTime(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
}

export function MeetingMemoryPanel({
  reportId,
  hasFinalPv,
  enrichments,
}: {
  reportId: string
  hasFinalPv: boolean
  enrichments: MeetingEnrichment[]
}) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, start] = useTransition()
  const [regen, startRegen] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [showJournal, setShowJournal] = useState(false)

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    const fd = new FormData()
    fd.set('report_id', reportId)
    fd.set('file', file)
    start(async () => {
      const r = await addMeetingAttachmentAction(fd)
      if (r.ok) { toast.success('Ajouté à la mémoire de la réunion'); router.refresh() }
      else { setError(r.error); toast.error(r.error) }
    })
  }

  function regenerate() {
    setError(null)
    startRegen(async () => {
      const r = await generatePvAction(reportId)
      if (r.ok) { toast.success('Nouvelle version du PV générée — la précédente reste figée'); router.refresh() }
      else { setError(r.error); toast.error(r.error) }
    })
  }

  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold">Mémoire de la réunion</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {hasFinalPv
            ? 'Cette réunion a été diffusée. Le PV figé reste inchangé ; vous pouvez enrichir la mémoire, et générer une nouvelle version si nécessaire.'
            : 'Ajoutez photos et documents au fil de la réunion. Le PV est une version ; la mémoire reste vivante.'}
        </p>
      </div>

      {/* Bannière d'enrichissement (ouvre six mois plus tard → comprend tout de suite). */}
      {hasFinalPv && enrichments.length > 0 && (
        <button type="button" onClick={() => setShowJournal((v) => !v)}
          className="flex w-full items-center gap-2 rounded-lg border border-amber-300/60 bg-amber-50/60 px-3 py-2 text-left text-xs text-amber-900 hover:bg-amber-50 dark:bg-amber-950/20 dark:text-amber-200">
          <History className="h-4 w-4" />
          Cette réunion a été enrichie après sa diffusion — {enrichments.length} élément{enrichments.length > 1 ? 's' : ''} ajouté{enrichments.length > 1 ? 's' : ''}.
          <span className="ml-auto underline">{showJournal ? 'Masquer' : 'Voir les enrichissements'}</span>
        </button>
      )}

      {/* Ajout — labels MÉTIER, pas techniques. Le backend route. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Ajouter :</span>
        <button type="button" onClick={() => fileRef.current?.click()} disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-muted/40 disabled:opacity-50">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />} Photo ou capture
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />

        <Link href={`/documents/import?target_type=site_report&target_id=${reportId}`}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-muted/40">
          <FilePlus2 className="h-3.5 w-3.5" /> Document métier (plan, DOE, PV…)
        </Link>
      </div>

      {/* PV : version figée + régénération. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">PV :</span>
        {hasFinalPv && (
          <Link href={`/meetings/${reportId}/pv/final`}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-muted/40">
            <FileCheck2 className="h-3.5 w-3.5" /> Voir le PV figé
          </Link>
        )}
        <button type="button" onClick={regenerate} disabled={regen}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-muted/40 disabled:opacity-50">
          {regen ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Générer une nouvelle version
        </button>
      </div>

      {error && <p className="text-xs text-rose-600">{error}</p>}

      {/* Historique des enrichissements — date · qui · quoi. */}
      {enrichments.length > 0 && (!hasFinalPv || showJournal) && (
        <div className="space-y-1.5 border-t pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Historique des enrichissements</p>
          <ol className="space-y-0 border-l-2 border-muted pl-3">
            {enrichments.map((e, i) => (
              <li key={i} className="relative pb-2.5">
                <span className="absolute -left-[17px] top-1 h-2 w-2 rounded-full bg-foreground/40" />
                <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                  <span>{frDateTime(e.date)}</span>
                  {e.who && <span className="font-medium text-foreground">{e.who}</span>}
                </div>
                <p className="text-sm">{e.what}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  )
}
