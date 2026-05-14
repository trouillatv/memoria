import { Users } from 'lucide-react'
import type { TeamPresences } from '@/lib/db/site-cockpit'

/**
 * V5.1.4 — Équipes présentes récemment (swap doctrinal Vincent 2026-05-15).
 *
 * "L'équipe = continuité collective, pas surveillance individuelle.
 *  Container logistique, pas personne — pas de reverse-lookup."
 *
 * Ordre alphabétique strict (anti-leaderboard). Aucun chiffre par équipe.
 * Pas de cliquabilité (créerait page fiche équipe = dérive RH possible).
 *
 * PIÈGES À ÉVITER :
 *   ❌ "Équipe Bleue (12 interventions)" → ranking implicite
 *   ❌ tri par activité → leaderboard déguisé
 *   ❌ avatar / pastille colorée équipe → personnification visuelle
 */

export function TeamPresencesList({ presences }: { presences: TeamPresences }) {
  if (presences.teamNames.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Aucune équipe affectée ces {presences.periodDays} derniers jours.
      </p>
    )
  }

  return (
    <ul className="space-y-1.5">
      {presences.teamNames.map((name) => (
        <li key={name} className="flex items-center gap-2.5">
          <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden />
          <span className="text-sm">{name}</span>
        </li>
      ))}
    </ul>
  )
}
