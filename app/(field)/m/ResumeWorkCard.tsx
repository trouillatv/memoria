import { CheckCircle2 } from 'lucide-react'
import { ActiveVisitsCard, type ActiveVisitCardItem } from './ActiveVisitsCard'
import { PendingTriageRow } from './PendingTriageRow'
import type { PendingTriageItem } from '@/lib/db/visits'

/**
 * « Reprendre mon travail » — LA carte du quotidien, tout en haut de l'accueil.
 * Le conducteur ne démarre pas 15 visites par jour ; il REPREND ce qui n'est pas
 * fini : une visite en cours, un tri à terminer, un CR à compléter. C'est une pile
 * de travail. Vide → « ✓ Tout est terminé ». Cf. refonte navigation (Guillaume).
 */
export function ResumeWorkCard({
  activeVisits,
  pendingTriage,
}: {
  activeVisits: ActiveVisitCardItem[]
  pendingTriage: PendingTriageItem[]
}) {
  const empty = activeVisits.length === 0 && pendingTriage.length === 0

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold tracking-tight">Reprendre mon travail</h2>

      {empty ? (
        <div className="inline-flex w-full items-center gap-2 rounded-xl border bg-muted/30 px-4 py-3.5 text-sm text-muted-foreground">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Tout est terminé.
        </div>
      ) : (
        <>
          {/* Visites EN COURS — riche (composition, où je me suis arrêté, envoi). */}
          <ActiveVisitsCard visits={activeVisits} />

          {/* TRI RESTANT — une visite finie mais pas encore triée. */}
          {pendingTriage.map((t) => (
            <PendingTriageRow key={t.reportId} item={t} />
          ))}
        </>
      )}
    </section>
  )
}
