// lib/visits/caption-dictation.ts
// Fusion d'une légende de photo dictée avec une légende déjà existante — jamais
// d'écrasement silencieux (post-shutter puis triage doivent pouvoir s'enchaîner
// sur LA MÊME légende, cf. [[reportage-photo-cr-editorial-valide]]).

export function mergeCaption(existing: string | null | undefined, incoming: string): string {
  const prev = (existing ?? '').trim()
  const next = incoming.trim()
  if (!next) return prev
  if (!prev) return next
  return `${prev} ${next}`
}
