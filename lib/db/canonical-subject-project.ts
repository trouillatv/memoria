// PROJECTION DÉTERMINISTE DU SUJET CANONIQUE SUR LES OBJETS MÉTIER
//
// Audit PRODUCT-CANONICAL-OBJECT-BRIDGE (Phase A, 2026-08-24) : MemorIA connaît
// déjà le rapprochement dans 96 actions et 26 échéances sur lesquelles la FK
// n'est pas posée — 0 cas ambigu sur tout le parc. Le défaut n'est pas un défaut
// de compréhension, c'est un défaut de PROJECTION : le lien intermédiaire existe,
// la surface finale ne le reçoit pas.
//
// Le cas emblématique est `ensureActionThread()` : elle reçoit le
// canonicalSubjectId, pose le subject_thread_id, crée l'identité canonique…
// puis s'arrête juste avant d'écrire la FK de l'action.
//
// CE QUE CE MODULE FAIT — uniquement réutiliser des preuves STRUCTURELLES déjà
// produites, dans cet ordre, sans jamais en fabriquer :
//   1. site_actions.subject_thread_id            → subject_thread_identity
//   2. document_proposal_materialization         → document_extraction_proposal
//                                                  .subject_thread_id
//                                                → subject_thread_identity
//   3. site_knowledge_proposals.canonical_subject_id (promotion terrain)
//
// CE QU'IL NE FERA JAMAIS (doctrine Vincent, GO du 2026-08-24) :
//   - aucun LLM, aucun Jaccard, aucune proximité lexicale ;
//   - aucune écriture si deux preuves désignent des sujets différents ;
//   - aucun écrasement d'une FK déjà posée ;
//   - aucune recherche de couverture à 100 % : un objet sans preuve reste NULL.
//
// Résolution des fusions : l'audit a mesuré 31 chaînes à DEUX sauts en
// production. Un déréférencement unique de `merged_into` écrirait donc une FK
// vers un perdant. Le walk est itératif et borné.

import { createAdminClient } from '@/lib/supabase/admin'

export type Sb = ReturnType<typeof createAdminClient>

/** Type d'objet métier portant une FK canonique (mig 346). */
export type ProjectableObjectType = 'site_action' | 'site_deadline'

/** Preuve structurelle ayant permis d'atteindre le sujet. Jamais lexicale. */
export type BridgePath = 'thread' | 'materialization' | 'promotion'

export type ProjectionSkipReason =
  /** FK déjà posée : on ne l'écrase jamais, même si une preuve la contredit. */
  | 'already_linked'
  /** Aucune des trois preuves n'aboutit. C'est un résultat, pas un échec. */
  | 'no_structural_evidence'
  /** Deux preuves désignent des sujets différents : arbitrage refusé. */
  | 'conflicting_evidence'
  /** La chaîne de fusion est cassée ou cyclique : cible non fiable. */
  | 'merge_chain_unresolved'

export interface ProjectedRow {
  objectType: ProjectableObjectType
  objectId: string
  /** Sujet atteint par la preuve, AVANT résolution des fusions. */
  rawSubjectId: string
  /** Sujet vivant réellement écrit, APRÈS résolution des fusions. */
  canonicalSubjectId: string
  /** Nombre de déréférencements `merged_into` traversés (0 = sujet déjà vivant). */
  mergeHops: number
  /** Preuves concordantes ayant mené à ce sujet. */
  paths: BridgePath[]
}

export interface SkippedRow {
  objectType: ProjectableObjectType
  objectId: string
  reason: ProjectionSkipReason
  /** Sujets atteints — plusieurs en cas de conflit, pour l'inspection humaine. */
  targets: string[]
}

export interface ProjectionReport {
  /** Écrites (ou qui l'auraient été si `dryRun`). */
  projected: ProjectedRow[]
  skipped: SkippedRow[]
  /** true = aucune écriture n'a été émise. */
  dryRun: boolean
}

