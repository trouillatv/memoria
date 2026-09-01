import Link from 'next/link'
import { Users, ClipboardList, CheckCircle2, ChevronRight, CircleCheckBig, Compass, CheckSquare } from 'lucide-react'
import type { SinceLastVisitDelta, DeltaItemKind } from '@/lib/db/visits'

const KIND_META: Record<DeltaItemKind, { Icon: typeof Users; cls: string; prefix: string }> = {
  reserve_lifted: { Icon: CircleCheckBig, cls: 'text-emerald-600', prefix: 'Réserve levée' },
  reserve_new:    { Icon: ClipboardList,  cls: 'text-rose-600',    prefix: 'Nouvelle réserve' },
  decision_new:   { Icon: Compass,        cls: 'text-violet-600',  prefix: 'Décision' },
  action_done:    { Icon: CheckSquare,    cls: 'text-emerald-600', prefix: 'Action terminée' },
  meeting:        { Icon: Users,          cls: 'text-sky-600',     prefix: 'Réunion' },
}

/**
 * « Depuis votre dernier passage » — ce qui a changé sur le chantier,
 * item par item. Déterministe, zéro IA.
 * État vide explicite (items=[]) : « Rien de nouveau depuis votre passage du X. »
 */
export function SinceLastVisitCard({ delta, siteId }: { delta: SinceLastVisitDelta; siteId: string }) {
  const heading = delta.personal ? 'Depuis votre dernier passage' : 'Depuis la dernière visite'
  const when = delta.daysAgo === 0 ? "aujourd'hui" : `il y a ${delta.daysAgo} j`

  return (
    <section className="rounded-2xl border bg-card p-4" data-testid="since-last-visit">
      <Link href={`/m/site/${siteId}/frise`} className="flex items-center justify-between gap-2 active:opacity-70">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {heading}
          <span className="font-normal normal-case"> · {when}</span>
        </h2>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Link>

      {delta.items.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted-foreground">
          {/* Le possessif « votre » n'apparaît QUE si la visite de référence est bien
              la vôtre (personal=true). Sinon (repli sur la dernière visite du chantier,
              faite par un autre), formulation neutre — jamais une venue fabriquée (9+10A). */}
          Rien de nouveau depuis {delta.personal ? 'votre passage' : 'la dernière visite'} du {delta.visitDateLabel}.
        </p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {delta.items.map((item, i) => {
            const { Icon, cls, prefix } = KIND_META[item.kind]
            return (
              <li key={i} className="flex items-start gap-2.5">
                <Icon className={`mt-0.5 h-[18px] w-[18px] shrink-0 ${cls}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">{prefix}</span>
                  <span className="block truncate text-[13px] font-medium leading-snug">{item.label}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {delta.overflow > 0 && (
        <p className="mt-3 text-[12px] text-muted-foreground">
          +{delta.overflow} autre{delta.overflow > 1 ? 's' : ''} changement{delta.overflow > 1 ? 's' : ''} · Voir la frise
        </p>
      )}
    </section>
  )
}
