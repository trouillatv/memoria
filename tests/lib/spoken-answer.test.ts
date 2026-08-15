import { describe, it, expect } from 'vitest'
import {
  sanitizeSpokenText,
  spokenFromShortAnswer,
  buildSpokenFallback,
  SPOKEN_MAX_CHARS,
  SHORT_ANSWER_MAX_CHARS,
} from '@/lib/voice/spoken-answer'
import { pickFrenchVoice, type VoiceLike } from '@/lib/voice/speech-output'

describe('sanitizeSpokenText — la voix ne peut jamais casser la réponse', () => {
  it('accepte une synthèse orale normale', () => {
    expect(sanitizeSpokenText("Rien ne semble urgent aujourd'hui."))
      .toBe("Rien ne semble urgent aujourd'hui.")
  })

  it('laisse passer une réponse hiérarchisée à une question large', () => {
    // Cas de référence de la doctrine « verdict puis 1 à 3 faits » : quatre
    // phrases, ~380 caractères. L'ancien plafond de 400 la jetait par moments —
    // MemorIA devenait muette exactement là où elle avait le plus à dire.
    const riche =
      "Rien ne ressort comme réellement urgent sur ce chantier aujourd'hui. En revanche deux sujets méritent " +
      "d'être relancés dès demain : la sécurisation du matériel et le nouveau toilette, tous les deux sans " +
      "changement depuis quatre passages. Je vérifierais aussi l'absence de courant, qui revient depuis deux " +
      "visites. Le SSI, lui, a bien évolué depuis votre dernier passage et ne demande rien de particulier."
    expect(riche.length).toBeGreaterThan(400)
    expect(riche.length).toBeLessThanOrEqual(SPOKEN_MAX_CHARS)
    expect(sanitizeSpokenText(riche)).toBe(riche)
  })

  it.each([
    ['absent', undefined],
    ['nul', null],
    ['mauvais type', 42],
    ['objet', { text: 'coucou' }],
    ['vide', '   '],
  ])('%s → null, sans lever', (_label, input) => {
    expect(sanitizeSpokenText(input)).toBeNull()
  })

  it('trop long → jeté, jamais tronqué (une phrase amputée s’entend)', () => {
    const trop = 'a'.repeat(SPOKEN_MAX_CHARS + 1)
    expect(sanitizeSpokenText(trop)).toBeNull()
    expect(sanitizeSpokenText('a'.repeat(SPOKEN_MAX_CHARS))).toHaveLength(SPOKEN_MAX_CHARS)
  })

  it('retire le markdown : la voix ne prononce pas des astérisques', () => {
    expect(sanitizeSpokenText('**Trois points** à revoir, dont *l’électricité*.'))
      .toBe('Trois points à revoir, dont l’électricité.')
    expect(sanitizeSpokenText('- Premier point\n- Second point'))
      .toBe('Premier point Second point')
    expect(sanitizeSpokenText('## Titre\n> citation')).toBe('Titre citation')
  })

  it('retire les identifiants techniques', () => {
    expect(sanitizeSpokenText('Le sujet 3f2a1b4c-9d8e-4f7a-b6c5-1a2b3c4d5e6f stagne.'))
      .toBe('Le sujet stagne.')
  })
})

describe('spokenFromShortAnswer — réponses sans LLM', () => {
  it('une phrase courte se prononce telle quelle', () => {
    const t = 'Aucun retard sur ce chantier à ce jour.'
    expect(spokenFromShortAnswer(t)).toBe(t)
  })

  it('une réponse structurée reste silencieuse même si elle est courte', () => {
    expect(spokenFromShortAnswer('Deux points :\n- électricité\n- terrassement')).toBeNull()
    expect(spokenFromShortAnswer('Contexte.\n\nConclusion.')).toBeNull()
  })

  it('au-delà du seuil : silence, pas de résumé improvisé', () => {
    expect(spokenFromShortAnswer('a'.repeat(SHORT_ANSWER_MAX_CHARS + 1))).toBeNull()
    expect(spokenFromShortAnswer('a'.repeat(SHORT_ANSWER_MAX_CHARS))).not.toBeNull()
  })

  it('vide → null', () => {
    expect(spokenFromShortAnswer('')).toBeNull()
    expect(spokenFromShortAnswer('   \n  ')).toBeNull()
  })
})

describe('buildSpokenFallback — un compteur en français, rien de plus', () => {
  it('verbalise le nombre de contrôles sans rien interpréter', () => {
    expect(buildSpokenFallback(5)).toBe("J'ai identifié cinq points à vérifier.")
  })

  it('accorde le singulier', () => {
    expect(buildSpokenFallback(1)).toBe("J'ai identifié un point à vérifier.")
  })

  it('au-delà du vocabulaire court, le chiffre se prononce bien', () => {
    expect(buildSpokenFallback(23)).toBe("J'ai identifié 23 points à vérifier.")
  })

  it.each([0, -3, Number.NaN, Number.POSITIVE_INFINITY])('compteur %s : phrase de vide, jamais de non-sens', (n) => {
    expect(buildSpokenFallback(n)).toBe("Je n'ai identifié aucun point à vérifier.")
  })

  it.each([0, 1, 5, 23])('ne renvoie jamais l’utilisateur vers l’écran (%s)', (n) => {
    // La voix et l'écran ne sont pas deux systèmes concurrents : MemorIA
    // s'arrête sur sa réponse, elle ne décrit pas son interface.
    expect(buildSpokenFallback(n)).not.toMatch(/affich|écran|ci-dessous|consultez/i)
  })
})

describe('pickFrenchVoice — par score, jamais par nom en dur', () => {
  const v = (p: Partial<VoiceLike>): VoiceLike => ({
    name: '', lang: 'en-US', voiceURI: '', localService: false, default: false, ...p,
  })

  it('préfère fr-FR à une autre variante française', () => {
    const fr = v({ name: 'Voix A', lang: 'fr-FR' })
    const ca = v({ name: 'Voix B', lang: 'fr-CA', default: true })
    expect(pickFrenchVoice([ca, fr])).toBe(fr)
  })

  it('à langue égale, préfère une voix de qualité déclarée', () => {
    const base    = v({ name: 'Thomas', lang: 'fr-FR', default: true, localService: true })
    const premium = v({ name: 'Thomas (Enhanced)', lang: 'fr-FR' })
    expect(pickFrenchVoice([base, premium])).toBe(premium)
  })

  it('ignore totalement les voix non françaises', () => {
    expect(pickFrenchVoice([
      v({ name: 'Samantha (Premium)', lang: 'en-US', default: true }),
      v({ name: 'Anna', lang: 'de-DE' }),
    ])).toBeNull()
  })

  it('accepte fr-CA quand c’est le seul français disponible', () => {
    const ca = v({ name: 'Amélie', lang: 'fr_CA' })
    expect(pickFrenchVoice([v({ lang: 'en-GB' }), ca])).toBe(ca)
  })

  it('liste vide → null (le moteur parlera dans sa voix par défaut)', () => {
    expect(pickFrenchVoice([])).toBeNull()
  })
})
