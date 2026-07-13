// P1 isolation multi-tenant (2026-07-13) — point d'entrée UNIQUE pour les
// requêtes service-role scopées organisation.
//
// Pourquoi : createAdminClient() bypasse la RLS. Chaque requête « à la main »
// doit donc penser à .eq('organization_id', …) ET au cas orgId null — deux
// oublis possibles, et l'audit a montré qu'ils arrivent. Ce module rend
// l'oubli difficile : on obtient d'abord un contexte tenant (fail-closed),
// puis des requêtes déjà filtrées.
//
// Règle : toute NOUVELLE liste user-facing sur une surface tenant passe par
// ici. Les deux seules exceptions à l'isolation restent la console plateforme
// /admin/* (rôle 'admin' = super-admin) et les bibliothèques système
// (organization_id NULL, partagées PAR CONCEPTION, jamais le contenu d'un
// autre tenant).
//
// Usage type :
//   const ctx = await tenantCtx()
//   if (!ctx) return []                       // FAIL-CLOSED : pas d'org → rien
//   const { data } = await tenantSelect(ctx, 'teams', '*')
//     .is('deleted_at', null)
//     .order('name', { ascending: true })

import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'

export interface TenantCtx {
  db: SupabaseClient
  orgId: string
}

/**
 * Contexte tenant de l'utilisateur courant, ou null (pas de session / pas
 * d'organisation). L'appelant DOIT traiter null en renvoyant sa valeur vide —
 * jamais en élargissant la requête.
 */
export async function tenantCtx(): Promise<TenantCtx | null> {
  const orgId = await getOrgId()
  if (!orgId) return null
  return { db: createAdminClient(), orgId }
}

/**
 * SELECT service-role déjà filtré sur l'organisation du contexte.
 * Chaînable comme un select Supabase normal (.is / .eq / .order / .limit…).
 */
export function tenantSelect(ctx: TenantCtx, table: string, columns: string) {
  return ctx.db.from(table).select(columns).eq('organization_id', ctx.orgId)
}

/**
 * COUNT service-role déjà filtré sur l'organisation (head: true — pas de
 * lignes, juste le compte). Les compteurs sont l'endroit classique où les
 * fuites restent : celui-ci ne peut pas en être une.
 */
export function tenantCount(ctx: TenantCtx, table: string) {
  return ctx.db
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', ctx.orgId)
}

/**
 * Vérifie qu'un objet référencé par id appartient bien à l'organisation du
 * contexte (garde anti-IDOR pour les pages /xxx/[id] et les exports).
 * Renvoie false si l'objet n'existe pas, est soft-deleted ou vient d'un
 * autre tenant — l'appelant fait alors notFound()/403, jamais de fallback.
 */
export async function tenantOwns(
  ctx: TenantCtx,
  table: string,
  id: string
): Promise<boolean> {
  const { data, error } = await ctx.db
    .from(table)
    .select('id')
    .eq('id', id)
    .eq('organization_id', ctx.orgId)
    .maybeSingle()
  if (error) return false
  return !!data
}
