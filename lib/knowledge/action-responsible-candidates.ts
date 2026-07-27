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
