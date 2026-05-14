// V5.1 Slice 5 — Wording verrouillé pour l'Atelier mémoire / Résonances.
//
// Doctrine Vincent 2026-05-14 :
//   - L'IA peut SÉLECTIONNER dans ce que les humains ont déposé. Elle ne peut
//     JAMAIS ajouter un mot dans ce qui sera signé par un humain.
//   - 3 verbes autorisés en surface : voici / fait écho-se ressemblent /
//     persiste-cesse.
//   - Aucun jugement, aucune dramatisation, aucune félicitation.
//
// Cette liste est testée automatiquement en CI (tests/doctrine/forbidden-ai-words.test.ts)
// sur tout texte généré par l'Atelier mémoire.

export const FORBIDDEN_AI_WORDS = [
  // Jugements de valeur
  'important',
  'importante',
  'majeur',
  'majeure',
  'critique',
  'essentiel',
  'essentielle',
  'remarquable',
  'intéressant',
  'intéressante',
  // Injonctions
  'il faudrait',
  'vous devriez',
  'tu devrais',
  'à surveiller',
  'à noter',
  // Métriques exposées
  'score',
  'pertinence',
  'pourcentage',
  // Recommandations
  'recommandé',
  'recommande',
  'suggéré',
  'conseillé',
  // Dramatisation / félicitation
  'félicitations',
  'bravo',
  'parfait',
  'excellent',
  'extraordinaire',
  // Note : 'note' et 'attention' retirés car trop polysémiques (note = papier,
  // attention = vigilance). Les expressions "à noter" et "à surveiller" suffisent
  // à capter l'injonction. Si une dérive "donnez une note" apparaît, on l'ajoutera
  // sous forme plus stricte (regex "donn\w+ une note").
] as const

/**
 * Détecte si un texte contient un mot interdit. Insensible à la casse,
 * insensible aux accents (approximation simple : on compare en lowercase
 * et on prend en compte les variations courantes).
 *
 * Retourne le premier mot trouvé, ou null si conforme.
 */
export function findForbiddenWord(text: string): string | null {
  const normalized = text.toLowerCase()
  for (const w of FORBIDDEN_AI_WORDS) {
    if (normalized.includes(w)) {
      return w
    }
  }
  return null
}

/**
 * Throws si le texte contient un mot interdit. À utiliser dans les helpers
 * IA avant de retourner un texte à l'UI.
 */
export function assertCleanAiText(text: string, context: string): void {
  const violation = findForbiddenWord(text)
  if (violation) {
    throw new Error(
      `[AI wording violation] Mot interdit "${violation}" dans le texte généré (contexte: ${context}). ` +
      `Cf. lib/ai/forbidden-words.ts.`
    )
  }
}
