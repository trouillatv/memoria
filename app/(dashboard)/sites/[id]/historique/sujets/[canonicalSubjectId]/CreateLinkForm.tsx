'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { Link2 } from 'lucide-react'
import SubjectPicker from './SubjectPicker'
import { createCanonicalLinkAction } from './link-actions'
import type { SubjectPickerItem } from '@/lib/db/canonical-subject-life'

const LINK_LABELS: Record<string, { out: string }> = {
  requires:   { out: 'nécessite' },
  enables:    { out: 'permet' },
  causes:     { out: 'provoque' },
  validates:  { out: 'valide' },
  replaces:   { out: 'remplace' },
  relates_to: { out: 'est lié à' },
}

interface Props {
  siteId: string
  canonicalSubjectId: string
  pickerItems: SubjectPickerItem[]
}

export default function CreateLinkForm({ siteId, canonicalSubjectId, pickerItems }: Props) {
  const [error, formAction, isPending] = useActionState(createCanonicalLinkAction, null)

  // Réinitialise le formulaire (clé) après chaque soumission réussie
  const [formKey, setFormKey] = useState(0)
  const wasPendingRef = useRef(false)
  useEffect(() => {
    if (wasPendingRef.current && !isPending && error === null) {
      setFormKey((k) => k + 1)
    }
    wasPendingRef.current = isPending
  }, [isPending, error])

  return (
    <div className="mt-1 rounded-lg border border-dashed bg-muted/10 px-3 py-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">Ajouter une relation</p>
      <form key={formKey} action={formAction} className="space-y-2">
        <input type="hidden" name="siteId" value={siteId} />
        <input type="hidden" name="canonicalSubjectId" value={canonicalSubjectId} />

        <SubjectPicker
          items={pickerItems}
          name="toCanonicalSubjectId"
          siteId={siteId}
          required
        />

        <select
          name="linkType"
          required
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
        >
          {Object.entries(LINK_LABELS).map(([type, { out }]) => (
            <option key={type} value={type}>{out}</option>
          ))}
        </select>

        <input
          type="text"
          name="justification"
          placeholder="Justification (optionnel)"
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
        />

        {error && (
          <p className="rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className={`inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors ${
            isPending ? 'cursor-not-allowed opacity-60' : 'hover:bg-primary/90'
          }`}
        >
          <Link2 className="h-3 w-3" />
          {isPending ? 'Liaison…' : 'Lier'}
        </button>
      </form>
    </div>
  )
}
