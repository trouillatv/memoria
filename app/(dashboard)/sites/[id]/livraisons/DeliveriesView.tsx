// Liste des bons de livraison d'un chantier, groupés par date.
// Sobre et descriptif (doctrine : pas d'alerte rouge, jamais une mesure d'humain).
// La photo du BL (URL signée résolue côté serveur) est la pièce opposable.

import { Truck, FileText, MapPin, Package, Hash, StickyNote } from 'lucide-react'
import type { SiteDelivery } from '@/lib/db/site-delivery'

export interface DeliveryWithPhoto extends SiteDelivery {
  photoUrl: string | null
}

// ---------------------------------------------------------------------------
// Formatage des dates (cohérent avec le journal de chantier)
// ---------------------------------------------------------------------------

const FR_MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]
const FR_DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

function formatDayHeading(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const utc = new Date(Date.UTC(y, m - 1, d))
  const dayName = FR_DAYS[utc.getUTCDay()]
  return `${dayName.charAt(0).toUpperCase() + dayName.slice(1)} ${d} ${FR_MONTHS[m - 1]} ${y}`
}

// ---------------------------------------------------------------------------
// Carte d'une livraison
// ---------------------------------------------------------------------------

function DeliveryCard({ delivery }: { delivery: DeliveryWithPhoto }) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-2.5">
      {/* Ligne titre : fournisseur + n° de bon */}
      <div className="flex items-center gap-2 flex-wrap">
        <Truck className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden />
        <span className="font-medium text-sm">
          {delivery.supplier ?? 'Livraison'}
        </span>
        {delivery.reference && (
          <span className="inline-flex items-center gap-1 rounded border px-1.5 py-0 text-[11px] text-muted-foreground">
            <Hash className="h-3 w-3" aria-hidden />
            {delivery.reference}
          </span>
        )}
      </div>

      {/* Chips info : zone, matériau, quantité */}
      <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
        {delivery.zone && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3 w-3" aria-hidden />
            {delivery.zone}
          </span>
        )}
        {delivery.material && (
          <span className="inline-flex items-center gap-1">
            <Package className="h-3 w-3" aria-hidden />
            {delivery.material}
          </span>
        )}
        {delivery.quantity && (
          <span className="inline-flex items-center gap-1 tabular-nums">
            {delivery.quantity}
          </span>
        )}
      </div>

      {/* Note */}
      {delivery.note && (
        <p className="text-sm text-foreground/80 italic border-l-2 border-muted pl-3 inline-flex items-start gap-1.5">
          <StickyNote className="h-3 w-3 shrink-0 mt-1 not-italic" aria-hidden />
          {delivery.note}
        </p>
      )}

      {/* Photo du bon de livraison (vignette via URL signée) */}
      {delivery.photoUrl ? (
        <a
          href={delivery.photoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-fit"
          title="Ouvrir le bon de livraison"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={delivery.photoUrl}
            alt={`Bon de livraison${delivery.reference ? ` n°${delivery.reference}` : ''}`}
            className="h-28 w-auto rounded-md border object-cover"
          />
        </a>
      ) : (
        <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70">
          <FileText className="h-3 w-3" aria-hidden />
          Bon non photographié
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Export principal — groupé par date de livraison (décroissant)
// ---------------------------------------------------------------------------

interface Props {
  deliveries: DeliveryWithPhoto[]
}

export function DeliveriesView({ deliveries }: Props) {
  if (deliveries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic py-6 text-center">
        Aucune livraison enregistrée sur ce chantier pour le moment.
      </p>
    )
  }

  // Regroupement par date — l'ordre est préservé (la requête trie déjà
  // delivered_on puis created_at en décroissant).
  const groups: { date: string; items: DeliveryWithPhoto[] }[] = []
  for (const d of deliveries) {
    const last = groups[groups.length - 1]
    if (last && last.date === d.deliveredOn) last.items.push(d)
    else groups.push({ date: d.deliveredOn, items: [d] })
  }

  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <div key={group.date} className="space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-foreground">
              {formatDayHeading(group.date)}
            </h2>
            <div className="flex-1 h-px bg-border/50" aria-hidden />
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">
              {group.items.length} livraison{group.items.length > 1 ? 's' : ''}
            </span>
          </div>

          <div className="space-y-2">
            {group.items.map((d) => (
              <DeliveryCard key={d.id} delivery={d} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
