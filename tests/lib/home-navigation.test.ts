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
})

describe('resolveHomeDestination', () => {
  it('sends managers to /dashboard on desktop, but chefs always to /m', () => {
    expect(resolveHomeDestination({ role: 'manager', home_preference: 'dashboard' }, false)).toBe('/dashboard')
    expect(resolveHomeDestination({ role: 'manager', home_preference: 'terrain' }, false)).toBe('/dashboard')
    // Chef d'équipe : jamais le dashboard conducteur, même en desktop / mode bureau.
    expect(resolveHomeDestination({ role: 'chef_equipe', home_preference: 'dashboard' }, false)).toBe('/m')
  })

  it('keeps roles separate from home experience preferences on mobile', () => {
    expect(resolveHomeDestination({ role: 'manager', home_preference: 'dashboard' }, true)).toBe('/dashboard')
    expect(resolveHomeDestination({ role: 'manager', home_preference: 'terrain' }, true)).toBe('/m')
    expect(resolveHomeDestination({ role: 'chef_equipe', home_preference: 'dashboard' }, true)).toBe('/m')
  })
})

describe('shouldRedirectDashboardRequestToField', () => {
  it('redirects field users off the conductor dashboard on desktop too (mode bureau)', () => {
    // Régression : en mode bureau (UA desktop) le chef n'était PAS redirigé et
    // rendait le dashboard conducteur, qui plante pour son rôle.
    expect(shouldRedirectDashboardRequestToField({
      role: 'chef_equipe',
      home_preference: 'dashboard',
      pathname: '/dashboard',
    }, false)).toBe(true)
  })

  it('lets managers open dashboard pages even when their home preference is terrain', () => {
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

  it('keeps field users on the mobile app except for their account page', () => {
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
