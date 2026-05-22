// Moteur d'états de mémoire (« Temps 2 ») — grammaire.
//
// Vincent 2026-05-22. Cf. mémoire projet [[etats-fragiles-moteur-surfacage]].
//
// Un MemorySignal = un ÉTAT OBSERVÉ de la mémoire portée par un lieu ou une
// équipe. Explicable, falsifiable, ÉPHÉMÈRE (jamais persisté comme vérité —
// recalculé à chaque lecture).
//
// VERROUS encodés dans le type (doctrine dans le type system) :
//   - subjectType n'a PAS 'person' → impossible de coder un score humain.
//   - PAS d'`intensity`/`score` → pas de hiérarchie figée (= score caché).
//   - PAS de `text` → le signal est SÉMANTIQUE ; la phrase naît au renderer.
//   - `facts` = données structurées ; `evidence` = pourquoi (auditabilité).

/** Sujet d'un signal : un lieu ou une équipe PORTEUR de mémoire. Jamais une personne. */
export type SubjectType = 'site' | 'team'

/**
 * Catégorie d'état (PAS un score). On n'ajoute un kind QUE quand son détecteur
 * + son renderer + son entrée registre existent (cf. tripwire). Pas de kind
 * orphelin.
 */
export type SignalKind =
  | 'handover_acknowledged'
  | 'fresh_field_memory'
  | 'memory_awaiting'
  | 'unusual_silence'

/** Ce que le système AFFIRME : déterministe vs supposé. Extensible ('llm' au Batch 3). */
export type Confidence = 'certain' | 'heuristic'

export interface MemorySignal {
  kind: SignalKind
  subjectType: SubjectType
  subjectId: string
  /** Libellé du sujet (identité, pas du rendu) — ex. nom du site. */
  subjectLabel: string

  /** Faits structurés. JAMAIS une phrase, JAMAIS une intensité. */
  facts: Record<string, number | string | boolean>

  confidence: Confidence

  /** Quand le moteur a observé l'état. */
  detectedAt: string
  /**
   * L'événement réel concerné — ou, pour un silence, la dernière trace connue
   * (le sens devient « depuis quand RIEN »). null si non applicable.
   */
  lastRelevantEventAt: string | null

  /** Auditabilité : la règle qui a produit le signal + preuves (ids). */
  evidence: { rule: string; refs?: string[] }
}
