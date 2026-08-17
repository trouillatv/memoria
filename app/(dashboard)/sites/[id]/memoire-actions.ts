'use server'

// P5-F2a — geste humain explicite sur une information de la Mémoire.
//
// `requireSiteAccess` (membership seul, sans contrôle de rôle) — même gravité
// que la création d'un FACT Copilote (createCopilotFact) : archiver une
// information n'est pas plus sensible que la confirmer.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireSiteAccess } from '@/lib/auth/resource-access'
import { createAdminClient } from '@/lib/supabase/admin'
import { archiveKnowledgeEntry } from '@/lib/db/site-memory-entries'

type ActionResult = { ok: true } | { error: string }

const archiveSchema = z.object({
  siteId: z.string().uuid(),
  entryId: z.string().uuid(),
})

/** L'entrée désignée appartient-elle bien à ce chantier ? Fail-closed. */
async function entryOnSite(entryId: string, siteId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from('site_knowledge_entries').select('site_id').eq('id', entryId).maybeSingle()
  return (data as { site_id: string } | null)?.site_id === siteId
}

export async function archiveKnowledgeEntryAction(formData: FormData): Promise<ActionResult> {
  const parsed = archiveSchema.safeParse({
    siteId: formData.get('siteId'),
    entryId: formData.get('entryId'),
  })
  if (!parsed.success) return { error: 'Paramètres invalides.' }

  try {
    await requireSiteAccess(parsed.data.siteId)
  } catch {
    return { error: 'Accès non autorisé.' }
  }
  if (!(await entryOnSite(parsed.data.entryId, parsed.data.siteId))) return { error: 'Information introuvable.' }

  await archiveKnowledgeEntry(parsed.data.entryId, parsed.data.siteId)
  revalidatePath(`/sites/${parsed.data.siteId}`)
  return { ok: true }
}
