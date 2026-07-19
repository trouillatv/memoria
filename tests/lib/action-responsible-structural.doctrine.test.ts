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

  it('le serveur refuse un contact hors casting et met le nom en mirror', () => {
    const s = read('app/(dashboard)/meetings/[id]/pv-actions.ts')
    expect(s).toContain('listSiteContacts')          // le contact doit être du casting
    expect(s).toMatch(/pas dans le casting/)          // refus explicite
    expect(s).toContain('assigned_to: c.fullName')    // mirror du nom, jamais un rapprochement
  })

  it('l’UI garde les deux modes EXCLUSIFS et distingue l’affichage', () => {
    const s = read('app/(dashboard)/meetings/[id]/pv/validation/PvActionsBlock.tsx')
    expect(s).toContain('{!contactId && (')           // texte libre SEULEMENT sans personne
    expect(s).toContain('Responsable identifié')      // le mode structurel
    expect(s).toContain('ancien suivi')               // la trace texte, distincte
  })
})
