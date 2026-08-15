import { SpikeVoiceHarness } from './SpikeVoiceHarness'

// LOT 0 — banc d'essai vocal, TEMPORAIRE.
//
// Objectif unique : savoir si `webkitSpeechRecognition` (résultats
// intermédiaires) et `getUserMedia`/`MediaRecorder` peuvent tenir le même micro
// en même temps, sur les téléphones réels de Vincent — Android Chrome/PWA et
// iPhone Safari. Cette question conditionne le lot 3 (transcription live) et
// rien d'autre : les lots 1 et 2 avancent quoi qu'il arrive.
//
// Cette route n'est liée depuis aucune surface. Elle hérite de l'auth et du
// garde-rôle du layout terrain. **À supprimer à la clôture du lot 0.**
//
// Tout est affiché à l'écran, y compris les erreurs : sur téléphone il n'y a
// pas de console.

export const dynamic = 'force-dynamic'

export default function SpikeVoicePage() {
  return <SpikeVoiceHarness />
}
