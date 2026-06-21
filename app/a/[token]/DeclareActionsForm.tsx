'use client'

import { useState, useTransition } from 'react'
import { Loader2, CheckCircle2, Camera, PenLine, X, Check, Ban } from 'lucide-react'
import { SignaturePad } from '@/app/(field)/m/intervention/[id]/SignaturePad'
import { submitDeclarationViaToken, uploadActionPhotoViaToken } from './actions-public'

interface ActionItem {
  action_id: string
  title: string
  corps_etat: string | null
  due_date: string | null
  requires_proof_photo: boolean
}

interface Props {
  token: string
  recipientLabel: string
  items: ActionItem[]
}

type Decision = 'done' | 'blocked'
interface LocalState {
  decision: Decision | null
  comment: string
  photoPath: string | null
  photoPreview: string | null
  uploading: boolean
}

const EMPTY: LocalState = { decision: null, comment: '', photoPath: null, photoPreview: null, uploading: false }

export function DeclareActionsForm({ token, recipientLabel, items }: Props) {
  const [states, setStates] = useState<Record<string, LocalState>>(
    () => Object.fromEntries(items.map((i) => [i.action_id, { ...EMPTY }])),
  )
  const [name, setName] = useState(recipientLabel)
  const [signature, setSignature] = useState<string | null>(null)
  const [showPad, setShowPad] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function patch(id: string, p: Partial<LocalState>) {
    setStates((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }))
  }

  async function addPhoto(id: string, file: File | null) {
    if (!file) return
    setError(null)
    patch(id, { uploading: true })
    const fd = new FormData()
    fd.set('token', token)
    fd.set('action_id', id)
    fd.set('file', file)
    const preview = URL.createObjectURL(file)
    const res = await uploadActionPhotoViaToken(fd)
    if (res.ok) {
      patch(id, { uploading: false, photoPath: res.path, photoPreview: preview })
    } else {
      URL.revokeObjectURL(preview)
      patch(id, { uploading: false })
      setError(res.error)
    }
  }

  // Au moins une action renseignée ; « bloquée » exige un commentaire ;
  // « fait » sur une action à preuve requise exige une photo (« montre-moi »).
  const answered = items.filter((i) => states[i.action_id]?.decision != null)
  const blockedMissingComment = items.some((i) => {
    const s = states[i.action_id]
    return s?.decision === 'blocked' && !s.comment.trim()
  })
  const doneMissingPhoto = items.some((i) => {
    const s = states[i.action_id]
    return s?.decision === 'done' && i.requires_proof_photo && !s.photoPath
  })
  const anyUploading = items.some((i) => states[i.action_id]?.uploading)
  const canSubmit =
    !isPending && !anyUploading && answered.length > 0 && name.trim().length > 0 &&
    !!signature && !blockedMissingComment && !doneMissingPhoto

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!signature) { setError('Signature requise.'); return }
    if (blockedMissingComment) { setError('Une action bloquée doit être expliquée.'); return }
    if (doneMissingPhoto) { setError('Une photo est requise pour clôturer certaines actions.'); return }
    const declarations = answered.map((i) => {
      const s = states[i.action_id]
      return { actionId: i.action_id, status: s.decision as Decision, comment: s.comment, photoPath: s.photoPath }
    })
    startTransition(async () => {
      const res = await submitDeclarationViaToken(token, name, signature, declarations)
      if (res.ok) setDone(true)
      else setError(res.error)
    })
  }

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 flex items-center gap-3">
        <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
        <div>
          <p className="text-sm font-medium text-emerald-800">Merci, c&apos;est envoyé.</p>
          <p className="text-xs text-emerald-700 mt-0.5">Vos réponses et preuves ont été transmises au maître d&apos;œuvre.</p>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Vos actions</h2>
        <ul className="space-y-2.5">
          {items.map((item) => {
            const s = states[item.action_id] ?? EMPTY
            return (
              <li key={item.action_id} className="rounded-xl border p-3.5 space-y-3">
                <div>
                  <p className="text-sm font-medium leading-snug">{item.title}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                    {item.corps_etat && <span>{item.corps_etat}</span>}
                    {item.due_date && <span>· pour le {item.due_date}</span>}
                  </div>
                </div>

                {/* Deux états seulement : Fait / Bloqué (one-shot, pas un gestionnaire de tâches) */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => patch(item.action_id, { decision: s.decision === 'done' ? null : 'done' })}
                    className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border py-2 text-sm font-medium transition-colors ${
                      s.decision === 'done'
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : 'border-muted-foreground/25 text-muted-foreground hover:border-emerald-400'
                    }`}
                  >
                    <Check className="h-4 w-4" /> Fait
                  </button>
                  <button
                    type="button"
                    onClick={() => patch(item.action_id, { decision: s.decision === 'blocked' ? null : 'blocked' })}
                    className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border py-2 text-sm font-medium transition-colors ${
                      s.decision === 'blocked'
                        ? 'border-rose-500 bg-rose-500 text-white'
                        : 'border-muted-foreground/25 text-muted-foreground hover:border-rose-400'
                    }`}
                  >
                    <Ban className="h-4 w-4" /> Bloqué
                  </button>
                </div>

                {s.decision != null && (() => {
                  // « Montre-moi » : sur « fait », la photo de preuve est requise
                  // si l'action la demande (le MOE l'a posée à la création).
                  const photoNeeded = s.decision === 'done' && item.requires_proof_photo
                  return (
                  <div className="space-y-2.5">
                    <textarea
                      value={s.comment}
                      onChange={(e) => patch(item.action_id, { comment: e.target.value })}
                      rows={2}
                      maxLength={500}
                      placeholder={s.decision === 'blocked' ? 'Pourquoi ? (obligatoire — ex : attente pièce OPT)' : 'Commentaire (optionnel)'}
                      className={`w-full rounded-lg border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring ${
                        s.decision === 'blocked' && !s.comment.trim() ? 'border-rose-300' : ''
                      }`}
                    />
                    {photoNeeded && (
                      <p className={`text-[11px] font-medium ${s.photoPath ? 'text-emerald-700' : 'text-amber-700'}`}>
                        Pour clôturer : photo après travaux {s.photoPath ? '✓' : 'requise'}
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      {s.photoPreview ? (
                        <div className="relative h-14 w-14 rounded-md border overflow-hidden bg-muted/30">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={s.photoPreview} alt="" className="h-full w-full object-cover" />
                          <button
                            type="button"
                            onClick={() => patch(item.action_id, { photoPath: null, photoPreview: null })}
                            className="absolute top-0 right-0 bg-black/60 text-white p-0.5 rounded-bl"
                            aria-label="Retirer la photo"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <label className="inline-flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground cursor-pointer hover:text-foreground hover:border-foreground/40 active:scale-[0.99] transition">
                          {s.uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                          {s.uploading ? 'Envoi…' : 'Ajouter une photo'}
                          <input
                            type="file" accept="image/*" capture="environment" className="sr-only"
                            disabled={anyUploading}
                            onChange={(e) => { addPhoto(item.action_id, e.target.files?.[0] ?? null); e.target.value = '' }}
                          />
                        </label>
                      )}
                    </div>
                  </div>
                  )
                })()}
              </li>
            )
          })}
        </ul>
      </section>

      {/* Identité + signature */}
      <div className="rounded-xl border p-4 space-y-4">
        <h2 className="text-sm font-medium">Confirmer</h2>
        <div className="space-y-1.5">
          <label htmlFor="ad-name" className="text-xs text-muted-foreground">
            Votre nom / entreprise <span className="text-amber-600">*</span>
          </label>
          <input
            id="ad-name" type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Ex : Colas — chef de chantier" required maxLength={100}
            className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Signature <span className="text-amber-600">*</span></label>
          {signature ? (
            <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={signature} alt="Signature" className="h-12 rounded bg-white border" />
              <span className="text-xs text-emerald-700 inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" />Enregistrée</span>
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
          Envoyer {answered.length > 0 ? `(${answered.length})` : ''}
        </button>

        <p className="text-[10px] text-muted-foreground/60 text-center">
          Vos réponses sont une déclaration transmise au maître d&apos;œuvre — elles ne remplacent pas sa vérification.
        </p>
      </div>
    </form>
  )
}
