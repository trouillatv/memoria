// Slice B.1 — Anomalies résolues / ouvertes.
//
// Doctrine impérative :
//   - Calme. Anomalies en AMBRE pâle, jamais rouge alarmant. Résolues en
//     emerald sapin sobre.
//   - 2 sections "Ouvertes" (en haut, on les veut voir) puis "Résolues"
//     (la résolution est un fait factuel rassurant, on la consigne sans
//     détourner l'attention).
//   - Photos rattachées via la grid existante. Pas de duplication de UI.

import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { ProofAnomaly } from '@/lib/db/proofs'
import { ProofPhotoGrid } from './ProofPhotoGrid'

const CATEGORY_LABELS: Record<string, string> = {
  eau_coupee: 'Eau coupée',
  electricite_coupee: 'Électricité coupée',
  materiel_casse: 'Matériel manquant',
  acces_bloque: 'Accès impossible',
  zone_non_prete: 'Zone non prête',
  danger_securite: 'Danger / sécurité',
  livraison_probleme: 'Livraison problème',
  produit_manquant: 'Produit manquant',
  autre: 'Autre',
}

export function ProofAnomalies({ anomalies }: { anomalies: ProofAnomaly[] }) {
  const open = anomalies.filter((a) => !a.resolved_at)
  const resolved = anomalies.filter((a) => a.resolved_at)

  return (
    <div className="space-y-5">
      {open.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-xs uppercase tracking-widest font-semibold text-amber-800">
            Ouvertes ({open.length})
          </h3>
          <ul className="space-y-3">
            {open.map((a) => (
              <AnomalyCard key={a.id} anomaly={a} resolved={false} />
            ))}
          </ul>
        </section>
      )}

      {resolved.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-xs uppercase tracking-widest font-semibold text-emerald-800">
            Résolues ({resolved.length})
          </h3>
          <ul className="space-y-3">
            {resolved.map((a) => (
              <AnomalyCard key={a.id} anomaly={a} resolved={true} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function AnomalyCard({
  anomaly,
  resolved,
}: {
  anomaly: ProofAnomaly
  resolved: boolean
}) {
  const tone = resolved
    ? 'border-emerald-200 bg-emerald-50/60'
    : 'border-amber-200 bg-amber-50/60'

  const Icon = resolved ? CheckCircle2 : AlertTriangle
  const iconTone = resolved ? 'text-emerald-700' : 'text-amber-700'

  const label = CATEGORY_LABELS[anomaly.category] ?? 'Autre'

  return (
    <li className={`rounded-md border ${tone} p-3 space-y-2`}>
      <div className="flex items-start gap-2">
        <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${iconTone}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{label}</span>
            <span className="text-xs text-muted-foreground">
              Signalée le {formatDateTime(anomaly.reported_at)}
            </span>
          </div>
          {anomaly.description && (
            <p className="text-sm mt-1 whitespace-pre-wrap">
              {anomaly.description}
            </p>
          )}
        </div>
      </div>

      {resolved && (
        <div className="ml-6 text-xs text-emerald-900 space-y-0.5">
          <div>
            Résolue le {anomaly.resolved_at ? formatDateTime(anomaly.resolved_at) : '—'}
          </div>
          {anomaly.resolution_note && (
            <p className="italic">
              &laquo;&nbsp;{anomaly.resolution_note}&nbsp;&raquo;
            </p>
          )}
        </div>
      )}

      {anomaly.photos.length > 0 && (
        <div className="ml-6 pt-1">
          <ProofPhotoGrid photos={anomaly.photos} />
        </div>
      )}
    </li>
  )
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const date = d.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const time = d.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${date} à ${time}`
}
