// Phase 3.3 — Mémoire du lieu : timeline agrégée par site.
//
// Vue projetée à partir des données existantes. Aucune saisie supplémentaire.
// Le site devient un objet temporel : on lit son histoire, on ne configure rien.

import { createAdminClient } from '@/lib/supabase/admin'

export type SiteMemoryEventType =
  | 'intervention'
  | 'photo'
  | 'anomaly'
  | 'note'
  | 'a_savoir'
  | 'access'

export interface SiteMemoryEvent {
  type: SiteMemoryEventType
  id: string
  occurredAt: string
  title: string
  detail: string | null
  status?: string | null
  // Pour navigation cross-objet.
  interventionId?: string | null
  // Métadonnées spécifiques par type
  meta?: Record<string, string | number | boolean | null>
}

// ----------------------------------------------------------------------------
// processAnomaliesForMemory — helper PUR (testable sans Supabase)
// ----------------------------------------------------------------------------
//
// Vincent 2026-05-21 — réduit le bruit dans la Mémoire du lieu :
//
//   A. Dedup intervention.notes ↔ anomaly.description : si une anomaly a la
//      MÊME description (case-insensitive, trim) que la note de SA propre
//      intervention, on masque l'anomaly. La note l'incarne déjà.
//
//   B. Collapse anomalies génériques : N anomalies SANS description libre
//      ni category_other, MÊME jour, MÊME category, MÊME site (implicite)
//      → 1 seule ligne « <catégorie> — N signalements ».
//      Singletons traités normalement.
//
// Aucune mutation DB. Pure transformation de rendu.

export interface AnomalyInputRow {
  id: string
  intervention_id: string
  description: string | null
  category: string
  category_other: string | null
  status: string
  created_at: string
  resolved_at: string | null
}

