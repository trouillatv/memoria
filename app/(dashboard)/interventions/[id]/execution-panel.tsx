'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Check, Play, CheckCircle2, UnlockKeyhole, Lock, ScanSearch } from 'lucide-react'
import { toast } from 'sonner'
import {
  startInterventionAction,
  completeInterventionAction,
  toggleChecklistItemAction,
  uploadInterventionPhotoAction,
  reopenInterventionAction,
  analyzeInterventionPhotoAction,
} from './intervention-actions'
import type { DbIntervention, DbInterventionChecklistItem, DbInterventionPhoto, PhotoKind } from '@/types/db'

const KIND_LABELS: Record<PhotoKind, string> = {
  before: 'Avant',
  after: 'Après',
  anomaly: 'Anomalie',
  proof: 'Preuve',
  passage: 'Passage', // V5.1 Slice 1 — trace libre hors workflow planifié
}

const KIND_COLORS: Record<PhotoKind, string> = {
  before: 'bg-slate-50 border-slate-200 text-slate-700',
  after: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  anomaly: 'bg-amber-50 border-amber-200 text-amber-700',
  proof: 'bg-sky-50 border-sky-200 text-sky-700',
  passage: 'bg-slate-50 border-slate-200 text-slate-600', // V5.1 — couleur sobre (grammaire descriptive)
}

interface Props {
  intervention: DbIntervention
  checklistItems: DbInterventionChecklistItem[]
  photos: DbInterventionPhoto[]
  signedUrls: Record<string, string>
}

