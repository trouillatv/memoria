// Phase 6E.1A — Sémantique de fusion Point→Point + agrégation read-model — ZERO WRITE.
//
// Mandat Vincent (post 6E.0, GO confirmé) : le mécanisme structurel de fusion existe déjà
// depuis la migration 388 (tracked_point.status IN ('active','merged','retired') +
// merged_into_id, jamais utilisés — 0 ligne merged aujourd'hui). Ce module spécifie et teste
// la SÉMANTIQUE au-dessus de ce schéma, en pur, sans aucune écriture.
//
// MERGE = redirection logique uniquement. Fusionner A dans B signifie : A.status='merged',
// A.merged_into_id=B. Jamais de déplacement physique de tracked_point_member,
// canonical_business_object.tracked_point_id, founding_reference ou preuves. Jamais de
// suppression. Le read-model du Point canonique agrège LOGIQUEMENT, à la lecture, les
// contributions de B et de tous ses descendants merged — cf. loadTrackedPointReadModel
// (tracked-point-read-model.ts), qui consomme buildPointMergeComponents ci-dessous.
//
// Règle de sélection de la cible canonique (Vincent, gelée) : le sens de la candidature
// (A→B ou B→A) ne décide jamais. CONFIRMED > PROVISIONAL, puis created_at le plus ancien,
// puis UUID stable en dernier recours déterministe.

export type TrackedPointMergeStatus = 'active' | 'merged' | 'retired'
export type TrackedPointMergeIdentityStatus = 'CONFIRMED' | 'PROVISIONAL' | 'CONFLICTED'

// MergePointCore : le sous-ensemble strictement nécessaire à la résolution de chaîne
// (resolveCanonicalPointId / buildPointMergeComponents). Volontairement minimal pour que
// deriveCandidatePointPairs (plus bas) puisse réutiliser ces fonctions sans avoir à
// transporter identity_status/created_at, qui ne servent qu'au choix de cible (ci-dessous).
export type MergePointCore = {
  id: string
  siteId: string
  status: TrackedPointMergeStatus
  mergedIntoId: string | null
}

export type MergeGraphPoint = MergePointCore & {
  identityStatus: TrackedPointMergeIdentityStatus
  createdAt: string
}

export class PointMergeCycleError extends Error {}
export class PointMergeTargetMissingError extends Error {}
export class PointMergeTargetRetiredError extends Error {}
export class PointMergeCrossSiteError extends Error {}
export class PointMergeAmbiguousCanonicalError extends Error {}

// resolveCanonicalPointId : suit la chaîne merged_into_id jusqu'à un Point non-merged (le
// canonique). Aucun fallback silencieux (CLAUDE.md §21) : cible absente, cible retired,
// cycle ou fusion cross-site lèvent chacun une erreur explicite et typée plutôt que de
// deviner un résultat.
export function resolveCanonicalPointId<T extends MergePointCore>(
  pointId: string,
  pointsById: Map<string, T>,
): string {
  const start = pointsById.get(pointId)
  if (!start) throw new PointMergeTargetMissingError(`resolveCanonicalPointId: point introuvable ${pointId}`)

  const visited = new Set<string>([pointId])
  let current = start
  while (current.status === 'merged') {
    const nextId = current.mergedIntoId
    if (!nextId) {
      throw new PointMergeTargetMissingError(
        `resolveCanonicalPointId: ${current.id} status=merged sans merged_into_id`,
      )
    }
    if (visited.has(nextId)) {
      throw new PointMergeCycleError(`resolveCanonicalPointId: cycle détecté sur ${pointId} (via ${nextId})`)
    }
    const next = pointsById.get(nextId)
    if (!next) {
      throw new PointMergeTargetMissingError(
        `resolveCanonicalPointId: cible de fusion introuvable ${nextId} (depuis ${current.id})`,
      )
    }
    if (next.siteId !== start.siteId) {
      throw new PointMergeCrossSiteError(
        `resolveCanonicalPointId: fusion cross-site ${current.id}(${current.siteId}) → ${next.id}(${next.siteId})`,
      )
    }
    if (next.status === 'retired') {
      throw new PointMergeTargetRetiredError(`resolveCanonicalPointId: cible de fusion retired ${next.id}`)
    }
    visited.add(nextId)
    current = next
  }
  return current.id
}

