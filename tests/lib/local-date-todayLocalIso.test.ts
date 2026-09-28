// DOC-CONTRACT-OS-1B2-B4 FIX (revue ChatGPT) — todayLocalIso() doit rendre la
// date CIVILE Nouméa, jamais la date UTC. Horloge système mockée (vi.setSystemTime)
// pour ne jamais dépendre de l'heure réelle de la machine qui exécute le test.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { todayLocalIso } from '@/lib/time/local-date'

describe('todayLocalIso — frontière UTC/Nouméa (UTC+11)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('01 déc 2026 08:00 Nouméa = 30 nov 2026 21:00 UTC → "2026-12-01" (PAS la veille)', () => {
    // C'est le bug flagué par ChatGPT : new Date().toISOString().slice(0,10)
    // rendrait "2026-11-30" à cet instant précis.
    vi.setSystemTime(new Date('2026-11-30T21:00:00Z'))
    expect(todayLocalIso()).toBe('2026-12-01')
  })

  it('30 nov 2026 12:59 UTC = 30 nov 2026 23:59 Nouméa → "2026-11-30" (encore dans le jour)', () => {
    vi.setSystemTime(new Date('2026-11-30T12:59:00Z'))
    expect(todayLocalIso()).toBe('2026-11-30')
  })

  it('30 nov 2026 13:00 UTC = 01 déc 2026 00:00 Nouméa → "2026-12-01" (passage du jour)', () => {
    vi.setSystemTime(new Date('2026-11-30T13:00:00Z'))
    expect(todayLocalIso()).toBe('2026-12-01')
  })
})
