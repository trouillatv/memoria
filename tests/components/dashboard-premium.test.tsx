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
import { render, screen, within } from '@testing-library/react'
import { DashboardPremium } from '@/app/(dashboard)/dashboard/DashboardPremium'
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

function baseProps(over: Partial<Props> = {}): Props {
  return {
    firstName: 'Vincent',
    orgNames: ['Org A'],
    attentionCards: [],
    upcoming: [],
    sites: [site()],
    activeSiteId: 'site-1',
    heroDelta: null,
    activeReview: emptyReview(),
    orgLabels: { 'org-a': 'org-a' },
    organizationMap,
    deadlinesToPlan: [],
    ...over,
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
})

describe('DashboardPremium — Memory ("MemorIA se souvient")', () => {
  it('aucun chantier actif → "Aucun chantier actif."', () => {
    render(<DashboardPremium {...baseProps({ sites: [], activeSiteId: null })} />)
    expect(screen.getByText('Aucun chantier actif.')).toBeInTheDocument()
  })

  it('chantier actif sans confirmé → message nominatif', () => {
    render(<DashboardPremium {...baseProps({ activeReview: emptyReview() })} />)
    expect(screen.getByText('Rien de confirmé à retenir pour Chantier Alpha pour le moment.')).toBeInTheDocument()
  })

  it('confirmed[0] avec href → lien cliquable vers la fiche', () => {
    const item = confirmedItem({ href: '/sites/site-1/intervenants/ci-1', title: 'Jean Dupont' })
    render(<DashboardPremium {...baseProps({ activeReview: { confirmed: [item], toReview: [] } })} />)
    const link = screen.getByRole('link', { name: 'Jean Dupont' })
    expect(link).toHaveAttribute('href', '/sites/site-1/intervenants/ci-1')
  })

  it('confirmed[0] sans href → titre en texte, pas un lien', () => {
    const item = confirmedItem({ href: null, title: 'Connaissance durable X' })
    render(<DashboardPremium {...baseProps({ activeReview: { confirmed: [item], toReview: [] } })} />)
    expect(screen.getByText('Connaissance durable X')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Connaissance durable X' })).not.toBeInTheDocument()
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
})
