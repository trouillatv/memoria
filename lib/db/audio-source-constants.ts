// Constantes PURES des sources audio (mig 141) — importables client ET serveur
// (la logique DB vit dans report-audio-sources.ts, server-only). Cf. piège ACTION_CODES.
export type AudioSourceType = 'audio_meeting' | 'voice_note' | 'phone_call' | 'debrief' | 'other'
export const AUDIO_SOURCE_TYPES: AudioSourceType[] = ['audio_meeting', 'voice_note', 'phone_call', 'debrief', 'other']
export const AUDIO_SOURCE_LABEL: Record<AudioSourceType, string> = {
  audio_meeting: 'Audio de réunion',
  voice_note: 'Note vocale',
  phone_call: 'Appel complémentaire',
  debrief: 'Débrief',
  other: 'Autre',
}
