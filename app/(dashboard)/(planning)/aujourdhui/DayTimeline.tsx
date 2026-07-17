import Link from 'next/link'
import {
  Footprints, Users, Wrench, CheckSquare, CalendarClock,
  RotateCw, DoorClosed, OctagonAlert, CalendarPlus, ChevronRight,
} from 'lucide-react'
import type { PlanningTimelineEvent, PlanningEventType } from '@/lib/planning/timeline-contract'

// ── LA JOURNÉE DU CHANTIER, PAS SEULEMENT SES INTERVENTIONS ──────────────────
// Le Planning lisait `missions`, `interventions`, `team_members` — et ZÉRO de
// site_reports, site_actions, site_deadlines. Il annonçait « 0 » un jour où une
// visite venait d'avoir lieu : pas un bug d'affichage, une page qui regardait des
// tables où les visites ne sont pas.
//
// `getPlanningTimeline` savait déjà tout lire — visites, réunions, échéances,
// fermetures, blocages, interventions incluses. Elle était écrite, testée, et
// personne ne l'importait. Il n'y avait rien à construire : il fallait brancher.
//
// Le VALIDÉ et le PROPOSÉ ne se mélangent jamais ici non plus. Le jour où une
// date déduite s'avère fausse, c'est tout le planning qu'on cesse de croire.

const META: Record<PlanningEventType, { Icon: typeof Users; cls: string; label: string }> = {
  visite: { Icon: Footprints, cls: 'text-emerald-600', label: 'Visite' },
  reunion: { Icon: Users, cls: 'text-sky-600', label: 'Réunion' },
  reunion_a_organiser: { Icon: CalendarPlus, cls: 'text-sky-500', label: 'Réunion à organiser' },
  intervention: { Icon: Wrench, cls: 'text-amber-600', label: 'Intervention' },
  action: { Icon: CheckSquare, cls: 'text-violet-600', label: 'Action' },
  echeance: { Icon: CalendarClock, cls: 'text-rose-600', label: 'Échéance' },
  roulement: { Icon: RotateCw, cls: 'text-slate-600', label: 'Roulement' },
  fermeture: { Icon: DoorClosed, cls: 'text-slate-500', label: 'Fermeture' },
  blocage: { Icon: OctagonAlert, cls: 'text-red-600', label: 'Blocage' },
}

const STATUT: Record<PlanningTimelineEvent['status'], string> = {
  done: 'Terminé',
  in_progress: 'En cours',
  upcoming: 'À venir',
  overdue: 'En retard',
  cancelled: 'Annulé',
}

/** L'heure du conducteur quand elle est connue. Une date civile (yyyy-mm-dd)
 *  reste une date sans heure : on ne fabrique pas un « 08:00 » pour faire joli. */
function moment(start: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) return null
  const d = new Date(start)
  return Number.isNaN(d.getTime())
    ? null
    : new Intl.DateTimeFormat('fr-FR', { timeZone: 'Pacific/Noumea', hour: '2-digit', minute: '2-digit' }).format(d)
}

export function DayTimeline({ events }: { events: PlanningTimelineEvent[] }) {
  if (events.length === 0) return null

  // Le passé d'abord : la question du conducteur qui ouvre son planning le soir
  // est « qu'est-ce qui s'est passé ? » autant que « qu'est-ce qui arrive ? ».
  const passe = events.filter((e) => e.status === 'done' || e.status === 'in_progress')
  const avenir = events.filter((e) => e.status !== 'done' && e.status !== 'in_progress')

  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        La vie des chantiers
      </h2>
      {passe.length > 0 && <Groupe titre="Ce qui a eu lieu" events={passe} />}
      {avenir.length > 0 && <Groupe titre="Ce qui arrive" events={avenir} />}
    </section>
  )
}

function Groupe({ titre, events }: { titre: string; events: PlanningTimelineEvent[] }) {
  return (
    <div>
      <h3 className="text-[13px] font-medium text-muted-foreground">{titre}</h3>
      <ul className="mt-2 space-y-2">
        {events.map((e) => {
          const m = META[e.type] ?? META.action
          const heure = moment(e.start)
          const corps = (
            <>
              <m.Icon className={`mt-0.5 h-4 w-4 shrink-0 ${m.cls}`} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{m.label}</span>
                  {/* Une date DÉDUITE ne se présente jamais comme un engagement. */}
                  {e.certainty === 'proposed' && (
                    <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                      à confirmer
                    </span>
                  )}
                  {e.status === 'overdue' && (
                    <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                      {STATUT.overdue}
                    </span>
                  )}
                </span>
                <span className="block text-sm font-medium leading-snug">{e.title}</span>
                <span className="block text-[12px] text-muted-foreground">
                  {e.siteName}
                  {heure && ` · ${heure}`}
                  {e.detail && ` · ${e.detail}`}
                </span>
              </span>
              {e.href && <ChevronRight className="h-4 w-4 shrink-0 self-center text-muted-foreground" />}
            </>
          )
          return (
            <li key={e.id}>
              {e.href ? (
                <Link href={e.href} className="flex items-start gap-2.5 rounded-xl border bg-background p-2.5 hover:brightness-95">
                  {corps}
                </Link>
              ) : (
                <div className="flex items-start gap-2.5 rounded-xl border bg-background p-2.5">{corps}</div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
