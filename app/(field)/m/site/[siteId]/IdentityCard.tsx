import { MapPin, Navigation, Clock, KeyRound } from 'lucide-react'
import type { SiteIdentity } from '@/lib/db/sites'

/**
 * Identité du chantier + « Lieu du chantier ». Matérialise la décision produit :
 * Chantier = dossier métier ; le Site n'est qu'une LOCALISATION utile dans le
 * chantier (jamais une entité concurrente — d'où « Lieu du chantier », pas « Site »).
 * Sobre, textuel. N'affiche que ce qui existe. « Itinéraire » ouvre la carte depuis
 * l'adresse (pas de GPS en base pour l'instant → ni distance ni rayon).
 */
export function IdentityCard({ identity }: { identity: SiteIdentity }) {
  const { phaseLabel, clientName, address, accessHours, accessInstructions } = identity
  const hasIdentity = phaseLabel || clientName
  const hasLieu = address || accessHours || accessInstructions
  if (!hasIdentity && !hasLieu) return null

  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4">
      {hasIdentity && (
        <div className="flex flex-wrap items-center gap-2">
          {phaseLabel && (
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              {phaseLabel}
            </span>
          )}
          {clientName && <span className="text-sm text-muted-foreground">Client : <span className="font-medium text-foreground">{clientName}</span></span>}
        </div>
      )}

      {hasLieu && (
        <div className="space-y-2 border-t pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lieu du chantier</p>
          {address && (
            <div className="flex items-start justify-between gap-3">
              <p className="inline-flex items-start gap-1.5 text-sm">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span>{address}</span>
              </p>
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium active:scale-[0.97]"
              >
                <Navigation className="h-3.5 w-3.5" /> Itinéraire
              </a>
            </div>
          )}
          {accessHours && (
            <p className="inline-flex items-start gap-1.5 text-[13px] text-muted-foreground">
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {accessHours}
            </p>
          )}
          {accessInstructions && (
            <p className="inline-flex items-start gap-1.5 text-[13px] text-muted-foreground">
              <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {accessInstructions}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
