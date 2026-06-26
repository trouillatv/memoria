'use client'

// Mémoire du CHANTIER (cette réunion en est une étape). UN SEUL geste d'ajout ;
// la frontière est MÉTIER (photo de contexte vs document métier), jamais
// technique — le backend route. Le PV figé ne bouge pas ; tant qu'une nouvelle
// version n'est pas générée, les ajouts sont des « nouveautés à intégrer ». Le
// journal des enrichissements se RACONTE (groupé par jour · personne).

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Camera, FilePlus2, FileCheck2, RefreshCw, Loader2, History, Sparkle } from 'lucide-react'
import { toast } from 'sonner'
import { addMeetingAttachmentAction, generatePvAction } from './pv-actions'
import type { MeetingEnrichment } from '@/lib/db/meeting-enrichments'

function frDay(dayIso: string): string {
  const d = new Date(dayIso)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
}

// Journal INTELLIGENT : on regroupe par (jour, personne).
function groupByDayPerson(items: MeetingEnrichment[]) {
  const map = new Map<string, { day: string; who: string | null; whats: string[] }>()
  for (const e of items) {
    const day = e.date.slice(0, 10)
    const key = `${day}|${e.who ?? ''}`
    if (!map.has(key)) map.set(key, { day, who: e.who, whats: [] })
    map.get(key)!.whats.push(e.what)
  }
  return [...map.values()].sort((a, b) => (a.day < b.day ? -1 : 1))
}

export function MeetingMemoryPanel({
  reportId,
  hasFinalPv,
  lastPvAt,
  enrichments,
}: {
  reportId: string
  hasFinalPv: boolean
  lastPvAt: string | null
  enrichments: MeetingEnrichment[]
}) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, start] = useTransition()
  const [regen, startRegen] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [showJournal, setShowJournal] = useState(false)

  // « Nouveautés à intégrer » = enrichissements postérieurs au dernier PV figé.
  const toIntegrate = lastPvAt ? enrichments.filter((e) => e.date > lastPvAt) : []
  const groups = groupByDayPerson(enrichments)

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
      if (r.ok) { toast.success('Ajouté à la mémoire du chantier'); router.refresh() }
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
        <h2 className="text-sm font-semibold">Mémoire du chantier</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Cette réunion fait partie de la mémoire du chantier. Le PV est une version ; la mémoire reste vivante.
        </p>
      </div>

      {/* Nouveautés à intégrer : le PV n'est pas faux, mais il existe du plus récent. */}
      {hasFinalPv && toIntegrate.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300/60 bg-amber-50/60 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
          <Sparkle className="h-4 w-4" />
          <span><strong>{toIntegrate.length}</strong> nouveauté{toIntegrate.length > 1 ? 's' : ''} depuis le PV figé — une nouvelle version peut être générée.</span>
          <button type="button" onClick={() => setShowJournal((v) => !v)} className="ml-auto underline">
            {showJournal ? 'Masquer' : 'Voir'}
          </button>
        </div>
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
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-muted/40 disabled:opacity-50 ${toIntegrate.length > 0 ? 'border-amber-400 text-amber-800 dark:text-amber-200' : ''}`}>
          {regen ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Générer une nouvelle version
        </button>
      </div>

      {error && <p className="text-xs text-rose-600">{error}</p>}

      {/* Historique des enrichissements — groupé par jour · personne. */}
      {groups.length > 0 && (
        <div className="space-y-1">
          <button type="button" onClick={() => setShowJournal((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
            <History className="h-3.5 w-3.5" /> Historique des enrichissements ({enrichments.length}) {showJournal ? '▾' : '▸'}
          </button>
          {showJournal && (
            <ol className="space-y-0 border-l-2 border-muted pl-3">
              {groups.map((g, i) => (
                <li key={i} className="relative pb-3">
                  <span className="absolute -left-[17px] top-1 h-2 w-2 rounded-full bg-foreground/40" />
                  <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                    <span>{frDay(g.day)}</span>
                    {g.who && <span className="font-medium text-foreground">{g.who}</span>}
                  </div>
                  <ul className="mt-0.5 space-y-0.5 text-sm">
                    {g.whats.map((w, j) => <li key={j}>• {w}</li>)}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  )
}
