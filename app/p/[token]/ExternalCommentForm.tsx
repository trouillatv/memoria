'use client'

import { useState, useTransition } from 'react'
import { MessageSquarePlus, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

const MAX_LENGTH = 2000

interface Props {
  token: string
}

export function ExternalCommentForm({ token }: Props) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [comment, setComment] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    const trimmed = comment.trim()
    if (!trimmed) return
    setError(null)

    startTransition(async () => {
      const res = await fetch('/api/share-comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, visitor_label: name.trim() || undefined, comment: trimmed }),
      })
      const data = (await res.json().catch(() => null)) as { ok?: boolean; reason?: string } | null
      if (!data?.ok) {
        const reason = data?.reason
        if (reason === 'rate_limited') setError('Trop de commentaires envoyés. Réessayez dans une heure.')
        else if (reason === 'comment_too_long') setError(`Commentaire trop long (max ${MAX_LENGTH} caractères).`)
        else setError('Erreur lors de l'envoi. Réessayez.')
        return
      }
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
            rows={5}
            disabled={pending}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[100px]"
          />
          <div className="text-right text-[11px] text-muted-foreground mt-1 tabular-nums">
            {comment.length} / {MAX_LENGTH}
          </div>
        </div>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

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
