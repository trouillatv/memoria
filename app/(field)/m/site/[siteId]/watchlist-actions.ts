'use server'

// Liste « À vérifier » d'une visite (mig 196) — server actions terrain.
// Trois décisions (Vérifié / À suivre / Sans objet), ajout manuel. La promotion
// d'un « à suivre » en objet chantier vit au débrief (debrief-actions).

import { z } from 'zod'
import { requireFieldAgent } from '@/lib/field/auth'
import { addWatchlistItem, setWatchlistItemState } from '@/lib/db/visit-watchlist'
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
