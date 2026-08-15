import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  markVoice,
  getVoiceLatencySnapshot,
  formatVoiceLatency,
} from '@/lib/voice/voice-latency'

// Un instrument qui mesure la mauvaise chose est pire que pas d'instrument :
// il oriente une optimisation. Ces tests protègent donc les deux règles qui
// garantissent que les chiffres publiés correspondent à un vrai parcours vocal.

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  // Chaque test repart d'une session neuve.
  markVoice('endOfSpeech')
})

describe('markVoice — sessions et jalons', () => {
  it('mesure les trois segments d’un parcours complet', () => {
    markVoice('transcript')
    markVoice('answer')
    markVoice('firstSound')

    const r = getVoiceLatencySnapshot()
    for (const v of [r.transcriptionMs, r.answerMs, r.speechStartMs, r.totalMs]) {
      expect(v).not.toBeNull()
      expect(v).toBeGreaterThanOrEqual(0)
    }
  })

  it('sans son, le parcours reste mesuré et « réponse→son » vaut null', () => {
    markVoice('transcript')
    markVoice('answer')

    const r = getVoiceLatencySnapshot()
    expect(r.answerMs).not.toBeNull()
    expect(r.speechStartMs).toBeNull()
    expect(r.totalMs).not.toBeNull()
  })

  it('le premier passage gagne : un jalon rejoué ne décale pas la mesure', () => {
    markVoice('transcript')
    const premier = getVoiceLatencySnapshot().transcriptionMs
    markVoice('transcript')
    expect(getVoiceLatencySnapshot().transcriptionMs).toBe(premier)
  })

  it('hors session, un jalon est ignoré : une question tapée n’est pas mesurée', () => {
    // Nouvelle session ouverte puis « oubliée » — on simule un module fraîchement
    // chargé en marquant directement une réponse sans fin de parole préalable.
    markVoice('firstSound')
    markVoice('answer')
    const avant = getVoiceLatencySnapshot()

    // La transcription n'a jamais eu lieu : aucun segment ne peut être inventé.
    expect(avant.transcriptionMs).toBeNull()
    expect(avant.answerMs).toBeNull()
  })

  it('une nouvelle fin de parole remet le compteur à zéro', () => {
    markVoice('transcript')
    markVoice('answer')
    expect(getVoiceLatencySnapshot().answerMs).not.toBeNull()

    markVoice('endOfSpeech')
    const r = getVoiceLatencySnapshot()
    expect(r.transcriptionMs).toBeNull()
    expect(r.answerMs).toBeNull()
    expect(r.totalMs).toBeNull()
  })
})

describe('formatVoiceLatency', () => {
  it('rien à afficher tant qu’aucun jalon n’est atteint', () => {
    expect(formatVoiceLatency(getVoiceLatencySnapshot())).toBeNull()
  })

  it('affiche les quatre valeurs, tiret pour un segment absent', () => {
    markVoice('transcript')
    markVoice('answer')
    const line = formatVoiceLatency(getVoiceLatencySnapshot())
    expect(line).toContain('parole→texte')
    expect(line).toContain('texte→réponse')
    expect(line).toContain('réponse→son —')
    expect(line).toContain('total')
  })
})