// chooseCanonicalMergeTarget : règle gelée CONFIRMED > PROVISIONAL > créé le plus tôt >
// UUID stable. CONFLICTED n'est pas couvert par la doctrine fournie par Vincent (qui ne
// spécifie que CONFIRMED/PROVISIONAL) : décision volontairement prudente de ne PAS inventer
// un rang implicite pour CONFLICTED — throw explicite plutôt qu'un ordre arbitraire silencieux.
// 0 Point CONFLICTED en production aujourd'hui (6E.0) : cette branche ne s'exerce sur aucune
// donnée réelle actuellement — à confirmer avec Vincent si un CONFLICTED apparaît un jour.
export function chooseCanonicalMergeTarget(a: MergeGraphPoint, b: MergeGraphPoint): string {
  if (a.identityStatus === 'CONFLICTED' || b.identityStatus === 'CONFLICTED') {
    throw new PointMergeAmbiguousCanonicalError(
      `chooseCanonicalMergeTarget: identity_status CONFLICTED non spécifié par la doctrine 6E.1A (${a.id}/${b.id})`,
    )
  }
  if (a.identityStatus !== b.identityStatus) {
    return a.identityStatus === 'CONFIRMED' ? a.id : b.id
  }
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? a.id : b.id
  }
  return a.id < b.id ? a.id : b.id
}

export type PointMergeComponent = {
  canonicalPointId: string
  memberPointIds: string[]
}

// buildPointMergeComponents : groupe TOUS les Points d'un site par cible canonique. Un Point
// non-merged forme son propre composant singleton (il est son propre canonique) — garantit
// une couverture totale : tout point.id passé en entrée apparaît comme membre d'exactement
// un composant en sortie.
export function buildPointMergeComponents<T extends MergePointCore>(points: T[]): Map<string, PointMergeComponent> {
  const pointsById = new Map(points.map((p) => [p.id, p]))
  const components = new Map<string, PointMergeComponent>()
  for (const p of points) {
    const canonicalId = resolveCanonicalPointId(p.id, pointsById)
    const comp = components.get(canonicalId) ?? { canonicalPointId: canonicalId, memberPointIds: [] }
    comp.memberPointIds.push(p.id)
    components.set(canonicalId, comp)
  }
  return components
}

// ─────────────────────────────────────────────────────────────────────────────
// Projection des 268 tracked_point_identity_candidate en paires métier Point↔Point.
// ─────────────────────────────────────────────────────────────────────────────
//
// Réplique la classification déjà validée par 6E.0 (scripts/_p6e0-consolidation-inventory.ts,
// §1/§2, 179 POINT_TO_POINT / 95 paires distinctes / 68 réciproques sur les données réelles) :
// une trace candidate à candidate_point_id est POINT_TO_POINT si son subject_thread_id est
// LUI-MÊME déjà rattaché à un autre Point (fondateur trackable_condition, membre HARD
// scope='thread', ou membre HARD scope='proposal_set') — auquel cas la candidature porte de
// fait sur une paire de Points, pas sur un simple rattachement de trace isolée.
//
// Canonicalisation : chaque extrémité passe par resolveCanonicalPointId AVANT le calcul de la
// clé de paire — après un premier merge, A→C avec A déjà fusionné dans B redevient B→C
// automatiquement (jamais recalculé à la main). Une self-pair (les deux extrémités résolvent
// au même canonique — déjà consolidées) est retirée de la file, PAS marquée rejetée : aucun
// candidat n'est jamais rejeté automatiquement par cette fonction (Vincent, gelé).

export type CandidatePairPointRow = MergePointCore & {
  foundingKind: 'cbo' | 'trackable_condition' | 'manual'
  foundingReference: string | null
}

export type CandidatePairMemberRow = {
  trackedPointId: string
  subjectThreadId: string
  scope: 'thread' | 'proposal_set'
  status: 'active' | 'retired'
}

export type CandidatePairIdentityCandidateRow = {
  id: string
  siteId: string
  candidatePointId: string
  subjectThreadId: string
  status: 'pending' | 'accepted' | 'rejected'
}

export type CandidatePointPair = {
  pairKey: string
  pointAId: string
  pointBId: string
  siteId: string
  candidateIds: string[]
  reciprocal: boolean
}

