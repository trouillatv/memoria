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

export type VoicePhase =
  | 'idle'
  | 'entering'
  | 'listening'
  | 'finalizing'
  | 'sending'
  | 'thinking'
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
  /** Délai écoulé sans qu'aucune parole ne soit détectée. */
  | { type: 'NO_SPEECH' }
  /** `onstop` : blob exploitable assemblé. */
  | { type: 'AUDIO_READY' }
  /** `onstop` : blob vide ou trop court. */
  | { type: 'AUDIO_EMPTY' }
  /** Réponse du backend STT. Un texte vide est refusé ici, pas plus loin. */
  | { type: 'TRANSCRIPT'; text: string }
  | { type: 'TRANSCRIBE_FAILED' }
  /** Le copilote a répondu (ou a échoué) — dans les deux cas l'orbe se retire. */
  | { type: 'ANSWER_SETTLED' }
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

/** États depuis lesquels une annulation est encore garantie sans envoi. */
const CANCELLABLE: VoicePhase[] = ['entering', 'listening', 'finalizing', 'sending', 'error']

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

    case 'NO_SPEECH':
      if (state.phase !== 'listening') return state
      return { ...state, phase: 'error', error: 'no-speech' }

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
      if (state.phase !== 'thinking') return state
      return { ...state, phase: 'exiting' }

    case 'CANCEL':
      // `thinking` est volontairement absent : la question est déjà partie au
      // serveur, l'annulation ne peut plus la rappeler. Le X y referme l'orbe
      // (ANSWER_SETTLED côté appelant), il ne « dés-envoie » pas.
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
