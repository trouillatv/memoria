import { describe, it, expect } from 'vitest'
import { buildExtractionPrompt } from '@/lib/documents/historical-visit-extractor'

// Lot F1 — doctrine de CAPTURE de la présence : PREUVE-FIRST. Une présence
// « présent » n'est émise que sur preuve documentaire explicite ; interlocuteur,
// rôle, contact, mention cartouche → « inconnu ». On protège le CONTENU du
// contrat ici ; le comportement réel est prouvé par la recette LLM corpus.

const PROMPT = buildExtractionPrompt('[[page 1]] texte', 1)

describe('F1 — la présence ne s’infère jamais d’un rôle / d’une mention', () => {
  it('énonce explicitement PREUVE-FIRST sur la famille person', () => {
    expect(PROMPT).toMatch(/doctrine PREUVE-FIRST/i)
    expect(PROMPT).toMatch(/la présence ne s'INFÈRE JAMAIS d'une simple mention, d'un rôle/i)
  })
  it('liste interlocuteur / RUS / contact / client / rôle comme NON preuve', () => {
    expect(PROMPT).toMatch(/statut d'« interlocuteur »/i)
    expect(PROMPT).toMatch(/RUS, MOE, AMO, maître d'ouvrage, titulaire/i)
  })
  it('défaut = inconnu en l’absence de preuve', () => {
    expect(PROMPT).toMatch(/À défaut de preuve → "inconnu"/i)
  })
})

describe('F1 — section dédiée « Statut de présence — PREUVE-FIRST »', () => {
  it('présent uniquement sur preuve explicite (colonne cochée / rubrique Présents / mention)', () => {
    expect(PROMPT).toMatch(/Statut de présence — PREUVE-FIRST/i)
    expect(PROMPT).toMatch(/case cochée.*colonne « Présent »/i)
    expect(PROMPT).toMatch(/rubrique « Présents/i)
    expect(PROMPT).toMatch(/I P AE AN D/)
  })
  it('interlocuteur / contact / cartouche / appartenance entreprise ne prouvent PAS la présence', () => {
    expect(PROMPT).toMatch(/ne prouvent PAS sa présence/i)
    expect(PROMPT).toMatch(/nommée au cartouche \/ en-tête \/ liste de contacts/i)
  })
  it('diffusion / destinataire → diffusion uniquement ; excusé/absent distingués', () => {
    expect(PROMPT).toMatch(/« Destinataire ».*→ "diffusion uniquement"/i)
    expect(PROMPT).toMatch(/« excusé\(e\) » → "absent excusé"/i)
    expect(PROMPT).toMatch(/« absent » → "absent non excusé"/i)
  })
  it('doute / ambiguïté → inconnu (l’absence de preuve n’est jamais une présence)', () => {
    expect(PROMPT).toMatch(/ambiguïté → "inconnu"/i)
    expect(PROMPT).toMatch(/L'absence de preuve n'est jamais une présence/i)
  })
})
