import Link from 'next/link'
import { Users, ClipboardList, CheckCircle2, Camera, ChevronRight, CircleCheckBig, Eye } from 'lucide-react'
import type { SinceLastVisitSummary } from '@/lib/db/visits'

/**
 * « Depuis votre dernier passage » — le NARRATEUR du retour sur chantier.
 * Personnel (depuis VOTRE dernière visite, pas celle du chantier), déterministe,
 * zéro IA. Raconte ce qui a bougé (réserves levées d'abord — la bonne nouvelle),
 * puis LE DOUTE d'alors s'il existe toujours. Silence positif sinon.
 * La phrase visée : « je savais immédiatement où reprendre. »
 */
export function SinceLastVisitCard({ summary, siteId }: { summary: SinceLastVisitSummary; siteId: string }) {
  const cells: { key: string; Icon: typeof Users; cls: string; n: number; label: string }[] = [
    { key: 'l', Icon: CircleCheckBig, cls: 'text-emerald-600', n: summary.liftedReserves, label: summary.liftedReserves > 1 ? 'réserves levées' : 'réserve levée' },
    { key: 'r', Icon: ClipboardList, cls: 'text-rose-600', n: summary.newReserves, label: summary.newReserves > 1 ? 'nouvelles réserves' : 'nouvelle réserve' },
    { key: 'a', Icon: CheckCircle2, cls: 'text-emerald-600', n: summary.actionsDone, label: summary.actionsDone > 1 ? 'actions terminées' : 'action terminée' },
    { key: 'm', Icon: Users, cls: 'text-sky-600', n: summary.meetings, label: summary.meetings > 1 ? 'réunions' : 'réunion' },
    { key: 'p', Icon: Camera, cls: 'text-violet-600', n: summary.newPhotos, label: summary.newPhotos > 1 ? 'photos ajoutées' : 'photo ajoutée' },
  ].filter((c) => c.n > 0)

  if (cells.length === 0 && summary.doubts.length === 0) return null

  return (
    <section className="rounded-2xl border bg-card p-4" data-testid="since-last-visit">
      <Link href={`/m/site/${siteId}/frise`} className="flex items-center justify-between gap-2 active:opacity-70">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {summary.personal ? 'Depuis votre dernier passage' : 'Depuis la dernière visite'}
          <span className="font-normal normal-case">
            {' '}· {summary.daysAgo === 0 ? "aujourd'hui" : `il y a ${summary.daysAgo} j`}
          </span>
        </h2>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Link>
      {cells.length > 0 && (
        <ul className="mt-3 space-y-2">
          {cells.map(({ key, Icon, cls, n, label }) => (
            <li key={key} className="flex items-center gap-2.5 text-sm">
              <Icon className={`h-[18px] w-[18px] shrink-0 ${cls}`} />
              <span className="font-semibold tabular-nums">{n}</span>
              <span className="text-muted-foreground">{label}</span>
            </li>
          ))}
        </ul>
      )}
      {/* Le doute d'alors — la mémoire qui vous connaît. Jamais culpabilisant :
          un rappel, pas un reproche. */}
      {summary.doubts.length > 0 && (
        <div className="mt-3 space-y-1 rounded-lg bg-amber-50/70 px-3 py-2.5 dark:bg-amber-950/20">
          <p className="text-[12px] font-medium text-amber-900 dark:text-amber-200">
            {summary.personal ? 'Vous étiez reparti avec un doute' : 'Un doute était resté ouvert'}
          </p>
          {summary.doubts.map((d, i) => (
            <p key={i} className="flex items-start gap-1.5 text-[13px] leading-snug text-amber-900/90 dark:text-amber-200/90">
              <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>« {d} » — il existe toujours.</span>
            </p>
          ))}
        </div>
      )}
    </section>
  )
}
