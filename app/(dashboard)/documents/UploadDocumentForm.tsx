'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { uploadDocumentAction } from './actions'
import {
  DOCUMENT_TYPE_OPTIONS,
  VISIBILITY_OPTIONS,
  TARGET_TYPE_OPTIONS,
} from '@/lib/documents/labels'

type Collection = { id: string; name: string }

const selectCls =
  'mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm'

export function UploadDocumentForm({
  collections,
  prefillTargetType,
  prefillTargetId,
}: {
  collections: Collection[]
  prefillTargetType?: string
  prefillTargetId?: string
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setMsg(null)
    setPending(true)
    const form = e.currentTarget
    const r = await uploadDocumentAction(new FormData(form))
    setPending(false)
    if (!r.ok) {
      setMsg({ ok: false, text: r.error ?? 'Échec' })
      return
    }
    form.reset()
    setMsg({ ok: true, text: 'Document envoyé. Analyse en cours…' })
    router.refresh()
  }

  if (collections.length === 0) {
    return (
      <p className="text-sm text-muted-foreground rounded-lg border p-4">
        Crée d’abord une collection : un document doit toujours être classé.
      </p>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border bg-card p-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Collection *</label>
          <select name="collection_id" required defaultValue="" className={selectCls}>
            <option value="" disabled>
              Choisir…
            </option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Type *</label>
          <select name="document_type" required defaultValue="" className={selectCls}>
            <option value="" disabled>
              Choisir…
            </option>
            {DOCUMENT_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Visibilité</label>
          <select name="visibility_level" defaultValue="manager" className={selectCls}>
            {VISIBILITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Tags (séparés par virgule)</label>
          <Input name="tags" placeholder="bloc B, humidité" />
        </div>
      </div>

      {prefillTargetType && prefillTargetId ? (
        <>
          <input type="hidden" name="target_type" value={prefillTargetType} />
          <input type="hidden" name="target_id" value={prefillTargetId} />
          <p className="text-xs text-muted-foreground">
            Rattaché à : {prefillTargetType}
          </p>
        </>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Rattacher à (optionnel)</label>
            <select name="target_type" defaultValue="" className={selectCls}>
              <option value="">— Aucun —</option>
              {TARGET_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Identifiant (UUID, si rattachement)</label>
            <Input name="target_id" placeholder="UUID de l’entité" />
          </div>
        </div>
      )}

      <div>
        <label className="text-xs text-muted-foreground">Fichier PDF *</label>
        <Input type="file" name="file" accept="application/pdf" required />
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Envoi…' : 'Téléverser'}
        </Button>
        {msg && (
          <p className="text-sm text-muted-foreground">{msg.text}</p>
        )}
      </div>
    </form>
  )
}
