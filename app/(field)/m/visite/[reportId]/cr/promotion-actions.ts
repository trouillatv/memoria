'use server'

// N3.1 — PROMOUVOIR UNE PHRASE DEPUIS UNE PREUVE.
//
// Le geste central de la salle d'enquête, et le seul qui écrive dans le
// compte-rendu depuis le récit. Ce n'est PAS une édition libre : on ne modifie
// aucune ligne existante, on en ajoute une, et on inscrit d'où elle vient.
//
// Ce que ça change : les sections du CR naissent de l'analyse du corpus entier
// et ne savent nommer aucune capture. Une phrase promue, si. La chaîne de
// traçabilité passe de trois maillons à quatre — et le lien n'est pas déduit,
// il est DÉSIGNÉ par un humain qui clique.

import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getVisit } from '@/lib/db/visits'
import { createAdminClient } from '@/lib/supabase/admin'
import { getVisitCrDocument } from '@/lib/db/visit-cr-documents'
import { updateReportDocumentSections } from '@/lib/db/report-documents'
import { promoteIntoSection } from '@/lib/visits/promotion'
import type { ReportDocumentSection } from '@/types/db'

/** Les sections où une phrase peut entrer. Les vigilances et les intervenants
 *  n'en sont pas : la première raconte, la seconde exige un rôle. */
const PROMOTABLE = ['resume', 'decisions', 'actions', 'a_savoir', 'echeances'] as const
export type PromotableSection = (typeof PROMOTABLE)[number]

export type PromotionResult =
  | { ok: true; sections: ReportDocumentSection[] }
  | { ok: false; error: string }

export async function promoteEvidenceToCrAction(input: {
  reportId: string
  captureId: string
  sectionKey: string
  text: string
}): Promise<PromotionResult> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false, error: 'Session expirée' }
  if (!(PROMOTABLE as readonly string[]).includes(input.sectionKey)) {
    return { ok: false, error: 'Cette section ne reçoit pas de phrase promue.' }
  }
  const text = input.text.trim()
  if (!text) return { ok: false, error: 'Sélectionnez une phrase.' }

  const visit = await getVisit(input.reportId)
  if (!visit) return { ok: false, error: 'Visite introuvable' }
  // Isolation tenant : le service-role passe outre la RLS, le filtre est ICI.
  if (visit.organization_id && user.organization_id && visit.organization_id !== user.organization_id) {
    return { ok: false, error: 'Visite introuvable' }
  }

  const doc = await getVisitCrDocument(input.reportId)
  if (!doc) return { ok: false, error: 'Compte-rendu introuvable' }
  if (doc.status !== 'draft') {
    return { ok: false, error: 'Ce compte-rendu est finalisé — rouvrez-le pour l’enrichir.' }
  }

  // La capture doit exister ET appartenir à cette visite : sans quoi on
  // inscrirait une provenance fausse, ce qui est pire que pas de provenance.
  const { data: cap } = await createAdminClient()
    .from('visit_capture')
    .select('id, kind, created_at, report_id')
    .eq('id', input.captureId)
    .maybeSingle()
  const capture = cap as { kind: string; created_at: string; report_id: string | null } | null
  if (!capture || capture.report_id !== input.reportId) {
    return { ok: false, error: 'Cette preuve n’appartient pas à cette visite.' }
  }

  const { sections, added } = promoteIntoSection(doc.sections, {
    sectionKey: input.sectionKey,
    text,
    captureId: input.captureId,
    captureKind: capture.kind,
    capturedAt: capture.created_at,
    promotedAt: new Date().toISOString(),
    promotedBy: user.id,
  })
  if (!added) return { ok: false, error: 'Cette phrase est déjà dans le compte-rendu.' }

  try {
    await updateReportDocumentSections(doc.id, sections)
  } catch {
    return { ok: false, error: 'Ajout impossible' }
  }
  return { ok: true, sections }
}
