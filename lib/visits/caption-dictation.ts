// lib/visits/caption-dictation.ts
// Fusion d'une légende de photo dictée avec une légende déjà existante — jamais
// d'écrasement silencieux (post-shutter puis triage doivent pouvoir s'enchaîner
// sur LA MÊME légende, cf. [[reportage-photo-cr-editorial-valide]]).
//
// Garde anti-doublon (bug terrain Vincent 2026-08-26 : « Il s'agit d'une
// chaise. Il s'agit d'une chaise. ») — l'attache (post-shutter, réseau terrain
// avec retry, double-tap) peut livrer deux fois LA MÊME phrase pour LA MÊME
// capture ; mergeCaption est le seul point commun aux deux appelants, donc le
// seul endroit où bloquer le doublon sans connaître sa cause exacte.

function normalizeForComparison(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!?]+$/, '')
}

function lastSentence(s: string): string {
  const parts = s.split(/(?<=[.!?])\s+/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : s
}

// `next` redit exactement la légende entière, ou sa dernière phrase — jamais un
// simple recoupement partiel (« chaise » seul ne doit pas bloquer un ajout
// légitime qui se termine aussi par ce mot).
function isDuplicateAppend(prev: string, next: string): boolean {
  const normalizedNext = normalizeForComparison(next)
  if (!normalizedNext) return false
  if (normalizeForComparison(prev) === normalizedNext) return true
  return normalizeForComparison(lastSentence(prev)) === normalizedNext
}

export function mergeCaption(existing: string | null | undefined, incoming: string): string {
  const prev = (existing ?? '').trim()
  const next = incoming.trim()
  if (!next) return prev
  if (!prev) return next
  if (isDuplicateAppend(prev, next)) return prev
  return `${prev} ${next}`
}
