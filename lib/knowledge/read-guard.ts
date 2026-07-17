import 'server-only'

// ── UNE ERREUR DE SCHÉMA N'EST PAS UN RÉSULTAT VIDE ───────────────────────────
// « Un schéma incorrect peut produire un écran vide parfaitement "valide". »
// (Vincent, 2026-07-17)
//
// C'est arrivé. Un read model filtrait `site_actions` sur `deleted_at` — une
// colonne QUI N'EXISTE PAS. PostgREST refusait la requête, le `.catch(() => [])`
// avalait l'erreur, et le compte-rendu affichait « 0 action validée » pour
// toujours. Typecheck vert, tests verts, écran faux.
//
// La règle : un fallback est légitime pour une erreur ATTENDUE et récupérable
// (le réseau, une table pas encore migrée). Il ne l'est jamais pour une erreur de
// SCHÉMA — celle-là dit que le code et la base ne parlent plus la même langue, et
// aucun affichage n'est correct tant qu'elle dure.
//
// En développement et dans les tests : on lève. En production : on journalise
// avec la table et le read model, et on rend le vide — un écran incomplet vaut
// mieux qu'une page morte, mais il ne doit pas être silencieux.

/** Vrai en dev et sous test : le bug doit faire du bruit là où on le corrige. */
function shouldThrow(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.VITEST === 'true'
}

/**
 * Une erreur qui dit que le CODE et la BASE divergent — colonne inconnue,
 * relation absente, type incompatible. Les codes PostgREST/Postgres :
 *   42703 undefined_column · 42P01 undefined_table · 42883 undefined_function
 *   PGRST200/PGRST204 : colonne ou relation introuvable dans le cache de schéma.
 */
function isSchemaError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  const code = error.code ?? ''
  if (['42703', '42P01', '42883', 'PGRST200', 'PGRST204'].includes(code)) return true
  return /does not exist|could not find|unknown column/i.test(error.message ?? '')
}

/**
 * Déballe une réponse Supabase en refusant le silence.
 *
 * @param table   la table lue — pour que le message dise OÙ chercher.
 * @param model   le read model appelant — pour que le message dise QUI a menti.
 */
export function unwrap<T>(
  table: string,
  model: string,
  res: { data: T[] | null; error: { code?: string; message?: string } | null },
): T[] {
  if (res.error) {
    const where = `${model} → ${table}`
    if (isSchemaError(res.error)) {
      const msg = `[schéma] ${where} : ${res.error.message}. Le code et la base divergent — ce read model rendrait un vide FAUX.`
      // En dev/test on lève : c'est là qu'on corrige. En prod on crie dans les
      // logs plutôt que de tuer la page, mais on ne se tait jamais.
      if (shouldThrow()) throw new Error(msg)
      console.error(msg)
      return []
    }
    // Erreur attendue/récupérable (réseau, indisponibilité) : le vide est un
    // résultat acceptable, mais il reste tracé.
    console.warn(`[lecture] ${where} : ${res.error.message}`)
    return []
  }
  return res.data ?? []
}
