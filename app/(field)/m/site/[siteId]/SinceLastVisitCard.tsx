import Link from 'next/link'
import { Users, ClipboardList, CheckCircle2, Camera, ChevronRight } from 'lucide-react'
import type { SinceLastVisitSummary } from '@/lib/db/visits'

/**
 * « Depuis votre dernière visite » — ce qui a bougé depuis la dernière visite
 * terminée, en une bande de statistiques (icône + chiffre + libellé). Déterministe,
 * zéro IA. Seuls les compteurs non nuls s'affichent ; la carte entière n'apparaît
 * que s'il y a du changement (silence positif). Ouvre la frise du chantier.
 */
export function SinceLastVisitCard({ summary, siteId }: { summary: SinceLastVisitSummary; siteId: string }) {
  const cells: { key: string; Icon: typeof Users; cls: string; n: number; label: string }[] = [
    { key: 'm', Icon: Users, cls: 'text-sky-600', n: summary.meetings, label: summary.meetings > 1 ? 'réunions' : 'réunion' },
    { key: 'p', Icon: Camera, cls: 'text-violet-600', n: summary.newPhotos, label: summary.newPhotos > 1 ? 'photos ajoutées' : 'photo ajoutée' },
    { key: 'r', Icon: ClipboardList, cls: 'text-rose-600', n: summary.newReserves, label: summary.newReserves > 1 ? 'nouvelles réserves' : 'nouvelle réserve' },
    { key: 'a', Icon: CheckCircle2, cls: 'text-emerald-600', n: summary.actionsDone, label: summary.actionsDone > 1 ? 'actions terminées' : 'action terminée' },
  ].filter((c) => c.n > 0)

  if (cells.length === 0) return null

  return (
    <section className="rounded-2xl border bg-card p-4">
      <Link href={`/m/site/${siteId}/frise`} className="flex items-center justify-between gap-2 active:opacity-70">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Depuis votre dernière visite
          <span className="font-normal normal-case"> · {summary.dateLabel}</span>
        </h2>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Link>
      <ul className="mt-3 space-y-2">
        {cells.map(({ key, Icon, cls, n, label }) => (
          <li key={key} className="flex items-center gap-2.5 text-sm">
            <Icon className={`h-[18px] w-[18px] shrink-0 ${cls}`} />
            <span className="font-semibold tabular-nums">{n}</span>
            <span className="text-muted-foreground">{label}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