export function normalizeText(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

/** Date civile yyyy-mm-dd extraite d'un ISO timestamp. */
function dateCivilOf(iso: string): string {
  return iso.slice(0, 10)
}

interface ProcessArgs {
  anomalies: AnomalyInputRow[]
  /** Notes d'intervention normalisées, indexées par intervention_id. */
  interventionNotesById: Map<string, string>
  /** Anomaly ids à exclure (ex. incidents d'accès représentés par la ligne « Accès »). */
  excludeAnomalyIds: Set<string>
}

export function processAnomaliesForMemory(
  args: ProcessArgs,
): SiteMemoryEvent[] {
  const { anomalies, interventionNotesById, excludeAnomalyIds } = args

  // Étape 1 : filtrer exclusions + dedup A (description = note intervention).
  const filtered = anomalies.filter((a) => {
    if (excludeAnomalyIds.has(a.id)) return false
    const desc = normalizeText(a.description)
    if (desc.length > 0) {
      const intvNote = interventionNotesById.get(a.intervention_id)
      if (intvNote && intvNote === desc) return false // doublon A
    }
    return true
  })

  // Étape 2 : séparer celles avec contenu libre (à push individuellement) des
  // celles génériques (candidates au collapse B).
  const richAnomalies: AnomalyInputRow[] = []
  type GroupKey = string // `${date_civile}::${category}`
  const genericGroups = new Map<GroupKey, AnomalyInputRow[]>()

  for (const a of filtered) {
    const hasDesc = normalizeText(a.description).length > 0
    const hasOther = normalizeText(a.category_other).length > 0
    if (hasDesc || hasOther) {
      richAnomalies.push(a)
      continue
    }
    const key = `${dateCivilOf(a.created_at)}::${a.category}`
    const arr = genericGroups.get(key) ?? []
    arr.push(a)
    genericGroups.set(key, arr)
  }

  // Étape 3 : push events.
  const out: SiteMemoryEvent[] = []

  for (const a of richAnomalies) {
    out.push({
      type: 'anomaly',
      id: a.id,
      occurredAt: a.created_at,
      title: a.description ?? a.category_other ?? a.category,
      detail: null,
      status: a.status,
      interventionId: a.intervention_id,
      meta: { category: a.category, resolved_at: a.resolved_at },
    })
  }

  for (const [key, group] of genericGroups) {
    if (group.length === 1) {
      const a = group[0]!
      out.push({
        type: 'anomaly',
        id: a.id,
        occurredAt: a.created_at,
        title: a.category,
        detail: null,
        status: a.status,
        interventionId: a.intervention_id,
        meta: { category: a.category, resolved_at: a.resolved_at },
      })
    } else {
      // Collapse : 1 ligne synthétique. Wording sobre, factuel.
      const latestAt = group.reduce(
        (acc, a) => (a.created_at > acc ? a.created_at : acc),
        group[0]!.created_at,
      )
      const categoryLabel = group[0]!.category.replace(/_/g, ' ')
      // status : si toutes resolved → resolved, sinon open (factuel mixte)
      const allResolved = group.every((a) => a.status === 'resolved')
      out.push({
        type: 'anomaly',
        id: `group::${key}`,
        occurredAt: latestAt,
        title: `${categoryLabel} — ${group.length} signalements`,
        detail: null,
        status: allResolved ? 'resolved' : 'open',
        // Lien vers la première intervention concernée (au moins une porte
        // d'entrée vers le détail, cf. demande Vincent « garder un lien »).
        interventionId: group[0]!.intervention_id,
        meta: {
          category: group[0]!.category,
          grouped: true,
          groupedCount: group.length,
        },
      })
    }
  }

  return out
}

// ----------------------------------------------------------------------------
// getSiteMemoryTimeline — assembleur de timeline
// ----------------------------------------------------------------------------

export async function getSiteMemoryTimeline(
  siteId: string,
  options: { limit?: number; periodDays?: number } = {},
): Promise<SiteMemoryEvent[]> {
  const sb = createAdminClient()
  const limit = options.limit ?? 100
  const since = options.periodDays
    ? new Date(Date.now() - options.periodDays * 86400_000).toISOString()
    : null

  // 1. Missions du site
  const { data: missions } = await sb
    .from('missions')
    .select('id, name')
    .eq('site_id', siteId)
    .is('deleted_at', null)
  const missionIds = (missions ?? []).map((m) => m.id)
  const missionNameById = new Map<string, string>(
    (missions ?? []).map((m) => [m.id, m.name as string]),
  )

  // 2. Interventions (via missions)
  let interventions: Array<{
    id: string
    status: string
    scheduled_at: string
    executed_at: string | null
    notes: string | null
    mission_id: string
  }> = []
  if (missionIds.length) {
    let q = sb
      .from('interventions')
      .select('id, status, scheduled_at, executed_at, notes, mission_id')
      .in('mission_id', missionIds)
    if (since) q = q.gte('scheduled_at', since)
    const { data } = await q
    interventions = (data ?? []) as typeof interventions
  }
  const interventionIds = interventions.map((i) => i.id)

  // 3. Photos / Anomalies (via interventions)
  const [photosRes, anomaliesRes, notesRes, accessRes] = await Promise.all([
    interventionIds.length
      ? sb
          .from('intervention_photos')
          .select('id, intervention_id, caption, kind, taken_at')
          .in('intervention_id', interventionIds)
      : { data: [] as Array<{ id: string; intervention_id: string; caption: string | null; kind: string; taken_at: string }> },
    interventionIds.length
      ? sb
          .from('intervention_anomalies')
          .select('id, intervention_id, description, category, category_other, status, created_at, resolved_at')
          .in('intervention_id', interventionIds)
      : { data: [] as Array<{ id: string; intervention_id: string; description: string | null; category: string; category_other: string | null; status: string; created_at: string; resolved_at: string | null }> },
    sb
      .from('site_notes')
      .select('id, body, kind, active_until, created_at')
      .eq('site_id', siteId)
      .is('deleted_at', null),
    interventionIds.length
      ? sb
          .from('intervention_access_events')
          .select('id, intervention_id, type, occurred_at, anomaly_id')
          .in('intervention_id', interventionIds)
      : { data: [] as Array<{ id: string; intervention_id: string; type: string; occurred_at: string; anomaly_id: string | null }> },
  ])

  // Doctrine : prise/restitution ≠ mémoire (routine), incident = mémoire.
  // On collapse en UNE ligne d'accès par intervention. L'incident est déjà
  // une anomalie (résonances) : on évite le doublon en masquant la ligne
  // anomalie liée, et c'est la ligne d'accès qui la représente avec le bon
  // libellé et le lien vers l'intervention.
  type AccessRow = { id: string; intervention_id: string; type: string; occurred_at: string; anomaly_id: string | null }
  const accessRows = (accessRes.data ?? []) as AccessRow[]
  const accessIncidentAnomalyIds = new Set(
    accessRows.filter((e) => e.type === 'incident' && e.anomaly_id).map((e) => e.anomaly_id as string),
  )

  const events: SiteMemoryEvent[] = []

  // V5.1.3 — Doctrine "les photos before/after/proof/anomaly_evidence ne sont
  // pas des événements autonomes : ce sont des artefacts attachés à
  // l'intervention ou à l'anomalie déjà listée." Seules les photos `passage`
  // (dépôt libre, hors mission planifiée) sont des événements à part entière.
  // On reporte le compte de photos d'intervention sur la ligne intervention
  // pour que le flux reste lisible (pas 6 lignes "Photo after" par intervention).
  const photoCountByIntervention = new Map<string, number>()
  const passagePhotos: typeof photosRes.data = []
  for (const p of (photosRes.data ?? [])) {
    if (p.kind === 'passage') {
      passagePhotos.push(p)
    } else {
      photoCountByIntervention.set(
        p.intervention_id,
        (photoCountByIntervention.get(p.intervention_id) ?? 0) + 1,
      )
    }
  }

  // V5.1.3 — Doctrine Vincent 2026-05-14 :
  // "La routine n'est pas une mémoire." Une intervention récurrente sans
  // voix humaine (sans notes) répète juste le nom de mission ligne après
  // ligne — du bruit qui détruit le substrat. La routine est déjà visible
  // en Section 2 (passages ce mois) et Section 3 (Activité récente).
  //
  // Le TraceStream / Mémoire du lieu ne garde que ce qui CHANGE le lieu :
  // anomalies, notes, voix humaine du chef d'équipe, dépôts photo passage.
  // Si l'intervention a une note écrite → la note DEVIENT le titre (pas le
  // nom de mission), c'est la voix humaine qui fait l'événement.
  for (const i of interventions) {
    const noteTrimmed = i.notes?.trim() ?? ''
    if (noteTrimmed.length === 0) continue
    const photoCount = photoCountByIntervention.get(i.id) ?? 0
    const photoSuffix = photoCount > 0
      ? `${photoCount} photo${photoCount > 1 ? 's' : ''}`
      : null
    const missionLabel = missionNameById.get(i.mission_id) ?? null
    const detail = [missionLabel, photoSuffix].filter(Boolean).join(' · ') || null
    events.push({
      type: 'intervention',
      id: i.id,
      occurredAt: i.executed_at ?? i.scheduled_at,
      title: noteTrimmed,
      detail,
      status: i.status,
      interventionId: i.id,
    })
  }

  for (const p of passagePhotos) {
    events.push({
      type: 'photo',
      id: p.id,
      occurredAt: p.taken_at,
      title: p.caption ?? 'Passage',
      detail: null,
      interventionId: p.intervention_id,
      meta: { kind: p.kind },
    })
  }

  // Vincent 2026-05-21 — dedup A + collapse B (cf. processAnomaliesForMemory).
  // Logique extraite en helper PUR pour test unitaire.
  const interventionNotesById = new Map<string, string>()
  for (const i of interventions) {
    const norm = normalizeText(i.notes)
    if (norm.length > 0) interventionNotesById.set(i.id, norm)
  }
  const anomalyEvents = processAnomaliesForMemory({
    anomalies: (anomaliesRes.data ?? []) as AnomalyInputRow[],
    interventionNotesById,
    excludeAnomalyIds: accessIncidentAnomalyIds,
  })
  for (const e of anomalyEvents) events.push(e)

  for (const n of (notesRes.data ?? [])) {
    events.push({
      type: n.kind === 'a_savoir' ? 'a_savoir' : 'note',
      id: n.id,
      occurredAt: n.created_at,
      title: n.body,
      detail: null,
      meta: { active_until: n.active_until },
    })
  }

  // Accès — UNE ligne collapsée par intervention. « Incident d'accès » si au
  // moins un incident, sinon « Accès documenté ». occurredAt = dernier mouvement.
  const accessByIntervention = new Map<string, { latest: string; hasIncident: boolean }>()
  for (const e of accessRows) {
    const cur = accessByIntervention.get(e.intervention_id)
    if (!cur) {
      accessByIntervention.set(e.intervention_id, {
        latest: e.occurred_at,
        hasIncident: e.type === 'incident',
      })
    } else {
      if (e.occurred_at > cur.latest) cur.latest = e.occurred_at
      if (e.type === 'incident') cur.hasIncident = true
    }
  }
  for (const [interventionId, agg] of accessByIntervention) {
    events.push({
      type: 'access',
      id: `${interventionId}-access`,
      occurredAt: agg.latest,
      title: agg.hasIncident ? "Incident d'accès" : 'Accès documenté',
      detail: null,
      interventionId,
      meta: { kind: agg.hasIncident ? 'incident' : 'routine' },
    })
  }

  // Tri chronologique inversé, cap au limit.
  events.sort((a, b) => (b.occurredAt > a.occurredAt ? 1 : b.occurredAt < a.occurredAt ? -1 : 0))
  return events.slice(0, limit)
}
