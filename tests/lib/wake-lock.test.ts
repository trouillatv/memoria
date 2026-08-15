import { describe, it, expect, vi } from 'vitest'
import {
  createWakeLockController,
  phaseNeedsWakeLock,
  type WakeLockEnv,
  type WakeLockSentinelLike,
} from '@/lib/voice/wake-lock'
import type { VoicePhase } from '@/lib/voice/voice-session'

/** Sentinelle contrôlable : on veut pouvoir simuler un `release` du navigateur. */
function makeSentinel() {
  const listeners = new Set<() => void>()
  const release = vi.fn(async () => { listeners.forEach((l) => l()) })
  const s: WakeLockSentinelLike = {
    release,
    addEventListener: (_t, l) => { listeners.add(l) },
    removeEventListener: (_t, l) => { listeners.delete(l) },
  }
  return { sentinel: s, release, fireBrowserRelease: () => listeners.forEach((l) => l()) }
}

/**
 * Environnement navigateur simulé. `request` renvoie une promesse résolue
 * manuellement quand `manual` est vrai : c'est le seul moyen de tester la course
 * « la session se termine pendant que le verrou est demandé ».
 */
function makeEnv(opts: { supported?: boolean; manual?: boolean } = {}) {
  const { supported = true, manual = false } = opts
  let visible = true
  let visibilityHandler: (() => void) | null = null
  const unsubscribe = vi.fn()
  const created: ReturnType<typeof makeSentinel>[] = []
  let resolveNext: ((s: WakeLockSentinelLike) => void) | null = null
  let rejectNext: ((e: unknown) => void) | null = null

  const request = vi.fn(async (): Promise<WakeLockSentinelLike> => {
    const made = makeSentinel()
    created.push(made)
    if (!manual) return made.sentinel
    return new Promise<WakeLockSentinelLike>((res, rej) => {
      resolveNext = () => res(made.sentinel)
      rejectNext = rej
    })
  })

  const env: WakeLockEnv = {
    wakeLock: supported ? { request } : null,
    isVisible: () => visible,
    onVisibilityChange: (h) => { visibilityHandler = h; return unsubscribe },
  }

  return {
    env,
    request,
    unsubscribe,
    created,
    last: () => created[created.length - 1],
    setVisible: (v: boolean) => { visible = v; visibilityHandler?.() },
    settle: () => resolveNext?.(undefined as never),
    fail: () => rejectNext?.(new Error('NotAllowedError')),
  }
}

describe('phaseNeedsWakeLock — exactement le temps de l’interaction vocale', () => {
  it.each<[VoicePhase, boolean]>([
    ['listening', true],
    ['finalizing', true],
    ['sending', true],
    ['thinking', true],
    ['speaking', true],
    ['idle', false],
    ['entering', false],
    ['error', false],
    ['exiting', false],
  ])('%s → %s', (phase, expected) => {
    expect(phaseNeedsWakeLock(phase)).toBe(expected)
  })
})

describe('createWakeLockController — cycle de vie du verrou', () => {
  it('acquiert au démarrage de la session, une seule fois', async () => {
    const h = makeEnv()
    const c = createWakeLockController(h.env)

    c.sync(true)
    await vi.waitFor(() => expect(c.isHeld()).toBe(true))

    // Un composant React appelle `sync` à chaque rendu : ce doit être sans effet.
    c.sync(true)
    c.sync(true)
    expect(h.request).toHaveBeenCalledTimes(1)
  })

  it('relâche dès que la session n’est plus active', async () => {
    const h = makeEnv()
    const c = createWakeLockController(h.env)
    c.sync(true)
    await vi.waitFor(() => expect(c.isHeld()).toBe(true))

    c.sync(false)
    expect(h.last().release).toHaveBeenCalledTimes(1)
    expect(c.isHeld()).toBe(false)
  })

  it('le démontage relâche et se désabonne', async () => {
    const h = makeEnv()
    const c = createWakeLockController(h.env)
    c.sync(true)
    await vi.waitFor(() => expect(c.isHeld()).toBe(true))

    c.dispose()
    expect(h.last().release).toHaveBeenCalledTimes(1)
    expect(h.unsubscribe).toHaveBeenCalledTimes(1)
    expect(c.isHeld()).toBe(false)

    // Après démontage, plus rien ne peut rallumer l'écran.
    c.sync(true)
    expect(h.request).toHaveBeenCalledTimes(1)
  })
})

