'use client'

import { useState, useTransition } from 'react'
import { Loader2, CheckCircle2, Camera, X, PenLine } from 'lucide-react'
import { SignaturePad } from '@/app/(field)/m/intervention/[id]/SignaturePad'
import { checkItemsAndValidateViaToken, uploadExternalPhotoViaToken } from './actions-public'

interface ChecklistItem {
  id: string
  label: string
  required: boolean
  done: boolean
}

interface Props {
  token: string
  checklistItems: ChecklistItem[]
}

interface LocalPhoto {
  id: string
  previewUrl: string
}

export function ValidateInterventionForm({ token, checklistItems }: Props) {
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(checklistItems.filter((i) => i.done).map((i) => i.id)),
  )
  const [name, setName] = useState('')
  const [comment, setComment] = useState('')
  // Photos par tâche + photos générales (fallback sans checklist).
  const [photosByItem, setPhotosByItem] = useState<Record<string, LocalPhoto[]>>({})
  const [generalPhotos, setGeneralPhotos] = useState<LocalPhoto[]>([])
  const [uploadingFor, setUploadingFor] = useState<string | null>(null) // itemId | '__general__' | null
  const [signature, setSignature] = useState<string | null>(null)
  const [showPad, setShowPad] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const GENERAL = '__general__'
  const hasItems = checklistItems.length > 0

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 flex items-center gap-3">
        <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
        <div>
          <p className="text-sm font-medium text-emerald-800">Validé. Merci !</p>
          <p className="text-xs text-emerald-700 mt-0.5">Votre confirmation et vos preuves ont été enregistrées.</p>
        </div>
      </div>
    )
  }

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleAddPhoto(file: File | null, target: string) {
    if (!file) return
    setError(null)
    setUploadingFor(target)
    const fd = new FormData()
    fd.set('token', token)
    fd.set('file', file)
    if (target !== GENERAL) fd.set('checklist_item_id', target)
    const previewUrl = URL.createObjectURL(file)
    const res = await uploadExternalPhotoViaToken(fd)
    setUploadingFor(null)
    if (res.ok) {
      const photo = { id: res.photoId, previewUrl }
      if (target === GENERAL) setGeneralPhotos((prev) => [...prev, photo])
      else setPhotosByItem((prev) => ({ ...prev, [target]: [...(prev[target] ?? []), photo] }))
    } else {
      URL.revokeObjectURL(previewUrl)
      setError(res.error)
    }
  }

  const allChecked = checklistItems.every((i) => checked.has(i.id))
  const incomplete = hasItems && !allChecked
  const commentRequired = incomplete
  const canSubmit =
    !isPending && uploadingFor === null && name.trim().length > 0 && !!signature &&
    (!commentRequired || comment.trim().length > 0)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!signature) { setError('Signature requise.'); return }
    if (commentRequired && !comment.trim()) { setError('Tâches incomplètes : un commentaire est obligatoire.'); return }
    startTransition(async () => {
      const result = await checkItemsAndValidateViaToken(token, Array.from(checked), name, comment, signature)
      if (result.ok) setDone(true)
      else setError(result.error)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Vos tâches — périmètre de la contribution */}
      {hasItems && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Vos tâches</h2>
          <div className="rounded-xl border divide-y">
            {checklistItems.map((item) => {
              const isChecked = checked.has(item.id)
              const itemPhotos = photosByItem[item.id] ?? []
              const isUploading = uploadingFor === item.id
              return (
                <div key={item.id} className="px-4 py-3 space-y-2">
                  <label className="flex items-start gap-3 cursor-pointer select-none active:opacity-80 transition-opacity">
                    <span className={`mt-0.5 h-5 w-5 shrink-0 rounded border-2 flex items-center justify-center transition-colors ${
                      isChecked ? 'border-emerald-500 bg-emerald-500' : 'border-muted-foreground/30 bg-background'
                    }`}>
                      {isChecked && (
                        <svg className="h-3 w-3 text-white" viewBox="0 0 10 10" fill="none" aria-hidden>
                          <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <input type="checkbox" className="sr-only" checked={isChecked} onChange={() => toggle(item.id)} />
                    <span className={`text-sm leading-snug flex-1 ${isChecked ? 'text-muted-foreground line-through' : ''}`}>
                      {item.label}
                      {item.required && !isChecked && <span className="text-amber-600 ml-1 text-[10px] font-medium">*</span>}
                    </span>
                  </label>

                  {/* Photos de cette tâche */}
                  {itemPhotos.length > 0 && (
                    <div className="grid grid-cols-4 gap-2 pl-8">
                      {itemPhotos.map((p) => (
                        <div key={p.id} className="relative aspect-square rounded-md border overflow-hidden bg-muted/30">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.previewUrl} alt="" className="h-full w-full object-cover" />
                        </div>
                      ))}
                    </div>
                  )}
                  <label className="ml-8 inline-flex items-center gap-1.5 rounded-lg border border-dashed px-2.5 py-1.5 text-xs text-muted-foreground cursor-pointer hover:text-foreground hover:border-foreground/40 active:scale-[0.99] transition">
                    {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                    {isUploading ? 'Envoi…' : 'Photo'}
                    <input type="file" accept="image/*" capture="environment" className="sr-only"
                      disabled={uploadingFor !== null}
                      onChange={(e) => { handleAddPhoto(e.target.files?.[0] ?? null, item.id); e.target.value = '' }} />
                  </label>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Photos générales — utile surtout sans checklist (fallback intervention entière) */}
      <section className="rounded-xl border p-4 space-y-3">
        <h2 className="text-sm font-medium">
          {hasItems ? 'Autres photos' : 'Photos'} <span className="text-muted-foreground/50 font-normal">(optionnel)</span>
        </h2>
        {generalPhotos.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {generalPhotos.map((p) => (
              <div key={p.id} className="relative aspect-square rounded-md border overflow-hidden bg-muted/30">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.previewUrl} alt="" className="h-full w-full object-cover" />
              </div>
            ))}
          </div>
        )}
        <label className="flex items-center justify-center gap-2 rounded-lg border border-dashed py-3 text-sm text-muted-foreground cursor-pointer hover:text-foreground hover:border-foreground/40 active:scale-[0.99] transition">
          {uploadingFor === GENERAL ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          {uploadingFor === GENERAL ? 'Envoi…' : 'Ajouter une photo'}
          <input type="file" accept="image/*" capture="environment" className="sr-only"
            disabled={uploadingFor !== null}
            onChange={(e) => { handleAddPhoto(e.target.files?.[0] ?? null, GENERAL); e.target.value = '' }} />
        </label>
      </section>

      {/* Identité + commentaire + signature */}
      <div className="rounded-xl border p-4 space-y-4">
        <h2 className="text-sm font-medium">Confirmer la réalisation</h2>

        <div className="space-y-1.5">
          <label htmlFor="it-name" className="text-xs text-muted-foreground">
            Votre nom / entreprise <span className="text-amber-600">*</span>
          </label>
          <input id="it-name" type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Ex : Plomberie Martin" required maxLength={100}
            className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="it-comment" className="text-xs text-muted-foreground">
            Commentaire {commentRequired
              ? <span className="text-amber-600">* (tâches incomplètes)</span>
              : <span className="text-muted-foreground/50">(optionnel)</span>}
          </label>
          <textarea id="it-comment" value={comment} onChange={(e) => setComment(e.target.value)}
            placeholder="Ex : 3 montants manquants — livraison incomplète" rows={2} maxLength={500}
            className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
        </div>

        {/* Signature — obligatoire, une seule pour toute la contribution */}
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">
            Signature <span className="text-amber-600">*</span>
          </label>
          {signature ? (
            <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={signature} alt="Signature" className="h-12 rounded bg-white border" />
              <span className="text-xs text-emerald-700 inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" />Signature enregistrée</span>
              <button type="button" onClick={() => setSignature(null)} className="ml-auto text-muted-foreground hover:text-foreground" aria-label="Refaire">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : showPad ? (
            <SignaturePad onSign={(dataUrl) => { setSignature(dataUrl); setShowPad(false) }} />
          ) : (
            <button type="button" onClick={() => setShowPad(true)}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-dashed py-3 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/40">
              <PenLine className="h-4 w-4" /> Signer
            </button>
          )}
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <button type="submit" disabled={!canSubmit}
          className="w-full rounded-lg bg-foreground text-background py-3 text-sm font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2 transition-opacity">
          {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Valider mes tâches
        </button>

        <p className="text-[10px] text-muted-foreground/60 text-center">
          En validant, vous certifiez avoir réalisé ou vérifié les points ci-dessus.
          Votre confirmation est une preuve — elle ne clôture pas l&apos;intervention côté entreprise.
        </p>
      </div>
    </form>
  )
}
