import { describe, expect, it } from 'vitest'

import {
  resolveHomeDestination,
  shouldRedirectDashboardRequestToField,
} from '@/lib/navigation/home'

describe('resolveHomeDestination', () => {
  it('keeps roles separate from home experience preferences', () => {
    expect(resolveHomeDestination({ role: 'manager', home_preference: 'dashboard' })).toBe('/dashboard')
    expect(resolveHomeDestination({ role: 'manager', home_preference: 'terrain' })).toBe('/m')
    expect(resolveHomeDestination({ role: 'chef_equipe', home_preference: 'dashboard' })).toBe('/m')
  })

  it('lets managers open dashboard pages even when their home preference is terrain', () => {
    expect(shouldRedirectDashboardRequestToField({
      role: 'manager',
      home_preference: 'terrain',
      pathname: '/dashboard',
    })).toBe(false)
  })

  it('keeps field users on the mobile app except for their account page', () => {
    expect(shouldRedirectDashboardRequestToField({
      role: 'chef_equipe',
      home_preference: 'dashboard',
      pathname: '/dashboard',
    })).toBe(true)

    expect(shouldRedirectDashboardRequestToField({
      role: 'chef_equipe',
      home_preference: 'dashboard',
      pathname: '/account',
    })).toBe(false)
  })
})
