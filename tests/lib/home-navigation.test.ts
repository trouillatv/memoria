import { describe, expect, it } from 'vitest'

import {
  resolveHomeDestination,
  shouldRedirectDashboardRequestToField,
  isMobileUserAgent,
} from '@/lib/navigation/home'

describe('isMobileUserAgent', () => {
  it('detects mobile devices', () => {
    expect(isMobileUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(true)
    expect(isMobileUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 7)')).toBe(true)
    expect(isMobileUserAgent(null)).toBe(false)
  })

  it('rejects desktop devices', () => {
    expect(isMobileUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36')).toBe(false)
    expect(isMobileUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')).toBe(false)
  })
})

describe('resolveHomeDestination', () => {
  it('always returns /dashboard on desktop regardless of role', () => {
    expect(resolveHomeDestination({ role: 'manager', home_preference: 'dashboard' }, false)).toBe('/dashboard')
    expect(resolveHomeDestination({ role: 'manager', home_preference: 'terrain' }, false)).toBe('/dashboard')
    expect(resolveHomeDestination({ role: 'chef_equipe', home_preference: 'dashboard' }, false)).toBe('/dashboard')
  })

  it('keeps roles separate from home experience preferences on mobile', () => {
    expect(resolveHomeDestination({ role: 'manager', home_preference: 'dashboard' }, true)).toBe('/dashboard')
    expect(resolveHomeDestination({ role: 'manager', home_preference: 'terrain' }, true)).toBe('/m')
    expect(resolveHomeDestination({ role: 'chef_equipe', home_preference: 'dashboard' }, true)).toBe('/m')
  })
})

describe('shouldRedirectDashboardRequestToField', () => {
  it('never redirects on desktop', () => {
    expect(shouldRedirectDashboardRequestToField({
      role: 'chef_equipe',
      home_preference: 'dashboard',
      pathname: '/dashboard',
    }, false)).toBe(false)
  })

  it('lets managers open dashboard pages even when their home preference is terrain', () => {
    expect(shouldRedirectDashboardRequestToField({
      role: 'manager',
      home_preference: 'terrain',
      pathname: '/dashboard',
    }, true)).toBe(false)
  })

  it('keeps field users on the mobile app except for their account page (on mobile)', () => {
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
