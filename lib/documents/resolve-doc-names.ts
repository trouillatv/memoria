import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

// Helper centralisé pour résoudre les `[doc:UUID]` cités dans des
// fragments IA vers leurs noms de fichiers. Utilisé par toute surface
// qui affiche un fragment B1/B2 ou un fragment contenant une citation
// `[doc:id]` (briefing, aujourd'hui, interventions, mobile, etc.).
//
// Une seule requête SELECT batched IN par appel. Filtre les docs
// soft-deleted (un doc supprimé ne doit JAMAIS exposer son filename
// dans un lien — l'utilisateur cliquerait sur une 404).

const DOC_REF_RE = /\[doc:([0-9a-f-]{8,})\]/g

/** Extrait tous les UUID de docs cités dans une liste de fragments,
 *  puis résout en parallèle vers un map `{id → filename}` via SELECT.
 *
 *  - Filtre `deleted_at IS NULL` (pas de lien vers doc soft-deleted).
 *  - Retourne `{}` si aucun `[doc:UUID]` trouvé OU si la query échoue
 *    (toléré silencieusement : l'UI rend `↗` en fallback).
 *  - Accepte des entrées null/undefined (filtrées).
 */
export async function resolveDocNamesFromFragments(
  fragments: Array<string | null | undefined>,
): Promise<Record<string, string>> {
  const ids = new Set<string>()
  for (const f of fragments) {
    if (!f) continue
    const re = new RegExp(DOC_REF_RE.source, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(f)) !== null) ids.add(m[1])
  }
  if (ids.size === 0) return {}

  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('documents')
      .select('id, filename')
      .in('id', Array.from(ids))
      .is('deleted_at', null)
    const map: Record<string, string> = {}
    for (const d of (data ?? []) as Array<{ id: string; filename: string }>) {
      map[d.id] = d.filename
    }
    return map
  } catch {
    return {}
  }
}
