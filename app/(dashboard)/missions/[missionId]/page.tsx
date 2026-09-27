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

import { requireMissionAccess } from '@/lib/auth/resource-access'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, CalendarDays, MapPin, Repeat } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getMission } from '@/lib/db/missions'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { listTeamsForSite } from '@/lib/db/teams'
import {
  getTemplateStatsBatch,
  listTemplatesForMission,
} from '@/lib/db/intervention-templates'
import { listCyclesBySite } from '@/lib/db/planning-cycles'
import { todayLocalIso } from '@/lib/time/local-date'
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
  await requireMissionAccess(missionId)
  const mission = await getMission(missionId)
  if (!mission) notFound()

  const [identity, allTeams, templates, cycles] = await Promise.all([
    getSiteIdentity(mission.site_id).catch(() => null),
    listTeamsForSite(mission.site_id).catch(() => []),
    listTemplatesForMission(missionId).catch(() => []),
    listCyclesBySite(mission.site_id).catch(() => []),
  ])

  // PLAN-UX-1A+B (mandat Vincent 2026-09-27) — simple et roulement PUBLIÉ ne
  // coexistent JAMAIS pour une même Mission active (invariant PLAN-INTEG-1).
  // cycle_id non-null = rythme technique PROJETÉ depuis un roulement, jamais
  // un rythme simple éditable : il ne doit pas apparaître dans cette liste.
  // Un roulement DRAFT, lui, est explicitement autorisé à coexister avec un
  // rythme actif (simple ou cycle publié) — révision Vincent 2026-09-28,
  // point 2 : ne jamais le masquer derrière un état exclusif.
  // ends_on dans le passé = rythme terminé, jamais "actif" (révision Vincent
  // 2026-09-28, point 1 — même vigilance que getMissionsForEngagements).
  const today = todayLocalIso()
  const activeTemplates = templates.filter((t) => t.active && !t.deleted_at)
  const simpleTemplates = activeTemplates.filter(
    (t) => !t.cycle_id && (!t.ends_on || t.ends_on >= today),
  )
  const missionCycles = cycles.filter((c) => c.missionId === mission.id)
  const publishedCycle =
    missionCycles.find((c) => c.status === 'published' && (!c.endsOn || c.endsOn >= today)) ?? null
  const draftCycle = missionCycles.find((c) => c.status === 'draft') ?? null
  const rhythmCase: 'simple' | 'cycle' | 'none' =
    simpleTemplates.length > 0 ? 'simple' : publishedCycle ? 'cycle' : 'none'

  const stats = await getTemplateStatsBatch(simpleTemplates.map((t) => t.id)).catch(
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

      {/* QUAND elle revient — sans passer par un contrat, et jusqu'à une date.
          PLAN-UX-1A+B : rythme actif = simple OU cycle publié OU aucun ;
          un roulement en préparation (draft) s'affiche en parallèle, jamais
          masqué par un rythme actif (révision Vincent 2026-09-28, point 2).
          mission.tsx#rythme = cible de « Définir le rythme » depuis la carte
          Engagement. */}
      <section id="rythme" className="space-y-3 rounded-2xl border bg-card p-4">
        <div>
          <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold">
            <Repeat className="h-4 w-4" /> Quand elle revient
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Les interventions sont créées au fil de l&apos;eau, confiées à l&apos;équipe ci-dessus.
          </p>
        </div>

        {rhythmCase === 'none' && (
          <div className="space-y-2">
            <p className="text-xs italic text-muted-foreground">
              Aucun rythme. Cette mission ne revient pas toute seule.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <RecurrenceSection missionId={mission.id} missionName={mission.name} />
              <Link
                href={`/sites/${mission.site_id}/roulements/nouveau?mission=${mission.id}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border bg-card hover:bg-muted/50 text-sm"
              >
                <CalendarDays className="h-3.5 w-3.5" /> Créer un roulement avancé
              </Link>
            </div>
          </div>
        )}

        {rhythmCase === 'simple' && (
          <div className="space-y-2">
            <ul className="space-y-2">
              {simpleTemplates.map((t) => {
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
                            : 'Aucune intervention matérialisée'}
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
            <div className="flex flex-wrap items-center gap-2">
              <RecurrenceSection missionId={mission.id} missionName={mission.name} />
              <Link
                href={`/sites/${mission.site_id}/roulements/nouveau?mission=${mission.id}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border bg-card hover:bg-muted/50 text-sm"
              >
                <CalendarDays className="h-3.5 w-3.5" /> Préparer un roulement avancé
              </Link>
              <Link
                href={`/mois?site=${mission.site_id}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border bg-card hover:bg-muted/50 text-sm"
              >
                <CalendarDays className="h-3.5 w-3.5" /> Voir le planning
              </Link>
            </div>
          </div>
        )}

        {rhythmCase === 'cycle' && publishedCycle && (
          <div className="space-y-2">
            <div className="rounded-lg border bg-background p-3 text-sm">
              <p className="font-medium">{publishedCycle.name || 'Roulement'}</p>
              <p className="text-xs text-muted-foreground">
                Sur {publishedCycle.cycleLengthWeeks} semaine{publishedCycle.cycleLengthWeeks > 1 ? 's' : ''} · depuis {formatDateFr(publishedCycle.startsOn)}
                {publishedCycle.endsOn ? ` · jusqu’au ${formatDateFr(publishedCycle.endsOn)}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/sites/${mission.site_id}/roulements/${publishedCycle.id}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border bg-card hover:bg-muted/50 text-sm"
              >
                Voir le roulement
              </Link>
              <Link
                href={`/mois?site=${mission.site_id}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border bg-card hover:bg-muted/50 text-sm"
              >
                <CalendarDays className="h-3.5 w-3.5" /> Voir le planning
              </Link>
            </div>
          </div>
        )}

        {draftCycle && (
          <div className="space-y-2 rounded-lg border border-dashed border-border bg-background/60 p-3">
            <p className="text-xs italic text-muted-foreground">
              Un roulement est en préparation pour cette mission, pas encore publié.
            </p>
            <Link
              href={`/sites/${mission.site_id}/roulements/${draftCycle.id}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border bg-card hover:bg-muted/50 text-sm"
            >
              Continuer la configuration
            </Link>
          </div>
        )}
      </section>
    </div>
  )
}
