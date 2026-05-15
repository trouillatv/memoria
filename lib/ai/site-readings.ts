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
  for (const row of (rows ?? []) as Array<{ mission_id: string; executed_at: string }>) {
    if (!lastByMission.has(row.mission_id)) lastByMission.set(row.mission_id, row.executed_at)
  }

  const nowMs = Date.now()
  const absences: MissionAbsence[] = []

  for (const m of missions as Array<{ id: string; name: string }>) {
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

function absenceFragment({ missionName, weeksSince }: MissionAbsence): string {
  if (weeksSince >= 16) {
    const months = Math.round(weeksSince / 4.3)
    return `${missionName} — absent depuis ${months} mois`
  }
  return `${missionName} — absent depuis ${weeksSince} semaines`
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
