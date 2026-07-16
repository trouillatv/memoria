import 'server-only'

// ── RÉINITIALISATION DU CHANTIER DE RECETTE ──────────────────────────────────
// La seule fonction du produit qui supprime en masse. Elle est donc écrite pour
// être INCAPABLE de faire des dégâts, pas seulement pour éviter d'en faire :
//
//   1. Elle relit le chantier en base et exige `is_sandbox = true`. Le drapeau
//      n'est jamais un paramètre — l'appelant ne peut pas le prétendre.
//   2. Elle exige l'organisation de l'appelant (le service-role bypasse la RLS :
//      sans ce contrôle, un id suffirait à vider le bac à sable d'un autre tenant).
//   3. Elle refuse par défaut. Toute incertitude = on ne supprime rien.
//
// Un chantier client ne peut donc pas être réinitialisé, même en forçant son id
// dans la requête : il faudrait d'abord le marquer bac à sable en base, ce
// qu'aucun écran ne permet.

import { createAdminClient } from '@/lib/supabase/admin'
import { invalidateSiteProjection } from '@/lib/knowledge/invalidate'

export interface SandboxResetResult {
  visites: number
  actions: number
  propositions: number
  reserves: number
  notes: number
}

/** Vrai UNIQUEMENT si ce chantier est un bac à sable de CETTE organisation. */
export async function isSandboxSite(siteId: string, orgId: string | null): Promise<boolean> {
  const { data } = await createAdminClient()
    .from('sites')
    .select('id, is_sandbox, organization_id')
    .eq('id', siteId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!data) return false
  const s = data as { is_sandbox: boolean | null; organization_id: string | null }
  if (!s.is_sandbox) return false
  // Fail-closed : org inconnue ou différente → non.
  if (!orgId || !s.organization_id || s.organization_id !== orgId) return false
  return true
}

/**
 * Vide le chantier de recette. Renvoie `null` si le chantier n'est PAS un bac à
 * sable de l'organisation appelante — on ne supprime alors rien du tout.
 */
export async function resetSandboxSite(siteId: string, orgId: string | null): Promise<SandboxResetResult | null> {
  if (!(await isSandboxSite(siteId, orgId))) return null

  const db = createAdminClient()

  const countOf = async (table: string): Promise<number> => {
    const { count } = await db.from(table).select('id', { count: 'exact', head: true }).eq('site_id', siteId)
    return count ?? 0
  }
  const [visites, actions, propositions, reserves, notes] = await Promise.all([
    countOf('site_reports'),
    countOf('site_actions'),
    countOf('site_knowledge_proposals'),
    countOf('site_reserve'),
    countOf('site_notes'),
  ])

  // Ordre : les enfants d'abord. Les propositions et les actions référencent le
  // rapport ; les supprimer après lui laisserait des lignes orphelines si une FK
  // n'est pas en cascade.
  for (const table of ['site_knowledge_proposals', 'site_actions', 'site_reserve', 'site_notes']) {
    const { error } = await db.from(table).delete().eq('site_id', siteId)
    if (error) throw new Error(`${table} : ${error.message}`)
  }
  const { error: repErr } = await db.from('site_reports').delete().eq('site_id', siteId)
  if (repErr) throw new Error(`site_reports : ${repErr.message}`)

  // Les écrans lisent une projection en cache : sans ça, le chantier resterait
  // « plein » à l'écran alors que la base est vide (c'est la mutation qui invalide).
  invalidateSiteProjection(siteId)

  return { visites, actions, propositions, reserves, notes }
}
