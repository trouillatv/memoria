'use server'

// Liste « À vérifier » d'une visite (mig 196) — server actions terrain.
// Trois décisions (Vérifié / À suivre / Sans objet), ajout manuel. La promotion
// d'un « à suivre » en objet chantier vit au débrief (debrief-actions).

import { z } from 'zod'
import { requireFieldAgent } from '@/lib/field/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { addWatchlistItem, setWatchlistItemState } from '@/lib/db/visit-watchlist'
import { buildWatchContext, type WatchContext, type WatchContextFacts } from '@/lib/visits/watchlist-context'
import type { DbVisitWatchlistItem } from '@/types/db'

const stateSchema = z.object({
  item_id: z.string().uuid(),
  state: z.enum(['pending', 'verified', 'to_follow', 'dismissed']),
  note: z.string().trim().max(500).optional(),
})

export async function setWatchlistItemStateAction(
  input: z.input<typeof stateSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = stateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  try {
    await setWatchlistItemState(parsed.data.item_id, parsed.data.state, parsed.data.note ?? undefined)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Échec' }
  }
}

// ── Profondeur du clic (revue 2026-07-12) ────────────────────────────────────
// Le contexte d'un point : pourquoi il apparaît, depuis quand, sa source réelle
// (réunion OU visite), le geste attendu. Tout vient de l'objet source
// (source_kind/source_ref) — rien d'inventé, zéro IA.

const contextSchema = z.object({ item_id: z.string().uuid() })

async function sourceLinkOf(
  supabase: ReturnType<typeof createAdminClient>,
  reportId: string | null,
): Promise<WatchContextFacts['source']> {
  if (!reportId) return null
  const { data } = await supabase
    .from('site_reports')
    .select('id, created_at, origin')
    .eq('id', reportId)
    .maybeSingle()
  const r = data as { id: string; created_at: string; origin: string | null } | null
  if (!r) return null
  return {
    id: r.id,
    kind: r.origin ? 'visite' : 'reunion',
    dateLabel: new Date(r.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Pacific/Noumea' }),
  }
}

export async function getWatchlistContextAction(
  input: z.input<typeof contextSchema>,
): Promise<{ ok: true; context: WatchContext } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = contextSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('visit_watchlist_item')
      .select('id, source_kind, source_ref')
      .eq('id', parsed.data.item_id)
      .maybeSingle()
    const item = data as { id: string; source_kind: string; source_ref: string | null } | null
    if (!item) return { ok: false, error: 'Point introuvable' }

    const facts: WatchContextFacts = { source_kind: item.source_kind }
    if (item.source_ref) {
      if (item.source_kind === 'reserve_open') {
        // site_reserve n'a PAS de report_id (mig 110) — pas de source inventée.
        const { data: r } = await supabase
          .from('site_reserve')
          .select('created_at, issued_on, location')
          .eq('id', item.source_ref)
          .maybeSingle()
        const res = r as { created_at: string; issued_on: string | null; location: string | null } | null
        if (res) {
          facts.sinceIso = res.issued_on ? `${res.issued_on}T00:00:00+11:00` : res.created_at
          facts.location = res.location
        }
      } else if (item.source_kind === 'action_overdue') {
        const { data: a } = await supabase
          .from('site_actions')
          .select('created_at, due_date, report_id')
          .eq('id', item.source_ref)
          .maybeSingle()
        const act = a as { created_at: string; due_date: string | null; report_id: string | null } | null
        if (act) {
          facts.sinceIso = act.created_at
          facts.dueIso = act.due_date
          facts.source = await sourceLinkOf(supabase, act.report_id)
        }
      } else if (item.source_kind === 'decision_unapplied') {
        const { data: dec } = await supabase
          .from('site_decisions')
          .select('created_at, date_decision, report_id')
          .eq('id', item.source_ref)
          .maybeSingle()
        const de = dec as { created_at: string; date_decision: string | null; report_id: string | null } | null
        if (de) {
          facts.sinceIso = de.date_decision ?? de.created_at
          facts.source = await sourceLinkOf(supabase, de.report_id)
        }
      }
      // proof_window_closing / obligation_neglected / manual : contexte statique
      // (le pourquoi et le geste suffisent — pas de fausse précision).
    }

    return { ok: true, context: buildWatchContext(facts, Date.now()) }
  } catch {
    return { ok: false, error: 'Échec du contexte' }
  }
}

const addSchema = z.object({
  report_id: z.string().uuid(),
  site_id: z.string().uuid(),
  label: z.string().trim().min(1).max(300),
})

export async function addWatchlistItemAction(
  input: z.input<typeof addSchema>,
): Promise<{ ok: true; item: DbVisitWatchlistItem } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = addSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  try {
    const item = await addWatchlistItem({
      reportId: parsed.data.report_id,
      siteId: parsed.data.site_id,
      label: parsed.data.label,
      createdBy: auth.userId,
    })
    return { ok: true, item }
  } catch {
    return { ok: false, error: 'Échec de l’ajout' }
  }
}
