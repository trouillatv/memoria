import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  phaseOfSiteEvent, freshnessOf, type SiteEvent,
} from '@/lib/knowledge/site-event-contract'

const MIGRATIONS = join(process.cwd(), 'supabase/migrations')

function event(patch: Partial<SiteEvent>): SiteEvent {
  return {
    id: 'e1', siteId: 's1', type: 'meeting', category: 'calendar',
    title: 'Réunion PAVE', summary: null,
    occurredAt: null, scheduledStart: null, scheduledEnd: null,
    status: 'planned', certainty: 'confirmed',
    actor: null, source: { type: 'scheduled_event', id: 'x' },
    href: null, metadata: {},
    ...patch,
  }
}

const NOW = new Date('2026-07-17T10:00:00Z')

// ── PHASE : CALCULÉE, JAMAIS STOCKÉE ─────────────────────────────────────────
// « phase doit être calculée à la lecture, jamais persistée. Une valeur
// temporelle stockée finirait nécessairement par mentir. » (Vincent, 2026-07-17)
describe('phaseOfSiteEvent — dérivée de maintenant', () => {
  it('situe un rendez-vous à venir, en cours, ou passé', () => {
    expect(phaseOfSiteEvent(event({ scheduledStart: '2026-07-24T09:00:00Z' }), NOW)).toBe('future')
    expect(phaseOfSiteEvent(event({ scheduledStart: '2026-07-01T09:00:00Z' }), NOW)).toBe('past')
    expect(phaseOfSiteEvent(
      event({ scheduledStart: '2026-07-17T09:00:00Z', scheduledEnd: '2026-07-17T11:00:00Z' }), NOW,
    )).toBe('current')
  })

  it('le MÊME événement change de phase avec le temps — la preuve qu\'on ne peut pas la stocker', () => {
    const e = event({ scheduledStart: '2026-07-20T09:00:00Z' })
    expect(phaseOfSiteEvent(e, new Date('2026-07-17T10:00:00Z'))).toBe('future')
    expect(phaseOfSiteEvent(e, new Date('2026-07-25T10:00:00Z'))).toBe('past')
  })

  it("une échéance sans date est « undated », jamais passée : elle attend une date", () => {
    // « Avant le démarrage » n'a pas de date. Lui en inventer une (minuit, 8 h)
    // serait décider à la place du conducteur.
    expect(phaseOfSiteEvent(event({ type: 'deadline', scheduledStart: null, occurredAt: null }), NOW)).toBe('undated')
    expect(phaseOfSiteEvent(event({ scheduledStart: 'pas-une-date' }), NOW)).toBe('undated')
  })

  it('retombe sur occurredAt quand rien n\'était prévu', () => {
    expect(phaseOfSiteEvent(event({ occurredAt: '2026-07-15T02:45:00Z' }), NOW)).toBe('past')
  })

  it('un événement ponctuel finit quand il commence : on n\'invente pas de durée', () => {
    const e = event({ scheduledStart: '2026-07-17T10:00:00Z' }) // pile maintenant
    expect(phaseOfSiteEvent(e, NOW)).toBe('current')
    expect(phaseOfSiteEvent(e, new Date('2026-07-17T10:00:01Z'))).toBe('past')
  })
})

// Le gel demandé : la phase TEMPORELLE ne doit jamais être persistée.
//
// ATTENTION au mot : `phase` existe déjà en base (171_site_phase, 172_dossiers,
// 187_dossier_phase_events) et c'est une AUTRE notion — la phase de vie d'un
// chantier ou d'un dossier ('actif', 'prospect'), posée par un humain. Elle ne
// dérive pas de l'heure, elle ne ment pas, et elle est antérieure. La règle vise
// la phase de SiteEvent : celle qui se déduit de `now`. On la gèle donc sur les
// tables qui portent des événements, pas sur le mot.
describe('phase — la phase temporelle est gelée hors de la base', () => {
  const TABLES_EVENEMENT = ['site_scheduled_events', 'site_reports', 'site_knowledge_proposals']

  it("aucune table d'événements ne porte de colonne phase", () => {
    const coupables: string[] = []
    for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))) {
      const sql = readFileSync(join(MIGRATIONS, f), 'utf8')
      for (const t of TABLES_EVENEMENT) {
        // Un ALTER qui ajoute phase à une table d'événements…
        if (new RegExp(`alter table[^;]*${t}[^;]*add column (if not exists )?phase\\b`, 'is').test(sql)) {
          coupables.push(`${f} (alter ${t})`)
        }
        // …ou un CREATE TABLE de l'une d'elles qui la déclare.
        const create = sql.match(new RegExp(`create table[^;]*${t}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i'))?.[1]
        if (create && /^\s*phase\s+(text|varchar|int)/im.test(create)) coupables.push(`${f} (create ${t})`)
      }
    }
    expect(coupables, `phase temporelle persistée dans : ${coupables.join(', ')} — elle mentira`).toEqual([])
  })

  it("aucun type de ligne de base ne porte phase", () => {
    for (const f of ['lib/db/scheduled-events.ts', 'lib/knowledge/repository.ts']) {
      const src = readFileSync(join(process.cwd(), f), 'utf8')
      expect(src, `${f} : une ligne de base ne porte jamais la phase`).not.toMatch(/^\s*phase[?]?\s*:/m)
    }
  })

  it("le contrat ne porte pas phase comme CHAMP", () => {
    const src = readFileSync(join(process.cwd(), 'lib/knowledge/site-event-contract.ts'), 'utf8')
    const iface = src.match(/export interface SiteEvent \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(iface).toBeTruthy()
    expect(iface, 'phase est un calcul, pas un champ').not.toMatch(/^\s*phase[?]?:/m)
  })
})

// ── LE TEMPS SIGNALE, IL N'ANNULE PAS ────────────────────────────────────────
// « Transmettre le plan avant démarrage » reste pertinente trois mois si le
// démarrage n'a pas eu lieu. Une péremption automatique effacerait la seule
// chose qui comptait.
describe('freshnessOf — le temps invite à réexaminer, jamais à annuler', () => {
  it('classe par âge, sans jamais supprimer', () => {
    expect(freshnessOf('2026-07-15T00:00:00Z', NOW)).toBe('new')
    expect(freshnessOf('2026-07-01T00:00:00Z', NOW)).toBe('pending')
    expect(freshnessOf('2026-05-01T00:00:00Z', NOW)).toBe('stale')
  })

  it("« stale » reste une invitation : ce n'est pas un statut, il n'écrit rien", () => {
    // La fraîcheur est un CALCUL sur created_at. Le seul verdict d'obsolescence
    // est 'superseded', porté par le statut en base — jamais par l'âge.
    const src = readFileSync(join(process.cwd(), 'lib/knowledge/site-event-contract.ts'), 'utf8')
    expect(src).not.toMatch(/\.update\(|\.from\(|createAdminClient/)
  })
})
