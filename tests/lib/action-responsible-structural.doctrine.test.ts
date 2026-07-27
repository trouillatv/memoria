import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── P2 · SLICE 2 — l'attribution d'une action à une PERSONNE est structurelle ─
// Une action peut désormais être attribuée à un contact confirmé du chantier
// (assigned_contact_id), pas seulement à du texte libre. Garde-fous :
//   · un SEUL writer persiste la relation (site-actions.ts) : create en insert,
//     update via le RPC atomique fn_update_action (p_patch) ;
//   · le serveur n'accepte qu'un contact du CASTING actif (jamais arbitraire,
//     jamais un rapprochement par nom) et alimente assigned_to avec le nom
//     (mirror lisible) — assigned_contact_id reste la preuve ;
//   · l'UI impose deux modes EXCLUSIFS : choisir une personne masque le texte.

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')

describe('P2 Slice 2 — responsable structurel (assigned_contact_id)', () => {
  it('le writer unique persiste assigned_contact_id (create + update)', () => {
    const s = read('lib/db/site-actions.ts')
    expect(s).toContain('assigned_contact_id: input.assigned_contact_id')
    // Update : la relation est forwardée dans le patch du RPC atomique fn_update_action.
    expect(s).toContain('p_patch.assigned_contact_id = patch.assigned_contact_id')
    expect(s).toContain("rpc('fn_update_action'")
  })

  it('le serveur valide personne ET entreprise via la politique pure, et met le nom en mirror', () => {
    // Lot 2A : candidats = UNION (lecture) casting actif ∪ agents des équipes affectées.
    // Lot 2B.1 : + entreprises candidates ; la décision (appartenance + cohérence) est
    // déléguée à une politique PURE ; le miroir texte = nom du contact, sinon entreprise.
    const s = read('app/(dashboard)/meetings/[id]/pv-actions.ts')
    expect(s).toContain('listSiteActionResponsibleCandidates') // candidats personnes
    expect(s).toContain('listSiteCandidateCompanies')          // candidats entreprises (Lot 2B.1)
    expect(s).toContain('resolveActionResponsibility')         // décision pure déléguée
    expect(s).toMatch(/assigned_to:\s*contact\?\.fullName\s*\?\?\s*company\?\.name/) // miroir
    // Le refus explicite vit dans la politique pure (testée à part).
    const policy = read('lib/knowledge/action-responsible-candidates.ts')
    expect(policy).toMatch(/responsable possible/)
    expect(policy).toMatch(/n.intervient pas sur ce chantier/) // entreprise hors chantier
  })

  it('l’UI distingue entreprise / personne / texte libre, exclusifs', () => {
    const s = read('app/(dashboard)/meetings/[id]/pv/validation/PvActionsBlock.tsx')
    // Lot 2B.1 : le texte libre n'apparaît QUE s'il n'y a NI personne NI entreprise.
    expect(s).toContain('{!contactId && !companyId && (')
    expect(s).toContain('Entreprise responsable')     // le niveau entreprise (mig 245)
    expect(s).toContain('Responsable identifié')      // le mode personne
    expect(s).toContain('ancien suivi')               // la trace texte, distincte
  })
})