export function deriveCandidatePointPairs(
  points: CandidatePairPointRow[],
  members: CandidatePairMemberRow[],
  candidates: CandidatePairIdentityCandidateRow[],
): CandidatePointPair[] {
  const pointsById = new Map(points.map((p) => [p.id, p]))

  const founderThreadToPointId = new Map<string, string>()
  for (const p of points) {
    if (p.foundingKind === 'trackable_condition' && p.foundingReference) {
      founderThreadToPointId.set(p.foundingReference, p.id)
    }
  }

  const hardThreadMemberToPointId = new Map<string, string>()
  const hardProposalSetMembersByThread = new Map<string, CandidatePairMemberRow[]>()
  for (const m of members) {
    if (m.status !== 'active') continue
    if (m.scope === 'thread') {
      hardThreadMemberToPointId.set(m.subjectThreadId, m.trackedPointId)
    } else {
      const list = hardProposalSetMembersByThread.get(m.subjectThreadId) ?? []
      list.push(m)
      hardProposalSetMembersByThread.set(m.subjectThreadId, list)
    }
  }

  type RawEdge = { pointAId: string; pointBId: string; siteId: string; candidateId: string }
  const rawEdges: RawEdge[] = []

  for (const c of candidates) {
    if (c.status !== 'pending') continue // accepted/rejected : déjà arbitrés, jamais reposés
    if (!pointsById.has(c.candidatePointId)) continue // cible introuvable (OTHER_UNRESOLVED) : hors paire, pas rejeté

    let sourceOwnPointId: string | null = null

    const founderPointId = founderThreadToPointId.get(c.subjectThreadId)
    if (founderPointId && founderPointId !== c.candidatePointId) {
      sourceOwnPointId = founderPointId
    }
    if (!sourceOwnPointId) {
      const hardThreadPointId = hardThreadMemberToPointId.get(c.subjectThreadId)
      if (hardThreadPointId && hardThreadPointId !== c.candidatePointId) {
        sourceOwnPointId = hardThreadPointId
      }
    }
    if (!sourceOwnPointId) {
      const proposalSetMembers = hardProposalSetMembersByThread.get(c.subjectThreadId) ?? []
      const distinctOther = proposalSetMembers.find((m) => m.trackedPointId !== c.candidatePointId)
      if (distinctOther) sourceOwnPointId = distinctOther.trackedPointId
    }

    if (!sourceOwnPointId) continue // TRACE_TO_POINT : rattachement de trace isolée, pas une paire Point↔Point

    rawEdges.push({ pointAId: sourceOwnPointId, pointBId: c.candidatePointId, siteId: c.siteId, candidateId: c.id })
  }

  const directedCanonicalSet = new Set<string>()
  const pairEdges: Array<{ canonicalA: string; canonicalB: string; candidateId: string; siteId: string }> = []

  for (const e of rawEdges) {
    const canonicalA = resolveCanonicalPointId(e.pointAId, pointsById)
    const canonicalB = resolveCanonicalPointId(e.pointBId, pointsById)
    if (canonicalA === canonicalB) continue // déjà consolidées par un merge antérieur : retirée de la file, jamais "rejetée"
    directedCanonicalSet.add(`${canonicalA}>${canonicalB}`)
    pairEdges.push({ canonicalA, canonicalB, candidateId: e.candidateId, siteId: e.siteId })
  }

  const byPairKey = new Map<string, CandidatePointPair>()
  for (const e of pairEdges) {
    const [x, y] = [e.canonicalA, e.canonicalB].sort()
    const pairKey = `${x}~${y}`
    const existing = byPairKey.get(pairKey)
    if (existing) {
      existing.candidateIds.push(e.candidateId)
    } else {
      byPairKey.set(pairKey, {
        pairKey,
        pointAId: x,
        pointBId: y,
        siteId: e.siteId,
        candidateIds: [e.candidateId],
        reciprocal: false,
      })
    }
  }

  for (const pair of byPairKey.values()) {
    pair.reciprocal =
      directedCanonicalSet.has(`${pair.pointAId}>${pair.pointBId}`) &&
      directedCanonicalSet.has(`${pair.pointBId}>${pair.pointAId}`)
  }

  return [...byPairKey.values()].sort((a, b) => a.pairKey.localeCompare(b.pairKey))
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilitaire générique de composantes connexes — réutilisable pour l'audit READ-ONLY des
// paires candidates (graphe DIFFÉRENT du graphe de fusion : aucun merge réel n'existe encore,
// donc buildPointMergeComponents ci-dessus renverrait uniquement des singletons ; ceci
// répond à une question distincte : « parmi les 95 paires candidates, combien forment des
// grappes de 3 Points ou plus ? »).
// ─────────────────────────────────────────────────────────────────────────────

export function computeConnectedComponents(edges: Array<{ a: string; b: string }>): string[][] {
  const parent = new Map<string, string>()

  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x)
    let root = x
    while (parent.get(root) !== root) root = parent.get(root) as string
    let cur = x
    while (parent.get(cur) !== root) {
      const next = parent.get(cur) as string
      parent.set(cur, root)
      cur = next
    }
    return root
  }

  const union = (x: string, y: string) => {
    const rx = find(x)
    const ry = find(y)
    if (rx !== ry) parent.set(rx, ry)
  }

  for (const e of edges) {
    find(e.a)
    find(e.b)
    union(e.a, e.b)
  }

  const groups = new Map<string, string[]>()
  for (const id of parent.keys()) {
    const root = find(id)
    const list = groups.get(root) ?? []
    list.push(id)
    groups.set(root, list)
  }
  return [...groups.values()]
}
