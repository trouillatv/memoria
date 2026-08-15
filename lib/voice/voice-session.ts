// Machine à états de la session vocale — module pur, sans React ni DOM.
//
// Raison d'être : l'envoi de la question au copilote devient automatique, sans
// écran de confirmation. Trois sources peuvent vouloir conclure la même phrase
// — la VAD, le tap manuel sur l'orbe, et un `onstop` de MediaRecorder délivré
// deux fois. Un booléen `sent` posé à trois endroits finirait par mentir. Ici
// c'est la *transition* qui est unique : `listening` est le seul état d'où l'on
// peut partir en `finalizing`, `sending` le seul d'où l'on peut partir en
// `thinking`. Un second événement est donc structurellement refusé, pas
// simplement ignoré par convention.
//
// Le réducteur renvoie **l'objet d'origine à l'identique** quand l'événement
// n'est pas recevable. L'appelant en déduit un booléen « accepté » par simple
// comparaison de référence, sans avoir à réimplémenter les règles.
//
// ── Session CONTINUE (2026-08-16) ────────────────────────────────────────────
//
// Bascule décidée par Vincent : l'orbe n'est plus un outil « une question puis
// fermeture », c'est une conversation courte et continue.
//
//   entering → listening → finalizing → sending → thinking → speaking
//                  ↑                                            │
//                  └────────────── réarmement ──────────────────┘
//
// Deux conséquences structurelles, et c'est tout le sens du changement :
//
//   1. **La fin d'une réponse ne ferme plus rien.** `SPEECH_ENDED` (la voix a
//      fini) et `ANSWER_SETTLED` (il n'y avait pas de voix — sourdine, moteur
//      absent, synthèse vide) ramènent tous deux en `entering`, donc en écoute.
//      L'appelant intercale un court délai avant de rouvrir le micro : sans lui,
//      MemorIA réentendrait la queue de sa propre voix.
//
//   2. **`CANCEL` devient la sortie UNIQUE et explicite** — la croix. Il est
//      donc accepté depuis TOUTES les phases actives, `thinking` compris. Avant,
//      `thinking` en était exclu au motif que la question était déjà partie ;
//      c'était vrai, mais cela obligeait l'appelant à refermer par un
//      `ANSWER_SETTLED` détourné. Or `ANSWER_SETTLED` signifie désormais
//      « réarme », exactement l'inverse. Annuler pendant la réflexion ne
//      « dés-envoie » toujours rien : la réponse arrivera dans la feuille. Cela
//      quitte le mode vocal, ce qui est une autre affirmation.
//
// `ready` est le troisième ajout : au bout d'un long silence, on relâche le
// micro sans fermer l'orbe. Garder un micro ouvert indéfiniment serait à la
// fois un coût batterie et une promesse d'écoute que personne n'a demandée.

export type VoicePhase =
  | 'idle'
  | 'entering'
  | 'listening'
  | 'finalizing'
  | 'sending'
  | 'thinking'
  /** MemorIA prononce la synthèse orale. Le texte, lui, est déjà affiché. */
  | 'speaking'
  /**
   * Session ouverte, micro relâché. Aucune parole n'est venue pendant le délai
   * d'inactivité. Un tap relance l'écoute ; la croix ferme.
   */
  | 'ready'
  | 'error'
  | 'exiting'

export type VoiceErrorKind =
  | 'mic-denied'
  | 'mic-unavailable'
  | 'no-speech'
  | 'audio-empty'
  | 'transcribe-failed'

export type EndReason = 'silence' | 'manual' | 'max-duration'

export type VoiceEvent =
  /** L'overlay s'ouvre. */
  | { type: 'OPEN' }
  /** Micro obtenu, analyse audio démarrée. */
  | { type: 'MIC_READY' }
  | { type: 'MIC_FAILED'; kind: 'mic-denied' | 'mic-unavailable' }
  /** VAD conclue, tap manuel, ou durée maximale atteinte. */
  | { type: 'END_OF_SPEECH'; reason: EndReason }
  /**
   * Long silence : personne ne parle. En session continue ce n'est PAS une
   * erreur — c'est le cas normal d'une conversation qui s'arrête. On relâche le
   * micro et l'orbe attend.
   */
  | { type: 'IDLE_TIMEOUT' }
  /** Tap sur l'orbe en `ready` : on remet le micro. */
  | { type: 'WAKE' }
  /** `onstop` : blob exploitable assemblé. */
  | { type: 'AUDIO_READY' }
  /** `onstop` : blob vide ou trop court. */
  | { type: 'AUDIO_EMPTY' }
  /** Réponse du backend STT. Un texte vide est refusé ici, pas plus loin. */
  | { type: 'TRANSCRIPT'; text: string }
  | { type: 'TRANSCRIBE_FAILED' }
  /**
   * Le copilote a répondu (ou a échoué) et il n'y a AUCUNE voix à attendre.
   * La conversation continue : on retourne écouter.
   */
  | { type: 'ANSWER_SETTLED' }
  /** Une lecture vocale a réellement démarré : l'orbe reste, en état `speaking`. */
  | { type: 'SPEECH_STARTED' }
  /** Fin naturelle, interruption ou échec du TTS — réarme l'écoute dans les trois cas. */
  | { type: 'SPEECH_ENDED' }
  /** La croix. Sortie unique et explicite du mode vocal. */
  | { type: 'CANCEL' }
  | { type: 'RETRY' }
  | { type: 'EXITED' }

