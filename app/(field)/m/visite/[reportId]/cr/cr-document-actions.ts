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

import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getVisit } from '@/lib/db/visits'
import { updateReportDocumentSections } from '@/lib/db/report-documents'
import { getVisitCrDocument, finalizeVisitCr, reopenVisitCr } from '@/lib/db/visit-cr-documents'
import { restoreSectionProposal } from '@/lib/visits/cr-visite-policy'
import type { ReportDocumentSection, ReportDocumentStatus } from '@/types/db'

/** La réponse porte le document RÉELLEMENT PERSISTÉ. L'écran ne suppose donc
 *  jamais ce que le serveur a fait : il adopte ce qu'il a écrit. C'est ce qui
 *  permet de se passer d'un rafraîchissement global — et donc de ne pas
 *  renvoyer le conducteur en haut de page à chaque enregistrement. */
export interface PersistedCrDocument {
  id: string
  status: ReportDocumentStatus
  sections: ReportDocumentSection[]
  updatedAt: string
}

type Result = { ok: true; document: PersistedCrDocument } | { ok: false; error: string }

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
  return reread(reportId, 'Enregistrement impossible')
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
  // On RELIT au lieu de renvoyer ce qu'on croit avoir écrit : « revenir à la
  // proposition » doit rendre la section telle que la base la porte désormais.
  return reread(reportId, 'Restauration impossible')
}

/** Relecture après écriture — la réponse est la vérité persistée, jamais une
 *  supposition du client. */
async function reread(reportId: string, error: string): Promise<Result> {
  const doc = await getVisitCrDocument(reportId)
  if (!doc) return { ok: false, error }
  return {
    ok: true,
    document: { id: doc.id, status: doc.status, sections: doc.sections, updatedAt: doc.updated_at },
  }
}

// ── LE CYCLE DE VIE, CÔTÉ ÉCRAN ─────────────────────────────────────────────
//
// Deux gestes explicites, jamais automatiques. Concrétiser des objets ne
// finalise pas le compte-rendu : on peut créer quatre actions et continuer à
// corriger le texte.

export type LifecycleResult = { ok: true; status: ReportDocumentStatus } | { ok: false; error: string }

/** Brouillon → Finalisé. Le document devient une lecture seule, signée et datée. */
export async function finalizeCrAction(reportId: string): Promise<LifecycleResult> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false, error: 'Session expirée' }
  const visit = await getVisit(reportId)
  if (!visit) return { ok: false, error: 'Visite introuvable' }
  if (visit.organization_id && user.organization_id && visit.organization_id !== user.organization_id) {
    return { ok: false, error: 'Visite introuvable' }
  }
  const ok = await finalizeVisitCr(reportId, user.id)
  return ok ? { ok: true, status: 'validated' } : { ok: false, error: 'Finalisation impossible' }
}

/** Finalisé → Brouillon. Les objets déjà créés dans le chantier ne bougent pas. */
export async function reopenCrAction(reportId: string): Promise<LifecycleResult> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false, error: 'Session expirée' }
  const visit = await getVisit(reportId)
  if (!visit) return { ok: false, error: 'Visite introuvable' }
  if (visit.organization_id && user.organization_id && visit.organization_id !== user.organization_id) {
    return { ok: false, error: 'Visite introuvable' }
  }
  const ok = await reopenVisitCr(reportId, user.id)
  return ok ? { ok: true, status: 'draft' } : { ok: false, error: 'Réouverture impossible' }
}