export function ExecutionPanel({ intervention, checklistItems, photos, signedUrls }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [uploadingForItem, setUploadingForItem] = useState<string | 'free' | null>(null)
  const [uploadKind, setUploadKind] = useState<PhotoKind>('after')
  const fileRef = useRef<HTMLInputElement>(null)

  const [justCompleted, setJustCompleted] = useState(false)
  const [showJustification, setShowJustification] = useState(false)
  const [justificationComment, setJustificationComment] = useState('')
  const [missingCount, setMissingCount] = useState(0)
  const [reopenOpen, setReopenOpen] = useState(false)
  const [reopenPassword, setReopenPassword] = useState('')

  const isCompleted = intervention.status === 'completed' || justCompleted
  const canExecute = intervention.status === 'in_progress' && !justCompleted
  const canStart = intervention.status === 'planned'
  const canComplete = intervention.status === 'in_progress' && !justCompleted

  const [analyzingPhotoId, setAnalyzingPhotoId] = useState<string | null>(null)

  const photosByItem = new Map<string, DbInterventionPhoto[]>()
  const anomalyPhotos: DbInterventionPhoto[] = []
  const freePhotos: DbInterventionPhoto[] = []
  for (const p of photos) {
    if (p.checklist_item_id) {
      const list = photosByItem.get(p.checklist_item_id) ?? []
      list.push(p)
      photosByItem.set(p.checklist_item_id, list)
    } else if (p.anomaly_id) {
      anomalyPhotos.push(p)
    } else {
      freePhotos.push(p)
    }
  }

  function handleAnalyzePhoto(photoId: string) {
    setAnalyzingPhotoId(photoId)
    const fd = new FormData()
    fd.set('photo_id', photoId)
    startTransition(async () => {
      const r = await analyzeInterventionPhotoAction(fd)
      if (r && 'error' in r && r.error) toast.error(r.error)
      else { toast.success('Analyse terminée'); router.refresh() }
      setAnalyzingPhotoId(null)
    })
  }

  function handleStart() {
    const fd = new FormData()
    fd.set('id', intervention.id)
    startTransition(async () => {
      const r = await startInterventionAction(fd)
      if (r && 'error' in r && r.error) toast.error(r.error)
      else { toast.success('Intervention démarrée'); router.refresh() }
    })
  }

  function handleComplete(comment?: string) {
    const fd = new FormData()
    fd.set('id', intervention.id)
    if (comment) fd.set('comment', comment)
    startTransition(async () => {
      const r = await completeInterventionAction(fd)
      if (r && 'error' in r) {
        if (r.error === 'comment_required') {
          setMissingCount((r as { missingCount: number }).missingCount ?? 0)
          setShowJustification(true)
        } else if (r.error) {
          toast.error(r.error)
        }
      } else {
        setJustCompleted(true)
        setShowJustification(false)
        toast.success('Intervention terminée')
        router.refresh()
      }
    })
  }

  function handleReopen() {
    if (!reopenPassword) { toast.error('Mot de passe requis'); return }
    const fd = new FormData()
    fd.set('intervention_id', intervention.id)
    fd.set('password', reopenPassword)
    startTransition(async () => {
      const r = await reopenInterventionAction(fd)
      if (r && 'error' in r && r.error) {
        toast.error(r.error)
      } else {
        toast.success('Intervention réouverte')
        setReopenOpen(false)
        setReopenPassword('')
        setJustCompleted(false)
        router.refresh()
      }
    })
  }

  function handleToggleItem(itemId: string, currentDone: boolean) {
    const fd = new FormData()
    fd.set('id', itemId)
    fd.set('intervention_id', intervention.id)
    fd.set('done', (!currentDone).toString())
    startTransition(async () => {
      const r = await toggleChecklistItemAction(fd)
      if (r && 'error' in r && r.error) toast.error(r.error)
      else router.refresh()
    })
  }

  function openFilePicker(itemId: string | 'free', kind: PhotoKind) {
    setUploadingForItem(itemId)
    setUploadKind(kind)
    setTimeout(() => fileRef.current?.click(), 50)
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // reset
    if (!file || !uploadingForItem) return

    const fd = new FormData()
    fd.set('intervention_id', intervention.id)
    fd.set('checklist_item_id', uploadingForItem === 'free' ? '' : uploadingForItem)
    fd.set('kind', uploadKind)
    fd.set('file', file)

    startTransition(async () => {
      const r = await uploadInterventionPhotoAction(fd)
      if (r && 'error' in r && r.error) toast.error(r.error)
      else { toast.success('Photo ajoutée'); router.refresh() }
      setUploadingForItem(null)
    })
  }

  return (
    <>
      {/* Status actions */}
      {canStart && (
        <section className="rounded-lg border bg-card p-4">
          <button
            type="button"
            onClick={handleStart}
            disabled={pending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded border bg-foreground text-background text-sm hover:opacity-90 disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            {pending ? 'Démarrage...' : "Démarrer l'intervention"}
          </button>
          <p className="text-[11px] text-muted-foreground mt-2">
            Une fois démarrée, vous pourrez cocher les tâches et ajouter des photos preuves.
          </p>
        </section>
      )}

      {/* Checklist */}
      <section className="space-y-3 rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Checklist ({checklistItems.length})
          </h2>
          {canExecute && (
            <button
              type="button"
              onClick={() => openFilePicker('free', 'proof')}
              disabled={pending}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border text-xs hover:bg-muted/50 disabled:opacity-50"
            >
              <Camera className="h-3 w-3" /> Photo libre
            </button>
          )}
        </div>

        {checklistItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune tâche pour cette intervention.</p>
        ) : (
          <ul className="space-y-1.5">
            {checklistItems.map((item) => {
              const itemPhotos = photosByItem.get(item.id) ?? []
              return (
                <li key={item.id} className="rounded border bg-background p-2.5">
                  <div className="flex items-start gap-2">
                    {canExecute ? (
                      <button
                        type="button"
                        onClick={() => handleToggleItem(item.id, item.done)}
                        disabled={pending}
                        aria-label={item.done ? 'Décocher' : 'Cocher'}
                        className={`shrink-0 w-5 h-5 rounded border mt-0.5 flex items-center justify-center transition-colors ${item.done ? 'bg-emerald-500 border-emerald-600' : 'bg-card border-border hover:border-foreground/40'}`}
                      >
                        {item.done && <Check className="h-3 w-3 text-background" />}
                      </button>
                    ) : (
                      <span className={`shrink-0 w-5 h-5 rounded border mt-0.5 flex items-center justify-center ${item.done ? 'bg-emerald-500 border-emerald-600' : 'bg-card border-border'}`} aria-hidden>
                        {item.done && <Check className="h-3 w-3 text-background" />}
                      </span>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm ${item.done ? 'line-through text-muted-foreground' : ''}`}>
                        {item.label}
                        {item.required && <span className="ml-1 text-rose-500">*</span>}
                      </div>
                      {item.done && item.done_at && (
                        <div className="text-[10px] text-muted-foreground">
                          ✓ {new Date(item.done_at).toLocaleString('fr-FR')}
                        </div>
                      )}
                      {/* Inline photo thumbs for this item */}
                      {itemPhotos.length > 0 && (
                        <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                          {itemPhotos.map((p) => {
                            const url = signedUrls[p.storage_path]
                            return url ? (
                              <a key={p.id} href={url} target="_blank" rel="noopener noreferrer" className="block w-12 h-12 rounded overflow-hidden border bg-muted relative group">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={url} alt={p.kind} className="w-full h-full object-cover" />
                                <span className={`absolute bottom-0 left-0 right-0 text-[8px] uppercase font-semibold px-0.5 py-px ${KIND_COLORS[p.kind]}`}>
                                  {KIND_LABELS[p.kind]}
                                </span>
                              </a>
                            ) : (
                              <span key={p.id} className="block w-12 h-12 rounded border bg-muted/50" />
                            )
                          })}
                        </div>
                      )}
                    </div>
                    {/* Photo capture buttons for this item */}
                    {canExecute && (
                      <div className="flex flex-col gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => openFilePicker(item.id, 'before')}
                          disabled={pending}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] hover:bg-muted/50 disabled:opacity-50"
                        >
                          <Camera className="h-2.5 w-2.5" /> Avant
                        </button>
                        <button
                          type="button"
                          onClick={() => openFilePicker(item.id, 'after')}
                          disabled={pending}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] hover:bg-muted/50 disabled:opacity-50"
                        >
                          <Camera className="h-2.5 w-2.5" /> Après
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Anomaly photos with AI analysis */}
      {anomalyPhotos.length > 0 && (
        <section className="space-y-3 rounded-lg border bg-card p-4">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Photos d&apos;anomalie ({anomalyPhotos.length})
          </h2>
          <div className="space-y-3">
            {anomalyPhotos.map((p) => {
              const url = signedUrls[p.storage_path]
              const isAnalyzing = analyzingPhotoId === p.id
              return (
                <div key={p.id} className="flex gap-3 items-start rounded border bg-background p-2">
                  {url ? (
                    <a href={url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="anomalie" className="w-20 h-20 object-cover rounded" />
                    </a>
                  ) : (
                    <span className="shrink-0 w-20 h-20 rounded bg-muted/50" />
                  )}
                  <div className="flex-1 min-w-0 space-y-1.5">
                    {p.ai_caption ? (
                      <p className="text-sm text-muted-foreground italic">{p.ai_caption}</p>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleAnalyzePhoto(p.id)}
                        disabled={pending || isAnalyzing}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs hover:bg-muted/50 disabled:opacity-50"
                      >
                        <ScanSearch className="h-3.5 w-3.5" />
                        {isAnalyzing ? 'Analyse...' : 'Analyser avec l\'IA'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Free photos gallery */}
      {freePhotos.length > 0 && (
        <section className="space-y-3 rounded-lg border bg-card p-4">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Photos libres ({freePhotos.length})
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {freePhotos.map((p) => {
              const url = signedUrls[p.storage_path]
              return url ? (
                <a key={p.id} href={url} target="_blank" rel="noopener noreferrer" className="block relative rounded overflow-hidden border bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={p.kind} className="w-full h-32 object-cover" />
                  <span className={`absolute bottom-1 left-1 text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${KIND_COLORS[p.kind]}`}>
                    {KIND_LABELS[p.kind]}
                  </span>
                </a>
              ) : (
                <span key={p.id} className="block w-full h-32 rounded border bg-muted/50" />
              )
            })}
          </div>
        </section>
      )}

      {/* Hidden file input */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Complete button / justification form */}
      {canComplete && !showJustification && (
        <section className="rounded-lg border bg-card p-4">
          <button
            type="button"
            onClick={() => handleComplete()}
            disabled={pending}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg border-2 border-emerald-600 bg-emerald-600 text-white text-base font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            <CheckCircle2 className="h-5 w-5" />
            {pending ? '...' : "Terminer l'intervention"}
          </button>
        </section>
      )}

      {canComplete && showJustification && (
        <section className="rounded-lg border bg-card p-4 space-y-3">
          <h3 className="text-sm font-semibold">
            {missingCount} tâche{missingCount > 1 ? 's' : ''} obligatoire{missingCount > 1 ? 's' : ''} non cochée{missingCount > 1 ? 's' : ''}
          </h3>
          <p className="text-sm text-muted-foreground">
            Précisez pourquoi au superviseur avant de terminer.
          </p>
          <textarea
            value={justificationComment}
            onChange={(e) => setJustificationComment(e.target.value)}
            rows={3}
            maxLength={500}
            disabled={pending}
            autoFocus
            placeholder="Ex : accès au local technique fermé, matériel manquant…"
            className="w-full rounded border p-2 text-sm bg-background"
          />
          <div className="flex justify-between items-center">
            <button
              type="button"
              onClick={() => { setShowJustification(false); setJustificationComment('') }}
              disabled={pending}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              ← Retour
            </button>
            <button
              type="button"
              onClick={() => handleComplete(justificationComment)}
              disabled={pending || !justificationComment.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-emerald-600 bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" />
              {pending ? '...' : 'Terminer avec justification'}
            </button>
          </div>
        </section>
      )}

      {/* Intervention terminée — état verrouillé + bouton Réouvrir */}
      {isCompleted && (
        <section className="rounded-lg border-2 border-emerald-300 bg-emerald-50/60 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-8 w-8 text-emerald-600 shrink-0" />
            <div>
              <div className="text-lg font-bold text-emerald-900">Intervention terminée</div>
              {intervention.executed_at && (
                <div className="text-sm text-emerald-700/80 mt-0.5">
                  Terminée le{' '}
                  {new Date(intervention.executed_at).toLocaleDateString('fr-FR', {
                    weekday: 'long',
                    day: '2-digit',
                    month: 'long',
                    year: 'numeric',
                  })}
                </div>
              )}
            </div>
          </div>
          <p className="text-xs text-emerald-700/70">
            L&apos;intervention est verrouillée. La checklist ne peut plus être modifiée.
          </p>

          {!reopenOpen ? (
            <button
              type="button"
              onClick={() => setReopenOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border-2 border-sky-300 bg-sky-50 text-sky-900 text-sm font-medium hover:bg-sky-100"
            >
              <UnlockKeyhole className="h-4 w-4" /> Réouvrir l&apos;intervention
            </button>
          ) : (
            <div className="rounded-lg border-2 border-sky-200 bg-sky-50/60 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-sky-700" />
                <h3 className="text-sm font-semibold text-sky-900">Réouverture — mot de passe requis</h3>
              </div>
              <input
                type="password"
                value={reopenPassword}
                onChange={(e) => setReopenPassword(e.target.value)}
                placeholder="Votre mot de passe"
                autoComplete="current-password"
                autoFocus
                disabled={pending}
                className="w-full rounded border p-2 text-sm bg-background"
                onKeyDown={(e) => { if (e.key === 'Enter' && reopenPassword) handleReopen() }}
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setReopenOpen(false); setReopenPassword('') }}
                  disabled={pending}
                  className="px-3 py-1.5 rounded border text-sm disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={handleReopen}
                  disabled={pending || !reopenPassword}
                  className="px-3 py-1.5 rounded border bg-foreground text-background text-sm disabled:opacity-50"
                >
                  {pending ? 'Vérification…' : 'Confirmer la réouverture'}
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </>
  )
}
