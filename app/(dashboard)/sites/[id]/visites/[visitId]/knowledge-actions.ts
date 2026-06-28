'use server'

// « À retenir » — créer une info utile (captured_knowledge) depuis le débrief.
// L'IA PROPOSE plus tard ; ici V1 = saisie/qualification MANUELLE. Règle d'or :
// on relie (au moins à la visite + au site, et on encourage un point suivi).

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { addCapturedKnowledge } from '@/lib/db/captured-knowledge'

const schema = z.object({
  site_id: z.string().uuid(),
  report_id: z.string().uuid(),
  kind: z.enum(['promise', 'risk', 'context', 'missing_document', 'attention', 'other']),
  title: z.string().trim().min(1).max(500),
  body: z.string().trim().max(8000).optional(),
  subject_id: z.string().uuid().nullable().optional(),
})

export async function addKnowledgeAction(
  input: z.input<typeof schema>,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false, error: 'Non authentifié' }
  if (user.role !== 'admin' && user.role !== 'manager') return { ok: false, error: 'Accès refusé' }

  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }

  try {
    const id = await addCapturedKnowledge({
      siteId: parsed.data.site_id,
      sourceType: 'visit',
      sourceId: parsed.data.report_id,
      kind: parsed.data.kind,
      title: parsed.data.title,
      body: parsed.data.body || null,
      subjectId: parsed.data.subject_id ?? null,
      createdBy: user.id,
    })
    revalidatePath(`/sites/${parsed.data.site_id}/visites/${parsed.data.report_id}`)
    return { ok: true, id }
  } catch {
    return { ok: false, error: "Échec de l'enregistrement" }
  }
}
