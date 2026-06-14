'use client'

import { useState, useRef, useTransition } from 'react'
import { MessageSquarePlus, CheckCircle2, X, ImagePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

const MAX_LENGTH = 2000
const MAX_PHOTOS = 3
const MAX_PHOTO_MB = 5

interface Props {
  token: string
}

interface Preview {
  file: File
  url: string
}

export function ExternalCommentForm({ token }: Props) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [comment, setComment] = useState('')
  const [previews, setPreviews] = useState<Preview[]>([])
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  function addPhotos(files: FileList | null) {
    if (!files) return
    const newPreviews: Preview[] = []
    for (const file of Array.from(files)) {
      if (previews.length + newPreviews.length >= MAX_PHOTOS) break
      if (!file.type.startsWith('image/')) continue
      if (file.size > MAX_PHOTO_MB * 1024 * 1024) {
        setError(`Image trop lourde (max ${MAX_PHOTO_MB} Mo).`)
        continue
      }
      setError(null)
      newPreviews.push({ file, url: URL.createObjectURL(file) })
    }
    setPreviews((prev) => [...prev, ...newPreviews].slice(0, MAX_PHOTOS))
  }

  function removePhoto(idx: number) {
    setPreviews((prev) => {
      URL.revokeObjectURL(prev[idx]!.url)
      return prev.filter((_, i) => i !== idx)
    })
  }

  function submit() {
    const trimmed = comment.trim()
    if (!trimmed) return
    setError(null)

    startTransition(async () => {
      const fd = new FormData()
      fd.append('token', token)
      if (name.trim()) fd.append('visitor_label', name.trim())
      fd.append('comment', trimmed)
      for (const p of previews) fd.append('photos', p.file)

      const res = await fetch('/api/share-comment', { method: 'POST', body: fd })
      const data = (await res.json().catch(() => null)) as { ok?: boolean; reason?: string } | null
      if (!data?.ok) {
        const reason = data?.reason
        if (reason === 'rate_limited') setError('Trop de commentaires envoyés. Réessayez dans une heure.')
        else if (reason === 'comment_too_long') setError(`Commentaire trop long (max ${MAX_LENGTH} caractères).`)
        else setError("Erreur lors de l'envoi. Réessayez.")
        return
      }
      previews.forEach((p) => URL.revokeObjectURL(p.url))
      setSent(true)
    })
  }

  if (sent) {
    return (
      <Card>
        <CardContent className="py-6 flex flex-col items-center gap-3 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-500" />
          <div>
            <p className="font-medium">Commentaire envoyé</p>
            <p className="text-sm text-muted-foreground mt-1">Le responsable de l&apos;intervention en sera informé.</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!open) {
    return (
      <div className="flex justify-center">
        <Button variant="outline" onClick={() => setOpen(true)} className="gap-2">
          <MessageSquarePlus className="h-4 w-4" />
          Laisser un commentaire
        </Button>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Votre commentaire</CardTitle>
        <CardDescription>
          Vos remarques seront transmises au responsable. Aucun compte requis.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="visitor-name" className="text-xs">Votre nom (optionnel)</Label>
          <Input
            id="visitor-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex : Martin Dupont"
            maxLength={100}
            disabled={pending}
          />
        </div>

        <div>
          <Label htmlFor="visitor-comment" className="text-xs">Commentaire</Label>
          <textarea
            id="visitor-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value.slice(0, MAX_LENGTH))}
            placeholder="Vos remarques, observations ou questions…"
            rows={4}
            disabled={pending}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[100px]"
          />
          <div className="text-right text-[11px] text-muted-foreground mt-1 tabular-nums">
            {comment.length} / {MAX_LENGTH}
          </div>
        </div>

        {/* Photos */}
        <div className="space-y-2">
          <Label className="text-xs">Photos (optionnel, max {MAX_PHOTOS})</Label>
          {previews.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {previews.map((p, idx) => (
                <div key={idx} className="relative w-20 h-20 rounded-md overflow-hidden border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(idx)}
                    disabled={pending}
                    className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {previews.length < MAX_PHOTOS && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => addPhotos(e.target.files)}
                disabled={pending}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={pending}
                className="inline-flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
              >
                <ImagePlus className="h-4 w-4" />
                Ajouter {previews.length === 0 ? 'des photos' : 'une photo'}
              </button>
            </>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={pending || !comment.trim()}>
            {pending ? 'Envoi…' : 'Envoyer'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