/**
 * Périmètre de la projection.
 *   report  — les objets nés d'une visite / d'un PV donné. C'est le périmètre des
 *             points d'appel « au moment de la création ».
 *   objects — des identifiants précis (promotion terrain, ensureActionThread).
 *   site    — tout le chantier. RÉSERVÉ au dry-run de réparation historique :
 *             ne jamais l'utiliser dans un chemin de création.
 */
export type ProjectionScope =
  | { kind: 'report'; reportId: string }
  | { kind: 'objects'; actionIds?: string[]; deadlineIds?: string[] }
  | { kind: 'site' }

export interface ProjectCanonicalSubjectParams {
  siteId: string
  scope: ProjectionScope
  /** true = calculer et rapporter sans rien écrire. */
  dryRun?: boolean
}

const MAX_MERGE_HOPS = 10

interface ObjectRow {
  id: string
  canonical_subject_id: string | null
  subject_thread_id?: string | null
}

/**
 * Projette le sujet canonique sur les actions et échéances du périmètre.
 *
 * Ne lève jamais : appelée depuis des chemins de création, elle ne doit pas
 * pouvoir faire échouer la création d'une visite ou d'une promotion. Un échec
 * se lit dans le rapport retourné, pas dans une exception.
 */
export async function projectCanonicalSubjectOnObjects(
  params: ProjectCanonicalSubjectParams,
): Promise<ProjectionReport> {
  const { siteId, scope } = params
  const dryRun = params.dryRun ?? false
  const sb = createAdminClient()
  const report: ProjectionReport = { projected: [], skipped: [], dryRun }

  const [actions, deadlines] = await Promise.all([
    loadObjects(sb, 'site_actions', siteId, scope),
    loadObjects(sb, 'site_deadlines', siteId, scope),
  ])
  if (actions.length === 0 && deadlines.length === 0) return report

  const objectIds = [...actions.map((a) => a.id), ...deadlines.map((d) => d.id)]

  const [materializationTargets, promotionTargets, threadIndex, subjects] = await Promise.all([
    loadMaterializationBridge(sb, objectIds),
    loadPromotionBridge(sb, objectIds),
    loadThreadIndex(sb, siteId),
    loadSiteSubjects(sb, siteId),
  ])

  const resolveWinner = makeWinnerResolver(sb, subjects)

  for (const [objectType, rows] of [
    ['site_action', actions],
    ['site_deadline', deadlines],
  ] as const) {
    for (const row of rows) {
      // ── Preuves brutes ─────────────────────────────────────────────────────
      const evidence = new Map<string, BridgePath[]>()
      const note = (subjectId: string, path: BridgePath) => {
        const paths = evidence.get(subjectId) ?? []
        if (!paths.includes(path)) paths.push(path)
        evidence.set(subjectId, paths)
      }

      if (row.subject_thread_id) {
        const cs = threadIndex.get(row.subject_thread_id)
        if (cs) note(cs, 'thread')
      }
      for (const threadId of materializationTargets.get(row.id) ?? []) {
        const cs = threadIndex.get(threadId)
        if (cs) note(cs, 'materialization')
      }
      for (const cs of promotionTargets.get(row.id) ?? []) note(cs, 'promotion')

      if (evidence.size === 0) {
        report.skipped.push({ objectType, objectId: row.id, reason: 'no_structural_evidence', targets: [] })
        continue
      }

      // ── Résolution des fusions AVANT de juger l'unicité ─────────────────────
      // Deux preuves peuvent désigner deux sujets qui ont été fusionnés depuis :
      // elles ne sont alors pas contradictoires. Juger avant le walk ferait
      // rejeter à tort des cas parfaitement déterministes.
      const winners = new Map<string, { raw: string; hops: number; paths: BridgePath[] }>()
      let unresolvedChain = false
      for (const [rawId, paths] of evidence) {
        const w = await resolveWinner(rawId)
        if (!w) {
          unresolvedChain = true
          continue
        }
        const existing = winners.get(w.id)
        if (existing) {
          for (const p of paths) if (!existing.paths.includes(p)) existing.paths.push(p)
        } else {
          winners.set(w.id, { raw: rawId, hops: w.hops, paths: [...paths] })
        }
      }

      if (winners.size === 0) {
        report.skipped.push({
          objectType,
          objectId: row.id,
          reason: unresolvedChain ? 'merge_chain_unresolved' : 'no_structural_evidence',
          targets: [...evidence.keys()],
        })
        continue
      }
      if (winners.size > 1) {
        report.skipped.push({
          objectType,
          objectId: row.id,
          reason: 'conflicting_evidence',
          targets: [...winners.keys()],
        })
        continue
      }

      const [winnerId, detail] = [...winners][0]

      // ── Jamais d'écrasement ────────────────────────────────────────────────
      if (row.canonical_subject_id) {
        report.skipped.push({
          objectType,
          objectId: row.id,
          reason: 'already_linked',
          targets: [winnerId],
        })
        continue
      }

      const projected: ProjectedRow = {
        objectType,
        objectId: row.id,
        rawSubjectId: detail.raw,
        canonicalSubjectId: winnerId,
        mergeHops: detail.hops,
        paths: detail.paths,
      }

      if (!dryRun) {
        // `.is('canonical_subject_id', null)` : une écriture concurrente arrivée
        // entre la lecture et ici gagne — on ne l'écrase pas non plus.
        const { error } = await sb
          .from(objectType === 'site_action' ? 'site_actions' : 'site_deadlines')
          .update({ canonical_subject_id: winnerId })
          .eq('id', row.id)
          .is('canonical_subject_id', null)
        if (error) {
          console.error('[canonical-project] écriture refusée pour', row.id, ':', error.message)
          continue
        }
      }
      report.projected.push(projected)
    }
  }

  return report
}

