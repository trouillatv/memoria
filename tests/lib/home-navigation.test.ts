import { describe, expect, it } from 'vitest'
import { resolveHomeDestination } from '@/lib/navigation/home'

// Matrice doctrine 2026-08-04 :
//   chef_equipe          → /m (navigateur ou PWA, sans exception)
//   admin / manager PWA  → /m (le contenant décide)
//   admin / manager nav  → /dashboard

describe('resolveHomeDestination', () => {
  it('admin + navigateur → /dashboard', () => {
    expect(resolveHomeDestination('admin', false)).toBe('/dashboard')
  })

  it('admin + PWA → /m', () => {
    expect(resolveHomeDestination('admin', true)).toBe('/m')
  })

  it('manager + navigateur → /dashboard', () => {
    expect(resolveHomeDestination('manager', false)).toBe('/dashboard')
  })

  it('manager + PWA → /m', () => {
    expect(resolveHomeDestination('manager', true)).toBe('/m')
  })

  it('chef_equipe + navigateur → /m', () => {
    expect(resolveHomeDestination('chef_equipe', false)).toBe('/m')
  })

  it('chef_equipe + PWA → /m', () => {
    expect(resolveHomeDestination('chef_equipe', true)).toBe('/m')
  })
})
