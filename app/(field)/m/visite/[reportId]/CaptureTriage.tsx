'use client'

// Écran 2 — TRAITEMENT DES CAPTURES, photo par photo. L'objectif est UNE
// métrique : traiter 30 captures en moins de 2 minutes. Donc : une capture en
// grand, 4 tags métier, 1 geste → capture suivante automatiquement. Le SWIPE est
// le vrai accélérateur (au bout de 2 jours, le conducteur ne regarde plus les
// boutons) : ← Mémoire · ↑ À surveiller · → Action · ↓ Réserve. Le tri ne
// supprime jamais ; 🗑 reste un geste volontaire. Cf. [[visite-trois-temps]].

import { useRef, useState } from 'react'
import { X, BookMarked, Eye, AlertTriangle, Check, Trash2, ArrowRight, ArrowLeft, ArrowUp, ArrowDown } from 'lucide-react'
import type { TriageDecision } from './debrief-actions'
import type { VisitCaptureRow } from '@/lib/db/visit-captures'
import type { CapturePreview } from './DebriefExpress'

const KEEP_TAGS: Array<{
  decision: Exclude<TriageDecision, 'delete'>
  label: string
  icon: typeof BookMarked
  swipe: string
  cls: string
}> = [
  { decision: 'memoire', label: 'Un élément à conserver', icon: BookMarked, swipe: '←', cls: 'border-slate-300 text-slate-700 dark:text-slate-200' },
  { decision: 'surveiller', label: 'Un point à surveiller', icon: Eye, swipe: '↑', cls: 'border-amber-300 text-amber-700 dark:text-amber-300' },
  { decision: 'reserve', label: 'Une réserve', icon: AlertTriangle, swipe: '↓', cls: 'border-rose-300 text-rose-700 dark:text-rose-300' },
  { decision: 'action', label: 'Une action à prévoir', icon: Check, swipe: '→', cls: 'border-emerald-400 text-emerald-700 dark:text-emerald-300' },
]

function bigLabel(c: VisitCaptureRow): string {
  switch (c.kind) {
    case 'photo': return 'Photo'
    case 'video': return 'Vidéo'
    case 'vocal': return c.body?.trim() ? `« ${c.body.trim()} »` : 'Mémo vocal'
    case 'note': return c.body ?? 'Note'
    case 'verification': return c.body?.trim() ? `Point vérifié — ${c.body.trim()}` : 'Point vérifié'
    case 'position': return 'Position enregistrée'
  }
}

export function CaptureTriage({
  captures,
  previews,
  startIndex = 0,
  onDecide,
  onClose,
}: {
  captures: VisitCaptureRow[]
  previews: Record<string, CapturePreview>
  startIndex?: number
  onDecide: (capture: VisitCaptureRow, decision: TriageDecision, comment?: string) => void
  onClose: () => void
}) {
  const [index, setIndex] = useState(Math.min(Math.max(0, startIndex), Math.max(0, captures.length - 1)))
  const [comment, setComment] = useState('')
  const touch = useRef<{ x: number; y: number } | null>(null)

  const total = captures.length
  const capture = captures[index]
  if (!capture) { onClose(); return null }

  const preview = previews[capture.id]
  const canComment = capture.kind === 'photo' || capture.kind === 'video'

  function advance() {
    setComment('')
    if (index >= total - 1) { onClose(); return }
    setIndex((i) => i + 1)
  }

  function decide(decision: TriageDecision) {
    onDecide(capture, decision, canComment ? comment : undefined)
    advance()
  }

  // Swipe : ← Mémoire · ↑ Surveiller · → Action · ↓ Réserve. Seuil généreux pour
  // ne pas déclencher par erreur ; l'axe dominant l'emporte.
  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0]
    touch.current = { x: t.clientX, y: t.clientY }
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (!touch.current) return
    const t = e.changedTouches[0]
    const dx = t.clientX - touch.current.x
    const dy = t.clientY - touch.current.y
    touch.current = null
    const TH = 60
    if (Math.abs(dx) < TH && Math.abs(dy) < TH) return
    if (Math.abs(dx) > Math.abs(dy)) decide(dx < 0 ? 'memoire' : 'action')
    else decide(dy < 0 ? 'surveiller' : 'reserve')
  }

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-background">
      {/* En-tête : progression + fermer. « Capture 3 / 15 ». */}
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <button type="button" onClick={onClose} aria-label="Fermer" className="text-muted-foreground">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <p className="text-sm font-medium">Capture {index + 1} / {total}</p>
          <div className="mx-auto mt-1 h-1 w-40 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${((index + 1) / total) * 100}%` }} />
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Fermer" className="text-muted-foreground">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Média en grand — le swipe se fait ici. */}
      <div
        className="flex flex-1 items-center justify-center overflow-hidden bg-black/5 p-3 dark:bg-white/5"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {capture.kind === 'photo' && preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview.url} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
        ) : capture.kind === 'video' && preview ? (
          <video src={preview.url} controls playsInline className="max-h-full max-w-full rounded-lg bg-black" />
        ) : capture.kind === 'vocal' ? (
          <div className="w-full max-w-sm space-y-3 text-center">
            {preview && <audio src={preview.url} controls className="w-full" />}
            <p className="text-sm text-muted-foreground">{bigLabel(capture)}</p>
          </div>
        ) : (
          <p className="max-w-sm text-center text-lg leading-snug">{bigLabel(capture)}</p>
        )}
      </div>

      {/* Décision — « Cette capture montre… » + 4 tags métier + supprimer. */}
      <div className="space-y-3 border-t p-4 safe-bottom">
        <p className="text-sm font-medium text-muted-foreground">Cette capture montre…</p>

        {canComment && (
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Ajouter un commentaire… (facultatif)"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            maxLength={500}
          />
        )}

        <div className="grid grid-cols-2 gap-2">
          {KEEP_TAGS.map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.decision}
                type="button"
                onClick={() => decide(t.decision)}
                className={`flex items-center gap-2 rounded-xl border-2 bg-background px-3 py-3 text-left text-sm font-medium active:scale-[0.98] transition ${t.cls}`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className="min-w-0 flex-1 leading-tight">{t.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground/60" aria-hidden>{t.swipe}</span>
              </button>
            )
          })}
        </div>

        <div className="flex items-center justify-between gap-2 pt-0.5">
          <button
            type="button"
            onClick={() => decide('delete')}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" /> Supprimer
          </button>
          <span className="inline-flex items-center gap-2 text-[11px] text-muted-foreground/70" aria-hidden>
            <ArrowLeft className="h-3 w-3" /><ArrowUp className="h-3 w-3" /><ArrowDown className="h-3 w-3" /><ArrowRight className="h-3 w-3" /> glissez pour aller vite
          </span>
        </div>
      </div>
    </div>
  )
}
