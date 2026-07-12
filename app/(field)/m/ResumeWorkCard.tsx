import { ActiveVisitsCard, type ActiveVisitCardItem } from './ActiveVisitsCard'
import { PendingTriageRow } from './PendingTriageRow'
import type { PendingTriageItem } from '@/lib/db/visits'

/**
 * « Reprendre mon travail » — LA carte du quotidien, tout en haut de l'accueil.
 * Le conducteur ne démarre pas 15 visites par jour ; il REPREND ce qui n'est pas
 * fini : une visite en cours, un tri à terminer, un CR à compléter. C'est une pile
 * de travail. Vide → la carte N'EXISTE PAS (audit 2026-07-12 : « Tout est
 * terminé » juste au-dessus d'un « Tu dois faire » rouge se lisait comme une
 * contradiction — ce qui a servi disparaît, le silence est la récompense).
 */
export function ResumeWorkCard({
  activeVisits,
  pendingTriage,
}: {
  activeVisits: ActiveVisitCardItem[]
  pendingTriage: PendingTriageItem[]
}) {
  if (activeVisits.length === 0 && pendingTriage.length === 0) return null

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold tracking-tight">Reprendre mon travail</h2>

      {/* Visites EN COURS — riche (composition, où je me suis arrêté, envoi). */}
      <ActiveVisitsCard visits={activeVisits} />

      {/* TRI RESTANT — une visite finie mais pas encore triée. */}
      {pendingTriage.map((t) => (
        <PendingTriageRow key={t.reportId} item={t} />
      ))}
    </section>
  )
}
