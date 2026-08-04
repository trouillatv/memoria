import 'server-only'

// Outil actor — Lot 3B Copilote.
// Charge le casting actif d'un chantier et les actions non-clôturées
// assignées aux acteurs correspondant aux labels extraits de la question.
//
// Matching déterministe (containment normalisé, pas de LLM).
// Max 3 acteurs × 10 actions = 30 lignes transmises au LLM.

import { createAdminClient } from '@/lib/supabase/admin'
import { listSiteIntervenants } from '@/lib/db/site-intervenants'
import { normalizeCanonicalLabel } from '@/lib/db/canonical-subject-resolve'

export interface ActorActionContext {
  title: string
  status: string | null
  dueDate: string | null
}

export interface ActorContext {
  id: string
  role: string
  companyName: string
  contactName: string | null
  assignedActions: ActorActionContext[]
}

/**
 * Charge les acteurs du chantier qui correspondent aux labels extraits
 * de la question, et leurs actions en cours.
 *
 * La correspondance est un containment normalisé (BECIB ⊂ "BECIB SARL" ou inverse).
 * Si plusieurs acteurs matchent un label, tous sont retournés.
 */
export async function getSiteActorContext(
  siteId: string,
  actorLabels: string[],
): Promise<ActorContext[]> {
  if (actorLabels.length === 0) return []

  const intervenants = await listSiteIntervenants(siteId)
  if (intervenants.length === 0) return []

  const normalizedLabels = actorLabels.map(normalizeCanonicalLabel).filter(Boolean)
  if (normalizedLabels.length === 0) return []

  // Match containment : label dans nom ou nom dans label (bidirectionnel)
  const matched = intervenants.filter((iv) => {
    const targets = [
      iv.companyName,
      iv.companyShort,
      iv.contactName,
    ]
      .filter((t): t is string => !!t)
      .map(normalizeCanonicalLabel)

    return normalizedLabels.some((label) =>
      targets.some((target) => target.includes(label) || label.includes(target)),
    )
  })

  if (matched.length === 0) return []

  const supabase = createAdminClient()

  const results: ActorContext[] = []
  for (const iv of matched.slice(0, 3)) {
    const orParts: string[] = []
    if (iv.mainContactId) orParts.push(`assigned_contact_id.eq.${iv.mainContactId}`)
    // Note : companyId est toujours présent (non null dans SiteIntervenant)
    orParts.push(`assigned_company_id.eq.${iv.companyId}`)

    const { data: actionRows } = await supabase
      .from('site_actions')
      .select('title, status, due_date')
      .eq('site_id', siteId)
      .or(orParts.join(','))
      .is('deleted_at', null)
      .not('status', 'in', '(done,cancelled)')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(10)

    results.push({
      id: iv.id,
      role: iv.role,
      companyName: iv.companyName,
      contactName: iv.contactName,
      assignedActions: (actionRows ?? []).map((a) => ({
        title: a.title as string,
        status: a.status as string | null,
        dueDate: a.due_date as string | null,
      })),
    })
  }

  return results
}
