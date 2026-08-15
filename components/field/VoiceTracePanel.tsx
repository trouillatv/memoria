'use client'

// Panneau de recette vocale — visible uniquement sous `?voicedebug=1`.
//
// Raison d'être, et elle est étroite : le P0 « la voix ne parle qu'au premier
// tour » ne se reproduit QUE sur téléphone réel. La trace existe depuis le lot
// précédent, mais elle n'était lisible que dans une console de navigateur de
// bureau — c'est-à-dire nulle part, sur le terrain. Sans lecture possible, la
// seule suite aurait été une correction spéculative.
//
// Ce panneau ne juge pas et ne corrige rien. Il affiche les lignes brutes et
// permet de les recopier en un geste. La signature à lire est connue d'avance :
//
//   cas A : `answer` avec `spokenText: "null"`         → serveur / contrat LLM
//   cas C : `speak-call` + `speak-queued` présents,
//           `speak-start` ABSENT, `speak-start-timeout` → moteur Web Speech
//   cas D : `speak-start` présent, aucun son entendu    → audio / volume OS
//
// (le cas B — le contrôleur refuse — est éliminé par preuve depuis `802631d5`.)

import { useState, useSyncExternalStore } from 'react'
import { Copy, Check, Trash2 } from 'lucide-react'
import { voiceDebugEnabled } from '@/lib/voice/voice-debug'
import {
  subscribeVoiceTrace,
  voiceTraceSnapshot,
  voiceTraceText,
  clearVoiceTrace,
} from '@/lib/voice/voice-trace'

/** Les événements qui tranchent A / C / D — mis en évidence dans le flot. */
const PIVOTAL = new Set([
  'answer', 'speak-returned', 'speak-refused', 'speak-call', 'speak-queued',
  'speak-start', 'speak-start-timeout', 'speak-error', 'prime',
])

const EMPTY: ReturnType<typeof voiceTraceSnapshot> = []

export function VoiceTracePanel() {
  // Résolu avant tout abonnement : hors recette, ce composant ne coûte rien.
  const enabled = voiceDebugEnabled()
  const entries = useSyncExternalStore(
    subscribeVoiceTrace,
    () => (enabled ? voiceTraceSnapshot() : EMPTY),
    () => EMPTY,
  )
  const [copied, setCopied] = useState(false)

  if (!enabled) return null

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(voiceTraceText())
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* presse-papier refusé hors contexte sécurisé */ }
  }

  return (
    <div className="pointer-events-auto absolute inset-x-2 bottom-2 z-10 max-h-[38vh] overflow-hidden rounded-xl border border-white/15 bg-black/80 text-white/80">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-1.5">
        <span className="text-[11px] font-medium tracking-wide text-white/50">
          trace vocale · {entries.length}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={copyAll}
            aria-label="Copier la trace"
            className="flex h-7 w-7 items-center justify-center rounded-md bg-white/10 active:bg-white/20"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => clearVoiceTrace()}
            aria-label="Vider la trace"
            className="flex h-7 w-7 items-center justify-center rounded-md bg-white/10 active:bg-white/20"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="max-h-[32vh] overflow-y-auto px-3 py-2 font-mono text-[10px] leading-[1.45]">
        {entries.length === 0 && <p className="text-white/35">aucun événement</p>}
        {entries.map((e, i) => (
          <p key={i} className={PIVOTAL.has(e.event) ? 'text-amber-300' : 'text-white/55'}>
            <span className="text-white/30">[{e.turn}] +{e.at}ms </span>
            {e.event}
            {Object.keys(e.fields).length > 0 && (
              <span className="text-white/40"> {JSON.stringify(e.fields)}</span>
            )}
          </p>
        ))}
      </div>
    </div>
  )
}
