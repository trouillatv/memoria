'use client'

// Drapeau unique de recette vocale.
//
// Extrait de `VoiceLatencyBadge` parce qu'il gouverne désormais deux
// instruments (le badge de latence et la trace multi-tours) : deux résolutions
// indépendantes du même drapeau finiraient par diverger, et une recette où la
// moitié des instruments est ouverte ne prouve rien.

const FLAG_KEY = 'memoria:voice-debug'

/**
 * Résolu une seule fois par chargement de page, puis mémorisé : le drapeau ne
 * change pas en cours de session, et `getSnapshot` d'un `useSyncExternalStore`
 * doit rester stable.
 *
 * Le paramètre d'URL est recopié dans le stockage : en recette on ouvre l'app
 * une fois avec `?voicedebug=1`, puis on navigue normalement sans le traîner
 * dans chaque URL. `?voicedebug=0` referme.
 */
let flag: boolean | null = null

export function voiceDebugEnabled(): boolean {
  if (flag !== null) return flag
  if (typeof window === 'undefined') return false
  flag = false
  try {
    const param = new URLSearchParams(window.location.search).get('voicedebug')
    if (param === '1') window.localStorage.setItem(FLAG_KEY, '1')
    if (param === '0') window.localStorage.removeItem(FLAG_KEY)
    flag = window.localStorage.getItem(FLAG_KEY) === '1'
  } catch { /* stockage indisponible */ }
  return flag
}
