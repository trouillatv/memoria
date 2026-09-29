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
import { DashboardPremium, Hero, MemorySouvient, ActionsDuChantier } from '@/app/(dashboard)/dashboard/DashboardPremium'
import type { SiteDashboardItem } from '@/lib/db/sites-dashboard'
import type { MemoryReview, ConfirmedItem } from '@/lib/knowledge/memory-review'
import type { UpcomingDashboardItem } from '@/lib/db/upcoming-items'
import type { DashboardDeadlineToPlan } from '@/lib/db/dashboard-deadlines'
import type { HomeHeroDelta } from '@/lib/documents/home-hero-delta'
import { emptyActionsPilotage, type SiteActionsPilotage, type PilotageCbo, type PilotageSubject } from '@/lib/knowledge/actions-pilotage'
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
    pointCount: 5,
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

function pilotageCbo(over: Partial<PilotageCbo> = {}): PilotageCbo {
  return {
    cboId: 'cbo-1',
    label: 'Reprendre les enduits',
    computedCurrentState: 'open',
    active: true,
    terminal: false,
    stateBasis: [],
    conflicts: [],
    documentaryDivergences: [],
    targetActionId: 'action-1',
    ...over,
  }
}

function pilotageSubject(over: Partial<PilotageSubject> = {}): PilotageSubject {
  return {
    canonicalSubjectId: 'cs-1',
    label: 'Façades',
    displayState: 'open',
    activeCboCount: 1,
    completedCboCount: 0,
    unknownCboCount: 0,
    totalCboCount: 1,
    lastMeaningfulChangeAt: null,
    pvCount: 1,
    cbos: [pilotageCbo()],
    formulations: [],
    formulationPvCount: 0,
    ...over,
  }
}

