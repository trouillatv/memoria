// PRÉVISIONS du CR (volet interventions) — 100% DÉTERMINISTE.
//
// Le CR est un document OFFICIEL (face MOA/client) : précision > rappel, rien qui
// ne soit actionnable / compréhensible / assumable. Sources retenues (Vincent
// 2026-06-20) :
//   - anomalies NON RÉSOLUES du site (intervention_anomalies.resolved_at = null)
//   - interventions PLANIFIÉES À VENIR (status='planned', date ≥ aujourd'hui)
// PAS les récurrentes sautées (skipped) : elles polluent le PV → elles restent
// côté cockpit interne / bloc « à reprogrammer », jamais auto-injectées sans
// validation. Chemin site → interventions : missions.site_id → interventions.mission_id.

import { createAdminClient } from '@/lib/supabase/admin'

export interface PrevisionItem {
  kind: 'anomalie' | 'intervention'
  texte: string
  confiance: 'sûr' | 'à confirmer'
  source: string // id (traçabilité / validation humaine)
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}
function ddmmyyyy(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso); if (isNaN(d.getTime())) return null
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
}
// Garantit exactement un point final (évite « …coffrage.. » quand la note en a déjà un).
const oneDot = (s: string): string => s.replace(/[.\s]+$/, '') + '.'

/** Volet « interventions » des Prévisions (anomalies non résolues + interventions à venir). */
export async function buildPrevisionsFromInterventions(siteId: string): Promise<PrevisionItem[]> {
  const sb = createAdminClient()
  const today = todayIso()

  const { data: missions } = await sb.from('missions').select('id').eq('site_id', siteId).is('deleted_at', null)
  const missionIds = (missions ?? []).map((m) => m.id as string)
  if (missionIds.length === 0) return []

  const { data: interventions } = await sb
    .from('interventions')
    .select('id, scheduled_for, scheduled_at, status, notes')
    .in('mission_id', missionIds)
  const intv = interventions ?? []
  const intvIds = intv.map((i) => i.id as string)

  const anomalies: PrevisionItem[] = []
  if (intvIds.length > 0) {
    const { data } = await sb
      .from('intervention_anomalies')
      .select('id, description, category_other, resolved_at, created_at')
      .in('intervention_id', intvIds)
      .is('resolved_at', null)
      .order('created_at', { ascending: false })
    for (const a of data ?? []) {
      const desc = ((a.description as string | null) ?? (a.category_other as string | null) ?? '').trim()
      if (!desc) continue
      // Côté Prévisions = l'ACTION (traitement/contrôle à prévoir), wording DISTINCT
      // du constat « Anomalie signalée : … » côté Points examinés. Ne pas réaligner.
      anomalies.push({ kind: 'anomalie', texte: oneDot(`Traitement / contrôle à prévoir : ${desc}`), confiance: 'sûr', source: a.id as string })
    }
  }

  const planned: PrevisionItem[] = []
  for (const i of intv) {
    if (i.status !== 'planned') continue
    const date = (i.scheduled_for as string | null) ?? (i.scheduled_at ? (i.scheduled_at as string).slice(0, 10) : null)
    if (!date || date < today) continue
    // Reformulation langage CR (pas « base de données ») : les notes ont la forme
    // « Description. Planifié le AAAA-MM-JJ : description » → on coupe au marqueur
    // technique et on garde la description humaine (avant, ou à défaut après le « : »).
    const rawNote = ((i.notes as string | null) ?? '').trim()
    const parts = rawNote.split(/\s*\.?\s*Planifié le \d{4}-\d{2}-\d{2}\s*:?\s*/i)
    const note = (parts[0] || parts[1] || '').replace(/[.\s]+$/, '').trim()
    const cap = note ? note.charAt(0).toUpperCase() + note.slice(1) : ''
    const d = ddmmyyyy(date)
    planned.push({
      kind: 'intervention',
      texte: oneDot(cap ? `${cap}, prévu le ${d}` : `Intervention prévue le ${d}`),
      confiance: 'sûr',
      source: i.id as string,
    })
  }

  return [...anomalies, ...planned]
}
