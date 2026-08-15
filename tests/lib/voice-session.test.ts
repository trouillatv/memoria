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
  it('tap → écoute → silence → envoi automatique → réflexion → retour en écoute', () => {
    const s = ecoute()
    expect(s.state.phase).toBe('listening')

    expect(s.dispatch({ type: 'END_OF_SPEECH', reason: 'silence' })).toBe(true)
    expect(s.state).toMatchObject({ phase: 'finalizing', endReason: 'silence' })

    expect(s.dispatch({ type: 'AUDIO_READY' })).toBe(true)
    expect(s.dispatch({ type: 'TRANSCRIPT', text: '  Quels contrôles sur PETRO ATITI ?  ' })).toBe(true)
    expect(s.state.phase).toBe('thinking')
    expect(s.envois).toEqual(['Quels contrôles sur PETRO ATITI ?'])

    // Session continue : la fin d'un tour ne ferme rien. On repart écouter, et
    // la transcription du tour écoulé ne traîne pas sous l'orbe — elle appartient
    // désormais au fil de la conversation.
    s.dispatch({ type: 'ANSWER_SETTLED' })
    expect(s.state).toMatchObject({ phase: 'entering', transcript: null })
  })
})

describe('voiceReducer — un seul envoi, quoi qu’il arrive', () => {
  it('aucune parole : le micro se relâche, rien n’est envoyé, la suite est refusée', () => {
    const s = ecoute()
    expect(s.dispatch({ type: 'IDLE_TIMEOUT' })).toBe(true)
    // `ready`, pas `error` : ne rien dire pendant vingt secondes n'est pas une
    // panne. Aucun message d'erreur, aucun bouton « Réessayer ».
    expect(s.state).toMatchObject({ phase: 'ready', error: null })

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

describe('voiceReducer — sortie vocale', () => {
  /** Amène jusqu'à la réflexion, question déjà partie. */
  function reflexion() {
    const s = ecoute()
    s.dispatch({ type: 'END_OF_SPEECH', reason: 'silence' })
    s.dispatch({ type: 'AUDIO_READY' })
    s.dispatch({ type: 'TRANSCRIPT', text: 'que dois-je vérifier ?' })
    return s
  }

  it('une lecture démarre : l’orbe reste, la transcription aussi', () => {
    const s = reflexion()
    expect(s.dispatch({ type: 'SPEECH_STARTED' })).toBe(true)
    expect(s.state).toMatchObject({ phase: 'speaking', transcript: 'que dois-je vérifier ?' })

    expect(s.dispatch({ type: 'SPEECH_ENDED' })).toBe(true)
    expect(s.state.phase).toBe('entering')
  })

  it('pas de voix (sourdine, moteur absent, synthèse vide) : on réécoute sans attendre', () => {
    const s = reflexion()
    // Aucune phase `speaking` n'est fabriquée pour faire semblant.
    expect(s.dispatch({ type: 'ANSWER_SETTLED' })).toBe(true)
    expect(s.state.phase).toBe('entering')
    // Une lecture tardive ne peut plus rattraper le tour écoulé.
    expect(s.dispatch({ type: 'SPEECH_STARTED' })).toBe(false)
  })

  it('aucun double passage en parole : le second SPEECH_STARTED est refusé', () => {
    const s = reflexion()
    expect(s.dispatch({ type: 'SPEECH_STARTED' })).toBe(true)
    expect(s.dispatch({ type: 'SPEECH_STARTED' })).toBe(false)
    expect(s.state.phase).toBe('speaking')
  })

  it('une fin de lecture sans lecture en cours ne ferme rien', () => {
    const s = reflexion()
    expect(s.dispatch({ type: 'SPEECH_ENDED' })).toBe(false)
    expect(s.state.phase).toBe('thinking')
  })

  it.each(['listening', 'finalizing', 'sending'] as const)(
    'une lecture ne peut pas démarrer pendant %s',
    (cible) => {
      const s = ecoute()
      if (cible !== 'listening') s.dispatch({ type: 'END_OF_SPEECH', reason: 'silence' })
      if (cible === 'sending') s.dispatch({ type: 'AUDIO_READY' })
      expect(s.dispatch({ type: 'SPEECH_STARTED' })).toBe(false)
      expect(s.state.phase).toBe(cible)
    },
  )

  it('interrompre la parole (tap ou X) ferme l’orbe sans rien renvoyer', () => {
    const s = reflexion()
    s.dispatch({ type: 'SPEECH_STARTED' })
    expect(s.dispatch({ type: 'CANCEL' })).toBe(true)
    expect(s.state.phase).toBe('exiting')
    expect(s.envois).toEqual(['que dois-je vérifier ?'])
  })

  it('une fin de lecture tardive n’a plus aucun effet après fermeture', () => {
    const s = reflexion()
    s.dispatch({ type: 'SPEECH_STARTED' })
    s.dispatch({ type: 'CANCEL' })
    s.dispatch({ type: 'EXITED' })
    expect(s.dispatch({ type: 'SPEECH_ENDED' })).toBe(false)
    expect(s.state).toEqual(INITIAL_VOICE_STATE)
  })

  it('un second SPEECH_ENDED après réarmement ne rejoue pas le tour', () => {
    const s = reflexion()
    s.dispatch({ type: 'SPEECH_STARTED' })
    expect(s.dispatch({ type: 'SPEECH_ENDED' })).toBe(true)
    // `onend` délivré deux fois par le moteur : le second tombe sur `entering`.
    expect(s.dispatch({ type: 'SPEECH_ENDED' })).toBe(false)
    expect(s.state.phase).toBe('entering')
  })
})

// ── Session continue ─────────────────────────────────────────────────────────
//
// C'est le lot lui-même : « ouvrir → écouter → répondre → écouter → répondre… »
// sans action intermédiaire. Ces tests ne vérifient pas un détail d'implémentation
// mais l'affirmation produit.

describe('voiceReducer — session conversationnelle continue', () => {
  /** Un tour complet, voix comprise, à partir d'une phase `entering`. */
  function tour(s: ReturnType<typeof session>, question: string, avecVoix: boolean) {
    expect(s.dispatch({ type: 'MIC_READY' })).toBe(true)
    s.dispatch({ type: 'END_OF_SPEECH', reason: 'silence' })
    s.dispatch({ type: 'AUDIO_READY' })
    expect(s.dispatch({ type: 'TRANSCRIPT', text: question })).toBe(true)
    if (avecVoix) {
      s.dispatch({ type: 'SPEECH_STARTED' })
      expect(s.state.phase).toBe('speaking')
      s.dispatch({ type: 'SPEECH_ENDED' })
    } else {
      s.dispatch({ type: 'ANSWER_SETTLED' })
    }
    // Après chaque tour, la machine est prête à réécouter — aucun geste requis.
    expect(s.state.phase).toBe('entering')
  }

  it('cinq questions successives dans la même session, sans réouverture', () => {
    const s = session()
    s.dispatch({ type: 'OPEN' })
    for (let i = 1; i <= 5; i++) tour(s, `question ${i}`, true)
    expect(s.envois).toEqual(['question 1', 'question 2', 'question 3', 'question 4', 'question 5'])
  })

  it('sourdine : cinq tours passent aussi, sans phase de parole', () => {
    const s = session()
    s.dispatch({ type: 'OPEN' })
    for (let i = 1; i <= 5; i++) tour(s, `question ${i}`, false)
    expect(s.envois).toHaveLength(5)
  })

  it('alterner voix et silence n’interrompt pas la conversation', () => {
    const s = session()
    s.dispatch({ type: 'OPEN' })
    tour(s, 'avec voix', true)
    tour(s, 'sans voix', false)
    tour(s, 'avec voix à nouveau', true)
    expect(s.envois).toEqual(['avec voix', 'sans voix', 'avec voix à nouveau'])
  })

  it('long silence → micro relâché → un tap reprend la conversation', () => {
    const s = session()
    s.dispatch({ type: 'OPEN' })
    tour(s, 'première question', true)

    s.dispatch({ type: 'MIC_READY' })
    expect(s.dispatch({ type: 'IDLE_TIMEOUT' })).toBe(true)
    expect(s.state.phase).toBe('ready')

    expect(s.dispatch({ type: 'WAKE' })).toBe(true)
    expect(s.state.phase).toBe('entering')
    tour(s, 'question suivante', true)
    expect(s.envois).toEqual(['première question', 'question suivante'])
  })

  it('le réveil n’est possible que depuis `ready`', () => {
    const s = ecoute()
    expect(s.dispatch({ type: 'WAKE' })).toBe(false)
    expect(s.state.phase).toBe('listening')
  })

  it('la croix ferme depuis TOUTES les phases actives, `thinking` et `ready` compris', () => {
    for (const cible of ['entering', 'listening', 'finalizing', 'sending', 'thinking', 'speaking', 'ready'] as const) {
      const s = session()
      s.dispatch({ type: 'OPEN' })
      if (cible !== 'entering') s.dispatch({ type: 'MIC_READY' })
      if (cible === 'ready') s.dispatch({ type: 'IDLE_TIMEOUT' })
      if (['finalizing', 'sending', 'thinking', 'speaking'].includes(cible)) s.dispatch({ type: 'END_OF_SPEECH', reason: 'silence' })
      if (['sending', 'thinking', 'speaking'].includes(cible)) s.dispatch({ type: 'AUDIO_READY' })
      if (['thinking', 'speaking'].includes(cible)) s.dispatch({ type: 'TRANSCRIPT', text: 'question' })
      if (cible === 'speaking') s.dispatch({ type: 'SPEECH_STARTED' })
      expect(s.state.phase, `mise en place de ${cible}`).toBe(cible)

      expect(s.dispatch({ type: 'CANCEL' }), `croix refusée depuis ${cible}`).toBe(true)
      expect(s.state.phase).toBe('exiting')
      // Après la croix, plus rien du tour en vol ne peut relancer la session.
      expect(s.dispatch({ type: 'ANSWER_SETTLED' })).toBe(false)
      expect(s.dispatch({ type: 'SPEECH_STARTED' })).toBe(false)
      expect(s.dispatch({ type: 'IDLE_TIMEOUT' })).toBe(false)
    }
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

  it('pendant la réflexion, la croix quitte le mode vocal sans « dés-envoyer »', () => {
    const s = ecoute()
    s.dispatch({ type: 'END_OF_SPEECH', reason: 'silence' })
    s.dispatch({ type: 'AUDIO_READY' })
    s.dispatch({ type: 'TRANSCRIPT', text: 'question posée' })
    expect(s.envois).toHaveLength(1)

    // Accepté depuis ce lot : `ANSWER_SETTLED` signifie désormais « réarme »,
    // exactement l'inverse d'une fermeture. La croix ne rappelle pas la question
    // — elle est partie, la réponse arrivera dans la feuille — elle quitte le
    // mode vocal, ce qui est une autre affirmation.
    expect(s.dispatch({ type: 'CANCEL' })).toBe(true)
    expect(s.state.phase).toBe('exiting')
    expect(s.envois).toHaveLength(1)
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
