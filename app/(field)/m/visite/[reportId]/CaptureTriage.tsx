'use client'

// Écran 2 — TRAITEMENT DES CAPTURES, photo par photo. Une capture en grand,
// 4 tags métier, et DEUX rythmes assumés :
//   • TAP sur un tag = décision DÉLIBÉRÉE : on enregistre mais on NE passe PAS à
//     la suivante. Le conducteur reste maître d'avancer (bouton « Suivant » /
//     swipe) — il peut corriger, commenter, changer d'avis avant de continuer.
//   • SWIPE = décision RAPIDE : tague ET enchaîne (← Mémoire · ↑ À surveiller ·
//     → Action · ↓ Réserve à lever). L'accélérateur pour qui connaît les gestes.
// Le tri ne supprime jamais : « Ne pas retenir » écarte du compte-rendu, la
// capture reste consultable. Cf. [[visite-trois-temps]].

import { useRef, useState } from 'react'
import { X, BookMarked, Eye, AlertTriangle, Check, Wrench, Trash2, ArrowRight, ArrowLeft, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import type { TriageDecision } from './debrief-actions'
import type { VisitCaptureRow } from '@/lib/db/visit-captures'
import type { CapturePreview } from './DebriefExpress'
import { PhotoAnnotator } from '@/app/(field)/m/site/[siteId]/PhotoAnnotator'
import { uploadReportAttachmentAction } from '@/app/(field)/m/site/[siteId]/report-actions'
import { addPhotoCaptureAction } from '@/app/(field)/m/site/[siteId]/capture-actions'

// État actuel d'une capture → décision (pour surligner le tag déjà choisi).
function currentDecision(c: VisitCaptureRow): TriageDecision | null {
  if (c.status === 'discarded') return 'delete'
  if (c.status === 'kept') {
    if (c.triage_intent === 'action') return 'action'
    if (c.triage_intent === 'follow') return 'surveiller'
    if (c.triage_intent === 'reserve') return 'reserve'
    return 'memoire'
  }
  return null
}

const KEEP_TAGS: Array<{
  decision: Exclude<TriageDecision, 'delete'>
  label: string
  icon: typeof BookMarked
  swipe: string
  cls: string
}> = [
  { decision: 'memoire', label: 'Un élément à conserver', icon: BookMarked, swipe: '←', cls: 'border-slate-300 text-slate-700 dark:text-slate-200' },
  { decision: 'surveiller', label: 'Un point à surveiller', icon: Eye, swipe: '↑', cls: 'border-amber-300 text-amber-700 dark:text-amber-300' },
  // « Une réserve » etait le SEUL tag sans verbe — les trois autres disent « à
  // conserver », « à surveiller », « à prévoir ». Dans un écran où tous les
  // autres gestes trient des captures, un nom nu se lit « mettre en réserve »,
  // c'est-à-dire « mets ça de côté ». Guillaume a tagué un vocal ainsi en
  // pensant l'écarter ; MemorIA a compris « défaut à lever » et l'a gardé.
  // Le verbe lève l'ambiguïté sans quitter le vocabulaire du métier.
  { decision: 'reserve', label: 'Une réserve à lever', icon: AlertTriangle, swipe: '↓', cls: 'border-rose-300 text-rose-700 dark:text-rose-300' },
  { decision: 'action', label: 'Une action à prévoir', icon: Wrench, swipe: '→', cls: 'border-emerald-400 text-emerald-700 dark:text-emerald-300' },
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
  onUndo,
  onClose,
  onAnnotated,
}: {
  captures: VisitCaptureRow[]
  previews: Record<string, CapturePreview>
  startIndex?: number
  onDecide: (capture: VisitCaptureRow, decision: TriageDecision, comment?: string) => void
  /** Re-tap sur le tag déjà choisi → on ANNULE (la capture redevient à trier). */
  onUndo: (capture: VisitCaptureRow) => void
  onClose: () => void
  /** Rappel après ajout d'une photo ANNOTÉE (nouvelle capture) — le parent
   *  recharge la liste + les aperçus pour la faire apparaître. */
  onAnnotated?: () => void | Promise<void>
}) {
  const total = captures.length
  const [index, setIndex] = useState(Math.min(Math.max(0, startIndex), Math.max(0, total - 1)))
  const touch = useRef<{ x: number; y: number } | null>(null)
  // Commentaire non contrôlé + `key` sur la capture : revenir en arrière recharge
  // ce qui a été saisi, sans setState en effet (pas de rendus en cascade).
  const commentRef = useRef<HTMLInputElement>(null)
  // Annotation ouverte (url de la photo à annoter), null = fermée.
  const [annotate, setAnnotate] = useState<string | null>(null)

  const capture = captures[index]
  if (!capture) { onClose(); return null }

  const preview = previews[capture.id]
  const canComment = capture.kind === 'photo' || capture.kind === 'video'
  const canAnnotate = capture.kind === 'photo' && !!preview
  const chosen = currentDecision(capture)

  // Quand la capture est taguée « Action » / « Réserve », le commentaire N'EST PLUS
  // facultatif : il devient le TITRE de la suite. On le rend explicite et bien
  // visible sur la photo, au lieu de laisser une « Action à préciser » vide.
  const needsTitle = chosen === 'action' || chosen === 'reserve'
  const commentLabel = chosen === 'action' ? 'Précisez l’action à réaliser'
    : chosen === 'reserve' ? 'Quel défaut faut-il lever ?'
    : null
  const commentPlaceholder = chosen === 'action' ? 'Ex. Reprendre l’étanchéité de la terrasse'
    : chosen === 'reserve' ? 'Ex. Fissure sur poteau — à traiter'
    : 'Ajouter un commentaire… (facultatif)'

  // Persiste le commentaire tapé APRÈS le choix du tag (au blur) : sinon le texte
  // saisi une fois la photo taguée serait perdu (il n'était lu qu'au moment du tag).
  function saveCommentIfTagged() {
    if (!chosen || chosen === 'delete' || !canComment) return
    const v = (commentRef.current?.value ?? '').trim()
    if (v !== (capture.body ?? '').trim()) decide(chosen, false)
  }

  // L'image ANNOTÉE s'ajoute EN PLUS de l'original (jamais détruire la preuve) :
  // nouvelle capture photo, même instant réel que l'originale (donc rangée juste
  // à côté d'elle dans une visite importée). Le parent recharge ensuite la liste.
  async function saveAnnotation(file: File, replaceOriginal: boolean) {
    try {
      const fd = new FormData()
      fd.set('report_id', capture.report_id)
      fd.set('kind', 'photo')
      fd.set('client_uuid', crypto.randomUUID())
      fd.set('file', file)
      const up = await uploadReportAttachmentAction(fd)
      if (!up.ok) { toast.error(up.error); return }
      const cap = await addPhotoCaptureAction({
        report_id: capture.report_id,
        site_id: capture.site_id,
        attachment_id: up.attachmentId,
        // Une photo annotée devient photo clé d'office → prioritaire dans le CR.
        starred: true,
        // « Remplacer l'affichage » → archive l'original (jamais supprimé).
        ...(replaceOriginal ? { replaces_capture_id: capture.id } : {}),
        ...(capture.captured_at ? { captured_at: capture.captured_at } : {}),
      })
      if (!cap.ok) { toast.error(cap.error); return }
      setAnnotate(null)
      toast.success('Photo annotée ajoutée', { duration: 1500 })
      await onAnnotated?.()
    } catch {
      toast.error('Échec de l’enregistrement de l’annotation')
    }
  }

  // Navigation CIRCULAIRE : après la dernière on revient à la première, et
  // « précédent » depuis la première va à la dernière. On ne SORT jamais tout
  // seul — la fermeture est un geste volontaire (croix). On peut donc revenir
  // corriger une mauvaise manipulation autant qu'on veut.
  function go(delta: number) {
    setIndex((i) => (i + delta + total) % total)
  }

  // Un TAP sur un tag enregistre la décision mais NE PASSE PAS à la suivante :
  // c'est au conducteur de décider quand il avance (bouton « Suivant » ou swipe).
  // On peut donc corriger, ajouter un commentaire, changer d'avis avant d'avancer.
  // Le SWIPE, lui, enchaîne (advance) — c'est le geste « aller vite » assumé.
  function decide(decision: TriageDecision, advance: boolean) {
    onDecide(capture, decision, canComment ? (commentRef.current?.value ?? undefined) : undefined)
    if (advance) go(1)
  }

  // Swipe : ← Mémoire · ↑ Surveiller · → Action · ↓ Réserve à lever. Seuil généreux pour
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
    if (Math.abs(dx) > Math.abs(dy)) decide(dx < 0 ? 'memoire' : 'action', true)
    else decide(dy < 0 ? 'surveiller' : 'reserve', true)
  }

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-background">
      {/* En-tête : fermer · progression · navigation (revenir en arrière possible). */}
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <button type="button" onClick={onClose} aria-label="Fermer" className="text-muted-foreground">
          <X className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <p className="text-sm font-medium">Capture {index + 1} / {total}</p>
          <div className="mx-auto mt-1 h-1 w-40 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${((index + 1) / total) * 100}%` }} />
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => go(-1)} aria-label="Précédent" className="rounded-lg p-1 text-muted-foreground active:bg-muted">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button type="button" onClick={() => go(1)} aria-label="Suivant" className="rounded-lg p-1 text-muted-foreground active:bg-muted">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Média en grand — le swipe se fait ici. */}
      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden bg-black/5 p-3 dark:bg-white/5"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {canAnnotate && (
          <button
            type="button"
            onClick={() => setAnnotate(preview.url)}
            className="absolute right-4 top-4 z-10 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur active:scale-95"
          >
            <Pencil className="h-3.5 w-3.5" /> Annoter
          </button>
        )}
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
          <div className="space-y-1">
            {commentLabel && (
              <p className="text-[13px] font-medium text-emerald-700 dark:text-emerald-300">{commentLabel}</p>
            )}
            <input
              key={capture.id}
              ref={commentRef}
              defaultValue={capture.body ?? ''}
              placeholder={commentPlaceholder}
              onBlur={saveCommentIfTagged}
              className={`w-full rounded-lg bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
                needsTitle ? 'border-2 border-emerald-400' : 'border border-input'
              }`}
              maxLength={500}
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          {KEEP_TAGS.map((t) => {
            const Icon = t.icon
            const active = chosen === t.decision
            return (
              <button
                key={t.decision}
                type="button"
                onClick={() => {
                  if (active) { onUndo(capture); return }
                  decide(t.decision, false)
                  // Action/Réserve non nommée → on invite à préciser tout de suite,
                  // le champ (déjà mis en avant) prend le focus sur la photo.
                  if ((t.decision === 'action' || t.decision === 'reserve') && canComment && !commentRef.current?.value.trim()) {
                    commentRef.current?.focus()
                  }
                }}
                className={`flex items-center gap-2 rounded-xl border-2 px-3 py-3 text-left text-sm font-medium active:scale-[0.98] transition ${t.cls} ${active ? 'bg-muted ring-2 ring-current ring-offset-1' : 'bg-background'}`}
              >
                {active ? <Check className="h-5 w-5 shrink-0" /> : <Icon className="h-5 w-5 shrink-0" />}
                <span className="min-w-0 flex-1 leading-tight">{t.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground/60" aria-hidden>{t.swipe}</span>
              </button>
            )
          })}
        </div>

        <div className="flex items-center justify-between gap-2 pt-0.5">
          <button
            type="button"
            onClick={() => (chosen === 'delete' ? onUndo(capture) : decide('delete', false))}
            className={`inline-flex items-center gap-1.5 text-xs font-medium ${chosen === 'delete' ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}
          >
            {/* « Supprimer » décrivait mal ET faisait peur : le tri ne supprime
                rien, la capture passe en `discarded` et reste consultable. Le
                geste que le conducteur cherche ici, c'est « celle-ci n'entre pas
                dans le compte-rendu ». On le dit. */}
            <Trash2 className="h-3.5 w-3.5" /> {chosen === 'delete' ? 'Écartée du compte-rendu' : 'Ne pas retenir'}
          </button>
          {/* Avancer est un GESTE VOLONTAIRE : le tap sur un tag n'enchaîne plus. */}
          <button
            type="button"
            onClick={() => go(1)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white active:scale-95"
          >
            Suivant <ArrowRight className="h-4 w-4" />
          </button>
        </div>
        <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground/70" aria-hidden>
          <ArrowLeft className="h-3 w-3" /><ArrowUp className="h-3 w-3" /><ArrowDown className="h-3 w-3" /><ArrowRight className="h-3 w-3" /> glissez pour taguer et enchaîner
        </p>
      </div>

      {/* Annotation plein écran — « regarde EXACTEMENT ici ». L'image annotée
          s'ajoute en plus de l'originale, sans jamais la détruire. */}
      {annotate && (
        <PhotoAnnotator
          imageUrl={annotate}
          onCancel={() => setAnnotate(null)}
          onSave={saveAnnotation}
        />
      )}
    </div>
  )
}
