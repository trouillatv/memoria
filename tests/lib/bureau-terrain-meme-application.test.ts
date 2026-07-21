import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { resolveHomeDestination, isMobileUserAgent } from '@/lib/navigation/home'

// ── G5 — BUREAU ET TERRAIN SONT DEUX VUES D'UNE MÊME APPLICATION ────────────
//
// Changer de vue déconnectait — volontairement : l'action faisait `signOut()`
// puis renvoyait au login, et le message le disait (« Reconnectez-vous pour
// ouvrir la vue choisie »). Un conducteur en plein chantier perdait sa session
// pour un changement d'affichage.
//
// Aucune raison technique : la préférence est relue à chaud. Ces tests
// interdisent le retour de la déconnexion et tiennent la règle d'ouverture.

const ACTIONS = fs.readFileSync(path.join(process.cwd(), 'app/(dashboard)/account/actions.ts'), 'utf8')
const TOGGLE = fs.readFileSync(
  path.join(process.cwd(), 'app/(dashboard)/account/HomePreferenceToggle.tsx'),
  'utf8',
)

describe('Changer de vue ne déconnecte jamais', () => {
  it('l’action de préférence ne signe plus personne dehors', () => {
    const bloc = ACTIONS.slice(ACTIONS.indexOf('applyHomePreferenceAction'))
    const fin = bloc.indexOf('export async function updateThemePreferenceAction')
    const code = bloc.slice(0, fin > 0 ? fin : undefined)
    expect(code).not.toContain('signOut')
    expect(code).not.toContain("redirect('/login')")
  })

  it('elle rend la destination, et l’écran y navigue', () => {
    expect(ACTIONS).toMatch(/destination\?: '\/m' \| '\/dashboard'/)
    expect(TOGGLE).toContain('router.push(result.destination)')
  })

  it('l’écran ne demande plus de se reconnecter', () => {
    expect(TOGGLE).not.toMatch(/[Rr]econnectez-vous/)
  })
})

describe('Où l’on ouvre après connexion', () => {
  const chef = { role: 'chef_equipe' as const, home_preference: 'dashboard' as const }
  const conducteur = { role: 'manager' as const, home_preference: 'terrain' as const }
  const bureau = { role: 'manager' as const, home_preference: 'dashboard' as const }

  it('un ORDINATEUR ouvre toujours le bureau, quelle que soit la préférence', () => {
    expect(resolveHomeDestination(conducteur, false)).toBe('/dashboard')
    expect(resolveHomeDestination(chef, false)).toBe('/dashboard')
  })

  it('un TÉLÉPHONE ouvre le terrain quand c’est la préférence', () => {
    expect(resolveHomeDestination(conducteur, true)).toBe('/m')
  })

  it('un téléphone respecte un choix explicite de bureau', () => {
    expect(resolveHomeDestination(bureau, true)).toBe('/dashboard')
  })

  it('un chef d’équipe reste au terrain sur téléphone', () => {
    expect(resolveHomeDestination(chef, true)).toBe('/m')
  })
})

describe('Reconnaître un téléphone', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', true],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8)', true],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', false],
    [null, false],
  ])('%s → %s', (ua, attendu) => {
    expect(isMobileUserAgent(ua as string | null)).toBe(attendu)
  })
})

describe('Le défaut d’un compte neuf', () => {
  it('est « terrain » — un téléphone ouvre sur le chantier', () => {
    const mig = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/229_home_preference_terrain_by_default.sql'),
      'utf8',
    )
    expect(mig).toMatch(/set default 'terrain'/)
  })
})
