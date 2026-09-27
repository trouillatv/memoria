import Link from 'next/link'
import { ClipboardList, Plus } from 'lucide-react'
import type { DbMission } from '@/types/db'
import type { DbTeam } from '@/types/db'
import { SectionTitle, Empty } from './PlanningUI'

// UX-CONTINUITY-1 (constat recette E2E Vincent 2026-09-28) — les Missions d'un
// chantier n'étaient visibles que depuis le menu global « Missions » (portefeuille
// manager, tous chantiers). Ce sous-onglet est un accès de proximité, pas un
// doublon : il liste les Missions DE ce chantier et renvoie vers leur fiche pour
// le détail (rythme, roulement, historique) — la vue globale reste la référence
// pour le pilotage transverse (filtres équipe, « sans prochaine », « sans équipe »).

const CADENCE_FR: Record<string, string> = {
  daily: 'Quotidienne',
  weekly: 'Hebdomadaire',
  biweekly: 'Bihebdomadaire',
  monthly: 'Mensuelle',
  on_demand: 'À la demande',
}

interface MissionsSubViewProps {
  missions: DbMission[]
  teams: DbTeam[]
}

export function MissionsSubView({ missions, teams }: MissionsSubViewProps) {
  const teamById = new Map(teams.map((t) => [t.id, t]))
  const active = missions.filter((m) => m.active)
  const inactive = missions.filter((m) => !m.active)

  return (
    <main className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <SectionTitle
          icon={ClipboardList}
          title="Missions du chantier"
          detail="Ce que le chantier doit faire, en continu — le détail (rythme, roulement) est sur la fiche."
        />
        <Link
          href="/missions"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted"
        >
          <Plus className="h-3.5 w-3.5" /> Nouvelle mission
        </Link>
      </div>

      {missions.length === 0 ? (
        <Empty>Aucune mission créée pour ce chantier.</Empty>
      ) : (
        <ul className="space-y-2">
          {active.map((m) => (
            <MissionRow key={m.id} mission={m} teamName={m.assigned_team_id ? teamById.get(m.assigned_team_id)?.name ?? null : null} />
          ))}
          {inactive.length > 0 && (
            <>
              <p className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Inactives</p>
              {inactive.map((m) => (
                <MissionRow key={m.id} mission={m} teamName={m.assigned_team_id ? teamById.get(m.assigned_team_id)?.name ?? null : null} />
              ))}
            </>
          )}
        </ul>
      )}
    </main>
  )
}

function MissionRow({ mission, teamName }: { mission: DbMission; teamName: string | null }) {
  return (
    <li className="rounded-2xl border bg-card p-4">
      <Link
        href={`/missions/${mission.id}`}
        className={`font-medium hover:underline ${mission.active ? 'text-foreground' : 'text-muted-foreground'}`}
      >
        {mission.name}
      </Link>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {CADENCE_FR[mission.cadence] ?? mission.cadence}
        {teamName ? ` · ${teamName}` : ' · Sans équipe'}
        {!mission.active ? ' · Inactive' : ''}
      </p>
    </li>
  )
}
