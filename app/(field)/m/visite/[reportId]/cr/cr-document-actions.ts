'use server'

// LES DEUX GESTES DU CR ÉDITABLE (Étape A) — et rien de plus.
//
// « Modifier » change la version humaine d'UNE section du document.
// « Revenir à la proposition » restaure la section IA d'origine, elle seule.
//
// FRONTIÈRE TENUE : ces gestes touchent le DOCUMENT, jamais les objets du
// chantier. Corriger la ligne « Communiquer le code d'accès » dans la section
// `actions` ne modifie aucune action réelle déjà créée. Le document RACONTE ;
// les objets métier VIVENT. Confondre les deux ferait qu'une relecture de texte
// réécrirait le chantier.
//
// Un document `validated` ou `exported` est en LECTURE SEULE : l'écriture est
// refusée ici, et `updateReportDocumentSections` la refuse une seconde fois côté
// base (`.eq('status', 'draft')`). Aucun geste d'édition ne défige un CR.

import { revalidatePath } from 'next/cache'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getVisit } from '@/lib/db/visits'
import { updateReportDocumentSections } from '@/lib/db/report-documents'
import { getVisitCrDocument } from '@/lib/db/visit-cr-documents'
import { restoreSectionProposal } from '@/lib/visits/cr-visite-policy'
import type { ReportDocumentSection } from '@/types/db'

type Result = { ok: true } | { ok: false; error: string }

type Opened =
  | { ok: false; error: string }
  | { ok: true; doc: NonNullable<Awaited<ReturnType<typeof getVisitCrDocument>>> }

/** Garde commune : l'utilisateur, la visite, son organisation, et un brouillon. */
async function openDraft(reportId: string): Promise<Opened> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false, error: 'Session expirée' }
  const visit = await getVisit(reportId)
  if (!visit) return { ok: false, error: 'Visite introuvable' }
  // Isolation tenant : le service-role passe outre la RLS, le filtre est ICI.
  if (visit.organization_id && user.organization_id && visit.organization_id !== user.organization_id) {
    return { ok: false, error: 'Visite introuvable' }
  }
  const doc = await getVisitCrDocument(reportId)
  if (!doc) return { ok: false, error: 'Compte-rendu introuvable' }
  if (doc.status !== 'draft') {
    return { ok: false, error: 'Ce compte-rendu est validé — il ne se modifie plus.' }
  }
  return { ok: true, doc }
}

/**
 * Enregistre le texte humain d'UNE section. Les autres sections ressortent
 * telles quelles : on réécrit le tableau complet, mais sans jamais recalculer
 * une section qu'on ne touche pas. `ai_content` n'est jamais modifié — c'est la
 * proposition d'origine, elle doit survivre à toutes les corrections.
 */
export async function saveCrSectionAction(
  reportId: string,
  sectionKey: string,
  content: string,
): Promise<Result> {
  const opened = await openDraft(reportId)
  if (!opened.ok) return opened

  const next: ReportDocumentSection[] = opened.doc.sections.map((s) =>
    s.key === sectionKey ? { ...s, content } : s,
  )
  if (!opened.doc.sections.some((s) => s.key === sectionKey)) {
    return { ok: false, error: 'Section inconnue' }
  }

  try {
    await updateReportDocumentSections(opened.doc.id, next)
  } catch {
    return { ok: false, error: 'Enregistrement impossible' }
  }
  revalidatePath(`/m/visite/${reportId}/cr`)
  return { ok: true }
}

/** Restaure la proposition MemorIA d'UNE section. Sans origine IA, rien ne bouge. */
export async function restoreCrSectionAction(reportId: string, sectionKey: string): Promise<Result> {
  const opened = await openDraft(reportId)
  if (!opened.ok) return opened

  try {
    await updateReportDocumentSections(
      opened.doc.id,
      restoreSectionProposal(opened.doc.sections, sectionKey),
    )
  } catch {
    return { ok: false, error: 'Restauration impossible' }
  }
  revalidatePath(`/m/visite/${reportId}/cr`)
  return { ok: true }
}
