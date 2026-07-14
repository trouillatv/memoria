import { describe, it, expect } from 'vitest'
import { validateSources } from '@/services/ai/source-validation'
import type { Source } from '@/types/sources'

/**
 * « PAGE 7 » DE QUOI ?
 *
 * Depuis que l'analyse lit TOUT le dossier d'appel d'offres (PR #174/#177), le
 * corpus concatène RC + CCAP + CCTP + BPU… et CHAQUE pièce redémarre à
 * [[page 1]]. Le numéro de page, seul, a cessé de désigner quoi que ce soit : il
 * en existe une par pièce.
 *
 * L'écran affichait pourtant « PDF page 7 ». Au clic, l'utilisateur ne retrouve
 * rien — et une provenance fausse est pire que pas de provenance : elle détruit
 * la confiance, qui est l'actif du produit.
 *
 * La pièce n'est pas DEMANDÉE à l'agent : elle est CHERCHÉE, côté serveur, en
 * retrouvant la citation dans chacune des pièces. Une provenance devinée n'est
 * pas une provenance.
 */

const CORPUS = [
  '=== Règlement de consultation — rc.pdf ===',
  '[[page 1]] La remise des offres est fixée au 12 septembre.',
  '[[page 2]] Les candidats produisent une attestation d assurance.',
  '',
  '=== CCTP — cctp.pdf ===',
  '[[page 1]] Les luminaires sont de classe II.',
  '[[page 2]] La peinture est appliquee en deux couches croisees.',
  '',
  '=== BPU — bpu.pdf ===',
  '[[page 1]] Prix unitaire du point lumineux : 12 000 XPF.',
].join('\n')

function validate(quote: string): Source | undefined {
  const sources: Source[] = [{ type: 'pdf', quote }]
  return validateSources(sources, { extractedText: CORPUS, knowledgeItems: [] })[0]
}

describe('Une citation issue du dossier d’appel d’offres', () => {
  it('nomme la PIÈCE d’où elle vient', () => {
    const src = validate('La peinture est appliquee en deux couches croisees.')
    expect(src?.document).toBe('CCTP — cctp.pdf')
  })

  it('donne la page DANS cette pièce, pas dans le corpus concaténé', () => {
    const src = validate('La peinture est appliquee en deux couches croisees.')
    // C'est la page 2 DU CCTP. Sur le corpus entier, ce serait la 4e page lue.
    expect(src?.page).toBe(2)
  })

  it('distingue deux pièces qui ont toutes deux une « page 1 »', () => {
    const rc = validate('La remise des offres est fixée au 12 septembre.')
    const cctp = validate('Les luminaires sont de classe II.')

    expect(rc?.document).toBe('Règlement de consultation — rc.pdf')
    expect(cctp?.document).toBe('CCTP — cctp.pdf')

    // Même numéro de page — et c'est bien pour ça qu'il fallait nommer la pièce.
    expect(rc?.page).toBe(1)
    expect(cctp?.page).toBe(1)
  })

  it('ne se laisse pas abuser par la page devinée par l’agent', () => {
    // L'agent prétend « page 9 ». Le serveur, lui, sait où est le texte.
    const sources: Source[] = [
      { type: 'pdf', quote: 'Prix unitaire du point lumineux : 12 000 XPF.', page: 9 },
    ]
    const out = validateSources(sources, { extractedText: CORPUS, knowledgeItems: [] })
    expect(out[0]?.document).toBe('BPU — bpu.pdf')
    expect(out[0]?.page).toBe(1)
  })

  it('reste compatible avec un dossier d’une seule pièce (sans en-tête)', () => {
    const sources: Source[] = [{ type: 'pdf', quote: 'Les luminaires sont de classe II.' }]
    const out = validateSources(sources, {
      extractedText: '[[page 3]] Les luminaires sont de classe II.',
      knowledgeItems: [],
    })
    expect(out[0]?.verified).toBe(true)
    expect(out[0]?.document).toBeUndefined()
    expect(out[0]?.page).toBe(3)
  })

  it('ne fabrique JAMAIS une source qui n’existe pas dans le dossier', () => {
    const out = validate('Le chantier est livré en février 2027.')
    expect(out).toBeUndefined()
  })
})
