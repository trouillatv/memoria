import Link from 'next/link'
import { Building2, CalendarRange, ClipboardList, Send, Users } from 'lucide-react'
import type { DbHandoverBrief, DbMission, DbTeam } from '@/types/db'
import type { PlanningCycle } from '@/lib/db/planning-cycles'
import type { SiteIdentity } from '@/lib/db/site-cockpit'
import { cycleStatusLabel } from '@/lib/chantier/labels'
import type { SiteRelay } from '../memory/MemoryWorkspace'
import { PrepareSitePassationButton } from './PrepareSitePassationButton'

export function OrganisationWorkspace({
  siteId,
  identity,
  missions,
  cycles,
  teams,
  relays,
  passations,
}: {
  siteId: string
  identity: SiteIdentity
  missions: DbMission[]
  cycles: PlanningCycle[]
  teams: DbTeam[]
  relays: SiteRelay[]
  passations: DbHandoverBrief[]
}) {
  const teamNameById = new Map(teams.map((team) => [team.id, team.name]))

  return (
    <main className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Organisation</h1>
        <p className="text-sm text-muted-foreground">
          Ici, je peux comprendre comment ce chantier est structuré — et le transmettre.
        </p>
      </header>

      {/* La passation n'est pas une vue : c'est une action de transmission construite
          à partir du chantier. Elle vit donc ici, pas dans un onglet concurrent.
          Mémoire = ce qui reste utile dans la durée.
          Passation = ce que cette personne doit savoir MAINTENANT pour reprendre. */}
      <section className="rounded-[22px] border border-violet-100 bg-card p-5 shadow-sm dark:border-violet-950/50">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Send className="mt-0.5 h-5 w-5 shrink-0 text-violet-600 dark:text-violet-300" />
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">Transmettre ce chantier</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Tout ce qu&apos;il faut comprendre pour reprendre {identity.name} sans repartir de zéro :
                situation, travail restant, réserves, décisions, prochaines échéances, équipes, documents,
                et ce qu&apos;il faut savoir du lieu.
              </p>
            </div>
          </div>
          <div className="shrink-0">
            <PrepareSitePassationButton siteId={siteId} siteName={identity.name} teams={teams} />
          </div>
        </div>

        {passations.length > 0 && (
          <div className="mt-4 divide-y rounded-2xl border">
            {passations.map((brief) => (
              <Link
                key={brief.id}
                href={`/handovers/${brief.id}`}
                className="flex flex-wrap items-center justify-between gap-2 p-4 hover:bg-muted/40"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{brief.title}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">
                    {passationStatusLabel(brief.status)}
                    {brief.effective_date && ` · à partir du ${formatDate(brief.effective_date)}`}
                  </span>
                </span>
                <span className="text-sm text-muted-foreground">Ouvrir</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-[22px] border bg-card p-5 shadow-sm">
          <SectionTitle icon={Building2} title="Identité" detail="À quoi ce chantier est rattaché." />
          <dl className="mt-4 divide-y rounded-2xl border">
            <IdentityRow label="Client" value={identity.clientName} />
            <IdentityRow label="Contrat" value={identity.contractName} />
            <IdentityRow label="Adresse" value={identity.address} />
            <IdentityRow
              label="Contrat démarré le"
              value={identity.contractStartedAt ? formatDate(identity.contractStartedAt) : null}
            />
          </dl>
        </section>

        <section className="rounded-[22px] border bg-card p-5 shadow-sm">
          <SectionTitle
            icon={Users}
            title={`Qui connaît ce chantier (${relays.length})`}
            detail="Les équipes réellement venues — la passation s'appuie sur elles."
          />
          {relays.length > 0 ? (
            <ul className="mt-4 divide-y rounded-2xl border">
              {relays.map((relay) => (
                <li key={relay.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <span className="font-medium">{relay.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {relay.interventions} passage{relay.interventions > 1 ? 's' : ''}
                    {relay.lastPassage && ` · dernier le ${formatDate(relay.lastPassage)}`}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
              Aucune équipe n&apos;est encore venue sur ce chantier. Une intervention terminée ou validée
              fait apparaître l&apos;équipe ici.
            </p>
          )}
        </section>
      </div>

      <section className="rounded-[22px] border bg-card p-5 shadow-sm">
        <SectionTitle
          icon={ClipboardList}
          title={`Missions (${missions.length})`}
          detail="Le travail prévu sur ce chantier et l'équipe qui en répond."
        />
        {missions.length > 0 ? (
          <ul className="mt-4 divide-y rounded-2xl border">
            {missions.map((mission) => {
              const teamName = mission.assigned_team_id ? teamNameById.get(mission.assigned_team_id) : null
              return (
                <li key={mission.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <Link href={`/missions/${mission.id}`} className="min-w-0 font-medium hover:underline">
                    {mission.name}
                  </Link>
                  {teamName ? (
                    <span className="text-sm text-muted-foreground">{teamName}</span>
                  ) : (
                    <span className="text-sm font-medium text-orange-700 dark:text-orange-300">
                      Équipe non affectée
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="mt-4 rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
            Aucune mission enregistrée sur ce chantier.
          </p>
        )}
      </section>

      <section className="rounded-[22px] border bg-card p-5 shadow-sm">
        <SectionTitle
          icon={CalendarRange}
          title={`Roulements (${cycles.length})`}
          detail="Le rythme dans lequel les équipes reviennent."
        />
        {cycles.length > 0 ? (
          <ul className="mt-4 divide-y rounded-2xl border">
            {cycles.map((cycle) => (
              <li key={cycle.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{cycle.name}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">
                    Cycle de {cycle.cycleLengthWeeks} semaine{cycle.cycleLengthWeeks > 1 ? 's' : ''} · à partir du{' '}
                    {formatDate(cycle.startsOn)}
                  </span>
                </span>
                <span className="text-sm text-muted-foreground">{cycleStatusLabel(cycle.status)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
            Aucun roulement enregistré. Le planning se fait alors intervention par intervention.
          </p>
        )}
      </section>
    </main>
  )
}

function SectionTitle({
  icon: Icon,
  title,
  detail,
}: {
  icon: typeof Users
  title: string
  detail: string
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}

function IdentityRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid gap-1 p-4 md:grid-cols-[180px_1fr] md:items-baseline">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={value ? 'text-sm' : 'text-sm italic text-muted-foreground'}>{value ?? 'Non renseigné'}</dd>
    </div>
  )
}

function passationStatusLabel(status: string): string {
  if (status === 'shared') return 'Partagée'
  if (status === 'acknowledged') return 'Reçue et confirmée'
  if (status === 'archived') return 'Archivée'
  return 'Brouillon — pas encore partagée'
}

function formatDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}
