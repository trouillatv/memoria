// Point 17A — classifieur PUR de durabilité d'affichage. Déterministe, par
// thematic_category. Défaut = durable (jamais masquer un thème inconnu).

import { describe, expect, it } from 'vitest'
import { isDurableTheme, ACTIVITY_THEMES } from '@/lib/knowledge/memory-durability'

describe('isDurableTheme — sélection d’affichage déterministe', () => {
  it('les thèmes d’ACTIVITÉ (progress/forecast/weather/test_control) ne sont PAS durables', () => {
    for (const t of ['progress', 'forecast', 'weather', 'test_control']) {
      expect(isDurableTheme(t)).toBe(false)
      expect(ACTIVITY_THEMES.has(t)).toBe(true)
    }
  })

  it('les thèmes durables reconnus (general_knowledge/administrative/resources) sont durables', () => {
    for (const t of ['general_knowledge', 'administrative', 'resources']) {
      expect(isDurableTheme(t)).toBe(true)
    }
  })

  it('DÉFAUT = durable : un thème inconnu ou null n’est JAMAIS masqué silencieusement', () => {
    expect(isDurableTheme('safety_environment')).toBe(true) // thème réel non listé
    expect(isDurableTheme(null)).toBe(true)
    expect(isDurableTheme(undefined)).toBe(true)
    expect(isDurableTheme('theme_inedit_futur')).toBe(true)
  })
})