export type VoiceState = {
  phase: VoicePhase
  error: VoiceErrorKind | null
  endReason: EndReason | null
  /** Transcription retenue, conservée pour un éventuel rattrapage. */
  transcript: string | null
}

export const INITIAL_VOICE_STATE: VoiceState = {
  phase: 'idle',
  error: null,
  endReason: null,
  transcript: null,
}

/**
 * La croix ferme depuis TOUTE phase active. `thinking` inclus : la question est
 * partie, la réponse arrivera dans la feuille, mais l'utilisateur a le droit de
 * quitter le mode vocal sans attendre. Seuls `idle` (déjà fermé) et `exiting`
 * (fermeture en cours) refusent — fermer deux fois n'a pas de sens.
 */
const CANCELLABLE: VoicePhase[] = [
  'entering', 'listening', 'finalizing', 'sending', 'thinking', 'speaking', 'ready', 'error',
]

/**
 * Retour en écoute après un tour. On repart d'un état de tour VIERGE : la
 * transcription précédente appartient au fil de la conversation, plus à la
 * session en cours. La laisser traîner ferait réafficher l'ancienne question
 * sous l'orbe pendant qu'on écoute la suivante.
 */
function rearm(state: VoiceState): VoiceState {
  return { ...state, phase: 'entering', error: null, endReason: null, transcript: null }
}

export function voiceReducer(state: VoiceState, event: VoiceEvent): VoiceState {
  switch (event.type) {
    case 'OPEN':
      // Réouverture depuis `exiting` autorisée : l'utilisateur peut retaper
      // pendant l'animation de sortie.
      if (state.phase !== 'idle' && state.phase !== 'exiting') return state
      return { phase: 'entering', error: null, endReason: null, transcript: null }

    case 'MIC_READY':
      if (state.phase !== 'entering') return state
      return { ...state, phase: 'listening' }

    case 'MIC_FAILED':
      if (state.phase !== 'entering' && state.phase !== 'listening') return state
      return { ...state, phase: 'error', error: event.kind }

    case 'END_OF_SPEECH':
      // LA transition unique. VAD, tap manuel et durée max passent tous par là.
      if (state.phase !== 'listening') return state
      return { ...state, phase: 'finalizing', endReason: event.reason }

    case 'IDLE_TIMEOUT':
      // Ne rien dire pendant vingt secondes n'est pas une panne : c'est la fin
      // naturelle d'une conversation. Aucun message d'erreur, aucun bouton
      // « Réessayer » — l'orbe attend, simplement.
      if (state.phase !== 'listening') return state
      return { ...state, phase: 'ready', error: null, endReason: null, transcript: null }

    case 'WAKE':
      if (state.phase !== 'ready') return state
      return { ...state, phase: 'entering' }

    case 'AUDIO_READY':
      // Un second `onstop` arrive ici alors qu'on est déjà en `sending` : refusé.
      if (state.phase !== 'finalizing') return state
      return { ...state, phase: 'sending' }

    case 'AUDIO_EMPTY':
      if (state.phase !== 'finalizing') return state
      return { ...state, phase: 'error', error: 'audio-empty' }

    case 'TRANSCRIPT': {
      if (state.phase !== 'sending') return state
      const text = event.text.trim()
      // Transcription vide = rien à envoyer. Garanti par la machine elle-même :
      // aucun appelant ne peut « oublier » ce contrôle.
      if (!text) return { ...state, phase: 'error', error: 'no-speech' }
      return { ...state, phase: 'thinking', transcript: text }
    }

    case 'TRANSCRIBE_FAILED':
      if (state.phase !== 'sending') return state
      return { ...state, phase: 'error', error: 'transcribe-failed' }

    case 'ANSWER_SETTLED':
      // Réponse obtenue, rien à prononcer (sourdine, moteur absent, synthèse
      // vide). On n'attend pas une phase `speaking` qui n'existera jamais : on
      // retourne directement écouter.
      if (state.phase !== 'thinking') return state
      return rearm(state)

    case 'SPEECH_STARTED':
      // Seule la réponse qu'on vient d'obtenir peut faire parler l'orbe. Une
      // lecture qui démarrerait à un autre moment du parcours est refusée ici.
      if (state.phase !== 'thinking') return state
      return { ...state, phase: 'speaking' }

    case 'SPEECH_ENDED':
      // Fin naturelle, tap d'interruption ou échec du moteur : trois causes,
      // une seule suite — on réécoute.
      if (state.phase !== 'speaking') return state
      return rearm(state)

    case 'CANCEL':
      if (!CANCELLABLE.includes(state.phase)) return state
      return { ...state, phase: 'exiting', error: null }

    case 'RETRY':
      if (state.phase !== 'error') return state
      return { phase: 'entering', error: null, endReason: null, transcript: null }

    case 'EXITED':
      if (state.phase !== 'exiting') return state
      return INITIAL_VOICE_STATE

    default:
      return state
  }
}

const ERROR_MESSAGES: Record<VoiceErrorKind, string> = {
  'mic-denied': "Le microphone n'est pas accessible",
  'mic-unavailable': "Le microphone n'est pas disponible",
  'no-speech': "Je n'ai rien entendu",
  'audio-empty': "Je n'ai rien entendu",
  'transcribe-failed': "La transcription n'a pas fonctionné",
}

export function voiceErrorMessage(kind: VoiceErrorKind | null): string {
  return kind ? ERROR_MESSAGES[kind] : ''
}
