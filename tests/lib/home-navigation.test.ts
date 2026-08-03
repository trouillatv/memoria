import { describe, expect, it } from 'vitest'

import {
  resolveHomeDestination,
  shouldRedirectDashboardRequestToField,
  isMobileUserAgent,
} from '@/lib/navigation/home'

describe('isMobileUserAgent', () => {
  it('detects mobile devices', () => {
    expect(isMobileUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(true)
    // UA Chrome Android en mode mobile : contient "Mobile" (le mode bureau, lui,
    // garde "Android" mais RETIRE "Mobile" → traité comme desktop, cf. impl).
    expect(isMobileUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36')).toBe(true)
    expect(isMobileUserAgent(null)).toBe(false)
  })

  it('rejects desktop devices', () => {
    expect(isMobileUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36')).toBe(false)
    expect(isMobileUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')).toBe(false)
  })

  it('treats Chrome Android in desktop mode as desktop UA (Mobile absent)', () => {
    // Chrome en "site pour ordinateur" : Android présent, Mobile absent.
    // La détection côté serveur doit le lire comme desktop.
    // La protection viewport côté client (ViewportGuard) rattrapera le cas.
    expect(isMobileUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')).toBe(false)
  })
})

describe('resolveHomeDestination — doctrine 2026-08-04', () => {
  // Chef d'équipe : toujours terrain, sans exception
  it('sends chef_equipe to /m regardless of preference', () => {
    expect(resolveHomeDestination({ role: 'chef_equipe', home_preference: 'dashboard' })).toBe('/m')
    expect(resolveHomeDestination({ role: 'chef_equipe', home_preference: 'terrain' })).toBe('/m')
  })

  // PWA : toujours /m (le mode bureau temporaire est géré côté client)
  it('sends everyone to /m in PWA standalone mode', () => {
    expect(resolveHomeDestination({ role: 'manager', home_preference: 'dashboard' }, true)).toBe('/m')
    expect(resolveHomeDestination({ role: 'manager', home_preference: 'terrain' }, true)).toBe('/m')
    expect(resolveHomeDestination({ role: 'admin', home_preference: 'dashboard' }, true)).toBe('/m')
    expect(resolveHomeDestination({ role: 'chef_equipe', home_preference: 'dashboard' }, true)).toBe('/m')
  })

  // Manager : la préférence fait foi — l'UA n'intervient plus
  it('manager follows home_preference regardless of UA', () => {
    expect(resolveHomeDestination({ role: 'manager', home_preference: 'dashboard' })).toBe('/dashboard')
    expect(resolveHomeDestination({ role: 'manager', home_preference: 'terrain' })).toBe('/m')
  })

  // Admin : identique à manager
  it('admin follows home_preference regardless of UA', () => {
    expect(resolveHomeDestination({ role: 'admin', home_preference: 'dashboard' })).toBe('/dashboard')
    expect(resolveHomeDestination({ role: 'admin', home_preference: 'terrain' })).toBe('/m')
  })

  // Chrome Android "site pour ordinateur" : l'UA dit desktop, la préférence dit terrain.
  // Avant 2026-08-04 : envoyé sur /dashboard (préférence ignorée). Maintenant : /m.
  it('manager with terrain preference goes to /m even when UA looks like desktop', () => {
    // Simulation : isMobile=false (UA desktop menteur), mais home_preference=terrain
    // resolveHomeDestination ne prend plus isMobile — la préférence fait foi.
    expect(resolveHomeDestination({ role: 'manager', home_preference: 'terrain' })).toBe('/m')
  })

  // Changement de préférence → pris en compte immédiatement
  it('destination changes immediately after preference update', () => {
    const user = { role: 'manager' as const, home_preference: 'dashboard' as const }
    expect(resolveHomeDestination(user)).toBe('/dashboard')
    const updated = { ...user, home_preference: 'terrain' as const }
    expect(resolveHomeDestination(updated)).toBe('/m')
  })
})

describe('shouldRedirectDashboardRequestToField', () => {
  it('redirects chef_equipe off the dashboard (mode bureau inclus)', () => {
    expect(shouldRedirectDashboardRequestToField({
      role: 'chef_equipe',
      home_preference: 'dashboard',
      pathname: '/dashboard',
    }, false)).toBe(true)
  })

  it('lets managers open dashboard pages regardless of home_preference', () => {
    expect(shouldRedirectDashboardRequestToField({
      role: 'manager',
      home_preference: 'terrain',
      pathname: '/dashboard',
    }, true)).toBe(false)
    expect(shouldRedirectDashboardRequestToField({
      role: 'manager',
      home_preference: 'terrain',
      pathname: '/dashboard',
    }, false)).toBe(false)
  })

  it('keeps chef_equipe on mobile app except for their account page', () => {
    expect(shouldRedirectDashboardRequestToField({
      role: 'chef_equipe',
      home_preference: 'dashboard',
      pathname: '/dashboard',
    }, true)).toBe(true)

    expect(shouldRedirectDashboardRequestToField({
      role: 'chef_equipe',
      home_preference: 'dashboard',
      pathname: '/account',
    }, true)).toBe(false)
  })
})
