// Lectures du lieu — couche légère pour surfaces compactes (mobile chef, rapport).
//
// Doctrine : révéler, jamais générer. Pas de label "IA". Fragments ultra-courts.
// Complète getSiteReadings (site-cockpit) qui opère sur les textes.
// Ici on opère sur l'EXÉCUTION réelle des missions (données structurées, plus fiable).

import { createAdminClient } from '@/lib/supabase/admin'
import { getSiteReadings } from '@/lib/db/site-cockpit'

export type ReadingType = 'resonance' | 'absence' | 'persistence'

export interface Reading {
  type: ReadingType
  fragment: string
}

const ABSENCE_WEEKS = 4
const ABSENCE_MIN_EXECUTIONS = 3  // doctrine : évite les faux positifs sur sites récents

// ---------------------------------------------------------------------------
// Absences basées sur l'exécution réelle (complément aux absences textuelles)
// ---------------------------------------------------------------------------

interface MissionAbsence {
  missionName: string
  weeksSince: number
}

export async function findMissionAbsences(siteId: string): Promise<MissionAbsence[]> {
  const supabase = createAdminClient()

  const { data: missions } = await supabase
    .from('missions')
    .select('id, name')
    .eq('site_id', siteId)
    .is('deleted_at', null)
  if (!missions || missions.length === 0) return []

  const missionIds = (missions as Array<{ id: string; name: string }>).map((m) => m.id)

  const { data: rows } = await supabase
    .from('interventions')
    .select('mission_id, executed_at')
    .in('mission_id', missionIds)
    .not('executed_at', 'is', null)
    .order('executed_at', { ascending: false })

  const lastByMission = new Map<string, string>()
  const countByMission = new Map<string, number>()
  for (const row of (rows ?? []) as Array<{ mission_id: string; executed_at: string }>) {
    countByMission.set(row.mission_id, (countByMission.get(row.mission_id) ?? 0) + 1)
    if (!lastByMission.has(row.mission_id)) lastByMission.set(row.mission_id, row.executed_at)
  }

  const nowMs = Date.now()
  const absences: MissionAbsence[] = []

  for (const m of missions as Array<{ id: string; name: string }>) {
    if ((countByMission.get(m.id) ?? 0) < ABSENCE_MIN_EXECUTIONS) continue
    const lastAt = lastByMission.get(m.id)
    const ageMs = lastAt ? nowMs - new Date(lastAt).getTime() : nowMs
    const weeksSince = Math.floor(ageMs / (7 * 86_400_000))
    if (weeksSince >= ABSENCE_WEEKS) {
      absences.push({ missionName: m.name, weeksSince })
    }
  }

  absences.sort((a, b) => b.weeksSince - a.weeksSince)
  return absences
}

export function absenceFragment({ missionName, weeksSince }: MissionAbsence): string {
  if (weeksSince >= 16) {
    const months = Math.round(weeksSince / 4.3)
    return `${missionName} — absent depuis ${months} mois`
  }
  return `${missionName} — absent depuis ${weeksSince} semaines`
}

// Wording externe (client public) : "non documentée" plutôt que "absent"
// pour éviter toute connotation juridique défavorable.
function absenceFragmentExternal({ missionName, weeksSince }: MissionAbsence): string {
  if (weeksSince >= 16) {
    const months = Math.round(weeksSince / 4.3)
    return `${missionName} — non documentée depuis ${months} mois`
  }
  return `${missionName} — non documentée depuis ${weeksSince} semaines`
}

/**
 * Retourne au plus 1 lecture d'absence pour la page client publique.
 * Exclut la mission courante (déjà documentée dans le dossier affiché).
 * Wording externe : "non documentée depuis" (pas "absent depuis").
 */
export async function getProofPageReading(
  siteId: string,
  excludeMissionName?: string,
): Promise<string | null> {
  const absences = await findMissionAbsences(siteId)
  const filtered = excludeMissionName
    ? absences.filter((a) => a.missionName !== excludeMissionName)
    : absences
  const top = filtered[0]
  if (!top) return null
  return absenceFragmentExternal(top)
}

// ---------------------------------------------------------------------------
// getTenantDayReading — 1 signal global pour les pages journée (aujourd'hui,
// briefing). Prend les site_ids du jour, retourne la première absence
// significative toutes surfaces confondues (signal déterministe, rapide).
// ---------------------------------------------------------------------------

interface SiteContext {
  siteId: string
  plannedMissions?: string[]   // noms des missions au planning ce jour/demain
}

export interface DayReadingResult {
  fragment: string
  context?: string  // pertinence contextuelle — jamais une gravité, jamais un score
}

// getTenantDayReading — 1 signal pour les surfaces opérationnelles (briefing,
// aujourd'hui). Retourne fragment + contexte séparés.
//
// Doctrine : le fragment observe (passé), le contexte situe (présent).
// L'humain décide. L'IA ne juge pas. Jamais "critique", "urgent", "important".
export async function getTenantDayReading(
  sites: SiteContext[],
  when: "aujourd'hui" | 'demain' = "aujourd'hui",
): Promise<DayReadingResult | null> {
  if (sites.length === 0) return null
  const capped = sites.slice(0, 6)
  const results = await Promise.all(capped.map((s) => findMissionAbsences(s.siteId)))

  const enriched = results.flatMap((absences, i) => {
    const planned = new Set(capped[i]?.plannedMissions ?? [])
    return absences.map((abs) => ({ ...abs, isPlanned: planned.has(abs.missionName) }))
  })

  // Absences concernant une mission au planning en tête, puis par ancienneté
  enriched.sort((a, b) => {
    if (a.isPlanned !== b.isPlanned) return a.isPlanned ? -1 : 1
    return b.weeksSince - a.weeksSince
  })

  const top = enriched[0]
  if (!top) return null

  return {
    fragment: absenceFragment(top),
    context: top.isPlanned ? `au planning ${when}` : undefined,
  }
}

// ---------------------------------------------------------------------------
// generateSiteReadings — surface compacte (mobile, rapport)
// Retourne max 2 fragments : priorise les absences d'exécution, puis les
// lectures textuelles de getSiteReadings.
// ---------------------------------------------------------------------------

export async function generateSiteReadings(siteId: string): Promise<Reading[]> {
  const [missionAbsences, { readings: cockpitReadings }] = await Promise.all([
    findMissionAbsences(siteId),
    getSiteReadings(siteId),
  ])

  const result: Reading[] = []

  // 1. Absences d'exécution (signal fiable, structuré)
  for (const abs of missionAbsences.slice(0, 1)) {
    result.push({ type: 'absence', fragment: absenceFragment(abs) })
  }

  // 2. Première lecture textuelle (resonance ou persistence)
  for (const r of cockpitReadings) {
    if (result.length >= 2) break
    const type: ReadingType =
      r.axis === 'resonance' ? 'resonance'
      : r.axis === 'persistence' ? 'persistence'
      : 'absence'
    result.push({ type, fragment: r.text })
  }

  return result.slice(0, 2)
}
