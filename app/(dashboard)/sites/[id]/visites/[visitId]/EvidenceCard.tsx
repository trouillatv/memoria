'use client'

// N3.1 — LA PREUVE, ET LE GESTE QUI LA CITE.
//
// Une capture s'ouvre : on relit la transcription, et on peut faire entrer une
// phrase dans le compte-rendu. Deux sections seulement — le résumé et « à
// savoir » — parce qu'on CITE une preuve, on ne rédige pas le compte-rendu.
// Une action, une décision ou une échéance passe par l'arbitrage, là où
// l'humain a les champs qu'il faut.
//
// L'écran reste sobre : N3.1 câble le récit, N3.2 le rendra agréable.

import { useState } from 'react'
import { Loader2, Check, Plus, Mic, Camera, FileText, MapPin } from 'lucide-react'
import { promoteEvidenceToCrAction } from '@/app/(field)/m/visite/[reportId]/cr/promotion-actions'
import type { NarrativeCapture } from '@/lib/db/visit-narrative'

const KIND_ICON: Record<string, typeof Mic> = {
  vocal: Mic, photo: Camera, video: Camera, note: FileText, position: MapPin, verification: Check,
}

/** Découpe une transcription en phrases citables. On ne reformule rien : on
 *  propose ce qui a été dit, tel quel. */
function sentences(text: string | null): string[] {
  if (!text) return []
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12)
}

export function EvidenceCard({
  reportId,
  capture,
  canPromote,
}: {
  reportId: string
  capture: NarrativeCapture
  /** Faux quand le compte-rendu est finalisé : on ne l'enrichit plus sans le rouvrir. */
  canPromote: boolean
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [done, setDone] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const Icon = KIND_ICON[capture.kind] ?? FileText
  const phrases = sentences(capture.body)
  const heure = capture.capturedAt.slice(11, 16)

  const promote = async (text: string, sectionKey: 'resume' | 'a_savoir') => {
    const key = `${sectionKey}:${text}`
    if (pending) return
    setPending(key)
    setError(null)
    const res = await promoteEvidenceToCrAction({
      reportId,
      captureId: capture.id,
      sectionKey,
      text,
    })
    setPending(null)
    if (res.ok) setDone((d) => ({ ...d, [text]: sectionKey }))
    else setError(res.error)
  }

  return (
    <div className="border-l pl-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline gap-2 py-2 text-left"
        aria-expanded={open}
      >
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{heure}</span>
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm">
          {capture.body?.trim() || <span className="text-muted-foreground">Sans texte</span>}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{open ? 'replier' : 'ouvrir'}</span>
      </button>

      <p className="-mt-1 mb-1 text-[11px] text-muted-foreground">{capture.why.label}</p>

      {open && (
        <div className="mb-3 space-y-3">
          {capture.body && (
            <p className="whitespace-pre-wrap border-l-2 pl-3 text-[13px] italic leading-relaxed text-muted-foreground">
              {capture.body}
            </p>
          )}

          {canPromote && phrases.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Citer une phrase dans le compte-rendu
              </p>
              {phrases.map((phrase) => (
                <div key={phrase} className="rounded-lg border bg-card p-2">
                  <p className="text-[13px] leading-snug">{phrase}</p>
                  {done[phrase] ? (
                    <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                      <Check className="h-3 w-3" aria-hidden />
                      Ajoutée à « {done[phrase] === 'resume' ? 'Résumé' : 'À savoir'} » — sa provenance est inscrite
                    </p>
                  ) : (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <PromoteButton
                        label="Résumé"
                        busy={pending === `resume:${phrase}`}
                        onClick={() => promote(phrase, 'resume')}
                      />
                      <PromoteButton
                        label="À savoir"
                        busy={pending === `a_savoir:${phrase}`}
                        onClick={() => promote(phrase, 'a_savoir')}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {!canPromote && (
            <p className="text-[11px] text-muted-foreground">
              Le compte-rendu est finalisé — rouvrez-le pour y citer une preuve.
            </p>
          )}

          {error && <p className="text-[12px] text-rose-600 dark:text-rose-400">{error}</p>}
        </div>
      )}
    </div>
  )
}

function PromoteButton({ label, busy, onClick }: { label: string; busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[12px] hover:border-foreground/40 disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Plus className="h-3 w-3" aria-hidden />}
      {label}
    </button>
  )
}
