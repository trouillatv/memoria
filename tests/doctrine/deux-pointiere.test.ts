import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { siteLabel } from '@/lib/labels/site-label'

/**
 * « POINTIÈRE » NE VEUT RIEN DIRE TOUT SEUL.
 *
 * Constat de Guillaume, en séance : il y a le magasin Discount de Pointière ET la
 * mairie de Pointière. Le nom d'un chantier n'identifie pas un chantier — c'est
 * le couple CLIENT + LIEU qui l'identifie.
 *
 * Le helper `siteLabel` existait, et la vue Semaine l'utilisait. Mais la vue Mois
 * et le tiroir de la Semaine affichaient encore le nom SEUL : deux « Pointière »
 * y restaient rigoureusement indistinguables. Le correctif était à moitié posé.
 *
 * Ce test ferme la moitié manquante, et empêche la prochaine surface de repartir
 * du nom seul.
 */

const SURFACES = [
  // fichier, ce qu'on doit y trouver
  ['app/(dashboard)/(planning)/mois/page.tsx', 'la ligne de la vue Mois'],
  ['app/(dashboard)/(planning)/semaine/WeekGrid.tsx', 'la ligne de la vue Semaine'],
  ['app/(dashboard)/(planning)/semaine/CellDrawer.tsx', 'le tiroir du planning'],
  ['app/(dashboard)/(planning)/semaine/CreateInterventionDialog.tsx', 'le planificateur'],
] as const

describe('Le helper d’étiquette', () => {
  it('nomme le chantier par son client', () => {
    expect(siteLabel('Pointière', 'Discount')).toBe('Discount — Pointière')
  })

  it('retombe sur le nom seul quand le client est inconnu', () => {
    // Un chantier peut exister AVANT son client (migration 210). Le libellé ne
    // doit pas inventer un tiret dans le vide.
    expect(siteLabel('Pointière', null)).toBe('Pointière')
    expect(siteLabel('Pointière', '  ')).toBe('Pointière')
  })
})

describe('Les surfaces du planning', () => {
  for (const [file, what] of SURFACES) {
    it(`nomment le client sur ${what}`, () => {
      const path = join(process.cwd(), file)
      expect(existsSync(path), `${file} introuvable`).toBe(true)
      const src = readFileSync(path, 'utf8')
      expect(
        src.includes('siteLabel'),
        `${what} affiche un nom de chantier sans son client. ` +
          `Deux « Pointière » y sont indistinguables — utilise siteLabel(siteName, clientName).`,
      ).toBe(true)
    })
  }
})

describe('La vue Mois', () => {
  it('rapatrie le client depuis la base — sans la donnée, l’étiquette est vide', () => {
    const db = readFileSync(join(process.cwd(), 'lib', 'db', 'month-view.ts'), 'utf8')
    expect(db).toMatch(/clientName:\s*string \| null/)
    expect(db).toContain('client:clients(name)')
  })
})
