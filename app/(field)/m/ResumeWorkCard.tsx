import Link from 'next/link'
import { ListChecks, ArrowRight, CheckCircle2 } from 'lucide-react'
import { ActiveVisitsCard, type ActiveVisitCardItem } from './ActiveVisitsCard'
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
            <Link
              key={t.reportId}
              href={`/m/visite/${t.reportId}`}
              className="flex items-center gap-3 rounded-2xl border border-amber-300/50 bg-amber-50/50 px-4 py-3.5 active:scale-[0.99] transition-transform dark:border-amber-900/40 dark:bg-amber-950/20"
            >
              <ListChecks className="h-5 w-5 shrink-0 text-amber-600" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{t.siteName}</p>
                <p className="text-[13px] text-muted-foreground">
                  Tri restant : {t.remaining} capture{t.remaining > 1 ? 's' : ''}
                </p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-amber-700 dark:text-amber-300">
                Terminer <ArrowRight className="h-4 w-4" />
              </span>
            </Link>
          ))}
        </>
      )}
    </section>
  )
}
