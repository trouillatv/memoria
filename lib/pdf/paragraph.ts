// Contexte d'un extrait dans le document (Vincent 2026-06-22). DÉTERMINISTE, zéro IA :
// on localise l'extrait verbatim dans le texte extrait et on remonte le paragraphe
// autour. « Le cerveau humain comprend un paragraphe, pas une phrase sortie du contexte. »
// Le PDF devient vérification, pas lecture.

/** Paragraphe autour de l'extrait (texte nettoyé des marqueurs [[page N]]). null si introuvable. */
export function paragraphAround(fullText: string | null | undefined, excerpt: string | null | undefined, window = 360): string | null {
  if (!fullText || !excerpt) return null
  const clean = fullText.replace(/\[\[page \d+\]\]/g, ' ').replace(/\s+/g, ' ').trim()
  const ex = excerpt.replace(/\s+/g, ' ').trim()
  if (clean.length === 0 || ex.length < 5) return null
  // Normalisation 1:1 (longueur préservée → l'index reste valide sur `clean`) :
  // apostrophes/guillemets typographiques + casse. Améliore le taux de localisation.
  const canon = (s: string) => s.replace(/[’‘`]/g, "'").replace(/[“”]/g, '"').toLowerCase()
  const idx = canon(clean).indexOf(canon(ex))
  if (idx < 0) return null
  const start = Math.max(0, idx - window)
  const end = Math.min(clean.length, idx + ex.length + window)
  let p = clean.slice(start, end).trim()
  if (start > 0) p = '… ' + p
  if (end < clean.length) p = p + ' …'
  // N'a d'intérêt que si ça apporte du contexte au-delà de l'extrait lui-même.
  return p.length > ex.length + 20 ? p : null
}