function pilotage(over: Partial<SiteActionsPilotage> = {}): SiteActionsPilotage {
  const base = emptyActionsPilotage()
  return { ...base, ...over }
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

// heroSlot/memorySlot/actionsSlot sont désormais pré-rendus par page.tsx (Async Server
// Component + Suspense, cf. fix Suspense Home V2) : les tests les construisent ici à
// partir de heroDelta/activeReview/activePilotage, comme le ferait
// ActiveHero/ActiveMemory/ActiveActions.
type BaseOverrides = Omit<Partial<Props>, 'heroSlot' | 'memorySlot' | 'actionsSlot'> & {
  heroDelta?: HomeHeroDelta | null
  activeReview?: MemoryReview
  activePilotage?: SiteActionsPilotage
  activeLateCount?: number
  activeOverdueDaysByActionId?: Record<string, number>
}

function baseProps(over: BaseOverrides = {}): Props {
  const {
    heroDelta = null,
    activeReview = emptyReview(),
    activePilotage = emptyActionsPilotage(),
    activeLateCount = 0,
    activeOverdueDaysByActionId = {},
    sites = [site()],
    activeSiteId = 'site-1',
    ...rest
  } = over
  const activeSite = sites.find((s) => s.id === activeSiteId) ?? null
  return {
    firstName: 'Vincent',
    orgNames: ['Org A'],
    upcoming: [],
    sites,
    activeSiteId,
    heroSlot: <Hero site={activeSite} heroDelta={heroDelta} />,
    memorySlot: <MemorySouvient site={activeSite} review={activeReview} />,
    actionsSlot: (
      <ActionsDuChantier
        site={activeSite}
        pilotage={activePilotage}
        lateCount={activeLateCount}
        overdueDaysByActionId={activeOverdueDaysByActionId}
      />
    ),
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

  it('SECTION 1 — tous les chantiers accessibles sont affichés, aucun plafond', () => {
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
    expect(items).toHaveLength(9)
    expect(within(items[0]!).getByText('Chantier Ancien')).toBeInTheDocument()
    expect(within(items[1]!).getByText('Chantier 8')).toBeInTheDocument()
    expect(within(items[8]!).getByText('Chantier 1')).toBeInTheDocument()
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
    const cta = screen.getByRole('link', { name: /Voir ce qui a changé/ })
    expect(cta).toHaveAttribute('href', '/sites/site-1/historique?view=avant-apres')
  })

  it('FIX 1 (review SHA 40a4ba65) — subjectCount (population proposition/thread) n\'est jamais présenté à côté du delta (population canonicale) : deux read-models non comparables', () => {
    const heroDelta: HomeHeroDelta = {
      toRunId: 'run-3',
      toEffectiveDate: '2026-09-15',
      fromRunId: 'run-2',
      metrics: {
        nouveaux: [{ canonicalSubjectId: 'a', label: 'a' }],
        evolutions: [],
        resolus: [],
        nonMentionnes: [{ canonicalSubjectId: 'z', label: 'z' }],
      },
      metricsFailed: false,
    }
    render(<DashboardPremium {...baseProps({ heroDelta, sites: [site({ id: 'site-1', pvCount: 4, subjectCount: 47 })] })} />)
    const hero = within(screen.getByText('Évolution depuis le PV précédent').closest('section') as HTMLElement)
    expect(hero.queryByText(/sujets? suivis?/)).not.toBeInTheDocument()
    expect(hero.queryByText(/47/)).not.toBeInTheDocument()
  })

  it('FIX 4 — le détail des changements affiche les quatre groupes (Nouveaux/Évolutions/Résolus/Non mentionnés)', () => {
    const heroDelta: HomeHeroDelta = {
      toRunId: 'run-3',
      toEffectiveDate: '2026-09-15',
      fromRunId: 'run-2',
      metrics: {
        nouveaux: [{ canonicalSubjectId: 'a', label: 'Sujet nouveau' }],
        evolutions: [{ canonicalSubjectId: 'b', label: 'Sujet évolution' }],
        resolus: [{ canonicalSubjectId: 'c', label: 'Sujet résolu' }],
        nonMentionnes: [{ canonicalSubjectId: 'd', label: 'Sujet non mentionné' }],
      },
      metricsFailed: false,
    }
    render(<DashboardPremium {...baseProps({ heroDelta })} />)
    const hero = within(screen.getByText('Évolution depuis le PV précédent').closest('section') as HTMLElement)
    expect(hero.getByText(/Nouveaux \(1\)/)).toBeInTheDocument()
    expect(hero.getByText(/Évolutions \(1\)/)).toBeInTheDocument()
    expect(hero.getByText(/Résolus \(1\)/)).toBeInTheDocument()
    expect(hero.getByText(/Non mentionnés \(1\)/)).toBeInTheDocument()
    expect(hero.getByText('Sujet nouveau')).toBeInTheDocument()
    expect(hero.getByText('Sujet évolution')).toBeInTheDocument()
    expect(hero.getByText('Sujet résolu')).toBeInTheDocument()
    expect(hero.getByText('Sujet non mentionné')).toBeInTheDocument()
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
    const memorySection = screen.getByText('Mémoire du chantier').closest('section') as HTMLElement
    expect(within(memorySection).getByText('Aucun chantier actif.')).toBeInTheDocument()
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

  it('FIX 2 (review SHA 40a4ba65) — un intervenant ET une décision sont TOUS DEUX affichés, chacun sous son groupe (aucune exclusion)', () => {
    const intervenant = confirmedItem({
      id: 'ci-intervenant',
      group: 'Intervenants',
      title: 'Jean-Pierre Chauvin — Directeur HSE',
    })
    const decision = confirmedItem({
      id: 'ci-decision',
      group: 'Décisions',
      title: 'Décision structurante sur le lot gros œuvre',
    })
    render(
      <DashboardPremium
        {...baseProps({ activeReview: { confirmed: [intervenant, decision], toReview: [] } })}
      />,
    )
    expect(screen.getByText('Décision structurante sur le lot gros œuvre')).toBeInTheDocument()
    expect(screen.getByText('Jean-Pierre Chauvin — Directeur HSE')).toBeInTheDocument()
  })

  it("seul un intervenant existe → il reste affiché (repli sur confirmed[0])", () => {
    const onlyIntervenant = confirmedItem({ group: 'Intervenants', title: 'Jean Dupont — conducteur de travaux' })
    render(<DashboardPremium {...baseProps({ activeReview: { confirmed: [onlyIntervenant], toReview: [] } })} />)
    expect(screen.getByText('Jean Dupont — conducteur de travaux')).toBeInTheDocument()
  })

  it('FIX 2 (review SHA 40a4ba65) — une vigilance ET un intervenant sont TOUS DEUX affichés (aucune exclusion)', () => {
    const intervenant = confirmedItem({ id: 'ci-int', group: 'Intervenants', title: 'Marc Petit — HSE' })
    const vigilance = confirmedItem({ id: 'ci-vig', group: 'Points de vigilance', title: 'Accès chantier non sécurisé', href: null })
    render(<DashboardPremium {...baseProps({ activeReview: { confirmed: [intervenant, vigilance], toReview: [] } })} />)
    expect(screen.getByText('Accès chantier non sécurisé')).toBeInTheDocument()
    expect(screen.getByText('Marc Petit — HSE')).toBeInTheDocument()
  })

  it('FIX 2 (review SHA 40a4ba65) — TOUS les review.confirmed sont rendus (2 Décisions + 2 Vigilances + 2 Connaissances + 2 Intervenants = 8), un seul header par groupe', () => {
    const items = [
      confirmedItem({ id: 'd1', group: 'Décisions', title: 'Décision 1' }),
      confirmedItem({ id: 'd2', group: 'Décisions', title: 'Décision 2' }),
      confirmedItem({ id: 'v1', group: 'Points de vigilance', title: 'Vigilance 1', href: null }),
      confirmedItem({ id: 'v2', group: 'Points de vigilance', title: 'Vigilance 2', href: null }),
      confirmedItem({ id: 'c1', group: 'Ce que le chantier sait', title: 'Connaissance 1', href: null }),
      confirmedItem({ id: 'c2', group: 'Ce que le chantier sait', title: 'Connaissance 2', href: null }),
      confirmedItem({ id: 'i1', group: 'Intervenants', title: 'Intervenant 1' }),
      confirmedItem({ id: 'i2', group: 'Intervenants', title: 'Intervenant 2' }),
    ]
    render(<DashboardPremium {...baseProps({ activeReview: { confirmed: items, toReview: [] } })} />)
    const memorySection = screen.getByText('Mémoire du chantier').closest('section') as HTMLElement
    for (const title of ['Décision 1', 'Décision 2', 'Vigilance 1', 'Vigilance 2', 'Connaissance 1', 'Connaissance 2', 'Intervenant 1', 'Intervenant 2']) {
      expect(within(memorySection).getByText(title)).toBeInTheDocument()
    }
    // Un seul header visuel par groupe — pas de répétition du libellé de groupe par item.
    expect(within(memorySection).getAllByText('Décisions')).toHaveLength(1)
    expect(within(memorySection).getAllByText('Points de vigilance')).toHaveLength(1)
    expect(within(memorySection).getAllByText('Ce que le chantier sait')).toHaveLength(1)
    expect(within(memorySection).getAllByText('Intervenants')).toHaveLength(1)
  })

  it('SECTION 7 — TOUS les temps forts sont affichés (liste complète, scrollable), aucun plafond à 3', () => {
    const items = [
      confirmedItem({ id: 'ci-1', group: 'Décisions', title: 'Décision A' }),
      confirmedItem({ id: 'ci-2', group: 'Points de vigilance', title: 'Vigilance B', href: null }),
      confirmedItem({ id: 'ci-3', group: 'Ce que le chantier sait', title: 'Connaissance C', href: null }),
      confirmedItem({ id: 'ci-4', group: 'Décisions', title: 'Décision D' }),
    ]
    render(<DashboardPremium {...baseProps({ activeReview: { confirmed: items, toReview: [] } })} />)
    for (const title of ['Décision A', 'Vigilance B', 'Connaissance C', 'Décision D']) {
      expect(screen.getByText(title)).toBeInTheDocument()
    }
  })

  it('RICHNESS §3 — au plus 4 compteurs, un par groupe réellement présent (jamais inventé)', () => {
    const items = [
      confirmedItem({ id: 'ci-1', group: 'Décisions', title: 'Décision A' }),
      confirmedItem({ id: 'ci-2', group: 'Points de vigilance', title: 'Vigilance B', href: null }),
    ]
    render(<DashboardPremium {...baseProps({ activeReview: { confirmed: items, toReview: [] } })} />)
    const memorySection = screen.getByText('Mémoire du chantier').closest('section') as HTMLElement
    expect(within(memorySection).queryByText(/Intervenants/)).not.toBeInTheDocument()
    expect(within(memorySection).queryByText(/Ce que le chantier sait/)).not.toBeInTheDocument()
  })

  it('SECTION 7 — pluralisation correcte des compteurs : "1 Décision" et "1 Point de vigilance" (jamais "1 Décisions")', () => {
    const items = [
      confirmedItem({ id: 'ci-1', group: 'Décisions', title: 'Décision A' }),
      confirmedItem({ id: 'ci-2', group: 'Points de vigilance', title: 'Vigilance B', href: null }),
    ]
    render(<DashboardPremium {...baseProps({ activeReview: { confirmed: items, toReview: [] } })} />)
    const memorySection = screen.getByText('Mémoire du chantier').closest('section') as HTMLElement
    expect(within(memorySection).getByText('1 Décision')).toBeInTheDocument()
    expect(within(memorySection).getByText('1 Point de vigilance')).toBeInTheDocument()
    expect(within(memorySection).queryByText('1 Décisions')).not.toBeInTheDocument()
    expect(within(memorySection).queryByText('1 Points de vigilance')).not.toBeInTheDocument()
  })

  it('SECTION 7 — pluriel conservé à partir de 2 : "2 Décisions"', () => {
    const items = [
      confirmedItem({ id: 'ci-1', group: 'Décisions', title: 'Décision A' }),
      confirmedItem({ id: 'ci-2', group: 'Décisions', title: 'Décision B' }),
    ]
    render(<DashboardPremium {...baseProps({ activeReview: { confirmed: items, toReview: [] } })} />)
    const memorySection = screen.getByText('Mémoire du chantier').closest('section') as HTMLElement
    expect(within(memorySection).getByText('2 Décisions')).toBeInTheDocument()
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

describe('DashboardPremium — Actions du chantier (SECTION 6)', () => {
  it('aucun chantier actif → "Aucun chantier actif."', () => {
    render(<DashboardPremium {...baseProps({ sites: [], activeSiteId: null })} />)
    const section = screen.getByText('Actions du chantier').closest('section') as HTMLElement
    expect(within(section).getByText('Aucun chantier actif.')).toBeInTheDocument()
  })

  it('chantier actif sans CBO actif → état vide dédié, jamais "Aucun chantier actif."', () => {
    render(<DashboardPremium {...baseProps({ activePilotage: emptyActionsPilotage(), activeLateCount: 0 })} />)
    const section = screen.getByText('Actions du chantier').closest('section') as HTMLElement
    expect(within(section).getByText('Aucune action en cours sur ce chantier.')).toBeInTheDocument()
  })

  it('en-tête "N actions · M en retard" + liste des CBO actifs, liens vers l\'action ciblée', () => {
    const subject = pilotageSubject({
      canonicalSubjectId: 'cs-1',
      label: 'Façades',
      cbos: [pilotageCbo({ cboId: 'cbo-1', label: 'Reprendre les enduits', targetActionId: 'action-1' })],
    })
    const p = pilotage({ subjects: [subject] })
    render(<DashboardPremium {...baseProps({ activePilotage: p, activeLateCount: 1 })} />)
    const section = screen.getByText('Actions du chantier').closest('section') as HTMLElement
    expect(within(section).getByText('1 action · 1 en retard')).toBeInTheDocument()
    const link = within(section).getByRole('link', { name: /Reprendre les enduits/ })
    expect(link).toHaveAttribute('href', '/sites/site-1/actions?actionId=action-1')
  })

  it('un CBO inactif n\'apparaît pas dans la liste (seuls les CBO actifs sont affichés)', () => {
    const subject = pilotageSubject({
      cbos: [
        pilotageCbo({ cboId: 'cbo-active', label: 'CBO actif', active: true }),
        pilotageCbo({ cboId: 'cbo-done', label: 'CBO terminé', active: false, terminal: true }),
      ],
    })
    const p = pilotage({ subjects: [subject] })
    render(<DashboardPremium {...baseProps({ activePilotage: p })} />)
    const section = screen.getByText('Actions du chantier').closest('section') as HTMLElement
    expect(within(section).getByText('CBO actif')).toBeInTheDocument()
    expect(within(section).queryByText('CBO terminé')).not.toBeInTheDocument()
  })

  it('FIX 3 (review SHA 40a4ba65) — une pilotage.unattachedActions apparaît dans la liste, avec le libellé de repli "Action non rattachée"', () => {
    const p = pilotage({
      subjects: [],
      unattachedActions: [pilotageCbo({ cboId: 'raw-action-2', label: 'Action orpheline', targetActionId: 'action-2' })],
    })
    render(<DashboardPremium {...baseProps({ activePilotage: p })} />)
    const section = screen.getByText('Actions du chantier').closest('section') as HTMLElement
    expect(within(section).getByText('Action orpheline')).toBeInTheDocument()
    expect(within(section).getByText('Action non rattachée')).toBeInTheDocument()
    const link = within(section).getByRole('link', { name: /Action orpheline/ })
    expect(link).toHaveAttribute('href', '/sites/site-1/actions?actionId=action-2')
  })

  it('FIX 3 (review SHA 40a4ba65) — le compteur "N actions" correspond à la population réellement visible (CBO rattachés + unattachedActions), pas à kpi.activeCbo', () => {
    const subject = pilotageSubject({
      cbos: [pilotageCbo({ cboId: 'cbo-1', label: 'Action rattachée', targetActionId: 'action-1' })],
    })
    const p = pilotage({
      kpi: { ...emptyActionsPilotage().kpi, activeCbo: 1 },
      subjects: [subject],
      unattachedActions: [pilotageCbo({ cboId: 'raw-action-2', label: 'Action orpheline', targetActionId: 'action-2' })],
    })
    render(<DashboardPremium {...baseProps({ activePilotage: p })} />)
    const section = screen.getByText('Actions du chantier').closest('section') as HTMLElement
    expect(within(section).getByText('2 actions · 0 en retard')).toBeInTheDocument()
  })

  it('FIX 4 — l\'échéance (cbo.dueDate) est rendue au format jj/mm/aaaa quand elle existe', () => {
    const subject = pilotageSubject({
      cbos: [pilotageCbo({ cboId: 'cbo-1', label: 'Contrôle potence Accès Est', targetActionId: 'action-1', dueDate: '2026-10-04' })],
    })
    const p = pilotage({ subjects: [subject] })
    render(<DashboardPremium {...baseProps({ activePilotage: p })} />)
    const section = screen.getByText('Actions du chantier').closest('section') as HTMLElement
    expect(within(section).getByText(/Échéance 04\/10\/2026/)).toBeInTheDocument()
  })

  it('FIX 4 — une action en retard (overdueDaysByActionId) affiche le badge "En retard de N j"', () => {
    const subject = pilotageSubject({
      cbos: [pilotageCbo({ cboId: 'cbo-1', label: 'Plan de gestion des eaux', targetActionId: 'action-1', dueDate: '2026-09-16' })],
    })
    const p = pilotage({ subjects: [subject] })
    render(
      <DashboardPremium
        {...baseProps({ activePilotage: p, activeLateCount: 1, activeOverdueDaysByActionId: { 'action-1': 13 } })}
      />,
    )
    const section = screen.getByText('Actions du chantier').closest('section') as HTMLElement
    expect(within(section).getByText(/En retard de 13 j/)).toBeInTheDocument()
  })

  it('CTA "Voir toutes les actions" pointe vers la route Actions du chantier', () => {
    render(<DashboardPremium {...baseProps()} />)
    const section = screen.getByText('Actions du chantier').closest('section') as HTMLElement
    const cta = within(section).getByRole('link', { name: /Voir toutes les actions/ })
    expect(cta).toHaveAttribute('href', '/sites/site-1/actions')
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
            activePilotage: pilotage({ subjects: [pilotageSubject()] }),
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
