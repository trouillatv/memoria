'use client'

// Déclarer une livraison/évacuation depuis le terrain (mobile). Repliable, gros
// champs, photo du bon en un tap. La douleur n°1 du pilote BTP : le camion livre/
// évacue toute la journée, on veut un retour fiable + photo en fin de journée.
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Truck, Camera, Check, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { recordDeliveryFieldAction } from './delivery-actions'

export function DeliverFieldPanel({ siteId }: { siteId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [photoName, setPhotoName] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('siteId', siteId)
    startTransition(async () => {
      const r = await recordDeliveryFieldAction(fd)
      if (r && 'error' in r) { toast.error(r.error); return }
      toast.success('Livraison enregistrée')
      formRef.current?.reset()
      setPhotoName(null)
      setOpen(false)
      router.refresh()
    })
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl border bg-card text-foreground text-sm font-medium px-4 py-3.5 active:bg-accent transition-colors">
        <Truck className="h-4 w-4 text-amber-600" /> Déclarer une livraison / évacuation
      </button>
    )
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="rounded-xl border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="inline-flex items-center gap-1.5 text-sm font-semibold"><Truck className="h-4 w-4 text-sky-600" /> Livraison / évacuation</p>
        <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
      </div>
      <input name="supplier" placeholder="Fournisseur (ex. Point P)" className="w-full rounded-lg border px-3 py-3 text-base" />
      <input name="material" placeholder="Produit livré / évacué (ex. portes, gravats)" className="w-full rounded-lg border px-3 py-3 text-base" />
      <div className="grid grid-cols-2 gap-2">
        <input name="quantity" placeholder="Quantité" className="rounded-lg border px-3 py-3 text-base" />
        <input name="zone" placeholder="Zone / bâtiment" className="rounded-lg border px-3 py-3 text-base" />
      </div>
      <textarea name="note" placeholder="Note (ex. moitié livrée, reste lundi)" rows={2} className="w-full rounded-lg border px-3 py-2 text-base" />

      <label className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed px-3 py-3 text-sm cursor-pointer hover:bg-muted/40">
        <Camera className="h-5 w-5 text-sky-600" />
        {photoName ? <span className="truncate">{photoName}</span> : 'Photo du bon / de la livraison'}
        <input type="file" name="photo" accept="image/*" capture="environment" hidden
          onChange={(e) => setPhotoName(e.target.files?.[0]?.name ?? null)} />
      </label>

      <button type="submit" disabled={pending}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-foreground text-background text-base font-medium px-4 py-4 active:scale-[0.99] disabled:opacity-50"
        style={{ minHeight: 56 }}>
        {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />} Enregistrer
      </button>
    </form>
  )
}