describe('createWakeLockController — visibilité', () => {
  it('le navigateur relâche en arrière-plan : on réacquiert au retour SI la session dure', async () => {
    const h = makeEnv()
    const c = createWakeLockController(h.env)
    c.sync(true)
    await vi.waitFor(() => expect(c.isHeld()).toBe(true))

    // Ce que fait réellement un navigateur quand la page passe en arrière-plan.
    h.created[0].fireBrowserRelease()
    h.setVisible(false)
    expect(c.isHeld()).toBe(false)

    h.setVisible(true)
    await vi.waitFor(() => expect(c.isHeld()).toBe(true))
    expect(h.request).toHaveBeenCalledTimes(2)
  })

  it('retour au premier plan APRÈS la fin de la session : aucun verrou', async () => {
    // Le cas qui ferait de MemorIA un consommateur de batterie invisible :
    // rouvrir l'app plus tard ne doit rien rallumer.
    const h = makeEnv()
    const c = createWakeLockController(h.env)
    c.sync(true)
    await vi.waitFor(() => expect(c.isHeld()).toBe(true))

    h.created[0].fireBrowserRelease()
    h.setVisible(false)
    c.sync(false)          // la réponse est arrivée, l'orbe s'est refermée
    h.setVisible(true)

    expect(c.isHeld()).toBe(false)
    expect(h.request).toHaveBeenCalledTimes(1)
  })

  it('ne demande pas de verrou tant que la page est masquée', () => {
    const h = makeEnv()
    h.setVisible(false)
    const c = createWakeLockController(h.env)
    c.sync(true)
    expect(h.request).not.toHaveBeenCalled()
  })
})

describe('createWakeLockController — courses et échecs', () => {
  it('session terminée pendant la demande : le verrou obtenu est relâché aussitôt', async () => {
    // Sans ce garde-fou, l'écran resterait allumé indéfiniment après une réponse
    // rapide — le verrou arriverait après la fermeture de l'orbe.
    const h = makeEnv({ manual: true })
    const c = createWakeLockController(h.env)

    c.sync(true)
    c.sync(false)      // la session se termine AVANT que le navigateur réponde
    h.settle()

    await vi.waitFor(() => expect(h.last().release).toHaveBeenCalledTimes(1))
    expect(c.isHeld()).toBe(false)
  })

  it('page masquée pendant la demande : le verrou obtenu est relâché aussitôt', async () => {
    const h = makeEnv({ manual: true })
    const c = createWakeLockController(h.env)

    c.sync(true)
    h.setVisible(false)
    h.settle()

    await vi.waitFor(() => expect(h.last().release).toHaveBeenCalledTimes(1))
    expect(c.isHeld()).toBe(false)
  })

  it('un refus du navigateur ne lève pas et n’interdit pas de réessayer', async () => {
    const h = makeEnv({ manual: true })
    const c = createWakeLockController(h.env)

    c.sync(true)
    h.fail()
    // Le refus se propage en microtâches ; dans un navigateur il est traité
    // bien avant qu'un `visibilitychange` puisse survenir. Ici il faut le
    // laisser arriver, sinon on testerait une course qui n'existe pas.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(h.request).toHaveBeenCalledTimes(1)
    expect(c.isHeld()).toBe(false)

    // La session continue : un changement de visibilité redonne sa chance.
    h.setVisible(false)
    h.setVisible(true)
    expect(h.request).toHaveBeenCalledTimes(2)
  })

  it('API absente : no-op total, aucune erreur', () => {
    const h = makeEnv({ supported: false })
    const c = createWakeLockController(h.env)
    expect(() => { c.sync(true); c.sync(false); c.dispose() }).not.toThrow()
    expect(c.isHeld()).toBe(false)
  })
})
