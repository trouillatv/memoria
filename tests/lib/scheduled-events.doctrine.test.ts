import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePayload, producesReport, reportOriginFor } from '@/lib/db/scheduled-events'

const MIGRATION = join(process.cwd(), 'supabase/migrations/216_site_scheduled_events.sql')
const MODEL = join(process.cwd(), 'lib/db/scheduled-events.ts')
const EVENTS = join(process.cwd(), 'lib/knowledge/site-events.ts')

// ── LA FRONTIÈRE ─────────────────────────────────────────────────────────────
// « site_scheduled_events doit porter uniquement les événements futurs qui n'ont
// pas déjà un objet métier spécialisé. » (Vincent, 2026-07-17)
//
// Une intervention a son cycle : équipe, horaires, affectation, preuves,
// facturation. L'y absorber ne créerait pas de l'ordre, ça dupliquerait un
// modèle vivant. Le jour où 'intervention' entre dans cette union, l'objet est
// devenu le fourre-tout qu'on voulait éviter — et ce test aura échoué avant.
describe('Le moment prévu — la frontière', () => {
  const sql = readFileSync(MIGRATION, 'utf8')
  const model = readFileSync(MODEL, 'utf8')

  it("n'accueille aucun événement qui possède déjà son objet métier", () => {
    const typeCheck = sql.match(/CHECK \(type IN \(([^)]+)\)\)/)?.[1] ?? ''
    expect(typeCheck, 'la contrainte CHECK sur type est introuvable').toBeTruthy()
    for (const intrus of ['intervention', 'deadline', 'closure', 'rotation', 'blocage', 'blockage', 'echeance']) {
      expect(typeCheck, `${intrus} a son propre modèle : il se PROJETTE dans le Planning, il ne se migre pas ici`)
        .not.toContain(intrus)
    }
  })

  it('porte exactement les cinq types sans objet métier spécialisé', () => {
    expect(model).toContain("export type ScheduledEventType = 'visit' | 'meeting' | 'inspection' | 'delivery' | 'other'")
  })
})

// ── LE WORKFLOW EST TYPÉ ─────────────────────────────────────────────────────
// La règle n'est PAS « tout événement crée un report » mais « certains types
// peuvent en produire un ». Une livraison se constate ; lui fabriquer un CR
// serait inventer une visite que personne n'a faite.
describe('Le moment prévu — chaque type a son workflow', () => {
  it('une livraison ne produit jamais de compte-rendu', () => {
    expect(producesReport('delivery')).toBe(false)
    expect(producesReport('other')).toBe(false)
  })

  it('une visite, une réunion et un contrôle en produisent un', () => {
    expect(producesReport('visit')).toBe(true)
    expect(producesReport('meeting')).toBe(true)
    expect(producesReport('inspection')).toBe(true)
  })

  it("la réunion garde le marqueur existant : l'ABSENCE d'origin (mig 162)", () => {
    expect(reportOriginFor('meeting')).toBeNull()
    expect(reportOriginFor('visit')).toBe('planned')
  })

  it('la base interdit un démarrage sans compte-rendu, sauf livraison', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    expect(sql).toContain('sse_report_required_when_started')
  })
})

// ── LE PAYLOAD A UN CONTRAT ──────────────────────────────────────────────────
// La base reste en jsonb, mais l'application impose la forme. Sans ça, chaque
// écran inventerait sa clé et « moment prévu » ne voudrait plus rien dire.
describe('Le moment prévu — le payload est discriminé, jamais libre', () => {
  it("jette les clés qui n'appartiennent pas au type", () => {
    const p = parsePayload('delivery', { supplier: 'Sotrap', agenda: 'ordre du jour', objective: 'x' })
    expect(p).toEqual({ type: 'delivery', supplier: 'Sotrap', expectedItems: undefined })
    expect(p).not.toHaveProperty('agenda')
  })

  it("n'invente rien quand la clé est absente ou vide", () => {
    expect(parsePayload('visit', {})).toEqual({ type: 'visit', objective: undefined })
    expect(parsePayload('visit', { objective: '   ' })).toEqual({ type: 'visit', objective: undefined })
    expect(parsePayload('meeting', null)).toEqual({ type: 'meeting', agenda: undefined, participantIds: undefined })
  })

  it('ne garde une liste de participants que si elle contient de vrais ids', () => {
    expect(parsePayload('meeting', { participantIds: ['a', '', 'b'] })).toEqual({
      type: 'meeting', agenda: undefined, participantIds: ['a', 'b'],
    })
    expect(parsePayload('meeting', { participantIds: 'pas-une-liste' }).type).toBe('meeting')
    expect(parsePayload('meeting', { participantIds: [] })).toEqual({
      type: 'meeting', agenda: undefined, participantIds: undefined,
    })
  })
})

// ── L'AUTEUR : TRAÇABILITÉ, JAMAIS MESURE ────────────────────────────────────
// « L'auteur est affiché pour assurer la traçabilité d'une décision métier,
// jamais pour mesurer une personne. » (Vincent, 2026-07-17)
//
// La frontière est nette et tient dans le TYPE : une DÉCISION porte son auteur —
// c'est un acte engageant, et un acte a un auteur. Une VISITE n'en porte pas :
// nommer qui est passé, quand, et combien de temps, c'est du pointage — et c'est
// exactement la ligne rouge du produit. (Cf. refus-erp-rh-pointage-gps.)
//
// Ce test échoue AVANT qu'un Dashboard ne commence à compter par utilisateur.
describe("L'auteur — traçabilité d'une décision, jamais mesure d'une personne", () => {
  const source = readFileSync(EVENTS, 'utf8')

  it("la visite ne porte AUCUN auteur : qui est passé et combien de temps = pointage", () => {
    const visit = source.match(/export interface HistoryVisit \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(visit, 'HistoryVisit est introuvable').toBeTruthy()
    for (const champ of ['by', 'author', 'reviewed_by', 'userId', 'createdBy']) {
      expect(visit, `HistoryVisit ne doit jamais nommer une personne (champ « ${champ} »)`)
        .not.toMatch(new RegExp(`\\b${champ}\\b`))
    }
  })

  it("seule la décision humaine nomme son auteur", () => {
    const decision = source.match(/export interface HistoryDecision \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(decision).toMatch(/\bby\b/)
  })

  it("n'agrège jamais par personne", () => {
    // Un compte par utilisateur — « Guillaume a validé 12 échéances ce mois-ci » —
    // transformerait la traçabilité en mesure. C'est un autre produit.
    expect(source).not.toMatch(/countBy\s*\(\s*['"]reviewed_by|groupBy\s*\(\s*['"](reviewed_by|user)/)
  })
})
