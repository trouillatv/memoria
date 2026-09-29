// MEMORIA-HOME-V2 — tests de rendu de DashboardPremium.tsx.
//
// Couvre :
//   - Selection : lien carte pleine `?chantier=` + aria-current, lien "Ouvrir" distinct
//   - Hero : état vide, 0/1/2+ PV, contenu figé (mandat home-hero-delta.ts)
//   - Memory : les 4 branches de MemorySouvient
//   - Attention : état vide + badges par tone
//   - Planning : Agenda (singulier/pluriel, priorité échéance > passage, état vide)
//   - Regression : rendu complet sans exception, pas de traces d'anciens blocs

import { describe, it, expect } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { DashboardPremium, Hero, MemorySouvient } from '@/app/(dashboard)/dashboard/DashboardPremium'
import type { SiteDashboardItem } from '@/lib/db/sites-dashboard'
import type { AttentionCard } from '@/lib/situations/attention/types'
import type { MemoryReview, ConfirmedItem } from '@/lib/knowledge/memory-review'
import type { UpcomingDashboardItem } from '@/lib/db/upcoming-items'
import type { DashboardDeadlineToPlan } from '@/lib/db/dashboard-deadlines'
import type { HomeHeroDelta } from '@/lib/documents/home-hero-delta'
import type { OrganizationIdentity, OrganizationIdentityMap } from '@/lib/db/organisations'

function org(over: Partial<OrganizationIdentity> = {}): OrganizationIdentity {
  return { id: 'org-a', name: 'Org A', slug: 'org-a', logoPath: null, logoUrl: null, brandColor: null, ...over }
}

function site(over: Partial<SiteDashboardItem> = {}): SiteDashboardItem {
  return {
    id: 'site-1',
    name: 'Chantier Alpha',
    organizationId: 'org-a',
    organization: org(),
    clientName: null,
    displayIdentity: { label: 'Org A', logoUrl: null, brandColor: null, source: 'organization' },
    activeActionCount: 2,
    overdueActionCount: 0,
    openReserveCount: 1,
    lastActivityAt: null,
    nextPassageAt: null,
    status: 'warning',
    href: '/sites/site-1',
    pvCount: 3,
    subjectCount: 7,
    ...over,
  }
}

function emptyReview(): MemoryReview {
  return { confirmed: [], toReview: [] }
}

function confirmedItem(over: Partial<ConfirmedItem> = {}): ConfirmedItem {
  return {
    id: 'ci-1',
    group: 'Intervenants',
    title: 'Jean Dupont — conducteur de travaux',
    nature: 'Connaissance durable',
    href: '/sites/site-1/intervenants/ci-1',
    knowledgeEntryId: null,
    durable: true,
    thematicCategory: null,
    sourceCount: 2,
    ...over,
  }
}

function attentionCard(over: Partial<AttentionCard> = {}): AttentionCard {
  return {
    id: 'ac-1',
    icon: 'warning',
    tone: 'red',
    priority: 10,
    title: 'Réserve non levée depuis 40 jours',
    description: 'Détail de la réserve.',
    siteLabel: 'Chantier Alpha',
    secondaryActions: [],
    subject: null,
    resolutions: [],
    ...over,
  }
}

function upcomingItem(over: Partial<UpcomingDashboardItem> = {}): UpcomingDashboardItem {
  return {
    id: 'up-1',
    sourceType: 'visit',
    organizationId: 'org-a',
    organization: org(),
    siteId: 'site-1',
    siteName: 'Chantier Alpha',
    clientName: null,
    title: 'Visite de contrôle',
    kind: 'visit',
    startsAt: '2026-10-01T08:00:00Z',
    isToday: false,
    isOverdue: false,
    href: '/sites/site-1',
    ...over,
  }
}

function deadline(over: Partial<DashboardDeadlineToPlan> = {}): DashboardDeadlineToPlan {
  return {
    id: 'dl-1',
    organizationId: 'org-a',
    organization: org(),
    siteId: 'site-1',
    siteName: 'Chantier Alpha',
    clientName: null,
    title: 'Réception des travaux',
    constraintText: null,
    reportId: null,
    href: '/sites/site-1/echeances/dl-1',
    ...over,
  }
}

const organizationMap: OrganizationIdentityMap = { 'org-a': org() }

