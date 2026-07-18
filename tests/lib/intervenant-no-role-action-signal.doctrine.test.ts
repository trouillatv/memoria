import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── La fiche lit les actions par IDENTITÉ, jamais par rôle/texte ─────────────
// Slice 0 avait tué le signal « N actions par rôle » (égalité assigned_to↔rôle,
// faux : 0 correspondance en prod). Slice 3A réintroduit une lecture de
// site_actions — mais LÉGITIME : par la relation structurelle
// `assigned_contact_id` (mig 220), scopée au chantier. Le principe verrouillé :
//
//   La fiche ne reconstruit JAMAIS une responsabilité personnelle à partir de
//   assigned_to, d'un rôle, d'un libellé libre ou d'une correspondance de texte.
//
// (Le comportement réel du rattachement est prouvé par assigned-actions.test.ts ;
// ici on protège le CHEMIN de lecture du read model, sans bannir globalement la
// chaîne « assigned_to » qui vit légitimement dans des commentaires.)

const src = readFileSync(join(process.cwd(), 'lib/knowledge/site-intervenants-view.ts'), 'utf8')

describe('Read model Intervenant — actions lues par assigned_contact_id seul', () => {
  it('la lecture d’actions filtre par assigned_contact_id, le site et les statuts ouverts', () => {
    expect(src).toMatch(/\.in\(\s*['"]assigned_contact_id['"]/)
    expect(src).toMatch(/\.in\(\s*['"]status['"]\s*,\s*\[\s*['"]open['"]\s*,\s*['"]planned['"]/)
    // La requête d'actions est scopée au chantier.
    expect(src).toContain("from('site_actions')")
    expect(src).toMatch(/\.eq\(\s*['"]site_id['"]/)
  })

  it('aucune reconstruction par rôle ni filtre par assigned_to', () => {
    expect(src).not.toContain('openByRole')
    expect(src).not.toContain('openActions')
    // Pas de filtre/rapprochement SQL par assigned_to, pas de match rôle↔texte.
    expect(src).not.toMatch(/\.eq\(\s*['"]assigned_to['"]/)
    expect(src).not.toMatch(/assigned_to['"\s)]*\.?\s*toUpperCase/)
    expect(src).not.toMatch(/toUpperCase\(\)\s*===\s*[^\n]*role/)
  })
})
