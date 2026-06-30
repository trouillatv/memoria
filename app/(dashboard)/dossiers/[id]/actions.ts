'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { updateDossierPhase } from '@/lib/db/dossiers'
import { resolveCapturedKnowledgeWithAnswer, listResolvedQuestionsByDossier } from '@/lib/db/captured-knowledge'
import { attachTenderToDossier } from '@/lib/db/tenders'
import { readForTender } from '@/lib/db/dossier-readings'
import { getDossier } from '@/lib/db/dossiers'
import { buildPrevisiteSynthesis } from '@/lib/db/previsite-synthesis'
import {
  buildComprehensionFacts,
  createComprehensionRun,
  setAffirmationVerdict,
  type AffirmationVerdict,
} from '@/lib/db/comprehension'
import { runComprehensionAgent } from '@/services/ai/comprehension'
import type { DossierPhase } from '@/types/db'

const VERDICTS: AffirmationVerdict[] = ['juste', 'vague', 'parasite', 'dangereux']

const ALLOWED: DossierPhase[] = ['prospect', 'en_ao', 'actif', 'perdu', 'archive']

// Soudure arrière : avancer le dossier dans son cycle de vie. « Marché gagné »
// (actif) ne copie rien — le même dossier devient chantier. Cf. mig 172.
export async function setDossierPhaseAction(formData: FormData): Promise<void> {
  const user = await getCurrentUserWithProfile()
  if (!user || (user.role !== 'admin' && user.role !== 'manager')) throw new Error('Non autorisé')

  const dossierId = String(formData.get('dossierId') ?? '')
  const phase = String(formData.get('phase') ?? '') as DossierPhase
  if (!dossierId || !ALLOWED.includes(phase)) throw new Error('Paramètres invalides')

  await updateDossierPhase(dossierId, phase)
  revalidatePath(`/dossiers/${dossierId}`)
}

// Vérifie un point en CONSERVANT la réponse trouvée (mig 178). La valeur n'est
// pas « résolu » mais ce qu'on a trouvé (« diamètre 200 », « compteur en limite
// de propriété »). La réponse est facultative mais encouragée. Pas d'assignation,
// échéance, priorité — ce n'est pas un outil de tâches.
export async function resolveQuestionAction(formData: FormData): Promise<void> {
  const user = await getCurrentUserWithProfile()
  if (!user || (user.role !== 'admin' && user.role !== 'manager')) throw new Error('Non autorisé')
  const id = String(formData.get('id') ?? '')
  const dossierId = String(formData.get('dossierId') ?? '')
  const answer = String(formData.get('answer') ?? '')
  if (!id) throw new Error('Paramètres invalides')
  await resolveCapturedKnowledgeWithAnswer(id, answer)
  revalidatePath(`/dossiers/${dossierId}`)
}

// Export « Synthèse de prévisite pour réponse AO » — texte prêt à copier/coller.
// Déterministe (read-model + points vérifiés), zéro IA. Renvoyé au client qui le
// copie dans le presse-papier ou le télécharge.
export async function buildPrevisiteSynthesisAction(
  dossierId: string,
): Promise<{ ok: true; text: string; filename: string } | { ok: false; error: string }> {
  const user = await getCurrentUserWithProfile()
  if (!user || (user.role !== 'admin' && user.role !== 'manager')) return { ok: false, error: 'Non autorisé' }
  if (!dossierId) return { ok: false, error: 'Dossier invalide' }
  try {
    const [dossier, reading, resolved] = await Promise.all([
      getDossier(dossierId),
      readForTender(dossierId),
      listResolvedQuestionsByDossier(dossierId),
    ])
    if (!dossier) return { ok: false, error: 'Dossier introuvable' }
    const text = buildPrevisiteSynthesis(reading, resolved)
    const slug = (reading.siteName || 'previsite')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40)
    return { ok: true, text, filename: `synthese-previsite-${slug || 'ao'}.md` }
  } catch {
    return { ok: false, error: 'Échec de la génération' }
  }
}

// Soudure AVANT (côté opportunité) : rattacher / détacher un AO à ce dossier.
export async function attachTenderToDossierAction(formData: FormData): Promise<void> {
  const user = await getCurrentUserWithProfile()
  if (!user || (user.role !== 'admin' && user.role !== 'manager')) throw new Error('Non autorisé')
  const tenderId = String(formData.get('tenderId') ?? '')
  const dossierId = String(formData.get('dossierId') ?? '')
  const detach = formData.get('detach') === '1'
  if (!tenderId || !dossierId) throw new Error('Paramètres invalides')
  await attachTenderToDossier(tenderId, detach ? null : dossierId)
  revalidatePath(`/dossiers/${dossierId}`)
}

// ── Harnais d'évaluation : « Voilà ce que j'ai compris » (mig 179) ───────────
// L'IA génère une compréhension en affirmations atomiques (avec provenance) sur
// le read-model. PROTOCOLE D'ÉVALUATION : l'humain note chaque affirmation. Un
// appel LLM borné, async, traçé (coût). L'IA propose, l'humain juge.

export async function generateComprehensionAction(
  dossierId: string,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const user = await getCurrentUserWithProfile()
  if (!user || (user.role !== 'admin' && user.role !== 'manager')) return { ok: false, error: 'Non autorisé' }
  if (!dossierId) return { ok: false, error: 'Dossier invalide' }
  try {
    const [dossier, reading, resolved] = await Promise.all([
      getDossier(dossierId),
      readForTender(dossierId),
      listResolvedQuestionsByDossier(dossierId),
    ])
    if (!dossier) return { ok: false, error: 'Dossier introuvable' }

    const facts = buildComprehensionFacts(reading, resolved)
    if (facts.length <= 1) return { ok: false, error: 'Pas encore assez de matière captée pour une compréhension.' }

    const res = await runComprehensionAgent({
      siteName: reading.siteName,
      clientName: reading.clientName,
      facts,
      userId: user.id,
    })
    if (res.affirmations.length === 0) return { ok: false, error: 'L’IA n’a rien pu formuler — réessaie.' }

    await createComprehensionRun({
      dossierId,
      siteId: dossier.site_id,
      provider: res.provider,
      model: res.model,
      createdBy: user.id,
      affirmations: res.affirmations,
    })
    revalidatePath(`/dossiers/${dossierId}`)
    return { ok: true, count: res.affirmations.length }
  } catch {
    return { ok: false, error: 'Échec de la génération' }
  }
}

// Note humaine d'une affirmation (grille 4 classes). Toggle : re-cliquer le même
// verdict l'efface. C'est la donnée d'évaluation qui fera évoluer le prompt/modèle.
export async function rateAffirmationAction(input: {
  affirmationId: string
  dossierId: string
  verdict: AffirmationVerdict | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUserWithProfile()
  if (!user || (user.role !== 'admin' && user.role !== 'manager')) return { ok: false, error: 'Non autorisé' }
  if (!input.affirmationId) return { ok: false, error: 'Paramètres invalides' }
  if (input.verdict !== null && !VERDICTS.includes(input.verdict)) return { ok: false, error: 'Verdict invalide' }
  try {
    await setAffirmationVerdict(input.affirmationId, input.verdict, null, user.id)
    revalidatePath(`/dossiers/${input.dossierId}`)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Échec' }
  }
}
