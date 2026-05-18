// Section "Accès site" (lecture seule, dashboard superviseur).
// Doctrine : preuve d'accès, aucun nom de personne. La capture se fait
// au terrain (mobile) — ici on lit prise / restitution / incident.

import { KeyRound, Undo2, AlertTriangle, ImageIcon } from 'lucide-react'
import Image from 'next/image'
import type { DbInterventionAccessEvent, AccessEventType, AccessEventSource } from '@/lib/db/intervention-access-events'
import type { DbInterventionPhoto } from '@/types/db'

const TYPE_LABEL: Record<AccessEventType, string> = {
  pickup: "Prise d'accès",
  return: 'Restitution',
  incident: "Incident d'accès",
}
const SOURCE_LABEL: Record<AccessEventSource, string> = {
  pc_securite: 'PC sécurité',
  spi: 'SPI / prestataire',
  accueil: 'Accueil',
  autre: 'Autre',
}
const TYPE_ICON: Record<AccessEventType, React.ReactNode> = {
  pickup: <KeyRound className="h-3.5 w-3.5" />,
  return: <Undo2 className="h-3.5 w-3.5" />,
  incident: <AlertTriangle className="h-3.5 w-3.5" />,
}

interface Props {
  events: DbInterventionAccessEvent[]
  photos: DbInterventionPhoto[]
  signedUrls: Record<string, string>
}

export function AccessPanel({ events, photos, signedUrls }: Props) {
  const photoById = new Map(photos.map((p) => [p.id, p]))

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground inline-flex items-center gap-2">
        <KeyRound className="h-3.5 w-3.5" />
        Accès site ({events.length})
      </h2>

      {events.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          Aucun mouvement d&apos;accès documenté sur cette intervention.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {events.map((e) => {
            const photo = e.photo_id ? photoById.get(e.photo_id) : null
            const url = photo ? signedUrls[photo.storage_path] : null
            return (
              <li key={e.id} className="rounded border bg-background p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-muted-foreground">{TYPE_ICON[e.type]}</span>
                      <span className="text-sm font-medium">{TYPE_LABEL[e.type]}</span>
                      <span className="text-xs text-muted-foreground">
                        · {SOURCE_LABEL[e.source]}
                      </span>
                      {e.type === 'return' && e.deferred && (
                        <span className="inline-flex items-center px-1.5 py-px rounded-full text-[9px] uppercase font-semibold tracking-widest bg-muted text-muted-foreground">
                          différée
                        </span>
                      )}
                    </div>
                    {e.note && (
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                        {e.note}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {new Date(e.occurred_at).toLocaleString('fr-FR')}
                      {e.type === 'incident' && e.anomaly_id && (
                        <> · incident lié — voir Anomalies</>
                      )}
                    </p>
                  </div>
                  {url ? (
                    <Image
                      src={url}
                      alt="Trousseau / badge"
                      width={56}
                      height={56}
                      className="h-14 w-14 rounded object-cover border shrink-0"
                      unoptimized
                    />
                  ) : photo ? (
                    <span className="inline-flex h-14 w-14 items-center justify-center rounded border text-muted-foreground shrink-0">
                      <ImageIcon className="h-4 w-4" />
                    </span>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
