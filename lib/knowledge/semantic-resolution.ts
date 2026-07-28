// Résolution post-LLM — Lot 1B.
//
// PIPELINE : Audio → Transcription → Injection sémantique → LLM → [ce module] → Résultat qualifié
//
// Rôle : qualifier chaque entité brute extraite par le LLM (intervenants, owners)
// en la confrontant à la mémoire sémantique connue.
//
// INVARIANTS :
//   - Aucune correction silencieuse : si la résolution est incertaine, needs_resolution = true.
//   - Déterminisme : mêmes entrées → mêmes sorties.
//   - Pas de création automatique : les nouveaux candidats sont remontés, pas inscrits.
//   - Mémoire vide = comportement identique à l'absence du module.
//
// ÉTATS DE RÉSOLUTION :
//   resolved  → alias ou canonical exact trouvé ; source = semantic_memory ou canonical_name.
//   ambiguous → réservé Lot 2 (matching partiel / plusieurs candidats plausibles).
//   unknown   → aucune correspondance ; le texte brut est remonté comme candidat.
//
// POINTS D'ENTRÉE dans la synthèse :
//   parsed.intervenants[]             — liste brute de personnes / entreprises citées
//   parsed.suggested_actions[].owner  — responsable d'une action
//   parsed.important_points[].owner   — responsable d'un point de vigilance

import { normalizeAlias, loadKnowledgeEntities, type KnowledgeEntity } from './semantic-entities'

export type EntityResolutionStatus = 'resolved' | 'ambiguous' | 'unknown'
export type EntityResolutionSource = 'semantic_memory' | 'canonical_name' | 'llm_only'

export interface EntityResolution {
  /** État de la résolution. */
  status: EntityResolutionStatus
  /** Comment la résolution a été obtenue. */
  source: EntityResolutionSource
  /** Identifiant de l'entité résolue (défini si status = 'resolved'). */
  entityId?: string
  /** Texte brut qui a matché (tel que produit par le LLM, après trim). */
  matchedAlias?: string
  /** Label canonique de l'entité résolue. */
  canonical?: string
  /** true = le système ne peut pas résoudre seul ; intervention humaine attendue. */
  needs_resolution: boolean
}

/** Champ source d'une occurrence d'entité dans la synthèse LLM. */
export type OccurrenceField = 'intervenant' | 'action_owner' | 'watchpoint_owner'

/** Une occurrence d'entité brute avec sa localisation dans la synthèse. */
export interface SemanticOccurrence {
  rawText: string
  field: OccurrenceField
  index: number
}

export interface DebriefSemanticMemory {
  /** rawText (trim) → résolution ; une entrée par texte unique extrait par le LLM. */
  resolutions: Record<string, EntityResolution>
  /** Textes non résolus, dédupliqués. Candidats à ajouter à la mémoire (Lot 2). */
  new_candidates: string[]
  /** Toutes les occurrences avec leur localisation (champ + index). */
  occurrences: SemanticOccurrence[]
  /** Candidats explicitement ignorés par l'utilisateur (Lot 1C). */
  ignored_candidates?: string[]
}

const SCOPE_PRIORITY: Record<string, number> = { user: 3, site: 2, org: 1 }

// Résout un texte brut contre la liste d'entités connues (scope-prioritized).
// Correspondance exacte sur alias_norm ou label canonique normalisé.
// Pas de matching partiel en Lot 1B : la résolution est soit certaine, soit absente.
export function resolveRawText(rawText: string, entities: KnowledgeEntity[]): EntityResolution {
  const norm = normalizeAlias(rawText)
  if (!norm) return { status: 'unknown', source: 'llm_only', needs_resolution: false }

  const active = entities.filter((e) => e.isActive)
  const byPriority = [...active].sort(
    (a, b) => (SCOPE_PRIORITY[b.scope] ?? 0) - (SCOPE_PRIORITY[a.scope] ?? 0),
  )

  // Correspondance exacte sur alias (scope-prioritized — même logique que resolveEntities)
  for (const entity of byPriority) {
    if (entity.aliases.some((a) => normalizeAlias(a) === norm)) {
      return {
        status: 'resolved',
        source: 'semantic_memory',
        entityId: entity.id,
        matchedAlias: rawText.trim(),
        canonical: entity.canonicalLabel,
        needs_resolution: false,
      }
    }
  }

  // Correspondance exacte sur le label canonique (le LLM a produit directement la forme canonique)
  for (const entity of byPriority) {
    if (normalizeAlias(entity.canonicalLabel) === norm) {
      return {
        status: 'resolved',
        source: 'canonical_name',
        entityId: entity.id,
        matchedAlias: rawText.trim(),
        canonical: entity.canonicalLabel,
        needs_resolution: false,
      }
    }
  }

  return { status: 'unknown', source: 'llm_only', needs_resolution: true }
}

// Résout une liste de textes bruts dédupliqués contre les entités connues.
// Produit le registre de résolutions et la liste des candidats non résolus.
export function resolveRawTexts(
  rawTexts: string[],
  entities: KnowledgeEntity[],
): DebriefSemanticMemory {
  const resolutions: Record<string, EntityResolution> = {}
  const newCandidates: string[] = []
  const seen = new Set<string>()

  for (const text of rawTexts) {
    const trimmed = text.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)

    const resolution = resolveRawText(trimmed, entities)
    resolutions[trimmed] = resolution
    if (resolution.status !== 'resolved') newCandidates.push(trimmed)
  }

  return { resolutions, new_candidates: newCandidates, occurrences: [] }
}

// Charge les entités du contexte et résout les occurrences extraites par le LLM.
// À appeler après l'appel LLM, avant la persistance de la synthèse.
// Retourne une mémoire vide si aucune occurrence n'est fournie.
export async function buildDebriefSemanticMemory(
  rawOccurrences: SemanticOccurrence[],
  siteId: string,
  orgId: string,
  userId?: string,
): Promise<DebriefSemanticMemory> {
  const nonEmpty = rawOccurrences.filter((o) => o.rawText.trim())
  if (nonEmpty.length === 0) return { resolutions: {}, new_candidates: [], occurrences: [] }

  const entities = await loadKnowledgeEntities(siteId, orgId, userId)
  const uniqueTexts = [...new Set(nonEmpty.map((o) => o.rawText.trim()))]
  const { resolutions, new_candidates } = resolveRawTexts(uniqueTexts, entities)
  const occurrences = nonEmpty.map((o) => ({ ...o, rawText: o.rawText.trim() }))

  const resolvedCount = Object.values(resolutions).filter((r) => r.status === 'resolved').length
  console.log(
    `[semantic-resolution] ${resolvedCount}/${uniqueTexts.length} entité(s) résolue(s)` +
      (new_candidates.length > 0
        ? ` — ${new_candidates.length} candidat(s) : ${new_candidates.join(', ')}`
        : ''),
  )

  return { resolutions, new_candidates, occurrences }
}
