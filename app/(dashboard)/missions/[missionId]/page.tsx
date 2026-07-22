// LA FICHE MISSION — l'objet métier, enfin ouvrable.
//
// Avant : une mission ne s'ouvrait QUE par le détour d'un contrat
// (`/contracts/[id]/missions/[missionId]/edit`), et le seul lien qui y menait
// partait de la liste des missions D'UN CONTRAT. Une mission sans contrat
// n'avait donc AUCUN accès à ses rythmes — le schéma ne l'exigeait pas,
// l'interface, si. C'était un prérequis caché, et un cul-de-sac.
//
// Ici, la mission se suffit à elle-même. Elle dit :
//   • où elle a lieu (le chantier) ;
//   • QUI y va (l'équipe — la colonne existait, aucun écran ne l'écrivait) ;
//   • quand elle revient, et JUSQU'À QUAND (`ends_on`, jamais saisissable avant).
//
// Doctrine : on construit des objets métier que les écrans projettent.

import { userCanAccessOrgRow } from '@/lib/auth/site-access'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, MapPin, Repeat } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getMission } from '@/lib/db/missions'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { listTeams } from '@/lib/db/teams'
import {
  getTemplateStatsBatch,
  listTemplatesForMission,
} from '@/lib/db/intervention-templates'
import { describeTemplate, formatDateFr } from '@/lib/recurrence/describe'
import { siteLabel } from '@/lib/labels/site-label'
import { RecurrenceSection } from '@/app/(dashboard)/contracts/[id]/missions/[missionId]/edit/RecurrenceSection'
import { RecurrenceRowActions } from '@/app/(dashboard)/contracts/[id]/missions/[missionId]/edit/RecurrenceRowActions'
import { MissionTeamPicker } from './MissionTeamPicker'

export const dynamic = 'force-dynamic'

export default async function MissionPage({
  params,
}: {
  params: Promise<{ missionId: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/planning')

  const { missionId } = await params
  // P0.5 : `getMission` charge par ID sans scope org, et la page rend la
  // mission même quand `getSiteIdentity` du chantier lié échoue. Garde directe.
  if (!(await userCanAccessOrgRow('missions', missionId))) notFound()
  const mission = await getMission(missionId)
  if (!mission) notFound()

  const [identity, allTeams, templates] = await Promise.all([
    getSiteIdentity(mission.site_id).catch(() => null),
    listTeams().catch(() => []),
    listTemplatesForMission(missionId).catch(() => []),
  ])

  const activeTemplates = templates.filter((t) => t.active && !t.deleted_at)
  const stats = await getTemplateStatsBatch(activeTemplates.map((t) => t.id)).catch(
    () => new Map<string, { lastInterventionDate: string | null; nextInterventionDate: string | null }>(),
  )

  const teams = allTeams
    .filter((t) => t.active && !t.deleted_at)
    .map((t) => ({ id: t.id, name: t.name, color: t.color }))

  const assignedTeamId =
    (mission as unknown as { assigned_team_id: string | null }).assigned_team_id ?? null

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <Link
        href="/missions"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Missions
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold leading-tight">{mission.name}</h1>
        {identity && (
          <Link
            href={`/sites/${mission.site_id}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <MapPin className="h-3.5 w-3.5" />
            {siteLabel(identity.name, (identity as unknown as { client_name?: string | null }).client_name)}
          </Link>
        )}
      </header>

      {/* QUI y va — la question à laquelle le planning ne savait pas répondre. */}
      <section className="rounded-2xl border bg-card p-4">
        <MissionTeamPicker missionId={mission.id} teams={teams} currentTeamId={assignedTeamId} />
      </section>

      {/* QUAND elle revient — sans passer par un contrat, et jusqu'à une date. */}
      <section className="space-y-3 rounded-2xl border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold">
              <Repeat className="h-4 w-4" /> Quand elle revient
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Les interventions sont créées au fil de l&apos;eau, confiées à l&apos;équipe ci-dessus.
            </p>
          </div>
          <RecurrenceSection missionId={mission.id} missionName={mission.name} />
        </div>

        {activeTemplates.length === 0 ? (
          <p className="text-xs italic text-muted-foreground">
            Aucun rythme. Cette mission ne revient pas toute seule.
          </p>
        ) : (
          <ul className="space-y-2">
            {activeTemplates.map((t) => {
              const s = stats.get(t.id)
              return (
                <li
                  key={t.id}
                  data-testid={`recurrence-row-${t.id}`}
                  className="rounded-lg border bg-background p-3 text-sm"
                >
                  <div className="flex items-start gap-2">
                    <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="font-medium">{describeTemplate(t)}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.ends_on
                          ? `Jusqu’au ${formatDateFr(t.ends_on)}`
                          : 'Sans date de fin'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {s?.nextInterventionDate
                          ? `Prochaine : ${formatDateFr(s.nextInterventionDate)}`
                          : 'Aucune intervention planifiée'}
                      </p>
                    </div>
                    <RecurrenceRowActions
                      template={t}
                      missionId={mission.id}
                      missionName={mission.name}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