type Props = React.ComponentProps<typeof DashboardPremium>

// heroSlot/memorySlot sont désormais pré-rendus par page.tsx (Async Server Component
// + Suspense, cf. fix Suspense Home V2) : les tests les construisent ici à partir de
// heroDelta/activeReview, comme le ferait ActiveHero/ActiveMemory.
type BaseOverrides = Omit<Partial<Props>, 'heroSlot' | 'memorySlot'> & {
  heroDelta?: HomeHeroDelta | null
  activeReview?: MemoryReview
}

function baseProps(over: BaseOverrides = {}): Props {
  const { heroDelta = null, activeReview = emptyReview(), sites = [site()], activeSiteId = 'site-1', ...rest } = over
  const activeSite = sites.find((s) => s.id === activeSiteId) ?? null
  return {
    firstName: 'Vincent',
    orgNames: ['Org A'],
    attentionCards: [],
    upcoming: [],
    sites,
    activeSiteId,
    heroSlot: <Hero site={activeSite} heroDelta={heroDelta} />,
    memorySlot: <MemorySouvient site={activeSite} review={activeReview} />,
    orgLabels: { 'org-a': 'org-a' },
    organizationMap,
    deadlinesToPlan: [],
    ...rest,
  }
}

describe('DashboardPremium — Selection (sélecteur de chantier)', () => {
  it('la carte pleine pointe vers ?chantier=<id> et porte aria-current quand active', () => {
    render(<DashboardPremium {...baseProps({ sites: [site({ id: 'site-1' })], activeSiteId: 'site-1' })} />)
    const fullCardLink = screen.getByRole('link', { name: 'Sélectionner Chantier Alpha' })
    expect(fullCardLink).toHaveAttribute('href', '/dashboard?chantier=site-1')
    expect(fullCardLink).toHaveAttribute('aria-current', 'true')
  })

  it('une carte inactive ne porte pas aria-current', () => {
    render(
      <DashboardPremium
        {...baseProps({
          sites: [site({ id: 'site-1' }), site({ id: 'site-2', name: 'Chantier Beta' })],
          activeSiteId: 'site-1',
        })}
      />,
    )
    const inactiveLink = screen.getByRole('link', { name: 'Sélectionner Chantier Beta' })
    expect(inactiveLink).not.toHaveAttribute('aria-current')
  })

  it('le lien "Ouvrir le chantier" est distinct de la carte et pointe vers site.href', () => {
    render(<DashboardPremium {...baseProps({ sites: [site({ id: 'site-1', href: '/sites/site-1' })] })} />)
    const openLink = screen.getByRole('link', { name: /Ouvrir le chantier/ })
    expect(openLink).toHaveAttribute('href', '/sites/site-1')
  })

  it('la zone décorative (nom, compteurs, activité) est neutralisée au clic — pointer-events-none — pour laisser le clic traverser vers la carte pleine, sans bloquer "Ouvrir le chantier" ni créer de lien imbriqué', () => {
    const { container } = render(
      <DashboardPremium {...baseProps({ sites: [site({ id: 'site-1', href: '/sites/site-1' })] })} />,
    )
    // Aucun <a> ne doit contenir un autre <a> (HTML invalide, cible de clic ambiguë).
    for (const anchor of Array.from(container.querySelectorAll('a'))) {
      expect(anchor.querySelector('a')).toBeNull()
    }
    // Le nom du chantier (zone décorative) est neutralisé au clic : le clic ne doit
    // jamais rester capté ici, il doit traverser vers le Link plein-carte en dessous.
    // Scopé à la section "Vos chantiers" : le Hero rend aussi {site.name} dans son <h2>.
    const chantiersSection = screen.getByText('Vos chantiers').closest('section') as HTMLElement
    const decorativeWrapper = within(chantiersSection).getByText('Chantier Alpha').closest('.pointer-events-none')
    expect(decorativeWrapper).not.toBeNull()
    // "Ouvrir le chantier" reste HORS de cette zone neutralisée — un vrai clic dessus fonctionne.
    const openLink = within(chantiersSection).getByRole('link', { name: /Ouvrir le chantier/ })
    expect(openLink.closest('.pointer-events-none')).toBeNull()
    expect(() => fireEvent.click(openLink)).not.toThrow()
  })

  it('le carrousel expose une structure role="list"/"listitem" avec une carte par chantier', () => {
    render(
      <DashboardPremium
        {...baseProps({
          sites: [site({ id: 'site-1' }), site({ id: 'site-2', name: 'Chantier Beta' })],
          activeSiteId: 'site-1',
        })}
      />,
    )
    const chantiersSection = screen.getByText('Vos chantiers').closest('section') as HTMLElement
    const list = within(chantiersSection).getByRole('list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
  })

  it('le chantier actif apparaît en tête du carrousel même s\'il n\'est pas premier dans `sites`', () => {
    render(
      <DashboardPremium
        {...baseProps({
          sites: [site({ id: 'site-1', name: 'Chantier Alpha' }), site({ id: 'site-2', name: 'Chantier Beta' })],
          activeSiteId: 'site-2',
        })}
      />,
    )
    const chantiersSection = screen.getByText('Vos chantiers').closest('section') as HTMLElement
    const items = within(chantiersSection).getAllByRole('listitem')
    expect(within(items[0]!).getByText('Chantier Beta')).toBeInTheDocument()
  })

  it('FIX RECENCE — actif ancien + plusieurs sites : l\'actif reste premier, les suivants sont triés par lastActivityAt DESC', () => {
    render(
      <DashboardPremium
        {...baseProps({
          sites: [
            site({ id: 'site-1', name: 'Chantier Alpha', lastActivityAt: '2026-01-01T00:00:00Z' }),
            site({ id: 'site-2', name: 'Chantier Beta', lastActivityAt: '2026-09-20T00:00:00Z' }),
            site({ id: 'site-3', name: 'Chantier Gamma', lastActivityAt: '2026-09-25T00:00:00Z' }),
          ],
          activeSiteId: 'site-1',
        })}
      />,
    )
    const chantiersSection = screen.getByText('Vos chantiers').closest('section') as HTMLElement
    const items = within(chantiersSection).getAllByRole('listitem')
    expect(within(items[0]!).getByText('Chantier Alpha')).toBeInTheDocument()
    expect(within(items[1]!).getByText('Chantier Gamma')).toBeInTheDocument()
    expect(within(items[2]!).getByText('Chantier Beta')).toBeInTheDocument()
  })

  it('FIX RECENCE — lastActivityAt null toujours en dernier', () => {
    render(
      <DashboardPremium
        {...baseProps({
          sites: [
            site({ id: 'site-1', name: 'Chantier Alpha', lastActivityAt: null }),
            site({ id: 'site-2', name: 'Chantier Beta', lastActivityAt: '2026-09-20T00:00:00Z' }),
          ],
          activeSiteId: null,
        })}
      />,
    )
    const chantiersSection = screen.getByText('Vos chantiers').closest('section') as HTMLElement
    const items = within(chantiersSection).getAllByRole('listitem')
    expect(within(items[0]!).getByText('Chantier Beta')).toBeInTheDocument()
    expect(within(items[1]!).getByText('Chantier Alpha')).toBeInTheDocument()
  })

  it('FIX RECENCE — tie-break déterministe par nom quand lastActivityAt est identique', () => {
    render(
      <DashboardPremium
        {...baseProps({
          sites: [
            site({ id: 'site-1', name: 'Zoulou', lastActivityAt: '2026-09-20T00:00:00Z' }),
            site({ id: 'site-2', name: 'Alpha', lastActivityAt: '2026-09-20T00:00:00Z' }),
          ],
          activeSiteId: null,
        })}
      />,
    )
    const chantiersSection = screen.getByText('Vos chantiers').closest('section') as HTMLElement
    const items = within(chantiersSection).getAllByRole('listitem')
    expect(within(items[0]!).getByText('Alpha')).toBeInTheDocument()
    expect(within(items[1]!).getByText('Zoulou')).toBeInTheDocument()
  })

  it('RICHNESS §2/§6 — maximum 8 cartes, sans doublon de l\'actif', () => {
    const sites = [
      site({ id: 'site-old', name: 'Chantier Ancien', lastActivityAt: '2020-01-01T00:00:00Z' }),
      site({ id: 'site-1', name: 'Chantier 1', lastActivityAt: '2026-09-08T00:00:00Z' }),
      site({ id: 'site-2', name: 'Chantier 2', lastActivityAt: '2026-09-09T00:00:00Z' }),
      site({ id: 'site-3', name: 'Chantier 3', lastActivityAt: '2026-09-10T00:00:00Z' }),
      site({ id: 'site-4', name: 'Chantier 4', lastActivityAt: '2026-09-11T00:00:00Z' }),
      site({ id: 'site-5', name: 'Chantier 5', lastActivityAt: '2026-09-12T00:00:00Z' }),
      site({ id: 'site-6', name: 'Chantier 6', lastActivityAt: '2026-09-13T00:00:00Z' }),
      site({ id: 'site-7', name: 'Chantier 7', lastActivityAt: '2026-09-14T00:00:00Z' }),
      site({ id: 'site-8', name: 'Chantier 8', lastActivityAt: '2026-09-15T00:00:00Z' }),
    ]
    render(<DashboardPremium {...baseProps({ sites, activeSiteId: 'site-old' })} />)
    const chantiersSection = screen.getByText('Vos chantiers').closest('section') as HTMLElement
    const items = within(chantiersSection).getAllByRole('listitem')
    expect(items).toHaveLength(8)
    expect(within(items[0]!).getByText('Chantier Ancien')).toBeInTheDocument()
    expect(within(items[1]!).getByText('Chantier 8')).toBeInTheDocument()
    expect(within(items[2]!).getByText('Chantier 7')).toBeInTheDocument()
    expect(within(items[3]!).getByText('Chantier 6')).toBeInTheDocument()
    expect(within(items[4]!).getByText('Chantier 5')).toBeInTheDocument()
    expect(within(items[5]!).getByText('Chantier 4')).toBeInTheDocument()
    expect(within(items[6]!).getByText('Chantier 3')).toBeInTheDocument()
    expect(within(items[7]!).getByText('Chantier 2')).toBeInTheDocument()
    expect(screen.queryByText('Chantier 1')).not.toBeInTheDocument()
  })
})

describe('DashboardPremium — Identité visuelle (RICHNESS §1)', () => {
  it('Hero et carte chantier utilisent displayIdentity (client OCEF), pas organization (BECIB)', () => {
    const s = site({
      id: 'site-1',
      organization: org({ id: 'org-becib', name: 'BECIB' }),
      displayIdentity: { label: 'OCEF', logoUrl: null, brandColor: null, source: 'client' },
    })
    render(<DashboardPremium {...baseProps({ sites: [s], activeSiteId: 'site-1' })} />)
    // EntityLogo sans logoUrl replie sur les initiales du label — "OC" pour "OCEF",
    // jamais "BE" pour "BECIB" : preuve que displayIdentity (client) prime sur organization.
    expect(screen.queryByText('BE')).not.toBeInTheDocument()
    expect(screen.getAllByText('OC').length).toBeGreaterThan(0)
  })
})

describe('DashboardPremium — Hero (contenu figé, jamais de contenu périmé)', () => {
  it('aucun chantier accessible → état vide explicite', () => {
    render(<DashboardPremium {...baseProps({ sites: [], activeSiteId: null })} />)
    expect(screen.getByText('Aucun chantier accessible pour le moment.')).toBeInTheDocument()
  })

  it('0 PV (heroDelta null) → "Aucun PV intégré", zéro métrique, pas d\'enseignement', () => {
    render(<DashboardPremium {...baseProps({ heroDelta: null })} />)
    expect(screen.getByText(/Aucun PV intégré/)).toBeInTheDocument()
    expect(screen.queryByText(/résolu depuis le PV précédent/)).not.toBeInTheDocument()
  })

  it('1 PV (fromRunId/metrics null) → date affichée + message "Premier PV intégré"', () => {
    const heroDelta: HomeHeroDelta = {
      toRunId: 'run-1',
      toEffectiveDate: '2026-09-01',
      fromRunId: null,
      metrics: null,
      metricsFailed: false,
    }
    render(<DashboardPremium {...baseProps({ heroDelta })} />)
    expect(screen.getByText(/Dernier PV intégré/)).toBeInTheDocument()
    expect(
      screen.getByText('Premier PV intégré — le suivi des évolutions commencera au prochain PV.'),
    ).toBeInTheDocument()
  })

  it('2+ PV avec métriques → les 4 compteurs, les enseignements et le CTA vers l\'avant-après', () => {
    const heroDelta: HomeHeroDelta = {
      toRunId: 'run-3',
      toEffectiveDate: '2026-09-15',
      fromRunId: 'run-2',
      metrics: {
        nouveaux: [{ canonicalSubjectId: 'a', label: 'a' }],
        evolutions: [
          { canonicalSubjectId: 'b', label: 'b' },
          { canonicalSubjectId: 'c', label: 'c' },
        ],
        resolus: [{ canonicalSubjectId: 'd', label: 'd' }],
        nonMentionnes: [],
      },
      metricsFailed: false,
    }
    render(<DashboardPremium {...baseProps({ heroDelta, sites: [site({ id: 'site-1', pvCount: 4, subjectCount: 9 })] })} />)
    const hero = within(screen.getByText('Évolution depuis le PV précédent').closest('section') as HTMLElement)
    expect(hero.getByText('1 sujet résolu depuis le PV précédent')).toBeInTheDocument()
    expect(hero.getByText('2 sujets en évolution depuis le PV précédent')).toBeInTheDocument()
    expect(hero.getByText('1 nouveau sujet identifié')).toBeInTheDocument()
    expect(hero.getByText(/4 PV analysés/)).toBeInTheDocument()
    expect(hero.getByText(/9 sujets suivis/)).toBeInTheDocument()
    const cta = screen.getByRole('link', { name: /Voir ce qui a changé/ })
    expect(cta).toHaveAttribute('href', '/sites/site-1/historique?view=avant-apres')
  })

  it('FIX #4 — échec technique du calcul (metricsFailed) → état d\'indisponibilité explicite, jamais "Aucune évolution détectée" ni compteurs fabriqués', () => {
    const heroDelta: HomeHeroDelta = {
      toRunId: 'run-2',
      toEffectiveDate: '2026-09-15',
      fromRunId: 'run-1',
      metrics: null,
      metricsFailed: true,
    }
    render(<DashboardPremium {...baseProps({ heroDelta })} />)
    const hero = within(screen.getByText('Évolution depuis le PV précédent').closest('section') as HTMLElement)
    expect(hero.getByText('Synthèse temporairement indisponible — réessayez plus tard.')).toBeInTheDocument()
    expect(hero.queryByText(/Aucune évolution détectée/)).not.toBeInTheDocument()
    expect(hero.queryByText(/résolu depuis le PV précédent/)).not.toBeInTheDocument()
  })
})

describe('DashboardPremium — Memory ("Mémoire du chantier")', () => {
  it('titre et sous-titre exacts affichés', () => {
    render(<DashboardPremium {...baseProps({ activeReview: emptyReview() })} />)
    expect(screen.getByText('Mémoire du chantier')).toBeInTheDocument()
    expect(screen.getByText('Ce que MemorIA sait déjà de ce chantier.')).toBeInTheDocument()
    expect(screen.queryByText('MemorIA se souvient')).not.toBeInTheDocument()
  })

  it('aucun chantier actif → "Aucun chantier actif."', () => {
    render(<DashboardPremium {...baseProps({ sites: [], activeSiteId: null })} />)
    expect(screen.getByText('Aucun chantier actif.')).toBeInTheDocument()
  })

  it('chantier actif sans confirmé → message de repli exact', () => {
    render(<DashboardPremium {...baseProps({ activeReview: emptyReview() })} />)
    expect(
      screen.getByText('Aucun élément de mémoire utile mis en avant pour ce chantier pour le moment.'),
    ).toBeInTheDocument()
  })

  it('confirmed[0] avec href → lien cliquable vers la fiche', () => {
    const item = confirmedItem({ group: 'Décisions', href: '/sites/site-1/intervenants/ci-1', title: 'Jean Dupont' })
    render(<DashboardPremium {...baseProps({ activeReview: { confirmed: [item], toReview: [] } })} />)
    const link = screen.getByRole('link', { name: 'Jean Dupont' })
    expect(link).toHaveAttribute('href', '/sites/site-1/intervenants/ci-1')
  })

  it('confirmed[0] sans href → titre en texte, pas un lien', () => {
    const item = confirmedItem({ group: 'Décisions', href: null, title: 'Connaissance durable X' })
    render(<DashboardPremium {...baseProps({ activeReview: { confirmed: [item], toReview: [] } })} />)
    expect(screen.getByText('Connaissance durable X')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Connaissance durable X' })).not.toBeInTheDocument()
  })

  it('un intervenant en tête mais une décision présente → la décision est mise en avant (sans retrier getMemoryReview)', () => {
    const weakIntervenant = confirmedItem({
      id: 'ci-intervenant',
      group: 'Intervenants',
      title: 'Jean-Pierre Chauvin — Directeur HSE',
    })
    const richDecision = confirmedItem({
      id: 'ci-decision',
      group: 'Décisions',
      title: 'Décision structurante sur le lot gros œuvre',
    })
    render(
      <DashboardPremium
        {...baseProps({ activeReview: { confirmed: [weakIntervenant, richDecision], toReview: [] } })}
      />,
    )
    expect(screen.getByText('Décision structurante sur le lot gros œuvre')).toBeInTheDocument()
    expect(screen.queryByText('Jean-Pierre Chauvin — Directeur HSE')).not.toBeInTheDocument()
  })

  it("seul un intervenant existe → il reste affiché (repli sur confirmed[0])", () => {
    const onlyIntervenant = confirmedItem({ group: 'Intervenants', title: 'Jean Dupont — conducteur de travaux' })
    render(<DashboardPremium {...baseProps({ activeReview: { confirmed: [onlyIntervenant], toReview: [] } })} />)
    expect(screen.getByText('Jean Dupont — conducteur de travaux')).toBeInTheDocument()
  })

  it('RICHNESS §3 — une vigilance prime sur un intervenant', () => {
    const intervenant = confirmedItem({ id: 'ci-int', group: 'Intervenants', title: 'Marc Petit — HSE' })
    const vigilance = confirmedItem({ id: 'ci-vig', group: 'Points de vigilance', title: 'Accès chantier non sécurisé', href: null })
    render(<DashboardPremium {...baseProps({ activeReview: { confirmed: [intervenant, vigilance], toReview: [] } })} />)
    expect(screen.getByText('Accès chantier non sécurisé')).toBeInTheDocument()
    expect(screen.queryByText('Marc Petit — HSE')).not.toBeInTheDocument()
  })

  it('RICHNESS §3 — au plus 3 temps forts même si davantage d\'éléments confirmés existent', () => {
    const items = [
      confirmedItem({ id: 'ci-1', group: 'Décisions', title: 'Décision A' }),
      confirmedItem({ id: 'ci-2', group: 'Points de vigilance', title: 'Vigilance B', href: null }),
      confirmedItem({ id: 'ci-3', group: 'Ce que le chantier sait', title: 'Connaissance C', href: null }),
      confirmedItem({ id: 'ci-4', group: 'Décisions', title: 'Décision D' }),
    ]
    render(<DashboardPremium {...baseProps({ activeReview: { confirmed: items, toReview: [] } })} />)
    const shown = ['Décision A', 'Vigilance B', 'Connaissance C', 'Décision D'].filter((t) => screen.queryByText(t))
    expect(shown).toHaveLength(3)
  })

  it('RICHNESS §3 — au plus 4 compteurs, un par groupe réellement présent (jamais inventé)', () => {
    const items = [
      confirmedItem({ id: 'ci-1', group: 'Décisions', title: 'Décision A' }),
      confirmedItem({ id: 'ci-2', group: 'Points de vigilance', title: 'Vigilance B', href: null }),
    ]
    render(<DashboardPremium {...baseProps({ activeReview: { confirmed: items, toReview: [] } })} />)
    const memorySection = screen.getByText('Mémoire du chantier').closest('section') as HTMLElement
    expect(within(memorySection).getByText(/1 Décisions/)).toBeInTheDocument()
    expect(within(memorySection).getByText(/1 Points de vigilance/)).toBeInTheDocument()
    expect(within(memorySection).queryByText(/Intervenants/)).not.toBeInTheDocument()
    expect(within(memorySection).queryByText(/Ce que le chantier sait/)).not.toBeInTheDocument()
  })

  it('RICHNESS §3 — CTA "Voir toute la mémoire" pointe vers la route canonique du chantier', () => {
    const item = confirmedItem({ group: 'Décisions', title: 'Décision A' })
    render(
      <DashboardPremium
        {...baseProps({ sites: [site({ id: 'site-1' })], activeSiteId: 'site-1', activeReview: { confirmed: [item], toReview: [] } })}
      />,
    )
    const cta = screen.getByRole('link', { name: /Voir toute la mémoire/ })
    expect(cta).toHaveAttribute('href', '/sites/site-1/memoire')
  })

  it('RICHNESS §3 — aucun CTA ni contenu périmé quand le chantier n\'a rien à mettre en avant', () => {
    render(<DashboardPremium {...baseProps({ activeReview: emptyReview() })} />)
    expect(screen.queryByRole('link', { name: /Voir toute la mémoire/ })).not.toBeInTheDocument()
  })

  it('RICHNESS §3 — pas de fuite d\'un chantier vers l\'autre lors d\'un changement de sélection', () => {
    const reviewA: MemoryReview = { confirmed: [confirmedItem({ id: 'a', group: 'Décisions', title: 'Décision du chantier A' })], toReview: [] }
    const reviewB: MemoryReview = { confirmed: [confirmedItem({ id: 'b', group: 'Points de vigilance', title: 'Vigilance du chantier B', href: null })], toReview: [] }
    const { rerender } = render(<DashboardPremium {...baseProps({ activeReview: reviewA })} />)
    expect(screen.getByText('Décision du chantier A')).toBeInTheDocument()
    rerender(<DashboardPremium {...baseProps({ activeReview: reviewB })} />)
    expect(screen.queryByText('Décision du chantier A')).not.toBeInTheDocument()
    expect(screen.getByText('Vigilance du chantier B')).toBeInTheDocument()
  })
})

describe('DashboardPremium — Attention ("Ce qui mérite votre attention")', () => {
  it('aucune carte → "Tout est en rythme."', () => {
    render(<DashboardPremium {...baseProps({ attentionCards: [] })} />)
    expect(screen.getByText('Tout est en rythme.')).toBeInTheDocument()
  })

  it('tone red → badge "En retard" ; tone amber → "À revoir" ; tone neutral → "À traiter"', () => {
    render(
      <DashboardPremium
        {...baseProps({
          attentionCards: [
            attentionCard({ id: 'ac-red', tone: 'red', title: 'Rouge' }),
            attentionCard({ id: 'ac-amber', tone: 'amber', title: 'Ambre' }),
            attentionCard({ id: 'ac-neutral', tone: 'neutral', title: 'Neutre' }),
          ],
        })}
      />,
    )
    expect(screen.getByText('En retard')).toBeInTheDocument()
    expect(screen.getByText('À revoir')).toBeInTheDocument()
    expect(screen.getByText('À traiter')).toBeInTheDocument()
    expect(screen.getByText('Rouge')).toBeInTheDocument()
    expect(screen.getByText('Ambre')).toBeInTheDocument()
    expect(screen.getByText('Neutre')).toBeInTheDocument()
  })

  it('RICHNESS §4 — jusqu\'à 5 cartes affichées (au lieu de 3)', () => {
    const cards = [1, 2, 3, 4, 5].map((n) => attentionCard({ id: `ac-${n}`, title: `Carte ${n}` }))
    render(<DashboardPremium {...baseProps({ attentionCards: cards })} />)
    for (const n of [1, 2, 3, 4, 5]) {
      expect(screen.getByText(`Carte ${n}`)).toBeInTheDocument()
    }
  })

  it('RICHNESS §4 — résumé par ton sous le titre, ex. "2 en retard · 2 à revoir · 1 à traiter"', () => {
    render(
      <DashboardPremium
        {...baseProps({
          attentionCards: [
            attentionCard({ id: 'ac-1', tone: 'red', title: 'R1' }),
            attentionCard({ id: 'ac-2', tone: 'red', title: 'R2' }),
            attentionCard({ id: 'ac-3', tone: 'amber', title: 'A1' }),
            attentionCard({ id: 'ac-4', tone: 'amber', title: 'A2' }),
            attentionCard({ id: 'ac-5', tone: 'neutral', title: 'N1' }),
          ],
        })}
      />,
    )
    expect(screen.getByText('2 en retard · 2 à revoir · 1 à traiter')).toBeInTheDocument()
  })

  it('RICHNESS §4 — aucun résumé quand la liste est vide', () => {
    render(<DashboardPremium {...baseProps({ attentionCards: [] })} />)
    expect(screen.queryByText(/à revoir|en retard|à traiter/)).not.toBeInTheDocument()
  })
})

describe('DashboardPremium — Planning (Agenda)', () => {
  it('aucun passage ni échéance → état vide', () => {
    render(<DashboardPremium {...baseProps({ upcoming: [], deadlinesToPlan: [] })} />)
    expect(screen.getByText('Rien à organiser pour le moment.')).toBeInTheDocument()
  })

  it('singulier : "1 passage à venir" / "1 échéance à planifier"', () => {
    render(<DashboardPremium {...baseProps({ upcoming: [upcomingItem()], deadlinesToPlan: [deadline()] })} />)
    const agenda = within(screen.getByText('À organiser').closest('section') as HTMLElement)
    expect(agenda.getByText(/passage à venir/)).toBeInTheDocument()
    expect(agenda.getByText(/échéance à planifier/)).toBeInTheDocument()
  })

  it('pluriel : "2 passages à venir" / "2 échéances à planifier"', () => {
    render(
      <DashboardPremium
        {...baseProps({
          upcoming: [upcomingItem({ id: 'up-1' }), upcomingItem({ id: 'up-2' })],
          deadlinesToPlan: [deadline({ id: 'dl-1' }), deadline({ id: 'dl-2' })],
        })}
      />,
    )
    const agenda = within(screen.getByText('À organiser').closest('section') as HTMLElement)
    expect(agenda.getByText(/passages à venir/)).toBeInTheDocument()
    expect(agenda.getByText(/échéances à planifier/)).toBeInTheDocument()
  })

  it('une échéance à planifier passe AVANT le prochain passage (priorité affichage)', () => {
    render(
      <DashboardPremium
        {...baseProps({
          upcoming: [upcomingItem({ title: 'Visite prioritaire' })],
          deadlinesToPlan: [deadline({ title: 'Réception prioritaire' })],
        })}
      />,
    )
    expect(screen.getByText('Réception prioritaire')).toBeInTheDocument()
    expect(screen.queryByText('Visite prioritaire')).not.toBeInTheDocument()
  })
})

describe('DashboardPremium — Regression (rendu global, header, anciens blocs disparus)', () => {
  it('rendu complet avec props réalistes ne lève aucune exception', () => {
    expect(() =>
      render(
        <DashboardPremium
          {...baseProps({
            orgNames: ['Org A', 'Org B'],
            sites: [site({ id: 'site-1' }), site({ id: 'site-2', name: 'Chantier Beta' })],
            attentionCards: [attentionCard()],
            upcoming: [upcomingItem()],
            deadlinesToPlan: [deadline()],
            activeReview: { confirmed: [confirmedItem()], toReview: [] },
          })}
        />,
      ),
    ).not.toThrow()
  })

  it('en-tête : salutation toujours affichée', () => {
    render(<DashboardPremium {...baseProps({ firstName: 'Vincent' })} />)
    expect(screen.getByText('Bonjour Vincent 👋')).toBeInTheDocument()
  })

  it('mono-org : la ligne des organisations n\'est PAS affichée', () => {
    render(<DashboardPremium {...baseProps({ orgNames: ['Org A'] })} />)
    expect(screen.queryByText('Org A')).not.toBeInTheDocument()
  })

  it('multi-org : la ligne des organisations est affichée, jointe par " · "', () => {
    render(<DashboardPremium {...baseProps({ orgNames: ['Org A', 'Org B'] })} />)
    expect(screen.getByText('Org A · Org B')).toBeInTheDocument()
  })

  it('aucune trace des anciens blocs legacy (VisitSummary/SitesTable/PriorityActions/MemoryCards)', () => {
    const { container } = render(<DashboardPremium {...baseProps()} />)
    expect(container.innerHTML).not.toMatch(/VisitSummary|SitesTable|PriorityActions|MemoryCards/)
  })

  it('aucune trace de l\'ancien libellé "MemorIA se souvient" ni de l\'ancien message de repli', () => {
    const { container } = render(<DashboardPremium {...baseProps()} />)
    expect(container.innerHTML).not.toMatch(/MemorIA se souvient|Rien de confirmé à retenir/)
  })
})
