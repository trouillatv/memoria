import { describe, it, expect } from 'vitest'
import {
  voiceReducer,
  voiceErrorMessage,
  INITIAL_VOICE_STATE,
  type VoiceEvent,
  type VoiceState,
} from '@/lib/voice/voice-session'

// Reproduit exactement ce que fait l'orbe : un état conservé, un `dispatch` qui
// renvoie « accepté ou non » par comparaison de référence, et l'envoi au
// copilote branché sur la *transition acceptée* vers `thinking`. Compter les
// envois ici, c'est compter les envois réels.
function session() {
  let state: VoiceState = INITIAL_VOICE_STATE
  const envois: string[] = []

  return {
    get state() { return state },
    envois,
    dispatch(event: VoiceEvent): boolean {
      const next = voiceReducer(state, event)
      const accepted = next !== state
      state = next
      if (accepted && next.phase === 'thinking' && next.transcript) envois.push(next.transcript)
      return accepted
    },
  }
}

/** Amène la session jusqu'à l'écoute active. */
function ecoute() {
  const s = session()
  s.dispatch({ type: 'OPEN' })
  s.dispatch({ type: 'MIC_READY' })
  return s
}

describe('voiceReducer — parcours nominal', () => {
  it('tap → écoute → silence → envoi automatique → réflexion → fermeture', () => {
    const s = ecoute()
    expect(s.state.phase).toBe('listening')

    expect(s.dispatch({ type: 'END_OF_SPEECH', reason: 'silence' })).toBe(true)
    expect(s.state).toMatchObject({ phase: 'finalizing', endReason: 'silence' })

    expect(s.dispatch({ type: 'AUDIO_READY' })).toBe(true)
    expect(s.dispatch({ type: 'TRANSCRIPT', text: '  Quels contrôles sur PETRO ATITI ?  ' })).toBe(true)
    expect(s.state.phase).toBe('thinking')
    expect(s.envois).toEqual(['Quels contrôles sur PETRO ATITI ?'])

    s.dispatch({ type: 'ANSWER_SETTLED' })
    expect(s.state.phase).toBe('exiting')
    s.dispatch({ type: 'EXITED' })
    expect(s.state).toEqual(INITIAL_VOICE_STATE)
  })
})

describe('voiceReducer — un seul envoi, quoi qu’il arrive', () => {
  it('aucune parole : rien n’est envoyé et la suite du pipeline est refusée', () => {
    const s = ecoute()
    expect(s.dispatch({ type: 'NO_SPEECH' })).toBe(true)
    expect(s.state).toMatchObject({ phase: 'error', error: 'no-speech' })

    expect(s.dispatch({ type: 'AUDIO_READY' })).toBe(false)
    expect(s.dispatch({ type: 'TRANSCRIPT', text: 'du bruit de chantier' })).toBe(false)
    expect(s.envois).toEqual([])
  })

  it('tap manuel et silence quasi simultanés : une seule fin de parole', () => {
    const s = ecoute()
    expect(s.dispatch({ type: 'END_OF_SPEECH', reason: 'manual' })).toBe(true)
    expect(s.dispatch({ type: 'END_OF_SPEECH', reason: 'silence' })).toBe(false)
    // La première raison gagne : c'est celle qui a réellement coupé le micro.
    expect(s.state).toMatchObject({ phase: 'finalizing', endReason: 'manual' })
  })

  it('`onstop` délivré deux fois : une seule transcription, un seul envoi', () => {
    const s = ecoute()
    s.dispatch({ type: 'END_OF_SPEECH', reason: 'silence' })
    expect(s.dispatch({ type: 'AUDIO_READY' })).toBe(true)
    expect(s.dispatch({ type: 'AUDIO_READY' })).toBe(false)

    expect(s.dispatch({ type: 'TRANSCRIPT', text: 'première' })).toBe(true)
    expect(s.dispatch({ type: 'TRANSCRIPT', text: 'seconde' })).toBe(false)
    expect(s.envois).toEqual(['première'])
  })

  it('transcription vide : pas d’envoi, retour en erreur exploitable', () => {
    const s = ecoute()
    s.dispatch({ type: 'END_OF_SPEECH', reason: 'silence' })
    s.dispatch({ type: 'AUDIO_READY' })
    expect(s.dispatch({ type: 'TRANSCRIPT', text: '   ' })).toBe(true)
    expect(s.state).toMatchObject({ phase: 'error', error: 'no-speech', transcript: null })
    expect(s.envois).toEqual([])
  })

  it('blob vide ou trop court : pas d’envoi', () => {
    const s = ecoute()
    s.dispatch({ type: 'END_OF_SPEECH', reason: 'manual' })
    expect(s.dispatch({ type: 'AUDIO_EMPTY' })).toBe(true)
    expect(s.state).toMatchObject({ phase: 'error', error: 'audio-empty' })
    expect(s.envois).toEqual([])
  })
})