// ─── Chargements ──────────────────────────────────────────────────────────────

async function loadObjects(
  sb: Sb,
  table: 'site_actions' | 'site_deadlines',
  siteId: string,
  scope: ProjectionScope,
): Promise<ObjectRow[]> {
  const columns =
    table === 'site_actions'
      ? 'id, canonical_subject_id, subject_thread_id'
      : 'id, canonical_subject_id'

  let query = sb.from(table).select(columns).eq('site_id', siteId)

  if (scope.kind === 'report') {
    query = query.eq('report_id', scope.reportId)
  } else if (scope.kind === 'objects') {
    const ids = table === 'site_actions' ? scope.actionIds : scope.deadlineIds
    if (!ids || ids.length === 0) return []
    query = query.in('id', ids)
  } else {
    // Périmètre chantier : seuls les objets non liés nous intéressent.
    query = query.is('canonical_subject_id', null)
  }

  const { data, error } = await query
  if (error) {
    console.error(`[canonical-project] lecture ${table} en échec :`, error.message)
    return []
  }
  return (data ?? []) as unknown as ObjectRow[]
}

/** objet métier → threads des propositions PV dont il est la matérialisation. */
async function loadMaterializationBridge(sb: Sb, objectIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (objectIds.length === 0) return out

  const { data: mats } = await sb
    .from('document_proposal_materialization')
    .select('proposal_id, target_entity_id')
    .in('target_entity_id', objectIds)

  const rows = (mats ?? []) as Array<{ proposal_id: string; target_entity_id: string | null }>
  if (rows.length === 0) return out

  const proposalIds = [...new Set(rows.map((r) => r.proposal_id))]
  const { data: props } = await sb
    .from('document_extraction_proposal')
    .select('id, subject_thread_id')
    .in('id', proposalIds)

  const propToThread = new Map(
    ((props ?? []) as Array<{ id: string; subject_thread_id: string | null }>).map((p) => [p.id, p.subject_thread_id]),
  )

  for (const r of rows) {
    if (!r.target_entity_id) continue
    const thread = propToThread.get(r.proposal_id)
    if (!thread) continue
    const list = out.get(r.target_entity_id) ?? []
    if (!list.includes(thread)) list.push(thread)
    out.set(r.target_entity_id, list)
  }
  return out
}

