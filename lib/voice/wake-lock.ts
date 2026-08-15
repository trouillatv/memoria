// Maintien de l'écran allumé pendant une interaction vocale — et seulement là.
//
// Constat terrain (2026-08-15) : sur un téléphone réglé avec une veille écran
// courte, l'écran s'éteint pendant `thinking` ou `speaking`. L'utilisateur a
// parlé, il attend, il ne touche plus rien — donc l'OS le considère inactif
// alors qu'il est précisément au cœur de l'échange. La réponse audio est coupée
// ou interrompue.
//
// Ce module existe pour que le verrou soit un OBJET avec un cycle de vie
// vérifiable, et non trois appels dispersés dans un composant React. La règle
// qu'il garantit tient en une phrase, et c'est la plus importante :
//
//   MemorIA ne maintient JAMAIS l'écran éveillé en dehors d'une interaction
//   vocale active.
//
// Un verrou d'écran oublié est un bug de batterie invisible : rien ne le
// signale, l'utilisateur constate seulement que son téléphone se vide. D'où le
// choix d'une API DÉCLARATIVE — `sync(actif)` — plutôt que `acquire()` /
// `release()` appelés à la main. L'appelant décrit un état ; il ne peut pas
// « oublier » de relâcher, seulement décrire un état faux, ce qui se teste.
//
// Les dépendances navigateur sont injectées : la logique se teste sans DOM, et
// c'est la logique qui porte le risque, pas l'appel `request('screen')`.

import type { VoicePhase } from './voice-session'

/** Sous-ensemble utile de `WakeLockSentinel`. */
export type WakeLockSentinelLike = {
  release(): Promise<void>
  addEventListener(type: 'release', listener: () => void): void
  removeEventListener(type: 'release', listener: () => void): void
}

/** Sous-ensemble utile de `navigator.wakeLock`. */
export type WakeLockLike = {
  request(type: 'screen'): Promise<WakeLockSentinelLike>
}

export type WakeLockEnv = {
  /** `null` quand l'API n'existe pas — cas normal, jamais une erreur. */
  wakeLock: WakeLockLike | null
  isVisible: () => boolean
  /** Abonnement au changement de visibilité ; renvoie le désabonnement. */
  onVisibilityChange: (handler: () => void) => () => void
}

export type WakeLockController = {
  /**
   * Décrit l'état voulu. Idempotent : appeler `sync(true)` à chaque rendu React
   * ne redemande pas un second verrou.
   */
  sync(active: boolean): void
  /** Relâche et se désabonne définitivement. À appeler au démontage. */
  dispose(): void
  /** Verrou réellement détenu à cet instant — sert aux tests et au débogage. */
  isHeld(): boolean
}

/**
 * Phases pendant lesquelles l'écran doit rester allumé.
 *
 * Périmètre volontairement identique à celui décrit par Vincent : de la prise de
 * parole à la fin de la lecture vocale. `entering` en est exclu — l'utilisateur
 * vient de toucher l'écran, l'OS n'a aucune raison de l'éteindre. `error`,
 * `exiting` et `idle` aussi : l'interaction est terminée.
 */
const PHASES_NEEDING_WAKE_LOCK: readonly VoicePhase[] = [
  'listening', 'finalizing', 'sending', 'thinking', 'speaking',
]

export function phaseNeedsWakeLock(phase: VoicePhase): boolean {
  return PHASES_NEEDING_WAKE_LOCK.includes(phase)
}

export function createWakeLockController(env: WakeLockEnv): WakeLockController {
  let desired = false
  let sentinel: WakeLockSentinelLike | null = null
  /** Une demande est en vol : empêche d'en lancer une seconde en parallèle. */
  let pending = false
  let disposed = false

  const onSentinelRelease = () => { sentinel = null }

  function detach(s: WakeLockSentinelLike) {
    try { s.removeEventListener('release', onSentinelRelease) } catch { /* implémentation partielle */ }
  }

  function releaseNow() {
    const s = sentinel
    sentinel = null
    if (!s) return
    detach(s)
    // Un `release()` en échec ne laisse rien à réparer côté application : le
    // verrou appartient au navigateur, qui le libérera au plus tard à la
    // fermeture de l'onglet.
    s.release().catch(() => {})
  }

  function acquire() {
    const api = env.wakeLock
    if (!api) return
    pending = true
    api.request('screen').then(
      (s) => {
        pending = false
        // Course réelle et non théorique : `request('screen')` est asynchrone,
        // et une réponse du copilote peut arriver entre-temps. Sans ce contrôle,
        // un verrou obtenu APRÈS la fin de la session resterait détenu — l'écran
        // du téléphone ne s'éteindrait plus jamais.
        if (disposed || !desired || !env.isVisible()) {
          s.release().catch(() => {})
          return
        }
        sentinel = s
        // Le navigateur peut relâcher de lui-même (page masquée, batterie
        // faible). On veut le savoir pour pouvoir redemander au retour, sinon on
        // se croirait protégé sans l'être.
        try { s.addEventListener('release', onSentinelRelease) } catch { /* implémentation partielle */ }
      },
      () => {
        // Refus de l'utilisateur, politique du navigateur, onglet en arrière-plan :
        // aucun message, aucun blocage. Une prochaine `sync(true)` réessaiera.
        pending = false
      },
    )
  }

  function reconcile() {
    if (disposed) return
    if (desired && env.isVisible()) {
      if (!sentinel && !pending) acquire()
      return
    }
    // Page masquée : on ne relâche pas explicitement (le navigateur s'en charge
    // et émet `release`), mais on ne redemande pas non plus. Session terminée :
    // on relâche tout de suite.
    if (!desired) releaseNow()
  }

  const unsubscribe = env.onVisibilityChange(() => {
    // Au retour au premier plan, on ne réacquiert QUE si une session vocale est
    // toujours en cours. Revenir sur MemorIA après coup ne doit pas rallumer un
    // verrou pour une conversation déjà close.
    reconcile()
  })

  return {
    sync(active: boolean) {
      if (disposed) return
      desired = active
      reconcile()
    },
    dispose() {
      if (disposed) return
      disposed = true
      desired = false
      unsubscribe()
      releaseNow()
    },
    isHeld: () => sentinel !== null,
  }
}

/**
 * Environnement navigateur réel. Tout est optionnel : sur un moteur sans Screen
 * Wake Lock (Safari iOS ancien, WebView restreinte), `wakeLock` vaut `null` et
 * le contrôleur devient un no-op silencieux — le parcours vocal fonctionne
 * exactement comme avant ce lot.
 */
export function browserWakeLockEnv(): WakeLockEnv {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') {
    return { wakeLock: null, isVisible: () => false, onVisibilityChange: () => () => {} }
  }
  const nav = navigator as Navigator & { wakeLock?: WakeLockLike }
  return {
    wakeLock: typeof nav.wakeLock?.request === 'function' ? nav.wakeLock : null,
    isVisible: () => document.visibilityState === 'visible',
    onVisibilityChange: (handler) => {
      document.addEventListener('visibilitychange', handler)
      return () => document.removeEventListener('visibilitychange', handler)
    },
  }
}
