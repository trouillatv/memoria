import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── P2 · SLICE 0 — le faux signal « actions par rôle » ne revient jamais ─────
// La fiche Intervenant comptait les « actions ouvertes » d'une personne par
// ÉGALITÉ DE CHAÎNE entre site_actions.assigned_to (majuscules) et le rôle de
// son casting. Ce n'est PAS une relation métier : assigned_to est du texte
// libre (« Papa », « Sotrap »…), et en prod 0 valeur correspondait à un rôle du
// casting — le signal valait 0 pour tout le monde tout en se présentant comme
// un fait. Retiré AVANT tout le reste du P2 (arbitrage Vincent).
//
// La lecture « ce que cette personne doit faire » reviendra en Slice 3, fondée
// sur une vraie relation structurelle site_actions.assigned_contact_id (FK
// company_contacts), jamais sur ce rapprochement rôle↔texte.

const VIEW = 'lib/knowledge/site-intervenants-view.ts'
const src = readFileSync(join(process.cwd(), VIEW), 'utf8')

// On ne cherche PAS la sous-chaîne « assigned_to » : elle vit légitimement dans
// un commentaire qui EXPLIQUE pourquoi ce champ (texte libre) ne peut pas servir
// de preuve. Le garde-fou porte sur le CODE : plus de lecture de site_actions,
// plus de calcul par rôle, plus de champ openActions.
describe('P2 Slice 0 — aucun suivi d’actions par rapprochement rôle↔texte', () => {
  it('le read model Intervenant ne lit plus la table site_actions', () => {
    expect(src).not.toContain("from('site_actions')")
  })

  it('le champ openActions et son calcul openByRole ont disparu', () => {
    expect(src).not.toContain('openActions')
    expect(src).not.toContain('openByRole')
  })
})
