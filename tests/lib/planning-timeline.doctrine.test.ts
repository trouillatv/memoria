import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sortTimeline, eventDay, type PlanningTimelineEvent } from '@/lib/planning/timeline-contract'

// ── DOCTRINE DU PLANNING ─────────────────────────────────────────────────────
// « Le Planning affiche immédiatement tout événement RÉEL ou toute proposition
//   DATÉE qui existe. Les événements futurs qui n'ont pas encore de modèle métier
//   sont créés dans des sprints séparés — JAMAIS simulés. » (Vincent, 2026-07-17)
//
// Deux tentations à interdire par le test, parce qu'elles sont invisibles à la
// relecture et coûteuses à l'usage :
//   1. inventer une VISITE PRÉVUE (elle n'existe pas dans le modèle) ;
//   2. transformer `next_meeting_at` en RÉUNION (une date sur un CR n'a ni heure,
//      ni participants — lui en donner, c'est promettre une certitude absente).

const SOURCE = readFileSync(join(process.cwd(), 'lib/db/planning-timeline.ts'), 'utf8')

function ev(over: Partial<PlanningTimelineEvent> = {}): PlanningTimelineEvent {
  return {
    id: 'e', type: 'intervention', siteId: 's', siteName: 'S', title: 'T',
    start: '2026-07-20', end: null, status: 'upcoming', certainty: 'confirmed',
    source: 'x', href: null, detail: null,
    ...over,
  }
}

describe('Planning — on n’invente aucun événement', () => {
  it("n'invente pas de visite prévue", () => {
    // Une visite naît en démarrant : il n'existe aucune visite planifiée. Le futur
    // proche n'en affiche donc AUCUNE — et c'est honnête.
    expect(SOURCE).not.toContain('Visite prévue')
    expect(SOURCE).not.toContain('visite_planifiee')
  })

  it("ne transforme pas next_meeting_at en réunion", () => {
    // L'intention porte son nom, et son incertitude.
    expect(SOURCE).toContain("type: 'reunion_a_organiser'")
    expect(SOURCE).toContain('Réunion à organiser')
    expect(SOURCE).toContain('Date indicative')
  })

  it("ne place pas une échéance sans date sur la chronologie", () => {
    // « Sous dix jours » n'est pas un jour. Une échéance à planifier attend dans sa
    // section — la poser sur une date déduite serait inventer.
    expect(SOURCE).toContain('if (!d.due_date || d.due_date < range.from || d.due_date > range.to) return')
  })

  it('reste fail-closed sur l’organisation', () => {
    expect(SOURCE).toContain("sq.eq('organization_id', orgId)")
  })
})

describe('Ordre du récit', () => {
  it('groupe par jour, et met les événements horodatés avant ceux qui ne le sont pas', () => {
    // On ne fabrique pas d'heure pour trier : une date sans heure passe après.
    const sorted = sortTimeline([
      ev({ id: 'sans-heure', start: '2026-07-20', title: 'Échéance' }),
      ev({ id: 'demain', start: '2026-07-21T08:00:00+11:00' }),
      ev({ id: 'avec-heure', start: '2026-07-20T09:00:00+11:00' }),
    ])
    expect(sorted.map((e) => e.id)).toEqual(['avec-heure', 'sans-heure', 'demain'])
  })

  it('le jour civil est celui de Nouméa, pas celui du serveur', () => {
    expect(eventDay(ev({ start: '2026-07-20T09:00:00+11:00' }))).toBe('2026-07-20')
  })
})
