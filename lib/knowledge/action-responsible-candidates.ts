import 'server-only'

// ── RESPONSABLES POSSIBLES D'UNE ACTION DE CHANTIER (Lot 2A) ─────────────────
// Union EN LECTURE (jamais une écriture) de deux sources de vérité distinctes :
//   · le CASTING actif du chantier (site_intervenants → contacts) — les
//     intervenants externes et rôles formels ;
//   · les AGENTS TERRAIN des équipes affectées au chantier (missions.assigned_
//     team_id → team_field_members) — la main-d'œuvre interne mobilisée.
//
// On ne recopie jamais un agent dans le casting : l'union vit ici, à la lecture.
// La provenance de chaque candidat est conservée (casting et/ou équipe(s)) pour
// que le sélecteur dise D'OÙ vient la personne. Déduplication par contact.id.
//
// Un membre CONNECTÉ d'équipe (users) n'est PAS un company_contact : il ne rentre
// pas dans cette union (assigned_contact_id → company_contacts). Son cas est
// traité séparément (refonte du répertoire), jamais fusionné implicitement ici.

import { listSiteContacts } from '@/lib/db/site-intervenants'
import { listSiteAssignedTeamFieldAgents } from '@/lib/db/team-field-members'

export interface ResponsibleCandidate {
  contactId: string
  fullName: string
  fonction: string | null
  companyName: string | null
  /** Présent dans le casting actif du chantier. */
  fromCasting: boolean
  /** Équipes affectées au chantier qui rendent cette personne candidate. */
  teams: string[]
}

/** Fusion PURE (testable) casting ∪ agents d'équipe, dédupliquée par contact. */
export function mergeResponsibleCandidates(
  casting: Array<{ id: string; fullName: string; function: string | null; companyName: string | null }>,
  teamAgents: Array<{ contactId: string; fullName: string; job: string | null; companyName: string | null; teamName: string }>,
): ResponsibleCandidate[] {
  const byId = new Map<string, ResponsibleCandidate>()

  for (const c of casting) {
    byId.set(c.id, {
      contactId: c.id,
      fullName: c.fullName,
      fonction: c.function,
      companyName: c.companyName,
      fromCasting: true,
      teams: [],
    })
  }

  for (const a of teamAgents) {
    const existing = byId.get(a.contactId)
    if (existing) {
      if (!existing.teams.includes(a.teamName)) existing.teams.push(a.teamName)
      // On complète sans écraser une info déjà connue par le casting.
      existing.fonction = existing.fonction ?? a.job
      existing.companyName = existing.companyName ?? a.companyName
    } else {
      byId.set(a.contactId, {
        contactId: a.contactId,
        fullName: a.fullName,
        fonction: a.job,
        companyName: a.companyName,
        fromCasting: false,
        teams: [a.teamName],
      })
    }
  }

  return [...byId.values()].sort((x, y) => x.fullName.localeCompare(y.fullName, 'fr'))
}

// ── RÉSOLUTION D'UNE RESPONSABILITÉ (Lot 2B.1) ───────────────────────────────
// Une action peut désigner une ENTREPRISE et/ou une PERSONNE. Décision PURE
// (testable) : valide l'appartenance au chantier et la cohérence personne↔
// entreprise. On n'invente jamais une personne ; on n'interdit pas une relation
// terrain atypique — on la fait CONFIRMER.

export type ResponsibilityDecision =
  | { ok: true; assignedCompanyId: string | null; assignedContactId: string | null }
  | { ok: false; error: string; requiresConfirmation?: boolean }

export function resolveActionResponsibility(input: {
  companyId: string | null
  contactId: string | null
  candidateCompanyIds: ReadonlySet<string>
  candidateContactIds: ReadonlySet<string>
  /** L'entreprise à laquelle le contact est rattaché (company_contacts.company_id), si connue. */
  contactCompanyId?: string | null
  /** L'humain a confirmé une incohérence contact↔entreprise (relation atypique assumée). */
  confirmMismatch?: boolean
  /** Valeurs ACTUELLES de l'action (édition). Une valeur INCHANGÉE est une
   *  CONSERVATION historique — jamais re-validée contre le casting (une entreprise
   *  sortie du casting ne doit pas bloquer l'édition d'un autre champ). Seule une
   *  NOUVELLE affectation ou un CHANGEMENT est validé. */
  currentCompanyId?: string | null
  currentContactId?: string | null
}): ResponsibilityDecision {
  const companyId = input.companyId || null
  const contactId = input.contactId || null
  const companyChanged = companyId !== (input.currentCompanyId ?? null)
  const contactChanged = contactId !== (input.currentContactId ?? null)

  if (companyId && companyChanged && !input.candidateCompanyIds.has(companyId)) {
    return { ok: false, error: 'Cette entreprise n’intervient pas sur ce chantier.' }
  }
  if (contactId && contactChanged && !input.candidateContactIds.has(contactId)) {
    return { ok: false, error: 'Cette personne n’est pas un responsable possible pour ce chantier.' }
  }

  // Cohérence personne↔entreprise : uniquement si les deux sont posés ET qu'au
  // moins l'un vient de changer (une paire conservée a déjà été acceptée).
  if (companyId && contactId && (companyChanged || contactChanged)) {
    const contactCompanyId = input.contactCompanyId ?? null
    // Contact sans entreprise connue → autorisé (l'association est une suggestion UI,
    // jamais une modification automatique de la fiche).
    // Contact d'une AUTRE entreprise → contradiction : on avertit, on ne bloque pas
    // définitivement (Jean peut représenter exceptionnellement ETV), mais on exige
    // une confirmation explicite.
    if (contactCompanyId && contactCompanyId !== companyId && !input.confirmMismatch) {
      return {
        ok: false,
        error: 'Ce contact est rattaché à une autre entreprise. Confirmez qu’il représente bien l’entreprise responsable pour cette action.',
        requiresConfirmation: true,
      }
    }
  }

  return { ok: true, assignedCompanyId: companyId, assignedContactId: contactId }
}

/** Les responsables possibles d'une action de CE chantier, prêts pour le sélecteur. */
export async function listSiteActionResponsibleCandidates(siteId: string): Promise<ResponsibleCandidate[]> {
  const [casting, teamAgents] = await Promise.all([
    listSiteContacts(siteId),
    listSiteAssignedTeamFieldAgents(siteId),
  ])
  return mergeResponsibleCandidates(
    casting.map((c) => ({ id: c.id, fullName: c.fullName, function: c.function, companyName: c.companyName })),
    teamAgents,
  )
}
