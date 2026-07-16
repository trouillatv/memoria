'use client'

// Ajouter un document au chantier, depuis le TERRAIN.
//
// La capacité existait déjà — le bureau l'a (« Document PDF » dans le menu
// Ajouter). Le terrain, lui, n'avait pas la porte : un plan reçu par mail, un
// devis signé, une attestation remise sur place, il fallait attendre d'être rentré
// pour les déposer. Ce n'était pas une fonction manquante, c'était une fonction
// invisible là où on en a besoin.
//
// On réutilise `uploadSiteDocumentAction` telle quelle : un seul chemin d'import,
// donc un seul comportement (déduplication, rattachement au chantier, indexation).
// Une seconde action « pour le mobile » finirait par diverger.

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { uploadSiteDocumentAction } from '@/app/(dashboard)/sites/[id]/site-add-actions'

export function AddDocumentPanel({ siteId }: { siteId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const r = await uploadSiteDocumentAction(siteId, fd)
      if (!r.ok) {
        toast.error(r.error ?? 'Import impossible')
        return
      }
      // Le doublon n'est pas une erreur : le document est déjà connu, on le
      // rattache. Le dire évite que le conducteur réessaie en boucle.
      toast.success(r.duplicate ? 'Document déjà connu — rattaché au chantier' : 'Document ajouté au chantier')
      formRef.current?.reset()
      setFileName(null)
      setOpen(false)
      router.refresh()
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-full w-full inline-flex items-center justify-center gap-2 rounded-xl border bg-muted/30 px-4 py-3.5 text-sm font-medium text-foreground shadow-sm transition active:brightness-95"
      >
        <FileText className="h-4 w-4 text-rose-600" /> Document
      </button>
    )
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="col-span-2 space-y-2 rounded-xl border bg-card p-3">
      <div className="flex items-center justify-between">
        <p className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <FileText className="h-4 w-4 text-rose-600" /> Ajouter un document
        </p>
        <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-muted-foreground hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Mêmes valeurs que le bureau : un document déposé du terrain est un
          document du chantier, pas une sous-catégorie « mobile ». */}
      <input type="hidden" name="document_type" value="preuve" />
      <input type="hidden" name="visibility_level" value="manager" />
      <input type="hidden" name="embed" value="true" />
      <input type="hidden" name="memory_tier" value="consultable" />

      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed px-3 py-4 text-sm hover:bg-muted/40">
        <FileText className="h-5 w-5 text-rose-600" />
        {fileName ? <span className="min-w-0 truncate">{fileName}</span> : 'Choisir un PDF'}
        <input
          type="file"
          name="file"
          accept="application/pdf"
          required
          hidden
          onChange={(e) => setFileName(e.currentTarget.files?.[0]?.name ?? null)}
        />
      </label>

      <button
        type="submit"
        disabled={pending || !fileName}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-foreground text-sm font-medium text-background disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
        Ajouter au chantier
      </button>
    </form>
  )
}
