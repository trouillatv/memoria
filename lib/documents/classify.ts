// Classifieur documentaire — le cerveau du pipeline d'ingestion mémorielle.
// Vincent 2026-05-23. Cf. mémoire projet [[ingestion-memorielle-pipeline]].
//
// Couche PURE (sans server-only → testable + utilisable côté formulaire).
//
// Répond à LA question : « ce document nourrit-il la mémoire vivante ? » —
// PAS « peut-on faire un embedding ? ». Tous les documents ne méritent pas la
// mémoire active. On classe en 3 couches et on RECOMMANDE (l'humain valide,
// doctrine [[mémoire-assistee]]) ; rien d'automatique.
//
// Garde-fou doctrinal : un litige n'est JAMAIS embeddé/sourcé automatiquement
// ([[litige-no-automatic-reading]]) → embeddingRecommended = false, toujours.

/** Les 3 couches documentaires (cf. doctrine) :
 *  - vivante     : transformable en artefacts (à savoir, signaux) — le moat.
 *  - consultable : embeddings + recherche.
 *  - froide      : on stocke, pas de mémoire active. */
export type MemoryTier = 'vivante' | 'consultable' | 'froide'

export interface DocClassification {
  tier: MemoryTier
  /** Recommandation d'embedding (l'humain tranche). */
  embeddingRecommended: boolean
  /** Justification courte, affichable. */
  reason: string
}

// document_type (enum migration 073) → couche par défaut + embedding conseillé.
const BY_TYPE: Record<string, { tier: MemoryTier; embed: boolean; reason: string }> = {
  procedure: { tier: 'vivante', embed: true, reason: 'Procédure — mémoire opérationnelle' },
  protocole: { tier: 'vivante', embed: true, reason: 'Protocole — mémoire opérationnelle' },
  plan_acces: { tier: 'vivante', embed: true, reason: 'Plan d’accès — mémoire opérationnelle' },
  securite: { tier: 'vivante', embed: true, reason: 'Sécurité — mémoire sensible' },
  memoire_technique: { tier: 'vivante', embed: true, reason: 'Mémoire technique' },
  ao: { tier: 'consultable', embed: true, reason: 'AO — mémoire commerciale consultable' },
  contrat: { tier: 'consultable', embed: true, reason: 'Contrat — mémoire contractuelle' },
  avenant: { tier: 'consultable', embed: true, reason: 'Avenant — mémoire contractuelle' },
  reference: { tier: 'consultable', embed: true, reason: 'Référence — consultable' },
  litige: { tier: 'consultable', embed: false, reason: 'Litige — jamais embeddé automatiquement (doctrine)' },
  facture: { tier: 'froide', embed: false, reason: 'Facture — archive administrative' },
  preuve: { tier: 'froide', embed: false, reason: 'Preuve — artefact, pas mémoire recherchable' },
  autre: { tier: 'consultable', embed: false, reason: 'Type indéterminé — à trancher manuellement' },
}

// Indices forts dans le nom de fichier / texte (minuscule).
const FROID = /\b(facture|devis|bon de commande|rib|bulletin|paie|relev[ée]|avoir)\b/
const VIVANT = /\b(proc[ée]dure|consigne|protocole|acc[èe]s|badge|code|s[ée]curit[ée]|sas|incident|consignes?|à savoir)\b/

/** Pur & déterministe. `documentType` (enum) fait autorité ; le nom de fichier
 * et le texte ne font qu'affiner les cas indéterminés. */
export function classifyDocument(input: {
  documentType: string
  filename?: string
  text?: string
}): DocClassification {
  const base = BY_TYPE[input.documentType] ?? BY_TYPE.autre!
  // Le litige est verrouillé : jamais d'embedding auto, quel que soit le reste.
  if (input.documentType === 'litige') {
    return { tier: base.tier, embeddingRecommended: false, reason: base.reason }
  }

  // Affinage par mots-clés UNIQUEMENT pour les types peu engageants
  // (indéterminé / référence) — on ne contredit pas un type explicite fort.
  if (input.documentType === 'autre' || input.documentType === 'reference') {
    // Normalise les séparateurs (_ - . /) en espaces : sinon « facture_mars »
    // casse le \b (underscore = caractère de mot).
    const hay = `${input.filename ?? ''} ${input.text ?? ''}`.toLowerCase().replace(/[_\-./]+/g, ' ')
    if (FROID.test(hay)) {
      return { tier: 'froide', embeddingRecommended: false, reason: 'Indices administratifs — archive' }
    }
    if (VIVANT.test(hay)) {
      return { tier: 'vivante', embeddingRecommended: true, reason: 'Indices opérationnels (accès / consigne / sécurité)' }
    }
  }

  return { tier: base.tier, embeddingRecommended: base.embed, reason: base.reason }
}

// Indice LÉGER de type par nom de fichier (explicable, borné — pas d'« IA
// magique »). Premier motif qui matche gagne ; sinon 'autre'. L'humain corrige.
const TYPE_GUESS: Array<[RegExp, string]> = [
  [/\b(facture|devis|avoir)\b/, 'facture'],
  [/\b(cctp|ccap|\bao\b|appel.?d.?offres?)\b/, 'ao'],
  [/\b(proc[ée]dure|consigne)\b/, 'procedure'],
  [/\b(protocole)\b/, 'protocole'],
  [/\b(s[ée]curit[ée])\b/, 'securite'],
  [/\b(plan|acc[èe]s|badge)\b/, 'plan_acces'],
  [/\b(contrat)\b/, 'contrat'],
  [/\b(avenant)\b/, 'avenant'],
]

/** Devine un document_type depuis le nom de fichier (heuristique simple). */
export function guessDocumentType(filename: string): string {
  const hay = filename.toLowerCase().replace(/[_\-./]+/g, ' ')
  for (const [re, type] of TYPE_GUESS) {
    if (re.test(hay)) return type
  }
  return 'autre'
}

/** Libellé + teinte UI d'une couche (pour les badges de triage). */
export const TIER_META: Record<MemoryTier, { label: string; badge: string }> = {
  vivante: { label: 'Mémoire vivante', badge: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300' },
  consultable: { label: 'Consultable', badge: 'border-sky-300 bg-sky-50 text-sky-800 dark:bg-sky-950/30 dark:text-sky-300' },
  froide: { label: 'Archive froide', badge: 'border-slate-300 bg-slate-50 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300' },
}
