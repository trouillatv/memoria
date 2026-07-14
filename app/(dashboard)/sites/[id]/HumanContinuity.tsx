import { Users } from 'lucide-react'
import type { HumanContinuity } from '@/lib/db/site-cockpit'

/**
 * V5.1.4 — Continuité humaine, pattern shadcn cohérent.
 *
 * VERROU DOCTRINAL V5.1.3 — Vincent 2026-05-14 :
 *   ✅ Les humains peuvent être nommés.
 *   ❌ Ils ne peuvent jamais être qualifiés.
 *
 * Pas d'avatar, pas de cliquabilité (créerait page profil = reverse-lookup
 * interdit). Pas de star, pas de classement, pas de pourcentage.
 *
 * Acceptable :
 *   ✅ "Hervé a tenu ce site 4 ans." (temporel, contextuel)
 *   ✅ "Sosefo a repris en mai." (relais)
 * Interdit :
 *   ❌ "Hervé connaissait parfaitement ce lieu." (qualitatif)
 *   ❌ "Joseph 92% des passages." (mesure individuelle)
 */

function formatMonthYear(iso: string): string {
  const d = new Date(iso)
  const month = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  return month.charAt(0).toUpperCase() + month.slice(1)
}

function spanLabel(months: number): string {
  if (months < 1) return 'moins d’un mois'
  if (months === 1) return '1 mois'
  if (months < 12) return `${months} mois`
  const years = Math.floor(months / 12)
  const remainder = months % 12
  if (remainder === 0) return years === 1 ? '1 an' : `${years} ans`
  return `${years} an${years > 1 ? 's' : ''} ${remainder} mois`
}

export function HumanContinuityList({ continuity }: { continuity: HumanContinuity }) {
  if (continuity.predecessors.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Ce chantier n&apos;a pas encore trouvé son chef d&apos;équipe.
      </p>
    )
  }

  // V5.1.4 — Reformulation en transmission narrative (Vincent 2026-05-15) :
  // "Moana a repris ce lieu en mai 2026. Avant elle : Anaïs."
  // Le current chef en haut comme une phrase, le reste comme prédécesseurs.
  // Sujet principal = le LIEU (qui change de main), pas le ranking d'individus.
  const current = continuity.predecessors.find((p) => p.isCurrent)
  const predecessors = continuity.predecessors.filter((p) => !p.isCurrent)

  return (
    <div className="space-y-3">
      {current ? (
        <div className="flex items-start gap-2.5">
          <Users className="h-3.5 w-3.5 shrink-0 mt-1 text-emerald-600" aria-hidden />
          <p className="text-sm">
            <span className="font-medium">{current.firstName}</span> a repris
            ce chantier en {formatMonthYear(current.firstSeenAt).toLowerCase()}.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          Personne n&apos;assure actuellement la continuité sur ce chantier.
        </p>
      )}

      {predecessors.length > 0 && (
        <div className="pl-6">
          <p className="text-xs text-muted-foreground mb-1">
            Avant {current ? (predecessors.length === 1 ? 'elle/lui' : 'eux') : 'cela'} :
          </p>
          <ol className="space-y-1">
            {predecessors.map((p, idx) => {
              const startLabel = formatMonthYear(p.firstSeenAt)
              const endLabel = formatMonthYear(p.lastSeenAt)
              const span = spanLabel(p.spanMonths)
              return (
                <li key={`${p.firstName}-${idx}`} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{p.firstName}</span>{' '}
                  · {startLabel} — {endLabel}, {span}
                </li>
              )
            })}
          </ol>
        </div>
      )}

      {continuity.teamsSucceeded > 1 && (
        <p className="text-xs text-muted-foreground italic pl-6">
          Ce chantier connaît sa {continuity.teamsSucceeded === 2 ? 'deuxième' : `${continuity.teamsSucceeded}ème`} équipe.
        </p>
      )}
    </div>
  )
}
