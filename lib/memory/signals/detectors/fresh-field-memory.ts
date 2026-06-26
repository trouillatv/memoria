// Détecteur fresh_field_memory — enveloppe DB (server-only).

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import type { MemorySignal } from '../types'
import {
  buildFreshFieldMemorySignals,
  FRESH_WINDOW_DAYS,
  type FieldNoteInput,
} from './fresh-field-memory.logic'

function pickOne<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null
  return Array.isArray(v) ? (v[0] as T) ?? null : v
}

export async function detectFreshFieldMemory(): Promise<MemorySignal[]> {
  const sb = createAdminClient()
  const orgId = await getOrgId().catch(() => null)
  if (!orgId) return []
  const sinceIso = new Date(Date.now() - FRESH_WINDOW_DAYS * 86_400_000).toISOString()

  const { data } = await sb
    .from('site_notes')
    .select('id, site_id, created_at, kind, site:sites!inner(id, name, deleted_at)')
    .eq('organization_id', orgId)
    .eq('kind', 'a_savoir')
    .is('deleted_at', null)
    .gte('created_at', sinceIso)

  type Row = {
    id: string
    created_at: string
    site: { id: string; name: string; deleted_at: string | null } | { id: string; name: string; deleted_at: string | null }[] | null
  }

  const notes: FieldNoteInput[] = []
  for (const r of (data ?? []) as Row[]) {
    const site = pickOne(r.site)
    if (!site?.id || !site.name || site.deleted_at) continue
    notes.push({ id: r.id, siteId: site.id, siteName: site.name, createdAt: r.created_at })
  }

  return buildFreshFieldMemorySignals(notes, Date.now())
}
