'use client'

// Saisie d'un bon de livraison reçu sur le chantier (béton/BPE, matériaux).
// Sobre et descriptif (doctrine : pas d'alerte rouge, pas de gamification).
// La photo du BL est la pièce à valeur juridique (preuve datée et opposable).

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Truck } from 'lucide-react'
import { toast } from 'sonner'
import { recordDeliveryAction } from './actions'

/** Date du jour en fuseau Pacific/Noumea, au format yyyy-mm-dd. */
function todayNoumea(): string {
  const [d, m, y] = new Date()
    .toLocaleDateString('fr-FR', {
      timeZone: 'Pacific/Noumea',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
    .split('/')
  return `${y}-${m}-${d}`
}

export function DeliveryForm({ siteId }: { siteId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)
  const [deliveredOn, setDeliveredOn] = useState(todayNoumea())

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    formData.set('siteId', siteId)
    formData.set('deliveredOn', deliveredOn)

    startTransition(async () => {
      const r = await recordDeliveryAction(formData)
      if ('error' in r) {
        toast.error(r.error)
        return
      }
      toast.success('Bon de livraison enregistré')
      formRef.current?.reset()
      setDeliveredOn(todayNoumea())
      router.refresh()
    })
  }

  const inputClass = 'w-full rounded-md border bg-background px-2 py-1.5 text-sm'

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      className="rounded-lg border bg-card p-4 space-y-3"
    >
      <div className="flex items-center gap-2">
        <Truck className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-medium">Nouvelle livraison</h2>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="d-date" className="text-xs text-muted-foreground">Date de livraison</label>
          <input
            id="d-date"
            type="date"
            value={deliveredOn}
            onChange={(e) => setDeliveredOn(e.target.value)}
            disabled={pending}
            className={inputClass}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="d-supplier" className="text-xs text-muted-foreground">Fournisseur</label>
          <input id="d-supplier" name="supplier" type="text" maxLength={200} disabled={pending}
            placeholder="ex. Centrale BPE Numbo" className={inputClass} />
        </div>

        <div className="space-y-1">
          <label htmlFor="d-reference" className="text-xs text-muted-foreground">N° du bon</label>
          <input id="d-reference" name="reference" type="text" maxLength={120} disabled={pending}
            placeholder="ex. BL-2026-0481" className={inputClass} />
        </div>

        <div className="space-y-1">
          <label htmlFor="d-zone" className="text-xs text-muted-foreground">Ouvrage / zone</label>
          <input id="d-zone" name="zone" type="text" maxLength={200} disabled={pending}
            placeholder="ex. Voile R+1, semelles" className={inputClass} />
        </div>

        <div className="space-y-1">
          <label htmlFor="d-material" className="text-xs text-muted-foreground">Matériau</label>
          <input id="d-material" name="material" type="text" maxLength={200} disabled={pending}
            placeholder="ex. Béton C25/30" className={inputClass} />
        </div>

        <div className="space-y-1">
          <label htmlFor="d-quantity" className="text-xs text-muted-foreground">Quantité</label>
          <input id="d-quantity" name="quantity" type="text" maxLength={120} disabled={pending}
            placeholder="ex. 12 m³, 3 palettes" className={inputClass} />
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="d-note" className="text-xs text-muted-foreground">Note (optionnelle)</label>
        <input id="d-note" name="note" type="text" maxLength={500} disabled={pending}
          placeholder="ex. Toupie arrivée à 7h15, écart de 0,5 m³ noté sur le bon" className={inputClass} />
      </div>

      <div className="space-y-1">
        <label htmlFor="d-photo" className="text-xs text-muted-foreground">
          Photo du bon de livraison (recommandée)
        </label>
        <input
          id="d-photo"
          name="photo"
          type="file"
          accept="image/*"
          capture="environment"
          disabled={pending}
          className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm file:text-foreground"
        />
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-foreground text-background px-3 py-1.5 text-sm font-medium disabled:opacity-50 transition-transform active:scale-[0.98]"
        >
          {pending ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </form>
  )
}