describe('voiceReducer — annulation', () => {
  it.each(['listening', 'finalizing', 'sending'] as const)(
    'annuler pendant %s ferme sans rien envoyer',
    (cible) => {
      const s = ecoute()
      if (cible !== 'listening') s.dispatch({ type: 'END_OF_SPEECH', reason: 'silence' })
      if (cible === 'sending') s.dispatch({ type: 'AUDIO_READY' })
      expect(s.state.phase).toBe(cible)

      expect(s.dispatch({ type: 'CANCEL' })).toBe(true)
      expect(s.state.phase).toBe('exiting')
      // Une transcription arrivant après coup ne peut plus repartir.
      expect(s.dispatch({ type: 'TRANSCRIPT', text: 'trop tard' })).toBe(false)
      expect(s.envois).toEqual([])
    },
  )

  it('pendant la réflexion, la question est déjà partie : le X ne la rappelle pas', () => {
    const s = ecoute()
    s.dispatch({ type: 'END_OF_SPEECH', reason: 'silence' })
    s.dispatch({ type: 'AUDIO_READY' })
    s.dispatch({ type: 'TRANSCRIPT', text: 'question posée' })
    expect(s.envois).toHaveLength(1)

    // Refusé explicitement : c'est ANSWER_SETTLED qui referme l'orbe côté
    // appelant. Annuler ici serait mentir sur l'état du serveur.
    expect(s.dispatch({ type: 'CANCEL' })).toBe(false)
    expect(s.state.phase).toBe('thinking')
  })

  it('annuler pendant l’ouverture du micro est possible', () => {
    const s = session()
    s.dispatch({ type: 'OPEN' })
    expect(s.dispatch({ type: 'CANCEL' })).toBe(true)
    // Le micro obtenu après coup ne relance pas l'écoute.
    expect(s.dispatch({ type: 'MIC_READY' })).toBe(false)
  })
})

describe('voiceReducer — retour d’erreur', () => {
  it('erreur de transcription : réessayer rend l’orbe utilisable, sans traîner l’état précédent', () => {
    const s = ecoute()
    s.dispatch({ type: 'END_OF_SPEECH', reason: 'silence' })
    s.dispatch({ type: 'AUDIO_READY' })
    expect(s.dispatch({ type: 'TRANSCRIBE_FAILED' })).toBe(true)
    expect(s.state).toMatchObject({ phase: 'error', error: 'transcribe-failed' })

    expect(s.dispatch({ type: 'RETRY' })).toBe(true)
    expect(s.state).toMatchObject({ phase: 'entering', error: null, endReason: null, transcript: null })

    s.dispatch({ type: 'MIC_READY' })
    s.dispatch({ type: 'END_OF_SPEECH', reason: 'silence' })
    s.dispatch({ type: 'AUDIO_READY' })
    s.dispatch({ type: 'TRANSCRIPT', text: 'deuxième essai' })
    expect(s.envois).toEqual(['deuxième essai'])
  })

  it('micro refusé : erreur immédiate, aucun pipeline audio', () => {
    const s = session()
    s.dispatch({ type: 'OPEN' })
    expect(s.dispatch({ type: 'MIC_FAILED', kind: 'mic-denied' })).toBe(true)
    expect(voiceErrorMessage(s.state.error)).toBe("Le microphone n'est pas accessible")
    expect(s.dispatch({ type: 'END_OF_SPEECH', reason: 'silence' })).toBe(false)
  })

  it('n’accepte aucun événement de pipeline depuis l’état initial', () => {
    const s = session()
    for (const e of [
      { type: 'MIC_READY' },
      { type: 'END_OF_SPEECH', reason: 'silence' },
      { type: 'AUDIO_READY' },
      { type: 'TRANSCRIPT', text: 'fantôme' },
      { type: 'ANSWER_SETTLED' },
    ] as VoiceEvent[]) {
      expect(s.dispatch(e)).toBe(false)
    }
    expect(s.envois).toEqual([])
    expect(s.state).toEqual(INITIAL_VOICE_STATE)
  })
})
