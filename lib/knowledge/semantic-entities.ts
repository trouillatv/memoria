// Mémoire sémantique — résolution des entités connues avant injection dans le LLM.
//
// PIPELINE : Audio → Transcription → [ce module] → Prompt enrichi → LLM → Extraction
//
// PRIORITÉ DE RÉSOLUTION (décroissante) : utilisateur > chantier > organisation.
// Quand deux entités de scopes différents revendiquent le même alias_norm,
// le scope supérieur gagne. Deux entités du même scope sur le même alias_norm :
// l'une d'elles écrase l'autre (ordre stable une fois les entités triées).
//
// NORMALISATION : identique à normalize() de lib/db/knowledge-proposals.ts.
// Doit rester synchronisée pour la validation post-LLM (Lot 1B).

import { createAdminClient } from '@/lib/supabase/admin'

export type EntityScope = 'user' | 'site' | 'org'
export type EntityType = 'company' | 'person' | 'acronym' | 'expression' | 'pronunciation'

export interface KnowledgeEntity {
  id: string
  canonicalLabel: string
  entityType: EntityType
  scope: EntityScope
  confidence: number
  isActive: boolean
  aliases: string[]
}

export interface ResolvedEntity {
  canonicalLabel: string
  entityType: EntityType
  scope: EntityScope
  aliases: string[] // alias bruts gagnants pour cette entité, triés
}

const SCOPE_PRIORITY: Record<EntityScope, number> = { user: 3, site: 2, org: 1 }

const TYPE_ORDER: Record<EntityType, number> = {
  person: 0, company: 1, acronym: 2, expression: 3, pronunciation: 4,
}

// Normalisation identique à normalize() dans lib/db/knowledge-proposals.ts.
// Toute modification ici DOIT être répercutée là-bas (et inversement).
export function normalizeAlias(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Résolution pure : given une liste plate d'entités (tous scopes confondus),
// produit une liste dédupliquée où le scope supérieur gagne sur chaque alias_norm.
// Les entités inactives sont exclues.
// L'ordre de sortie est déterministe (scope desc, type asc, canonical asc)
// indépendamment de l'ordre d'entrée.
export function resolveEntities(entities: KnowledgeEntity[]): ResolvedEntity[] {
  const active = entities.filter((e) => e.isActive)

  // Tri croissant par priorité : le scope supérieur écrase le scope inférieur.
  const byPriority = [...active].sort((a, b) => SCOPE_PRIORITY[a.scope] - SCOPE_PRIORITY[b.scope])

  // alias_norm → entité gagnante
  const winnerByNorm = new Map<string, KnowledgeEntity>()
  for (const entity of byPriority) {
    for (const alias of entity.aliases) {
      const norm = normalizeAlias(alias)
      if (norm) winnerByNorm.set(norm, entity)
    }
  }

  // Regroupe les alias gagnants par entité (id)
  const winningAliasesByEntityId = new Map<string, string[]>()
  for (const [norm, entity] of winnerByNorm) {
    const originalAlias = entity.aliases.find((a) => normalizeAlias(a) === norm) ?? norm
    const current = winningAliasesByEntityId.get(entity.id) ?? []
    if (!current.some((a) => normalizeAlias(a) === norm)) {
      current.push(originalAlias)
    }
    winningAliasesByEntityId.set(entity.id, current)
  }

  const entityById = new Map(active.map((e) => [e.id, e]))
  const resolved: ResolvedEntity[] = []

  for (const [entityId, aliases] of winningAliasesByEntityId) {
    const entity = entityById.get(entityId)
    if (!entity) continue
    resolved.push({
      canonicalLabel: entity.canonicalLabel,
      entityType: entity.entityType,
      scope: entity.scope,
      aliases: [...aliases].sort(),
    })
  }

  // Ordre déterministe : scope desc · type asc · canonical asc
  return resolved.sort((a, b) => {
    const sd = SCOPE_PRIORITY[b.scope] - SCOPE_PRIORITY[a.scope]
    if (sd !== 0) return sd
    const td = TYPE_ORDER[a.entityType] - TYPE_ORDER[b.entityType]
    if (td !== 0) return td
    return a.canonicalLabel.localeCompare(b.canonicalLabel, 'fr')
  })
}

export const MAX_SEMANTIC_BLOCK_CHARS = 2000

// Formate les entités résolues en bloc de contexte LLM, dans la limite de maxChars.
// Troncature à la limite de ligne : les entités de plus haute priorité sont incluses en premier.
// Retourne '' si aucune entité n'a d'alias gagnant.
export function formatSemanticContextBlock(
  resolved: ResolvedEntity[],
  maxChars = MAX_SEMANTIC_BLOCK_CHARS,
): string {
  const lines = resolved
    .filter((e) => e.aliases.length > 0)
    .map((e) => `${e.aliases.join(' / ')} → ${e.canonicalLabel}`)

  if (lines.length === 0) return ''

  const header = '=== Mémoire sémantique du chantier ==='
  let block = header

  for (const line of lines) {
    const candidate = `${block}\n${line}`
    if (candidate.length > maxChars) break
    block = candidate
  }

  return block
}

// Charge les entités connues pour un contexte donné (org + chantier + utilisateur)
// et retourne le bloc de contexte formaté, prêt à être injecté dans le prompt.
// Retourne '' si aucune entité n'est configurée (comportement identique à l'absence
// du module — aucun impact sur le pipeline existant).
export async function buildSemanticContextBlock(
  siteId: string,
  orgId: string,
  userId?: string,
): Promise<string> {
  const db = createAdminClient()

  // Charge toutes les entités actives de l'organisation pour ce chantier et cet utilisateur.
  // Filtre côté DB : entités d'organisation (site_id null) + entités du chantier courant.
  let query = db
    .from('site_knowledge_entities')
    .select(`
      id,
      canonical_label,
      entity_type,
      site_id,
      user_id,
      confidence,
      is_active,
      site_knowledge_entity_aliases ( alias )
    `)
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .or(`site_id.is.null,site_id.eq.${siteId}`)

  if (userId) {
    query = query.or(`user_id.is.null,user_id.eq.${userId}`)
  } else {
    query = query.is('user_id', null)
  }

  const { data, error } = await query

  if (error || !data || data.length === 0) return ''

  const entities: KnowledgeEntity[] = data.map((row) => {
    const siteNull = !row.site_id
    const userNull = !row.user_id
    const scope: EntityScope = !userNull ? 'user' : siteNull ? 'org' : 'site'
    return {
      id: row.id as string,
      canonicalLabel: row.canonical_label as string,
      entityType: row.entity_type as EntityType,
      scope,
      confidence: row.confidence as number,
      isActive: row.is_active as boolean,
      aliases: ((row.site_knowledge_entity_aliases ?? []) as Array<{ alias: string }>).map(
        (a) => a.alias,
      ),
    }
  })

  return formatSemanticContextBlock(resolveEntities(entities))
}
