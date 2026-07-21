import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

// ── LE TRIAGE DES CAPTURES NE DOIT PAS SE LIRE DE DEUX FAÇONS ────────────────
//
// Guillaume a tagué un vocal « Une réserve » en pensant l'écarter — « mets ça de
// côté ». MemorIA a compris « défaut à lever » et l'a gardé. Ni l'IA ni lui
// n'avaient tort : c'est le MOT qui portait deux sens dans un écran où tous les
// autres gestes trient des captures.
//
// Deux règles en sortent, et ces tests les tiennent :
//   1. les quatre tags portent un VERBE — « à conserver », « à surveiller »,
//      « à lever », « à prévoir ». Un nom nu laisse la place à l'autre sens ;
//   2. le geste d'exclusion ne dit pas « supprimer », parce qu'il ne supprime
//      rien : la capture passe en `discarded` et reste consultable.

const TRIAGE = path.join(process.cwd(), 'app/(field)/m/visite/[reportId]/CaptureTriage.tsx')
const src = fs.readFileSync(TRIAGE, 'utf8')

/** Le code sans ses commentaires — on juge ce que le conducteur LIT. */
function visible(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}
const vu = visible(src)

describe('Les quatre tags du triage portent un verbe', () => {
  it('« Une réserve » seul n’existe plus — c’est « une réserve à lever »', () => {
    expect(vu).toContain('Une réserve à lever')
    expect(vu).not.toMatch(/label:\s*'Une réserve'/)
  })

  it.each([
    ['à conserver', /à conserver/],
    ['à surveiller', /à surveiller/i],
    ['à lever', /à lever/],
    ['à prévoir', /à prévoir/],
  ])('le tag « %s » dit ce qu’on en fera', (_label, motif) => {
    expect(vu).toMatch(motif)
  })
})

describe('Écarter une capture n’est pas la supprimer', () => {
  it('le geste ne s’appelle plus « Supprimer »', () => {
    expect(vu).not.toMatch(/['"]Supprimer['"]/)
    expect(vu).not.toMatch(/['"]Supprimée['"]/)
  })

  it('il dit ce qu’il fait vraiment : la capture sort du compte-rendu', () => {
    expect(vu).toContain('Ne pas retenir')
    expect(vu).toContain('Écartée du compte-rendu')
  })
})

describe('Le même mot d’un écran à l’autre', () => {
  it('les suites proposées disent aussi « réserve à lever »', () => {
    const suites = fs.readFileSync(
      path.join(process.cwd(), 'app/(field)/m/visite/[reportId]/SuiteProposals.tsx'),
      'utf8',
    )
    expect(visible(suites)).toContain('Réserve à lever')
  })
})
