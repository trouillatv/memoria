import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { MaterializedEvent } from '@/lib/db/canonical-subject-life'

// Read-model d'objets métier durables (canonical_business_object) — P1-C2A.1.
//
// Ne remplace ni ne recalcule life.materializedEvents (l'historique physique brut
// reste la source de vérité, inchangée). Ce module projette dessus une deuxième
// vue : chaque canonical_business_object devient UNE entrée logique regroupant
// ses occurrences physiques ; un événement sans CBO reste sa propre entrée.
//
// Garanties :
//   - Jamais de fusion entre deux CBO différents (regroupement uniquement par
//     canonical_business_object_id, jamais par ressemblance de texte).
//   - Jamais de membre importé d'un autre canonical_subject : cette fonction ne
//     regarde que les entityId de la liste fournie par l'appelant (déjà scopée
//     à un seul sujet) — elle ne peut pas en aspirer d'autres.
//   - Les membres physiques ne disparaissent jamais : ils restent dans
//     entry.members (occurrences/preuves consultables derrière l'objet durable).
//
// Réutilisé à la fois par le compteur CBO-aware (build-canonical-subject-intelligence.ts)
// et par la liste détaillée « Objets métier » (fiche sujet) pour que les deux ne
// puissent plus diverger (cf. audit P1-C2A.1).

export type CanonicalBusinessObjectEntry = {
  /** cboId si regroupé, sinon l'entityId de l'unique membre — clé stable pour React. */
  key: string
  entityType: MaterializedEvent['entityType']
  /** Libellé du CBO si regroupé, sinon le titre du membre unique. */
  label: string
  isGrouped: boolean
  members: MaterializedEvent[]
  /** Statut commun si tous les membres partagent le même statut, sinon null. */
  status: string | null
  /** true si les membres n'ont pas tous le même statut — pas de résolution d'état courant dans ce lot. */
  statusIsDivergent: boolean
}

// Un .in() sur des centaines d'UUID dépasse la limite de headers HTTP du client
// PostgREST (HeadersOverflowError au-delà d'environ 16 Ko d'URL, atteint dès ~430
// UUID). Chunker évite la limite ; ne jamais avaler l'erreur (cf. P1-C2B.3 Gate 1 —
// un tel avalage silencieux a produit un faux "0 déjà membre" sur un lot de 502).
const CBO_MEMBERSHIP_CHUNK_SIZE = 100

/** Charge, pour un lot d'entityId, leur éventuelle appartenance à un canonical_business_object. */
export async function fetchCboMemberships(entityIds: string[]): Promise<Map<string, string>> {
  if (entityIds.length === 0) return new Map()
  const sb = createAdminClient()
  const memberMap = new Map<string, string>()

  for (let i = 0; i < entityIds.length; i += CBO_MEMBERSHIP_CHUNK_SIZE) {
    const chunk = entityIds.slice(i, i + CBO_MEMBERSHIP_CHUNK_SIZE)
    const { data, error } = await sb
      .from('canonical_business_object_member')
      .select('member_entity_id, canonical_business_object_id')
      .in('member_entity_id', chunk)
    if (error) {
      throw new Error(`fetchCboMemberships: échec du chunk [${i}, ${i + chunk.length}) — ${error.message}`)
    }
    for (const m of data ?? []) {
      memberMap.set(m.member_entity_id as string, m.canonical_business_object_id as string)
    }
  }

  return memberMap
}

/**
 * Regroupe une liste d'événements déjà scopés à un même sujet par CBO.
 * Fonction pure (aucun accès DB) — le memberMap doit venir de fetchCboMemberships().
 */
export function groupEventsByCbo<T extends { entityId: string }>(
  events: T[],
  memberMap: Map<string, string>,
): Array<{ cboId: string | null; members: T[] }> {
  const groups = new Map<string, T[]>()
  const standalone: Array<{ cboId: null; members: T[] }> = []

  for (const e of events) {
    const cboId = memberMap.get(e.entityId)
    if (!cboId) {
      standalone.push({ cboId: null, members: [e] })
      continue
    }
    const list = groups.get(cboId)
    if (list) list.push(e)
    else groups.set(cboId, [e])
  }

  return [
    ...[...groups.entries()].map(([cboId, members]) => ({ cboId, members })),
    ...standalone,
  ]
}

/**
 * Projette la liste des événements matérialisés d'un sujet en entrées logiques
 * (une par identité métier durable + une par événement isolé). N'altère jamais
 * la liste d'entrée — retourne une vue dérivée.
 */
export async function projectCanonicalBusinessObjects(
  events: MaterializedEvent[],
): Promise<CanonicalBusinessObjectEntry[]> {
  if (events.length === 0) return []

  const memberMap = await fetchCboMemberships(events.map((e) => e.entityId))
  const grouped = groupEventsByCbo(events, memberMap)

  const cboIds = grouped.map((g) => g.cboId).filter((id): id is string => id !== null)
  const labelMap = new Map<string, string>()
  if (cboIds.length > 0) {
    const sb = createAdminClient()
    const { data } = await sb
      .from('canonical_business_object')
      .select('id, label')
      .in('id', cboIds)
    for (const r of data ?? []) labelMap.set(r.id as string, r.label as string)
  }

  return grouped.map((g) => {
    const members = g.members
    const statuses = new Set(members.map((m) => m.status ?? null))
    const statusIsDivergent = statuses.size > 1

    return {
      key: g.cboId ?? members[0].entityId,
      entityType: members[0].entityType,
      label: g.cboId ? (labelMap.get(g.cboId) ?? members[0].title) : members[0].title,
      isGrouped: g.cboId !== null,
      members,
      status: statusIsDivergent ? null : (members[0].status ?? null),
      statusIsDivergent,
    }
  })
}