/** objet métier → sujets canoniques portés par les propositions terrain promues. */
async function loadPromotionBridge(sb: Sb, objectIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (objectIds.length === 0) return out

  const { data } = await sb
    .from('site_knowledge_proposals')
    .select('promoted_object_id, canonical_subject_id')
    .in('promoted_object_id', objectIds)
    .not('canonical_subject_id', 'is', null)

  for (const p of (data ?? []) as Array<{ promoted_object_id: string | null; canonical_subject_id: string | null }>) {
    if (!p.promoted_object_id || !p.canonical_subject_id) continue
    const list = out.get(p.promoted_object_id) ?? []
    if (!list.includes(p.canonical_subject_id)) list.push(p.canonical_subject_id)
    out.set(p.promoted_object_id, list)
  }
  return out
}

/** subject_thread_id → canonical_subject_id, sur le chantier. */
async function loadThreadIndex(sb: Sb, siteId: string): Promise<Map<string, string>> {
  const { data } = await sb
    .from('subject_thread_identity')
    .select('subject_thread_id, canonical_subject_id')
    .eq('site_id', siteId)
  return new Map(
    ((data ?? []) as Array<{ subject_thread_id: string; canonical_subject_id: string }>).map((r) => [
      r.subject_thread_id,
      r.canonical_subject_id,
    ]),
  )
}

export interface SubjectRow {
  id: string
  status: string | null
  merged_into: string | null
}

async function loadSiteSubjects(sb: Sb, siteId: string): Promise<Map<string, SubjectRow>> {
  const { data } = await sb.from('canonical_subject').select('id, status, merged_into').eq('site_id', siteId)
  return new Map(((data ?? []) as SubjectRow[]).map((c) => [c.id, c]))
}

// ─── Résolution transitive des fusions ────────────────────────────────────────

/**
 * Remonte `merged_into` jusqu'au sujet vivant.
 *
 * Pourquoi itératif : l'audit Phase A a mesuré 276 chaînes à 1 saut mais aussi
 * 31 chaînes à 2 sauts en production. Un `merged_into` suivi une seule fois
 * atterrirait donc parfois sur un sujet lui-même fusionné, et écrirait une FK
 * vers un perdant.
 *
 * Borné : une chaîne trop longue ou cyclique retourne null — on préfère ne rien
 * écrire plutôt qu'écrire une cible dont on ne sait pas prouver qu'elle est vivante.
 */
export function makeWinnerResolver(sb: Sb, cache: Map<string, SubjectRow>) {
  const missing = new Set<string>()

  async function fetchSubject(id: string): Promise<SubjectRow | null> {
    const hit = cache.get(id)
    if (hit) return hit
    if (missing.has(id)) return null
    // Cas rare : la chaîne sort du chantier courant. On va chercher la ligne
    // plutôt que d'abandonner silencieusement.
    const { data } = await sb.from('canonical_subject').select('id, status, merged_into').eq('id', id).maybeSingle()
    const row = (data ?? null) as SubjectRow | null
    if (!row) {
      missing.add(id)
      return null
    }
    cache.set(id, row)
    return row
  }

  return async function resolveWinner(id: string): Promise<{ id: string; hops: number } | null> {
    let current = id
    const seen = new Set<string>([id])
    for (let hops = 0; hops <= MAX_MERGE_HOPS; hops++) {
      const row = await fetchSubject(current)
      if (!row) return null
      if (row.status !== 'merged' || !row.merged_into) return { id: current, hops }
      if (seen.has(row.merged_into)) return null // cycle
      seen.add(row.merged_into)
      current = row.merged_into
    }
    return null
  }
}

/**
 * Enveloppe non bloquante pour les chemins de création : une projection ratée ne
 * doit jamais faire échouer la création d'une visite, d'une action ou d'une
 * promotion. Le lien manquant reste rattrapable au replay P0-2.
 */
export async function projectCanonicalSubjectSafely(
  params: ProjectCanonicalSubjectParams,
): Promise<ProjectionReport | null> {
  try {
    return await projectCanonicalSubjectOnObjects(params)
  } catch (err) {
    console.error('[canonical-project] projection ignorée :', err instanceof Error ? err.message : String(err))
    return null
  }
}
