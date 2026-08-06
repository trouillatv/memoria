import { describe, expect, it } from 'vitest'
import { resolveHomeDestination } from '@/lib/navigation/home'

// Doctrine 2026-08-06 :
//   La surface est déterminée par le rôle uniquement.
//   La PWA entre par /m via manifest start_url — pas de détection client nécessaire.
//
//   chef_equipe → /m  (il exécute, il ne pilote pas)
//   admin / manager → /dashboard
//
// Coexistence garantie : un admin peut avoir la PWA ouverte sur /m
// et Chrome ouvert sur /dashboard simultanément, avec le même compte,
// sans se déconnecter — le routage est structurel, pas via cookie.

describe('resolveHomeDestination', () => {
  it('admin → /dashboard', () => {
    expect(resolveHomeDestination('admin')).toBe('/dashboard')
  })

  it('manager → /dashboard', () => {
    expect(resolveHomeDestination('manager')).toBe('/dashboard')
  })

  it('chef_equipe → /m', () => {
    expect(resolveHomeDestination('chef_equipe')).toBe('/m')
  })
})
