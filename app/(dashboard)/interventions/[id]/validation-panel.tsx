'use client'

// V5.1 doctrine simplifiée : pas de validation superviseur séparée. La clôture
// par le chef d'équipe via "Terminer l'intervention" suffit. Ce panel n'est
// plus qu'un AFFICHEUR pour les interventions historiques en status 'validated'
// (legacy) — pas d'action.
//
// La réouverture est gérée directement dans ExecutionPanel (bouton dans le
// bandeau "Intervention terminée").

import { Stamp } from 'lucide-react'
import type { DbInterventionValidation } from '@/types/db'

interface Props {
  interventionId: string
  status: 'planned' | 'in_progress' | 'completed' | 'validated' | 'skipped'
  existingValidation: DbInterventionValidation | null
}

export function ValidationPanel({ status, existingValidation }: Props) {
  // Seul cas restant : affichage d'une intervention historique déjà validée.
  if (status !== 'validated' || !existingValidation) return null

  return (
    <section className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
      <div className="flex items-start gap-2">
        <Stamp className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-emerald-800">Intervention validée</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {new Date(existingValidation.validated_at).toLocaleString('fr-FR')}
          </div>
          {existingValidation.comment && (
            <p className="text-xs text-emerald-900 mt-1.5 italic">« {existingValidation.comment} »</p>
          )}
        </div>
      </div>
    </section>
  )
}
