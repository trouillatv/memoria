// Mémoire sémantique — résolution des entités connues avant injection dans le LLM.
//
// PIPELINE : Audio → Transcription → [ce module] → Prompt enrichi → LLM → Extraction
//
// PRIORITÉ DE RÉSOLUTION (décroissante) : utilisateur > chantier > organisation.
// Quand deux entités de scopes différents revendiquent le même alias_norm,
// le scope supérieur gagne. Deux entités du MÊME scope sur le même alias_norm
// constituent un CONFLIT (AliasConflict) : signalé, non silencieux, résolu par
// l'entité traitée en dernier lors du tri déterministe.
//
// NORMALISATION : identique à normalize() de lib/db/knowledge-proposals.ts.
// Doit rester synchronisée pour la validation post-LLM (Lot 1B).
//
// FORMAT LLM : chaque ligne inclut le type et les métadonnées disponibles,
// ex. : "Joseph → Joseph Martin (personne, conducteur de travaux chez Élec Plus)"
// afin de lever les ambiguïtés de prénom et de réduire les mauvaises résolutions.

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
  metadata: Record<string, unknown>
}

export interface ResolvedEntity {
  canonicalLabel: string
  entityType: EntityType
  scope: EntityScope
  aliases: string[] // alias bruts gagnants pour cette entité, triés
  metadata: Record<string, unknown>
}

// Conflit : même alias_norm revendiqué par deux entités actives dans le même scope.
export interface AliasConflict {
  aliasNorm: string
  alias: string // forme brute de l'alias
  entities: Array<{ id: string; canonicalLabel: string; scope: EntityScope }>
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
      metadata: entity.metadata,
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

// Détecte les conflits : deux entités actives dans le MÊME scope revendiquant
// le même alias_norm. Ces conflits signalent une incohérence de données.
// La résolution déterministe de resolveEntities() gère silencieusement le conflit,
// mais cette fonction le rend explicite pour logging / alerte UI future.
export function detectAliasConflicts(entities: KnowledgeEntity[]): AliasConflict[] {
  const active = entities.filter((e) => e.isActive)

  // alias_norm|scope → liste d'entités qui le revendiquent
  const claimsByKey = new Map<string, Array<{ id: string; canonicalLabel: string; scope: EntityScope; alias: string }>>()

  for (const entity of active) {
    for (const alias of entity.aliases) {
      const norm = normalizeAlias(alias)
      if (!norm) continue
      const key = `${norm}|${entity.scope}`
      const claims = claimsByKey.get(key) ?? []
      claims.push({ id: entity.id, canonicalLabel: entity.canonicalLabel, scope: entity.scope, alias })
      claimsByKey.set(key, claims)
    }
  }

  const conflicts: AliasConflict[] = []
  for (const [key, claims] of claimsByKey) {
    if (claims.length <= 1) continue
    // Conflit réel : deux entités différentes sur même alias_norm + scope
    const uniqueEntities = claims.filter((c, i) => claims.findIndex((x) => x.id === c.id) === i)
    if (uniqueEntities.length > 1) {
      const aliasNorm = key.split('|')[0]
      conflicts.push({
        aliasNorm,
        alias: claims[0].alias,
        entities: uniqueEntities.map((c) => ({ id: c.id, canonicalLabel: c.canonicalLabel, scope: c.scope })),
      })
    }
  }

  return conflicts
}

// Formate une entité résolue en ligne LLM avec contexte type + métadonnées.
// Format par type :
//   company     : "alias → Canonique (entreprise, trade)"
//   person      : "alias → Prénom Nom (personne, rôle chez Entreprise)"
//   acronym     : "alias → Développé (sigle)"
//   expression  : "alias → Canonique (expression)"
//   pronunciation : "alias → Correct (prononciation vocale)"
function formatEntityLine(entity: ResolvedEntity): string {
  const aliasStr = entity.aliases.join(' / ')
  const m = entity.metadata

  let ctx = ''
  switch (entity.entityType) {
    case 'company': {
      const trade = typeof m.trade === 'string' && m.trade ? `, ${m.trade}` : ''
      ctx = `entreprise${trade}`
      break
    }
    case 'person': {
      const role = typeof m.role === 'string' && m.role ? m.role : ''
      const co = typeof m.company_label === 'string' && m.company_label ? m.company_label : ''
      const detail = [role, co ? `chez ${co}` : ''].filter(Boolean).join(', ')
      ctx = detail ? `personne, ${detail}` : 'personne'
      break
    }
    case 'acronym':
      ctx = 'sigle'
      break
    case 'expression':
      ctx = 'expression'
      break
    case 'pronunciation':
      ctx = 'prononciation vocale'
      break
  }

  return `${aliasStr} → ${entity.canonicalLabel} (${ctx})`
}

export const MAX_SEMANTIC_BLOCK_CHARS = 2000

// Formate les entités résolues en bloc de contexte LLM, dans la limite de maxChars.
// Troncature à la limite de ligne : les entités de plus haute priorité (user > site > org)
// et de type prioritaire (person > company > acronym > expression > pronunciation)
// sont incluses en premier.
// Retourne '' si aucune entité n'a d'alias gagnant.
export function formatSemanticContextBlock(
  resolved: ResolvedEntity[],
  maxChars = MAX_SEMANTIC_BLOCK_CHARS,
): string {
  const lines = resolved
    .filter((e) => e.aliases.length > 0)
    .map(formatEntityLine)

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
// Les conflits détectés sont loggés mais n'interrompent pas le pipeline.
export async function buildSemanticContextBlock(
  siteId: string,
  orgId: string,
  userId?: string,
): Promise<string> {
  const db = createAdminClient()

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
      metadata,
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
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      aliases: ((row.site_knowledge_entity_aliases ?? []) as Array<{ alias: string }>).map(
        (a) => a.alias,
      ),
    }
  })

  const conflicts = detectAliasConflicts(entities)
  if (conflicts.length > 0) {
    console.warn(
      `[semantic-entities] ${conflicts.length} conflit(s) d'alias détecté(s) :`,
      conflicts.map((c) => `"${c.alias}" → ${c.entities.map((e) => e.canonicalLabel).join(' vs ')}`).join(', '),
    )
  }

  const block = formatSemanticContextBlock(resolveEntities(entities))
  if (block) {
    console.log(`[semantic-entities] Bloc injecté (${block.length} chars) :\n${block}`)
  }

  return block
}
