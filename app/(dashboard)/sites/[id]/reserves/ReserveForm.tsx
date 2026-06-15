'use client'

// Saisie d'un point à lever (constat à corriger), émis par un tiers (client,
// contrôleur, maître d'œuvre…). Sobre et descriptif (doctrine : pas d'alerte
// rouge, pas de gamification). La photo de constat (avant) documente le défaut.

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardList } from 'lucide-react'
import { toast } from 'sonner'
import { createReserveAction } from './actions'

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

export function ReserveForm({ siteId }: { siteId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)
  const [issuedOn, setIssuedOn] = useState(todayNoumea())

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    formData.set('siteId', siteId)
    formData.set('issuedOn', issuedOn)

    startTransition(async () => {
      const r = await createReserveAction(formData)
      if ('error' in r) {
        toast.error(r.error)
        return
      }
      toast.success('Point enregistré')
      formRef.current?.reset()
      setIssuedOn(todayNoumea())
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
        <ClipboardList className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-medium">Nouveau point à lever</h2>
      </div>

      <div className="space-y-1">
        <label htmlFor="r-label" className="text-xs text-muted-foreground">Libellé du point</label>
        <input
          id="r-label"
          name="label"
          type="text"
          maxLength={280}
          required
          disabled={pending}
          placeholder="ex. point à corriger"
          className={inputClass}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <label htmlFor="r-date" className="text-xs text-muted-foreground">Date d&apos;émission</label>
          <input
            id="r-date"
            type="date"
            value={issuedOn}
            onChange={(e) => setIssuedOn(e.target.value)}
            disabled={pending}
            className={inputClass}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="r-location" className="text-xs text-muted-foreground">Zone / local</label>
          <input id="r-location" name="location" type="text" maxLength={140} disabled={pending}
            placeholder="ex. RDC — hall" className={inputClass} />
        </div>

        <div className="space-y-1">
          <label htmlFor="r-issued-by" className="text-xs text-muted-foreground">Émetteur</label>
          <input id="r-issued-by" name="issuedBy" type="text" maxLength={140} disabled={pending}
            placeholder="ex. client, contrôleur" className={inputClass} />
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="r-photo" className="text-xs text-muted-foreground">
          Photo de constat (recommandée)
        </label>
        <input
          id="r-photo"
          name="photoBefore"
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
          {pending ? 'Enregistrement…' : 'Enregistrer le point'}
        </button>
      </div>
    </form>
  )
}
