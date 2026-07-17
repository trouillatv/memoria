'use server'

// La Mémoire ACTIONNABLE — confirmer / écarter depuis la fiche chantier.
//
// POURQUOI ICI et pas dans la visite : la Mémoire est scopée au SITE. Les actions
// du débrief (debrief-actions.ts) exigent un `report_id` et gardent l'org via la
// VISITE — or une proposition peut avoir perdu sa visite (`report_id` est
// ON DELETE SET NULL). Seule la GARDE change donc : elle porte sur le site.
//
// Le CYCLE, lui, ne change pas : promoteProposal / dismissProposal, les mêmes que
// depuis la synthèse. Aucun second mécanisme — sinon deux chemins de promotion
// divergeraient et l'un des deux finirait par écrire ce que l'autre interdit.

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireFieldAgent } from '@/lib/field/auth'
import { requireOwned } from '@/lib/auth/ownership'
import { getOrgId } from '@/lib/db/users'
import {
  promoteProposal, dismissProposal, getPromotionCapability,
  type PromotionInputName,
} from '@/lib/db/knowledge-proposals'

/**
 * L'issue d'un geste de confirmation. `needs_input` n'est pas un échec : c'est la
 * question que l'écran doit poser (le sélecteur de rôle, le choix de nature).
 * Elle traverse la couche action SANS être aplatie en erreur — sinon l'écran
 * devrait deviner, à partir d'un texte, s'il faut ouvrir un sélecteur.
 */
export type PromoteResult =
  | { ok: true; objectId: string }
  | { ok: false; needsInput: PromotionInputName[]; error: string }
  | { ok: false; error: string; needsInput?: undefined }

const baseSchema = z.object({ site_id: z.string().uuid(), proposal_id: z.string().uuid() })

type Guard =
  | { ok: false; error: string }
  | { ok: true; userId: string | null; orgId: string | null; siteId: string; proposalId: string }

async function guard(input: unknown): Promise<Guard> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = baseSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  // Jamais promouvoir une proposition sur le chantier d'un autre tenant.
  const owned = await requireOwned(auth.role, 'sites', parsed.data.site_id)
  if (!owned.allowed) return { ok: false, error: owned.error ?? 'Accès refusé' }
  return {
    ok: true,
    userId: auth.userId,
    orgId: await getOrgId(),
    siteId: parsed.data.site_id,
    proposalId: parsed.data.proposal_id,
  }
}

const promoteSchema = baseSchema.extend({
  /** REQUIS pour un intervenant : le rôle ne se devine pas depuis « Ginger ». */
  role: z.string().trim().min(1).max(60).optional(),
  company_name: z.string().trim().max(200).optional(),
  contact_id: z.string().uuid().nullish(),
  /** REQUIS pour une information : périssable ou durable ? L'humain tranche. */
  knowledge_kind: z.enum(['current_information', 'durable_knowledge']).optional(),
})

/**
 * Confirmer une proposition depuis la Mémoire — le geste métier, pas un
 * « Confirmer » générique : « Confirmer la décision », « Ajouter au chantier ».
 *
 * Les SIX types sont promouvables. Deux exigent une réponse que la proposition
 * ne porte pas — le rôle d'un intervenant, la nature d'une information : on la
 * demande (needsRole / needsNature) au lieu de la deviner, et l'écran pose la
 * question au lieu de récolter une exception.
 */
export async function promoteFromMemoryAction(
  input: z.input<typeof promoteSchema>,
): Promise<PromoteResult> {
  const g = await guard(input)
  if (!g.ok) return { ok: false, error: g.error }
  const parsed = promoteSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }

  try {
    const res = await promoteProposal({
      id: g.proposalId,
      userId: g.userId,
      organizationId: g.orgId,
      input: {
        role: parsed.data.role,
        companyName: parsed.data.company_name,
        contactId: parsed.data.contact_id ?? null,
        knowledgeKind: parsed.data.knowledge_kind,
      },
    })
    switch (res.status) {
      case 'promoted':
        // L'invalidation de la projection est portée par la MUTATION elle-même
        // (createSiteAction / createSiteDecision…), jamais par l'écran.
        revalidatePath(`/m/site/${g.siteId}/patrimoine`)
        revalidatePath(`/m/site/${g.siteId}`)
        return { ok: true, objectId: res.objectId }
      case 'needs_input':
        return { ok: false, needsInput: res.missing, error: missingLabel(res.missing) }
      case 'unsupported':
        return { ok: false, error: getPromotionCapability(res.kind).explanation ?? 'Impossible' }
      case 'not_found':
        return { ok: false, error: 'Élément introuvable' }
    }
  } catch {
    return { ok: false, error: 'Confirmation impossible' }
  }
}

/** La question à poser, avec les mots du conducteur. */
function missingLabel(missing: PromotionInputName[]): string {
  if (missing.includes('role')) return 'Indiquez son rôle sur le chantier'
  if (missing.includes('nature')) return 'Information du moment, ou savoir durable ?'
  return 'Information manquante'
}

const dismissSchema = baseSchema.extend({ reason: z.string().trim().max(500).nullish() })

/**
 * Écarter — disponible pour TOUS les types, y compris ceux qu'on ne sait pas
 * encore promouvoir. `dismissProposal` est agnostique du kind : une décision
 * humaine d'écarter ne dépend pas de l'existence d'une cible métier. C'est ce qui
 * permet d'être honnête tout de suite : « on ne sait pas encore l'ajouter, mais
 * vous pouvez au moins dire qu'elle n'a pas lieu d'être ».
 */
export async function dismissFromMemoryAction(
  input: z.input<typeof dismissSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard(input)
  if (!g.ok) return { ok: false, error: g.error }
  const parsed = dismissSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }

  try {
    await dismissProposal(g.proposalId, g.userId, parsed.data.reason ?? undefined, g.orgId)
    revalidatePath(`/m/site/${g.siteId}/patrimoine`)
    revalidatePath(`/m/site/${g.siteId}`)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Impossible de l’écarter' }
  }
}
