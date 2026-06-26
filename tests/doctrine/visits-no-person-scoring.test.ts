// Garde-fou doctrinal — Visites terrain (migration 162).
//
// Invariants gravés (arbitrage Vincent 2026-06-26) :
//   1. Un résultat de visite qualifie un LIEU / OUVRAGE / SUJET, JAMAIS une
//      personne ni une entreprise (pas de score, classement, performance).
//   2. La gravité n'est jamais demandée : aucune entrée `severity` ne doit
//      transiter par l'API de clôture (severity retirée du MVP).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf-8')

const MIGRATION = 'supabase/migrations/162_field_visits.sql'
const DB = 'lib/db/visits.ts'

// Notions de notation/comparaison individuelle interdites comme identifiants.
const FORBIDDEN_SCORING = [
  /\b(score|scoring|ranking|classement|performance|notation|note_visiteur)\b/i,
  /\b(taux_conformite|conformite_par_(personne|agent|user)|par_visiteur)\b/i,
]

describe('Doctrine — la visite qualifie un lieu, jamais une personne', () => {
  it('la migration 162 ne déclare aucune colonne de notation individuelle', () => {
    const codeLines = read(MIGRATION)
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
    for (const re of FORBIDDEN_SCORING) {
      expect(re.test(codeLines), `Identifiant interdit dans ${MIGRATION}: ${re}`).toBe(false)
    }
  })

  it('la migration documente explicitement l’invariant anti-RH', () => {
    const sql = read(MIGRATION)
    expect(sql).toMatch(/JAMAIS[\s\S]{0,40}personne/i)
  })

  it('la clôture n’accepte aucune entrée `severity` (gravité retirée du MVP)', () => {
    const src = read(DB)
    const iface = src.match(/export interface CloseVisitInput \{([\s\S]*?)\}/)
    expect(iface, 'interface CloseVisitInput introuvable').toBeTruthy()
    expect(iface![1]).not.toMatch(/\bseverity\b/)
  })

  it('la couche visites n’agrège jamais un résultat par auteur (created_by + outcome)', () => {
    const src = read(DB)
    // Pas de regroupement/filtre de résultat par personne.
    expect(src).not.toMatch(/group[^;\n]*created_by/i)
    expect(src).not.toMatch(/\.eq\(['"]created_by['"][\s\S]{0,80}outcome/i)
  })
})
