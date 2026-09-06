// NAV LOT 1 — la hiérarchie du menu est un CONTRAT : premier niveau = la
// proposition de valeur en six lignes ; aucune route de l'ancienne nav ne
// disparaît (elles se déplacent sous « Plus » ou dans le hub Mémoire).

import { describe, it, expect } from 'vitest'
import { NAV, NAV_PRIMARY, NAV_PLUS, MEMORY_HUB, NAV_FOOTER } from '@/components/layout/nav-items'

describe('nav lot 1 — premier niveau', () => {
  it('exactement cinq entrées primaires, dans l’ordre du récit produit (Recherche retirée — amendement audit × orgs)', () => {
    expect(NAV_PRIMARY.map((n) => n.href)).toEqual([
      '/dashboard', '/sites', '/actions', '/mois', '/memoire',
    ])
  })

  it('le tableau de bord s’appelle désormais « Aujourd’hui » (route inchangée)', () => {
    expect(NAV_PRIMARY.find((n) => n.href === '/dashboard')?.label).toBe("Aujourd'hui")
  })
})

describe('nav lot 1 — aucune route perdue', () => {
  const LEGACY_ROUTES = [
    '/recherche', '/dashboard', '/mois', '/briefing', '/clients', '/missions',
    '/planning', '/meetings', '/actions', '/sites', '/opportunites', '/contracts',
    '/equipes', '/intervenants', '/memoire',
    '/manuel', '/glossaire', '/comprendre/memoire-ia', '/comprendre/architecture',
    '/admin', '/admin/depenses-ia',
  ]
  it('toutes les anciennes routes de nav restent atteignables (NAV plat ∪ hub Mémoire)', () => {
    const reachable = new Set([...NAV.map((n) => n.href), ...MEMORY_HUB.map((n) => n.href)])
    for (const r of [...LEGACY_ROUTES, '/tenders', '/handovers', '/preuves', '/documents']) {
      expect(reachable.has(r), `route perdue : ${r}`).toBe(true)
    }
  })
})

describe('nav lot 1 — Plus et hub Mémoire', () => {
  it('« Plus » contient Activité (Réunions, Journal, Briefing) et Organisation', () => {
    const titles = NAV_PLUS.map((g) => g.title)
    expect(titles).toEqual(['Activité', 'Organisation'])
    const org = NAV_PLUS[1]!.items.map((n) => n.href)
    expect(org).toEqual(['/clients', '/missions', '/opportunites', '/contracts', '/equipes', '/intervenants'])
  })

  it('Acteurs est gated env (masqué quand la feature est OFF — plus de lien vers un 404)', () => {
    const acteurs = NAV_PLUS.flatMap((g) => g.items).find((n) => n.href === '/intervenants')
    expect(acteurs?.envGate).toBe('intervenants')
  })

  it('le hub Mémoire met la Bibliothèque en tête (surface réellement utilisée)', () => {
    expect(MEMORY_HUB[0]?.href).toBe('/documents')
    expect(MEMORY_HUB.map((n) => n.href)).toEqual(['/documents', '/recherche', '/tenders', '/handovers', '/preuves'])
  })

  it('Guides et Admin inchangés en pied de nav', () => {
    expect(NAV_FOOTER.map((n) => n.href)).toContain('/manuel')
    expect(NAV_FOOTER.map((n) => n.href)).toContain('/admin')
  })
})
