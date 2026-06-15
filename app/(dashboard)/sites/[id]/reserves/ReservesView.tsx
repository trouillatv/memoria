'use client'

// Liste des réserves d'un chantier, scindée "Ouvertes" / "Levées".
// Sobre et descriptif (doctrine : pas d'alerte rouge ; amber pour les ouvertes,
// jamais une mesure d'humain). VOCABULAIRE : on dit "lever" / "levée",
// jamais "résolu" (juridiquement dangereux).

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ClipboardCheck,
  MapPin,
  UserSquare,
  CalendarDays,
  CheckCircle2,
  StickyNote,
} from 'lucide-react'
import { toast } from 'sonner'
import type { SiteReserve } from '@/lib/db/site-reserve'
import { liftReserveAction } from './actions'

export interface ReserveWithPhotos extends SiteReserve {
  photoBeforeUrl: string | null
  photoAfterUrl: string | null
}

// ---------------------------------------------------------------------------
// Formatage des dates
// ---------------------------------------------------------------------------

const FR_MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

function formatDate(isoDate: string | null): string | null {
  if (!isoDate) return null
  const datePart = isoDate.slice(0, 10)
  const [y, m, d] = datePart.split('-').map(Number)
  if (!y || !m || !d) return null
  return `${d} ${FR_MONTHS[m - 1]} ${y}`
}

// ---------------------------------------------------------------------------
// Vignette photo (URL signée résolue côté serveur)
// ---------------------------------------------------------------------------

function PhotoThumb({ url, label }: { url: string; label: string }) {
  return (
    <div className="space-y-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <a href={url} target="_blank" rel="noopener noreferrer" className="block w-fit" title={label}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={label} className="h-28 w-auto rounded-md border object-cover" />
      </a>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Formulaire de levée (inline, sur une réserve ouverte)
// ---------------------------------------------------------------------------

function LiftForm({ reserve, siteId }: { reserve: ReserveWithPhotos; siteId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    formData.set('id', reserve.id)
    formData.set('siteId', siteId)

    startTransition(async () => {
      const r = await liftReserveAction(formData)
      if ('error' in r) {
        toast.error(r.error)
        return
      }
      toast.success('Réserve levée')
      formRef.current?.reset()
      setOpen(false)
      router.refresh()
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted/40 transition-colors"
      >
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
        Lever la réserve
      </button>
    )
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-2.5 rounded-md border bg-muted/20 p-3">
      <div className="space-y-1">
        <label htmlFor={`lift-note-${reserve.id}`} className="text-xs text-muted-foreground">
          Note de levée (ce qui a été fait)
        </label>
        <input
          id={`lift-note-${reserve.id}`}
          name="liftNote"
          type="text"
          maxLength={280}
          disabled={pending}
          placeholder="ex. Fissure rebouchée et reprise peinture le 14/06"
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor={`lift-photo-${reserve.id}`} className="text-xs text-muted-foreground">
          Photo de preuve (après) — recommandée
        </label>
        <input
          id={`lift-photo-${reserve.id}`}
          name="photoAfter"
          type="file"
          accept="image/*"
          capture="environment"
          disabled={pending}
          className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm file:text-foreground"
        />
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-foreground text-background px-3 py-1.5 text-sm font-medium disabled:opacity-50 transition-transform active:scale-[0.98]"
        >
          {pending ? 'Levée…' : 'Confirmer la levée'}
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Carte d'une réserve
// ---------------------------------------------------------------------------

function ReserveCard({ reserve, siteId }: { reserve: ReserveWithPhotos; siteId: string }) {
  const isLifted = reserve.status === 'lifted'
  const issuedOn = formatDate(reserve.issuedOn)
  const liftedAt = formatDate(reserve.liftedAt)

  return (
    <div className="rounded-lg border bg-card p-4 space-y-2.5">
      {/* Ligne titre : libellé + statut */}
      <div className="flex items-start gap-2 flex-wrap">
        <ClipboardCheck className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" aria-hidden />
        <span className="font-medium text-sm flex-1">{reserve.label}</span>
        {isLifted ? (
          <span className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-emerald-900 shrink-0">
            Levée
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-amber-900 shrink-0">
            Ouverte
          </span>
        )}
      </div>

      {/* Chips info : zone, émetteur, date d'émission */}
      <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
        {reserve.location && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3 w-3" aria-hidden />
            {reserve.location}
          </span>
        )}
        {reserve.issuedBy && (
          <span className="inline-flex items-center gap-1">
            <UserSquare className="h-3 w-3" aria-hidden />
            {reserve.issuedBy}
          </span>
        )}
        {issuedOn && (
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="h-3 w-3" aria-hidden />
            Émise le {issuedOn}
          </span>
        )}
      </div>

      {/* Photos avant / après */}
      {(reserve.photoBeforeUrl || reserve.photoAfterUrl) && (
        <div className="flex flex-wrap gap-4">
          {reserve.photoBeforeUrl && <PhotoThumb url={reserve.photoBeforeUrl} label="Constat (avant)" />}
          {reserve.photoAfterUrl && <PhotoThumb url={reserve.photoAfterUrl} label="Preuve (après)" />}
        </div>
      )}

      {/* Détails de levée */}
      {isLifted && (
        <div className="space-y-1 border-l-2 border-emerald-200 pl-3">
          {liftedAt && (
            <p className="text-xs text-emerald-800 inline-flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" aria-hidden />
              Levée le {liftedAt}
            </p>
          )}
          {reserve.liftNote && (
            <p className="text-sm text-foreground/80 italic inline-flex items-start gap-1.5">
              <StickyNote className="h-3 w-3 shrink-0 mt-1 not-italic" aria-hidden />
              {reserve.liftNote}
            </p>
          )}
        </div>
      )}

      {/* Action de levée (réserves ouvertes uniquement) */}
      {!isLifted && (
        <div className="pt-1">
          <LiftForm reserve={reserve} siteId={siteId} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Export principal — scindé Ouvertes / Levées
// ---------------------------------------------------------------------------

interface Props {
  siteId: string
  reserves: ReserveWithPhotos[]
}

export function ReservesView({ siteId, reserves }: Props) {
  if (reserves.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic py-6 text-center">
        Aucune réserve enregistrée sur ce chantier pour le moment.
      </p>
    )
  }

  const open = reserves.filter((r) => r.status !== 'lifted')
  const lifted = reserves.filter((r) => r.status === 'lifted')

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-foreground">Ouvertes</h2>
          <div className="flex-1 h-px bg-border/50" aria-hidden />
          <span className="text-xs text-muted-foreground tabular-nums shrink-0">
            {open.length} réserve{open.length > 1 ? 's' : ''}
          </span>
        </div>
        {open.length === 0 ? (
          <p className="text-xs text-muted-foreground/80 italic">
            Aucune réserve ouverte — toutes les réserves dressées ont été levées.
          </p>
        ) : (
          <div className="space-y-2">
            {open.map((r) => (
              <ReserveCard key={r.id} reserve={r} siteId={siteId} />
            ))}
          </div>
        )}
      </section>

      {lifted.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-foreground">Levées</h2>
            <div className="flex-1 h-px bg-border/50" aria-hidden />
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">
              {lifted.length} réserve{lifted.length > 1 ? 's' : ''}
            </span>
          </div>
          <div className="space-y-2">
            {lifted.map((r) => (
              <ReserveCard key={r.id} reserve={r} siteId={siteId} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
