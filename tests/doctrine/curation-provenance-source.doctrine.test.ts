// Tripwire doctrinal : l'écran de curation affiche la source depuis la
// provenance structurée persistée, et ne réintroduit pas la page devinée de
// source_ref comme libellé de source.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')

const view = read('app/(dashboard)/tenders/[id]/engagement-curation-view.tsx')
const page = read('app/(dashboard)/tenders/[id]/engagements/page.tsx')

function codeOnly(src: string): string {
  return src
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')
}

describe('Curation — source depuis la provenance structurée', () => {
  it('la page charge le read model et dérive la source via le presenter partagé', () => {
    expect(/listTenderEngagementProvenance\(/.test(page)).toBe(true)
    expect(/engagementSourceDisplay\(/.test(page)).toBe(true)
    expect(/sourceDisplays/.test(page)).toBe(true)
  })

  it('la vue affiche la source du presenter, pas une réf. dérivée de source_ref', () => {
    expect(/sourceDisplays/.test(view)).toBe(true)
    const code = codeOnly(view)
    // Plus aucune lecture de source_ref (ni ref.page / ref.section) pour la source.
    expect(/source_ref/.test(code)).toBe(false)
    expect(/ref\.page|ref\.section/.test(code)).toBe(false)
  })

  it('presenter partagé = UNIQUE source de vérité (libellé + filtre)', () => {
    const presenter = read('lib/tenders/engagement-source-display.ts')
    expect(/Proposé dans le mémoire technique/.test(presenter)).toBe(true)
    expect(/Source non localisée/.test(presenter)).toBe(true)
    expect(/Exigence AO/.test(presenter)).toBe(true)
    // La valeur de filtre est l'identité stable, jamais le nom affiché.
    expect(/filterValue/.test(presenter)).toBe(true)
  })
})
