// Slice B.1 — Liste anonymisée des validations superviseur.
//
// Doctrine : on expose UNIQUEMENT le rôle ("Équipe superviseur"), jamais
// l'identité. Pour l'usage juridique (lever l'anonymat), un mode admin
// arrivera en B.4. Ici on protège l'agent par défaut.

import { CheckCircle2 } from 'lucide-react'
import type { ProofValidation } from '@/lib/db/proofs'

const ROLE_LABELS: Record<string, string> = {
  admin: 'Équipe superviseur',
  manager: 'Équipe superviseur',
  chef_equipe: 'Équipe terrain',
}

export function ProofValidations({
  validations,
}: {
  validations: ProofValidation[]
}) {
  if (validations.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Aucune validation enregistrée pour cette intervention.
      </p>
    )
  }

  return (
    <ul className="space-y-3">
      {validations.map((v) => (
        <li key={v.id} className="flex items-start gap-3">
          <CheckCircle2
            className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">
              {ROLE_LABELS[v.validator_role] ?? 'Équipe superviseur'}
            </div>
            <div className="text-xs text-muted-foreground">
              Validée le {formatDateTime(v.validated_at)}
            </div>
            {v.comment && (
              <p className="mt-1 text-sm italic text-muted-foreground whitespace-pre-wrap">
                &laquo;&nbsp;{v.comment}&nbsp;&raquo;
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
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
