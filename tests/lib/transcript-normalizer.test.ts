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
  { canonical: 'PETRO ATTITI', kind: 'site', forms: ['PETRO ATTITI'] },
  { canonical: 'Vincent Milon', kind: 'person', forms: ['Vincent Milon'] },
  { canonical: 'Clim Expair', kind: 'company', forms: ['Clim Expair'] },
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
      { from: 'pétro à Titi', to: 'PETRO ATTITI', kind: 'site', distance: 1 },
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
    // « Climexpert » ↔ « Clim Expair » : 3 substitutions. Le corpus dit
    // « Clim Expert », l'entreprise s'appelle « Clim Expair » — c'est une
    // question de donnée, pas de transcription.
    const r = normalizeTranscript('Climexpert est intervenu hier', PETRO)
    expect(r.text).toBe('Climexpert est intervenu hier')
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

describe('normalizeTranscript — formes alternatives', () => {
  it('accepte un alias comme cible et écrit toujours la forme canonique', () => {
    const vocab: VocabularyTerm[] = [
      { canonical: 'CEGELEC', kind: 'company', forms: ['CEGELEC', 'Cégélec Nouvelle-Calédonie'] },
    ]
    const r = normalizeTranscript('Relance Cégélec Nouvelle Calédonie', vocab)
    expect(r.text).toBe('Relance CEGELEC')
  })
})
