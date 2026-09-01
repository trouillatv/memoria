import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Point 16A — état vide HONNÊTE de l'onglet Travaux (desktop). Deux branches
// déterministes, aucune inférence depuis les PV, aucun nouveau read-model.
// Test par lecture de source (composants serveur, même pattern que action-fiche).

const travaux = readFileSync(join(process.cwd(), 'app/(dashboard)/sites/[id]/views/planning/TravauxSubView.tsx'), 'utf8')
const page = readFileSync(join(process.cwd(), 'app/(dashboard)/sites/[id]/page.tsx'), 'utf8')

describe('Point 16A — Travaux vide : deux branches déterministes', () => {
  it('branche « planning absent MAIS échéances connues » : message + compte + lien vers les échéances', () => {
    expect(travaux).toMatch(/deadlinesCount > 0/)
    expect(travaux).toContain('Aucun planning de travaux documenté')
    expect(travaux).toContain('ne dispose pas d’un planning de travaux structuré')
    // compte factuel (pas un KPI) : « N échéance(s) … connue(s) »
    expect(travaux).toMatch(/\{deadlinesCount\}/)
    expect(travaux).toMatch(/néanmoins connue/)
    // lien vers la surface Échéances existante (jamais afficher les échéances ici)
    expect(travaux).toContain('tab=planning&plantab=echeances')
    expect(travaux).toContain('Voir les échéances')
  })

  it('branche « rien connu » : état vide honnête, garantie de non-inférence formulée pro', () => {
    expect(travaux).toContain('Aucun planning documenté pour le moment')
    expect(travaux).toContain('ne dispose d’aucun planning de travaux structuré')
    expect(travaux).toContain('Aucun jalon n’est déduit automatiquement des documents')
    // on n'emploie PAS la formulation « n'invente pas » (justification technique)
    expect(travaux).not.toContain('n’invente pas')
    expect(travaux).not.toContain("n'invente pas")
  })

  it('les échéances ne sont JAMAIS listées dans Travaux (elles ont leur surface) : seulement un compte + lien', () => {
    // aucune itération sur des deadlines dans ce composant
    expect(travaux).not.toMatch(/deadlines\.map|deadline\.due_date|d\.due_date/)
  })

  it('aucune inférence depuis les PV, aucun jalon fabriqué : l’état vide ne lit pas items', () => {
    // la branche vide se déclenche sur items.length === 0 ; elle n'invente aucun jalon
    expect(travaux).toMatch(/items\.length === 0/)
  })
})

describe('Point 16A — pas de nouveau read-model ni de changement quand un planning existe', () => {
  it('page.tsx passe le compteur d’échéances DÉJÀ chargé (deadlines.length), pas une nouvelle requête', () => {
    expect(page).toMatch(/<TravauxSubView[\s\S]*?deadlinesCount=\{deadlines\.length\}/)
  })

  it('le chemin « planning existant » reste inchangé (TravauxWeeksBoard + Jalons)', () => {
    expect(travaux).toContain('TravauxWeeksBoard')
    expect(travaux).toContain('Jalons')
  })
})
