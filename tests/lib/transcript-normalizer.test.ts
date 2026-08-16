// @vitest-environment node
/**
 * P3-B — normalisation déterministe d'un transcript contre un vocabulaire fermé.
 *
 * Les cas ci-dessous ne sont pas inventés : ce sont les erreurs RÉELLES de
 * Gemini Live relevées sur téléphone le 16/08 (17 essais), plus les cas où une
 * correction serait une faute plus grave que l'erreur d'origine.
 *
 * Ce que ces tests protègent surtout, c'est le droit de NE PAS corriger.
 */
import { describe, it, expect } from 'vitest'
import { normalizeTranscript, maxDistanceFor, type VocabularyTerm } from '@/lib/ai/transcript-normalizer'

/** Vocabulaire fermé réel de PETRO (audit du 16/08 : 7 termes, 0 paire ambiguë). */
const PETRO: VocabularyTerm[] = [
  // Formes fausses documentées, telles que `buildSiteVocabulary` les produit.
  { canonical: 'PETRO ATTITI', kind: 'site', forms: ['PETRO ATTITI', 'P3 à Titi', 'Pétro à Titi', 'Petrofac Titi'] },
  { canonical: 'Vincent Milon', kind: 'person', forms: ['Vincent Milon'] },
  // Forme fausse documentée, telle que `buildSiteVocabulary` la produit désormais.
  { canonical: 'Clim Expair', kind: 'company', forms: ['Clim Expair', 'Clim Expert'] },
  { canonical: 'CEGELEC', kind: 'company', forms: ['CEGELEC'] },
  { canonical: 'APAVE', kind: 'company', forms: ['APAVE'] },
  { canonical: 'Ginger', kind: 'company', forms: ['Ginger'] },
  { canonical: 'AGP', kind: 'acronym', forms: ['AGP'] },
]

describe('maxDistanceFor', () => {
  it('n’accorde aucune tolérance aux sigles courts', () => {
    expect(maxDistanceFor(3)).toBe(0)
    expect(maxDistanceFor(5)).toBe(0)
  })

  it('accorde une substitution aux noms de taille moyenne', () => {
    expect(maxDistanceFor(6)).toBe(1)
    expect(maxDistanceFor(12)).toBe(1)
  })

  it('reste proportionnelle au-delà', () => {
    expect(maxDistanceFor(20)).toBe(2)
  })
})

describe('normalizeTranscript — corrections certaines', () => {
  it('recolle un empan multi-mots : « pétro à Titi » → PETRO ATTITI', () => {
    const r = normalizeTranscript('Ajoute une réserve sur le chantier pétro à Titi', PETRO)
    expect(r.text).toBe('Ajoute une réserve sur le chantier PETRO ATTITI')
    expect(r.corrections).toEqual([
      { from: 'pétro à Titi', to: 'PETRO ATTITI', kind: 'site', distance: 0 },
    ])
    expect(r.abstentions).toEqual([])
  })

  it('corrige un nom de personne à une lettre près', () => {
    const r = normalizeTranscript('Note que Vincent Millon a validé le point', PETRO)
    expect(r.text).toBe('Note que Vincent Milon a validé le point')
    expect(r.corrections[0]).toMatchObject({ to: 'Vincent Milon', kind: 'person', distance: 1 })
  })

  it('réécrit une forme déjà correcte mais mal ponctuée, sans rien inventer', () => {
    const r = normalizeTranscript('Réserve sur Petro-Attiti', PETRO)
    expect(r.text).toBe('Réserve sur PETRO ATTITI')
    expect(r.corrections[0]).toMatchObject({ from: 'Petro-Attiti', distance: 0 })
  })

  it('n’insère pas de mot non prononcé et laisse le reste intact', () => {
    const r = normalizeTranscript('CEGELEC intervient demain matin sur le lot électricité', PETRO)
    expect(r.text).toBe('CEGELEC intervient demain matin sur le lot électricité')
    expect(r.corrections).toEqual([])
  })
})

describe('normalizeTranscript — refus de corriger', () => {
  it('ne transforme jamais un sigle en un autre sigle', () => {
    const vocab: VocabularyTerm[] = [{ canonical: 'CSI', kind: 'acronym', forms: ['CSI'] }]
    const r = normalizeTranscript('Vérifie le SSI du bâtiment', vocab)
    expect(r.text).toBe('Vérifie le SSI du bâtiment')
    expect(r.corrections).toEqual([])
  })

  it('renonce quand le mot entendu est trop loin du terme réel', () => {
    // Même entreprise, autre faute — mais celle-ci n'est pas documentée : le
    // moteur n'a pas le droit de deviner. C'est ce test qui prouve que l'alias
    // du 17/08 n'a pas élargi la tolérance générale.
    const r = normalizeTranscript('Clim Expresse est intervenu hier', PETRO)
    expect(r.text).toBe('Clim Expresse est intervenu hier')
    expect(r.corrections).toEqual([])
  })

  it('ne touche ni aux verbes ni au français libre', () => {
    const phrase = 'On voit un message à l’équipe pour demain'
    const r = normalizeTranscript(phrase, PETRO)
    expect(r.text).toBe(phrase)
    expect(r.corrections).toEqual([])
  })

  it('s’abstient quand deux termes réels sont également plausibles', () => {
    const vocab: VocabularyTerm[] = [
      { canonical: 'Martin Dupont', kind: 'person', forms: ['Martin Dupont'] },
      { canonical: 'Martin Dupond', kind: 'person', forms: ['Martin Dupond'] },
    ]
    const r = normalizeTranscript('Appelle Martin Dupone ce matin', vocab)
    expect(r.text).toBe('Appelle Martin Dupone ce matin')
    expect(r.corrections).toEqual([])
    expect(r.abstentions).toHaveLength(1)
    expect(r.abstentions[0].span).toBe('Martin Dupone')
    expect(r.abstentions[0].candidates.sort()).toEqual(['Martin Dupond', 'Martin Dupont'])
  })

  it('rend le transcript inchangé quand le vocabulaire est vide', () => {
    const phrase = 'Ajoute une réserve sur le chantier pétro à Titi'
    expect(normalizeTranscript(phrase, []).text).toBe(phrase)
  })
})

