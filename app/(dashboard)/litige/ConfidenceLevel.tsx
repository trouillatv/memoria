// Sprint 3 — UX-8 Niveau de confiance (affirmation calme).
//
// Doctrine V5 — Verrou V1 + Verrou V4 (strict) :
//   - AUCUN score numérique
//   - AUCUN pourcentage
//   - AUCUN classement / note / rating
//   - Affirmations passives descriptives uniquement.
//
// Wording autorisé :
//   « Dossier complet », « Photos suffisantes », « Preuves cohérentes »,
//   « Aucune anomalie en cours », « Interventions documentées »,
//   « Validations enregistrées », « Peu de photos disponibles ».
//
// Wording INTERDIT :
//   « Excellent », « Faible », « Mauvais », « Risque élevé », « Score : X/10 »,
//   « Note 8/10 », « Performance », « Confiance forte ».
//
// Le composant n'affiche AUCUNE valeur chiffrée brute non-passée ; les
// compteurs reçus en props sont uniquement utilisés pour le seuillage
// interne, jamais ré-affichés sous forme de "X interventions".

import * as React from 'react'

export interface ConfidenceLevelProps {
  interventionsCount: number
  photosCount: number
  anomaliesCount: number
  validationsCount: number
}

interface ConfidenceItem {
  ok: boolean
  label: string
}

function buildItems(props: ConfidenceLevelProps): ConfidenceItem[] {
  const items: ConfidenceItem[] = []

  if (props.interventionsCount > 0) {
    items.push({ ok: true, label: 'Interventions documentées' })
  }

  if (props.photosCount >= 3) {
    items.push({ ok: true, label: 'Photos suffisantes' })
  } else if (props.photosCount > 0) {
    items.push({ ok: false, label: 'Peu de photos disponibles' })
  }

  if (props.validationsCount > 0) {
    items.push({ ok: true, label: 'Validations enregistrées' })
  }

  if (props.anomaliesCount === 0) {
    items.push({ ok: true, label: 'Aucune anomalie en cours' })
  }

  return items
}

/**
 * Indique si le dossier peut être qualifié de « complet ».
 *
 * Critères doctrinaux passifs :
 *   - au moins 1 intervention documentée,
 *   - au moins 3 photos disponibles,
 *   - ET (au moins 1 validation OU aucune anomalie en cours).
 */
export function isDossierComplete(props: ConfidenceLevelProps): boolean {
  return (
    props.interventionsCount > 0 &&
    props.photosCount >= 3 &&
    (props.validationsCount > 0 || props.anomaliesCount === 0)
  )
}

export function ConfidenceLevel(props: ConfidenceLevelProps) {
  const items = buildItems(props)
  const complete = isDossierComplete(props)

  return (
    <div
      data-testid="confidence-level"
      className="rounded-lg border border-slate-200 bg-white p-4 mb-4"
    >
      <h3 className="text-sm font-semibold mb-3 text-slate-900">État du dossier</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          Aucun élément disponible pour cette période.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item, i) => (
            <li
              key={i}
              className="text-sm flex items-start gap-2"
              data-ok={item.ok ? 'true' : 'false'}
            >
              <span
                aria-hidden
                className={
                  item.ok
                    ? 'text-emerald-600 font-semibold'
                    : 'text-amber-600 font-semibold'
                }
              >
                {item.ok ? '✓' : '·'}
              </span>
              <span className="text-slate-700">{item.label}</span>
            </li>
          ))}
        </ul>
      )}
      {complete && (
        <p
          data-testid="confidence-complete"
          className="text-xs text-emerald-700 mt-3 italic"
        >
          Dossier complet · Preuves cohérentes
        </p>
      )}
    </div>
  )
}
