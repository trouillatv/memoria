// FERMETURES de site (mig 197, PL2) — « ce lieu est fermé du X au Y ».
//
// Donnée de LIEU, jamais d'humain. Cette couche ne fait qu'écrire et lire :
// le calcul (« ce jour est-il fermé, et pourquoi ? ») vit dans
// lib/planning/closures.ts, pur et testé.
//
// Pas d'`organization_id` sur la table (décision Vincent 2026-07-13) : le site
// porte déjà l'organisation ; la dupliquer la ferait diverger un jour. La garde
// d'appartenance passe donc par le SITE parent, dans la server action.

import { createAdminClient } from '@/lib/supabase/admin'
import type {
  ClosureReasonKind,
  ClosureResolution,
  ProjectableClosure,
} from '@/lib/planning/closures'

export interface SiteClosure extends ProjectableClosure {
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

const SELECT =
  'id, site_id, reason_kind, reason, starts_on, ends_on, default_resolution, created_by, created_at, updated_at'

const REASON_KINDS: readonly string[] = [
  'holiday', 'client', 'maintenance', 'inventory', 'exceptional', 'other',
]
const RESOLUTIONS: readonly string[] = ['none', 'move', 'cancel', 'keep']

function rowToClosure(r: Record<string, unknown>): SiteClosure {
  const kind = r.reason_kind as string
  const resolution = r.default_resolution as string
  return {
    id: r.id as string,
    siteId: r.site_id as string,
    reasonKind: (REASON_KINDS.includes(kind) ? kind : 'other') as ClosureReasonKind,
    reason: (r.reason as string | null) ?? null,
    startsOn: (r.starts_on as string) ?? '',
    endsOn: (r.ends_on as string) ?? '',
    defaultResolution: (RESOLUTIONS.includes(resolution) ? resolution : 'none') as ClosureResolution,
    createdBy: (r.created_by as string | null) ?? null,
    createdAt: (r.created_at as string) ?? '',
    updatedAt: (r.updated_at as string) ?? '',
  }
}

/** Dégradation gracieuse tant que la migration 197 n'est pas appliquée : la
 *  fiche chantier affiche « aucune fermeture » au lieu de planter. */
function isMissingTable(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? ''
  const msg = error.message ?? ''
  return code === '42P01' || msg.includes('site_closures')
}

/** Fermetures ACTIVES d'un site, les plus récentes d'abord. Les fermetures
 *  retirées ne sortent jamais d'ici (le moteur de calcul ne voit que l'actif). */
export async function listClosuresBySite(siteId: string): Promise<SiteClosure[]> {
  const { data, error } = await createAdminClient()
    .from('site_closures')
    .select(SELECT)
    .eq('site_id', siteId)
    .is('deleted_at', null)
    .order('starts_on', { ascending: false })
  if (error) {
    if (isMissingTable(error)) return []
    throw new Error(error.message)
  }
  return (data ?? []).map(rowToClosure)
}

/** Une fermeture par id (garde d'appartenance : l'appelant vérifie le SITE). */
export async function getClosure(id: string): Promise<SiteClosure | null> {
  const { data, error } = await createAdminClient()
    .from('site_closures')
    .select(SELECT)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) {
    if (isMissingTable(error)) return null
    throw new Error(error.message)
  }
  return data ? rowToClosure(data as Record<string, unknown>) : null
}

export interface CreateClosureInput {
  siteId: string
  reasonKind: ClosureReasonKind
  reason?: string | null
  startsOn: string
  endsOn: string
  createdBy: string | null
}

export async function createSiteClosure(input: CreateClosureInput): Promise<string> {
  const { data, error } = await createAdminClient()
    .from('site_closures')
    .insert({
      site_id: input.siteId,
      reason_kind: input.reasonKind,
      reason: input.reason ?? null,
      starts_on: input.startsOn,
      ends_on: input.endsOn,
      created_by: input.createdBy,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'Création impossible')
  return (data as { id: string }).id
}

export interface UpdateClosureInput {
  reasonKind?: ClosureReasonKind
  reason?: string | null
  startsOn?: string
  endsOn?: string
  updatedBy: string | null
}

/** Corriger une fermeture (dates, raison, motif) — on trace QUI, pas seulement quand. */
export async function updateSiteClosure(id: string, patch: UpdateClosureInput): Promise<void> {
  const { error } = await createAdminClient()
    .from('site_closures')
    .update({
      ...(patch.reasonKind !== undefined ? { reason_kind: patch.reasonKind } : {}),
      ...(patch.reason !== undefined ? { reason: patch.reason } : {}),
      ...(patch.startsOn !== undefined ? { starts_on: patch.startsOn } : {}),
      ...(patch.endsOn !== undefined ? { ends_on: patch.endsOn } : {}),
      updated_by: patch.updatedBy,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .is('deleted_at', null)
  if (error) throw new Error(error.message)
}

/** RETIRER une fermeture (doctrine audit/03 : jamais de suppression visible). */
export async function softDeleteSiteClosure(id: string): Promise<void> {
  const { error } = await createAdminClient()
    .from('site_closures')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)
  if (error) throw new Error(error.message)
}