describe('normalizeTranscript — Clim Expair (arbitrage métier du 17/08)', () => {
  // La vérité métier est « Clim Expair ». « Clim Expert » n'existe pas : c'est
  // une mauvaise transcription, pas une variante à préserver. Le cas est réel —
  // il vient du corpus téléphone du 16/08.
  it('corrige « Clim Expert » vers « Clim Expair », sans hésitation', () => {
    const r = normalizeTranscript('Clim Expert doit repasser sur le lot climatisation', PETRO)
    expect(r.text).toBe('Clim Expair doit repasser sur le lot climatisation')
    expect(r.corrections).toEqual([
      { from: 'Clim Expert', to: 'Clim Expair', kind: 'company', distance: 0 },
    ])
    expect(r.abstentions).toEqual([])
  })

  it('corrige aussi la forme collée en un mot', () => {
    const r = normalizeTranscript('Climexpert est intervenu hier', PETRO)
    expect(r.text).toBe('Clim Expair est intervenu hier')
  })

  it('laisse « Clim Expert » intact si l’entreprise n’est pas au vocabulaire', () => {
    // L'alias est une faute attendue SUR UN TERME RÉEL : sans le terme, rien.
    const r = normalizeTranscript('Clim Expert doit repasser', [
      { canonical: 'CEGELEC', kind: 'company', forms: ['CEGELEC'] },
    ])
    expect(r.text).toBe('Clim Expert doit repasser')
    expect(r.corrections).toEqual([])
  })
})

describe('normalizeTranscript — PETRO ATTITI (recette terrain du 17/08)', () => {
  // Les deux formulations RÉELLEMENT sorties de Gemini Live sur téléphone.
  // « P3 à Titi » est celle qui a traversé le Copilote sans correction : le
  // rapprochement flou ne pouvait pas la voir (distance 5 pour une tolérance
  // de 1) et ne DOIT pas pouvoir la voir.
  it('corrige « P3 à Titi » vers PETRO ATTITI', () => {
    const r = normalizeTranscript('où en est le chantier P3 à Titi ?', PETRO)
    expect(r.text).toBe('où en est le chantier PETRO ATTITI ?')
    expect(r.corrections).toEqual([
      { from: 'P3 à Titi', to: 'PETRO ATTITI', kind: 'site', distance: 0 },
    ])
    expect(r.abstentions).toEqual([])
  })

  it('corrige « Pétro à Titi » vers PETRO ATTITI', () => {
    const r = normalizeTranscript('où en est le chantier Pétro à Titi ?', PETRO)
    expect(r.text).toBe('où en est le chantier PETRO ATTITI ?')
    expect(r.corrections[0]).toMatchObject({ to: 'PETRO ATTITI', distance: 0 })
  })

  // Troisième formulation observée en recette terrain le 17/08 (tours 4-5) :
  // Gemini Live entend le nom d'une entreprise pétrolière réelle (Petrofac) au
  // lieu du sigle du chantier. Restée non corrigée jusqu'ici, elle passait au
  // Copilote telle quelle — la classification/réponse restaient correctes
  // (le contexte du chantier courant compense), mais le nom affiché était faux.
  it('corrige « Petrofac Titi » vers PETRO ATTITI', () => {
    const r = normalizeTranscript('où en est le chantier Petrofac Titi ?', PETRO)
    expect(r.text).toBe('où en est le chantier PETRO ATTITI ?')
    expect(r.corrections).toEqual([
      { from: 'Petrofac Titi', to: 'PETRO ATTITI', kind: 'site', distance: 0 },
    ])
    expect(r.abstentions).toEqual([])
  })

  it('ne touche toujours pas « Pétro Haïti » — Haïti est un mot réel', () => {
    // La garde du lot : nommer deux fautes n'a pas rendu le moteur permissif.
    const phrase = 'où en est le chantier Pétro Haïti ?'
    expect(normalizeTranscript(phrase, PETRO).text).toBe(phrase)
  })

  it('ne fabrique pas un nom de chantier depuis du français courant', () => {
    const phrase = 'le petit atelier a été rangé ce matin'
    const r = normalizeTranscript(phrase, PETRO)
    expect(r.text).toBe(phrase)
    expect(r.corrections).toEqual([])
  })
})

describe('normalizeTranscript — formes alternatives', () => {
  it('accepte un alias comme cible et écrit toujours la forme canonique', () => {
    const vocab: VocabularyTerm[] = [
      { canonical: 'CEGELEC', kind: 'company', forms: ['CEGELEC', 'Cégélec Nouvelle-Calédonie'] },
    ]
    const r = normalizeTranscript('Relance Cégélec Nouvelle Calédonie', vocab)
    expect(r.text).toBe('Relance CEGELEC')
  })
})
