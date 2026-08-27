// P1-C1b (workflow) — détection déterministe du RÔLE d'un acteur cité dans le texte d'un
// fait métier, pour créer les liens occurrence ↔ acteur (canonical_subject_occurrence_actor_link).
//
// Doctrine : l'acteur est une entité LIÉE au fait daté avec un rôle, jamais le sujet, jamais
// une responsabilité future. Aucun LLM. Pur : testable hors runtime serveur.
//
// Détection :
//   - un acteur est « cité » si son libellé OU un de ses alias apparaît comme PHRASE CONTIGUË
//     bornée par des limites de mot dans le texte normalisé (label + aliases normalisés,
//     frontières lexicales, pas de sous-chaîne accidentelle) ;
//   - le RÔLE se lit dans les mots qui précèdent immédiatement la mention (même fait) :
//       proposed_by    « proposition de X », « proposé par X »
//       validated_with « validation … avec X », « décision … avec la X »
//       performed_by   « réalisé/contrôlé/effectué/vérifié/récupéré … par X »
//       mentioned      défaut prudent si aucun indice de rôle explicite.
// « Ne pas forcer un type que le texte ne démontre pas » → mentioned plutôt qu'inventé.

export function normalizeForCitation(text: string): string {
  const n = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return ` ${n} `
}

export interface ActorSubject {
  id: string
  label: string
  aliases?: string[] | null
}

export type ActorRelationType = 'performed_by' | 'proposed_by' | 'validated_with' | 'mentioned'

export interface ActorRelation {
  actorId: string
  relationType: ActorRelationType
  matchedName: string
  evidenceCue: string | null
}

const MIN_SINGLE_TOKEN_LEN = 3
const CUE_WINDOW = 60

// Radicaux d'action (préfixes) marquant une exécution : « réalisé/contrôlé/… par X ».
const PERFORMED_STEMS =
  /(realis|control|effectu|verifi|recuper|assur|entretien|pomp|nettoy|restitu|inspect|remplac|install|pos|maintenu|repar|vidang|test)/

// Classe le rôle d'après la fenêtre AMONT (texte normalisé précédant la mention).
function classifyRelation(before: string): { type: ActorRelationType; cue: string | null } {
  if (/(proposition de|propose par|proposee par)\s*$/.test(before)) return { type: 'proposed_by', cue: 'proposition' }
  if (/(validation|valide avec|validee|decision|avec la|avec le|avec l)\s*$/.test(before)) return { type: 'validated_with', cue: 'validation' }
  if (/\bpar\s*$/.test(before) && PERFORMED_STEMS.test(before)) return { type: 'performed_by', cue: 'par' }
  return { type: 'mentioned', cue: null }
}

/**
 * Détecte les acteurs cités dans le texte d'un fait et leur rôle.
 * `texts` : fragments (labels + descriptions des propositions de l'occurrence).
 * Déterministe, idempotent, sans effet de bord. Un acteur seulement présent AILLEURS dans
 * le PV mais absent de CE texte n'est jamais lié (le texte passé est celui du fait).
 */
export function detectActorRelations(
  texts: Array<string | null | undefined>,
  actors: ActorSubject[],
): ActorRelation[] {
  const haystack = normalizeForCitation(texts.filter(Boolean).join(' '))
  if (haystack.trim().length === 0) return []

  const out = new Map<string, ActorRelation>() // clé actorId : garde le rôle le plus fort trouvé
  const rank: Record<ActorRelationType, number> = { performed_by: 3, proposed_by: 3, validated_with: 3, mentioned: 1 }

  for (const actor of actors) {
    const names = [actor.label, ...(actor.aliases ?? [])]
    for (const name of names) {
      const needle = normalizeForCitation(name).trim()
      if (needle.length === 0) continue
      const toks = needle.split(' ')
      if (toks.length === 1 && toks[0].length < MIN_SINGLE_TOKEN_LEN) continue

      const marker = ` ${needle} `
      const idx = haystack.indexOf(marker)
      if (idx === -1) continue

      const before = haystack.slice(Math.max(0, idx - CUE_WINDOW), idx + 1) // inclut l'espace avant
      const { type, cue } = classifyRelation(before)
      const prev = out.get(actor.id)
      if (!prev || rank[type] > rank[prev.relationType]) {
        out.set(actor.id, { actorId: actor.id, relationType: type, matchedName: name, evidenceCue: cue })
      }
    }
  }
  return [...out.values()]
}
