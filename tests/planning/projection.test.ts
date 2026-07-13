// PL1 — preuve de non-régression du moteur de projection.
//
// Ce fichier contient DEUX choses :
//
//  1. Les tests de comportement du moteur pur (fréquences, bornes, créneaux,
//     heures, période arbitraire).
//
//  2. **L'ORACLE LEGACY** : une réimplémentation VERBATIM de l'algorithme qui
//     vivait dans `generateInterventionsFromTemplates` avant PL1 (commit
//     229ae64, lib/db/intervention-templates.ts:403-451). On le confronte au
//     nouveau moteur sur une matrice de cas × fenêtres. S'ils divergent d'une
//     seule occurrence, le test casse.
//
//     C'est la preuve exigée : « projection virtuelle = occurrences
//     actuellement générées » sur une fenêtre de 7 jours (et au-delà).

import { describe, it, expect } from 'vitest'
import { buildScheduledAt, slotFromUtcHour } from '@/lib/time/prestation-slot'
import {
  projectOccurrences,
  matchesFrequency,
  occurrenceKey,
  isValidDateIso,
  type ProjectableTemplate,
  type ProjectedOccurrence,
} from '@/lib/planning/projection'
import type { InterventionSlot } from '@/types/db'

/** Clé d'une occurrence projetée (raccourci de lecture pour les tests). */
const occurrenceKeyOf = (o: ProjectedOccurrence) =>
  occurrenceKey({ templateId: o.templateId, scheduledFor: o.scheduledFor, slot: o.slot })

// ─────────────────────────────────────────────────────────────────────────────
// L'ORACLE — code d'avant PL1, recopié tel quel (ne pas « améliorer »)
// ─────────────────────────────────────────────────────────────────────────────

function legacyIsoDayOfWeek(date: Date): number {
  const d = date.getUTCDay()
  return d === 0 ? 7 : d
}

function legacyMatchesFrequency(template: ProjectableTemplate, date: Date): boolean {
  const dateIso = date.toISOString().slice(0, 10)
  if (template.ends_on && dateIso > template.ends_on) return false
  if (dateIso < template.starts_on) return false
  switch (template.frequency) {
    case 'daily':
      return true
    case 'weekdays':
      return legacyIsoDayOfWeek(date) >= 1 && legacyIsoDayOfWeek(date) <= 5
    case 'weekly':
      return template.day_of_week !== null && legacyIsoDayOfWeek(date) === template.day_of_week
    case 'monthly':
      return template.day_of_month !== null && date.getUTCDate() === template.day_of_month
    case 'one_shot':
      return dateIso === template.starts_on
    default:
      return false
  }
}

function legacyEnumerateDates(fromIso: string, toIso: string): Date[] {
  const out: Date[] = []
  const from = new Date(`${fromIso}T00:00:00.000Z`)
  const to = new Date(`${toIso}T00:00:00.000Z`)
  for (let d = new Date(from); d.getTime() <= to.getTime(); d = new Date(d.getTime() + 24 * 60 * 60 * 1000)) {
    out.push(new Date(d))
  }
  return out
}

/** Les lignes que l'ancienne génération aurait construites (hors héritage
 *  équipe/organisation, qui n'a pas bougé et ne dépend pas du calcul). */
function legacyRows(templates: ProjectableTemplate[], fromDate: string, toDate: string): ProjectedOccurrence[] {
  const rows: ProjectedOccurrence[] = []
  for (const tpl of templates) {
    const effectiveStart = tpl.starts_on > fromDate ? tpl.starts_on : fromDate
    const effectiveEnd = tpl.ends_on && tpl.ends_on < toDate ? tpl.ends_on : toDate
    if (effectiveStart > effectiveEnd) continue

    const dates = legacyEnumerateDates(effectiveStart, effectiveEnd)
    const hasTime =
      typeof tpl.planned_start_hhmm === 'string' && /^\d{2}:\d{2}$/.test(tpl.planned_start_hhmm)
    const slots: (InterventionSlot | null)[] = hasTime
      ? [slotFromUtcHour(Number(tpl.planned_start_hhmm!.slice(0, 2)))]
      : tpl.slots && tpl.slots.length > 0
        ? tpl.slots
        : [null]

    for (const date of dates) {
      if (!legacyMatchesFrequency(tpl, date)) continue
      const dateIso = date.toISOString().slice(0, 10)
      for (const slot of slots) {
        const plannedStart = hasTime
          ? `${dateIso}T${tpl.planned_start_hhmm}:00.000Z`
          : buildScheduledAt(dateIso, slot)
        const plannedEnd =
          hasTime && tpl.planned_end_hhmm ? `${dateIso}T${tpl.planned_end_hhmm}:00.000Z` : null
        rows.push({
          templateId: tpl.id,
          missionId: tpl.mission_id,
          scheduledFor: dateIso,
          slot,
          plannedStart,
          plannedEnd,
        })
      }
    }
  }
  return rows
}

// ─────────────────────────────────────────────────────────────────────────────
// Jeux de templates — tous les cas que le schéma actuel sait exprimer
// ─────────────────────────────────────────────────────────────────────────────

const base: Omit<ProjectableTemplate, 'id' | 'frequency'> = {
  mission_id: 'm1',
  slots: null,
  day_of_week: null,
  day_of_month: null,
  planned_start_hhmm: null,
  planned_end_hhmm: null,
  starts_on: '2026-07-01',
  ends_on: null,
}

const TEMPLATES: ProjectableTemplate[] = [
  { ...base, id: 't-daily', frequency: 'daily' },
  { ...base, id: 't-weekdays', frequency: 'weekdays' },
  { ...base, id: 't-weekly-mon', frequency: 'weekly', day_of_week: 1 },
  { ...base, id: 't-weekly-sun', frequency: 'weekly', day_of_week: 7 },
  { ...base, id: 't-weekly-null', frequency: 'weekly', day_of_week: null }, // jamais
  { ...base, id: 't-monthly-14', frequency: 'monthly', day_of_month: 14 },
  { ...base, id: 't-monthly-31', frequency: 'monthly', day_of_month: 31 }, // mois courts
  { ...base, id: 't-oneshot', frequency: 'one_shot', starts_on: '2026-07-15' },
  // Créneaux legacy (plusieurs par jour)
  { ...base, id: 't-slots', frequency: 'daily', slots: ['morning', 'evening'] },
  // Heure précise (V6.2) — le créneau est DÉRIVÉ, les slots legacy ignorés
  {
    ...base, id: 't-hhmm', frequency: 'weekdays',
    planned_start_hhmm: '06:00', planned_end_hhmm: '09:00', slots: ['evening'],
  },
  // Bornes
  { ...base, id: 't-ends', frequency: 'daily', starts_on: '2026-07-05', ends_on: '2026-07-08' },
  { ...base, id: 't-future', frequency: 'daily', starts_on: '2027-01-01' },
  { ...base, id: 't-past', frequency: 'daily', starts_on: '2026-01-01', ends_on: '2026-02-01' },
  { ...base, id: 't-other-mission', frequency: 'daily', mission_id: 'm2' },
]

const sortKey = (o: ProjectedOccurrence) =>
  `${o.scheduledFor}|${o.templateId}|${o.slot ?? '∅'}|${o.plannedStart}|${o.plannedEnd ?? '∅'}`
const normalize = (rows: ProjectedOccurrence[]) => [...rows].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))

// ─────────────────────────────────────────────────────────────────────────────
// 1. LA PREUVE : projection == génération actuelle
// ─────────────────────────────────────────────────────────────────────────────

describe('PL1 — équivalence avec la génération d’avant (oracle legacy)', () => {
  // La fenêtre de génération réelle : 7 jours glissants, à partir de n'importe
  // quel jour de la semaine (l'ancrage du lundi ne doit rien changer).
  const SEVEN_DAY_WINDOWS: Array<[string, string]> = [
    ['2026-07-01', '2026-07-07'], // mer → mar
    ['2026-07-06', '2026-07-12'], // lun → dim
    ['2026-07-09', '2026-07-15'], // jeu → mer, contient le one_shot
    ['2026-07-12', '2026-07-18'], // dim → sam
    ['2026-07-28', '2026-08-03'], // chevauche deux mois
    ['2026-02-25', '2026-03-03'], // chevauche fin février (monthly-31 absent)
    ['2026-12-29', '2027-01-04'], // chevauche l'année
  ]

  it.each(SEVEN_DAY_WINDOWS)(
    'fenêtre 7 jours %s → %s : occurrence pour occurrence, à l’identique',
    (from, to) => {
      const projected = normalize(projectOccurrences({ templates: TEMPLATES, from, to }))
      const legacy = normalize(legacyRows(TEMPLATES, from, to))
      expect(projected).toEqual(legacy)
    },
  )

  it('la fenêtre d’un JOUR (daysAhead: 0, fiche chantier mobile) est identique', () => {
    const projected = normalize(projectOccurrences({ templates: TEMPLATES, from: '2026-07-14', to: '2026-07-14' }))
    expect(projected).toEqual(normalize(legacyRows(TEMPLATES, '2026-07-14', '2026-07-14')))
    // 14 juillet 2026 = mardi → daily + weekdays + monthly-14 + slots + hhmm…
    expect(projected.length).toBeGreaterThan(0)
  })

  it('reste identique sur un MOIS entier (la vue mois ne changera rien au calcul)', () => {
    const projected = normalize(projectOccurrences({ templates: TEMPLATES, from: '2026-07-01', to: '2026-07-31' }))
    expect(projected).toEqual(normalize(legacyRows(TEMPLATES, '2026-07-01', '2026-07-31')))
  })

  it('reste identique sur SIX mois (période arbitraire — rien n’est écrit en base)', () => {
    const projected = normalize(projectOccurrences({ templates: TEMPLATES, from: '2026-07-01', to: '2026-12-31' }))
    expect(projected).toEqual(normalize(legacyRows(TEMPLATES, '2026-07-01', '2026-12-31')))
  })

  it('l’ORDRE de sortie est identique, pas seulement l’ensemble', () => {
    // Sans tri : la fusion projection ↔ matérialisé dépendra de cet ordre.
    const projected = projectOccurrences({ templates: TEMPLATES, from: '2026-07-06', to: '2026-07-12' })
    const legacy = legacyRows(TEMPLATES, '2026-07-06', '2026-07-12')
    expect(projected).toEqual(legacy)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 1bis. Valeurs ATTENDUES explicites — un oracle recopié peut recopier un bug.
//       Ici, personne ne dérive : on écrit le résultat attendu à la main.
// ─────────────────────────────────────────────────────────────────────────────

describe('PL1 — résultats attendus, écrits à la main', () => {
  const tpl = (p: Partial<ProjectableTemplate>): ProjectableTemplate =>
    ({ ...base, id: 'x', frequency: 'daily', ...p }) as ProjectableTemplate
  const dates = (occ: ProjectedOccurrence[]) => occ.map((o) => o.scheduledFor)

  it('daily du 01 au 03 → exactement 3 occurrences', () => {
    const occ = projectOccurrences({ templates: [tpl({})], from: '2026-07-01', to: '2026-07-03' })
    expect(dates(occ)).toEqual(['2026-07-01', '2026-07-02', '2026-07-03'])
  })

  it('weekdays du vendredi au lundi → vendredi et lundi seulement', () => {
    // 2026-07-17 = vendredi, 18 samedi, 19 dimanche, 20 lundi
    const occ = projectOccurrences({ templates: [tpl({ frequency: 'weekdays' })], from: '2026-07-17', to: '2026-07-20' })
    expect(dates(occ)).toEqual(['2026-07-17', '2026-07-20'])
  })

  it('weekly lundi → aucun dimanche, sur un mois entier', () => {
    const occ = projectOccurrences({
      templates: [tpl({ frequency: 'weekly', day_of_week: 1 })], from: '2026-07-01', to: '2026-07-31',
    })
    expect(dates(occ)).toEqual(['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27'])
  })

  it('monthly le 31 en février → aucune occurrence', () => {
    const occ = projectOccurrences({
      templates: [tpl({ frequency: 'monthly', day_of_month: 31, starts_on: '2026-01-01' })],
      from: '2026-02-01', to: '2026-02-28',
    })
    expect(occ).toEqual([])
  })

  it('one_shot hors plage → aucune occurrence', () => {
    const occ = projectOccurrences({
      templates: [tpl({ frequency: 'one_shot', starts_on: '2026-07-15' })],
      from: '2026-07-16', to: '2026-07-31',
    })
    expect(occ).toEqual([])
  })

  it('ends_on est INCLUSIF : occurrence le dernier jour', () => {
    const occ = projectOccurrences({
      templates: [tpl({ starts_on: '2026-07-05', ends_on: '2026-07-08' })],
      from: '2026-07-01', to: '2026-07-31',
    })
    expect(dates(occ)).toEqual(['2026-07-05', '2026-07-06', '2026-07-07', '2026-07-08'])
  })

  it('06:30–09:00 → timestamps exacts, créneau dérivé', () => {
    const occ = projectOccurrences({
      templates: [tpl({ planned_start_hhmm: '06:30', planned_end_hhmm: '09:00' })],
      from: '2026-07-14', to: '2026-07-14',
    })
    expect(occ).toEqual([{
      templateId: 'x', missionId: 'm1', scheduledFor: '2026-07-14', slot: 'morning',
      plannedStart: '2026-07-14T06:30:00.000Z', plannedEnd: '2026-07-14T09:00:00.000Z',
    }])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 1ter. Bords calendaires — le moteur doit tenir avant d'ajouter les cycles (PL4)
// ─────────────────────────────────────────────────────────────────────────────

describe('PL1 — bords calendaires', () => {
  const tpl = (p: Partial<ProjectableTemplate>): ProjectableTemplate =>
    ({ ...base, id: 'x', frequency: 'daily', ...p }) as ProjectableTemplate
  const dates = (occ: ProjectedOccurrence[]) => occ.map((o) => o.scheduledFor)

  it('passage décembre → janvier', () => {
    const occ = projectOccurrences({
      templates: [tpl({ starts_on: '2026-01-01' })], from: '2026-12-30', to: '2027-01-02',
    })
    expect(dates(occ)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])
  })

  it('année bissextile : le 29 février 2028 existe', () => {
    const occ = projectOccurrences({
      templates: [tpl({ frequency: 'monthly', day_of_month: 29, starts_on: '2026-01-01' })],
      from: '2028-02-01', to: '2028-02-29',
    })
    expect(dates(occ)).toEqual(['2028-02-29'])
  })

  it('année NON bissextile : pas de 29 février 2026', () => {
    const occ = projectOccurrences({
      templates: [tpl({ frequency: 'monthly', day_of_month: 29, starts_on: '2026-01-01' })],
      from: '2026-02-01', to: '2026-02-28',
    })
    expect(occ).toEqual([])
  })

  it('mois de 28, 29, 30 et 31 jours : le compte est juste', () => {
    const count = (from: string, to: string) =>
      projectOccurrences({ templates: [tpl({ starts_on: '2020-01-01' })], from, to }).length
    expect(count('2026-02-01', '2026-02-28')).toBe(28) // février commun
    expect(count('2028-02-01', '2028-02-29')).toBe(29) // février bissextile
    expect(count('2026-04-01', '2026-04-30')).toBe(30)
    expect(count('2026-07-01', '2026-07-31')).toBe(31)
  })

  it('from > to → vide (jamais une boucle folle)', () => {
    expect(projectOccurrences({ templates: [tpl({})], from: '2026-07-10', to: '2026-07-01' })).toEqual([])
  })

  it('template commençant APRÈS la fenêtre → vide', () => {
    expect(projectOccurrences({
      templates: [tpl({ starts_on: '2027-01-01' })], from: '2026-07-01', to: '2026-07-31',
    })).toEqual([])
  })

  it('template terminé AVANT la fenêtre → vide', () => {
    expect(projectOccurrences({
      templates: [tpl({ starts_on: '2026-01-01', ends_on: '2026-02-01' })], from: '2026-07-01', to: '2026-07-31',
    })).toEqual([])
  })

  it('plage très longue (2 ans) : ni mutation, ni écriture, ni explosion', () => {
    const templates = [tpl({ starts_on: '2020-01-01' })]
    const snapshot = JSON.stringify(templates)
    const occ = projectOccurrences({ templates, from: '2026-01-01', to: '2027-12-31' })
    expect(occ).toHaveLength(730) // 365 + 365
    expect(JSON.stringify(templates)).toBe(snapshot) // entrées non mutées
  })

  it('deux templates aux occurrences proches restent DISTINCTS', () => {
    const occ = projectOccurrences({
      templates: [
        tpl({ id: 'a', planned_start_hhmm: '06:00' }),
        tpl({ id: 'b', planned_start_hhmm: '06:00' }), // même heure, autre rythme
      ],
      from: '2026-07-14', to: '2026-07-14',
    })
    expect(occ).toHaveLength(2)
    expect(new Set(occ.map(occurrenceKeyOf)).size).toBe(2) // clés distinctes
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 1quater. Contrat d'entrée — rien d'invalide ne se propage
// ─────────────────────────────────────────────────────────────────────────────

describe('PL1 — entrées invalides : politique explicite', () => {
  const tpl = (p: Partial<ProjectableTemplate>): ProjectableTemplate =>
    ({ ...base, id: 'x', frequency: 'daily', ...p }) as ProjectableTemplate

  it('date de fenêtre malformée → vide (pas d’Invalid Date)', () => {
    expect(projectOccurrences({ templates: [tpl({})], from: '2026-07-99', to: '2026-07-31' })).toEqual([])
    expect(projectOccurrences({ templates: [tpl({})], from: 'demain', to: '2026-07-31' })).toEqual([])
  })

  it('date inexistante (30 février) → vide, jamais décalée en douce au 2 mars', () => {
    expect(isValidDateIso('2026-02-30')).toBe(false)
    expect(projectOccurrences({ templates: [tpl({})], from: '2026-02-30', to: '2026-03-02' })).toEqual([])
  })

  it('starts_on invalide → template ignoré (les autres passent)', () => {
    const occ = projectOccurrences({
      templates: [tpl({ id: 'ko', starts_on: 'n’importe quoi' }), tpl({ id: 'ok' })],
      from: '2026-07-14', to: '2026-07-14',
    })
    expect(occ.map((o) => o.templateId)).toEqual(['ok'])
  })

  it('heure « 25:80 » → traitée comme ABSENTE, jamais comme un timestamp corrompu', () => {
    // ⚠️ DIVERGENCE ASSUMÉE avec l'algorithme d'avant PL1 : lui produisait
    // « 2026-07-14T25:80:00.000Z ». La base n'a aucun CHECK (mig 085) : le cas
    // est atteignable. On le prouve, puis on corrige.
    const bad = tpl({ planned_start_hhmm: '25:80', planned_end_hhmm: '99:99' })

    const legacy = legacyRows([bad], '2026-07-14', '2026-07-14')
    expect(legacy[0].plannedStart).toBe('2026-07-14T25:80:00.000Z')
    expect(Number.isNaN(new Date(legacy[0].plannedStart).getTime())).toBe(true) // corrompu

    const occ = projectOccurrences({ templates: [bad], from: '2026-07-14', to: '2026-07-14' })
    expect(occ[0].slot).toBeNull() // retombe sur l'ancrage créneau
    expect(occ[0].plannedStart).toBe(buildScheduledAt('2026-07-14', null))
    expect(Number.isNaN(new Date(occ[0].plannedStart).getTime())).toBe(false)
    expect(occ[0].plannedEnd).toBeNull()
  })

  it('heure de fin invalide seule → début conservé, fin nulle', () => {
    const occ = projectOccurrences({
      templates: [tpl({ planned_start_hhmm: '06:00', planned_end_hhmm: '99:99' })],
      from: '2026-07-14', to: '2026-07-14',
    })
    expect(occ[0].plannedStart).toBe('2026-07-14T06:00:00.000Z')
    expect(occ[0].plannedEnd).toBeNull()
  })

  it('fréquence inconnue → aucune occurrence', () => {
    const occ = projectOccurrences({
      templates: [tpl({ frequency: 'quinzomadaire' as never })],
      from: '2026-07-01', to: '2026-07-31',
    })
    expect(occ).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Comportement du moteur (ce que la génération faisait, désormais isolé)
// ─────────────────────────────────────────────────────────────────────────────

describe('matchesFrequency', () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
  const tpl = (p: Partial<ProjectableTemplate>): ProjectableTemplate =>
    ({ ...base, id: 'x', frequency: 'daily', ...p }) as ProjectableTemplate

  it('daily : tous les jours dans les bornes', () => {
    expect(matchesFrequency(tpl({}), d('2026-07-14'))).toBe(true)
  })

  it('weekdays : lundi→vendredi seulement', () => {
    const t = tpl({ frequency: 'weekdays' })
    expect(matchesFrequency(t, d('2026-07-13'))).toBe(true)  // lundi
    expect(matchesFrequency(t, d('2026-07-17'))).toBe(true)  // vendredi
    expect(matchesFrequency(t, d('2026-07-18'))).toBe(false) // samedi
    expect(matchesFrequency(t, d('2026-07-19'))).toBe(false) // dimanche
  })

  it('weekly : le dimanche est 7 (ISO), pas 0', () => {
    expect(matchesFrequency(tpl({ frequency: 'weekly', day_of_week: 7 }), d('2026-07-19'))).toBe(true)
  })

  it('weekly sans day_of_week → jamais (pas de faux positif)', () => {
    expect(matchesFrequency(tpl({ frequency: 'weekly', day_of_week: null }), d('2026-07-13'))).toBe(false)
  })

  it('monthly le 31 : silencieux les mois courts', () => {
    const t = tpl({ frequency: 'monthly', day_of_month: 31 })
    expect(matchesFrequency(t, d('2026-07-31'))).toBe(true)
    expect(matchesFrequency(t, d('2026-06-30'))).toBe(false) // juin n'a pas de 31
  })

  it('one_shot : uniquement le jour de départ', () => {
    const t = tpl({ frequency: 'one_shot', starts_on: '2026-07-15' })
    expect(matchesFrequency(t, d('2026-07-15'))).toBe(true)
    expect(matchesFrequency(t, d('2026-07-16'))).toBe(false)
  })

  it('bornes : rien avant starts_on, rien après ends_on', () => {
    const t = tpl({ starts_on: '2026-07-05', ends_on: '2026-07-08' })
    expect(matchesFrequency(t, d('2026-07-04'))).toBe(false)
    expect(matchesFrequency(t, d('2026-07-05'))).toBe(true)
    expect(matchesFrequency(t, d('2026-07-08'))).toBe(true)
    expect(matchesFrequency(t, d('2026-07-09'))).toBe(false)
  })
})

describe('projectOccurrences — créneaux et heures', () => {
  it('heure précise : UN créneau dérivé de l’heure, les slots legacy sont ignorés', () => {
    const occ = projectOccurrences({
      templates: [TEMPLATES.find((t) => t.id === 't-hhmm')!],
      from: '2026-07-13', to: '2026-07-13', // lundi
    })
    expect(occ).toHaveLength(1)
    expect(occ[0].slot).toBe('morning') // 06:00 → morning, PAS 'evening'
    expect(occ[0].plannedStart).toBe('2026-07-13T06:00:00.000Z')
    expect(occ[0].plannedEnd).toBe('2026-07-13T09:00:00.000Z')
  })

  it('créneaux legacy : une occurrence PAR créneau', () => {
    const occ = projectOccurrences({
      templates: [TEMPLATES.find((t) => t.id === 't-slots')!],
      from: '2026-07-13', to: '2026-07-13',
    })
    expect(occ.map((o) => o.slot)).toEqual(['morning', 'evening'])
    expect(occ[0].plannedEnd).toBeNull() // sans heure de fin : rien d'inventé
  })

  it('sans heure ni créneau : un ancrage dérivé, jamais un pointage', () => {
    const occ = projectOccurrences({
      templates: [TEMPLATES.find((t) => t.id === 't-daily')!],
      from: '2026-07-13', to: '2026-07-13',
    })
    expect(occ[0].slot).toBeNull()
    expect(occ[0].plannedStart).toBe(buildScheduledAt('2026-07-13', null))
  })

  it('période inversée → aucune occurrence (jamais une erreur silencieuse)', () => {
    expect(projectOccurrences({ templates: TEMPLATES, from: '2026-07-10', to: '2026-07-01' })).toEqual([])
  })

  it('déterministe : deux appels identiques donnent le même résultat', () => {
    const a = projectOccurrences({ templates: TEMPLATES, from: '2026-07-01', to: '2026-07-31' })
    const b = projectOccurrences({ templates: TEMPLATES, from: '2026-07-01', to: '2026-07-31' })
    expect(a).toEqual(b)
  })
})

describe('occurrenceKey', () => {
  it('reproduit l’index unique de la base (template, date, créneau)', () => {
    expect(occurrenceKey({ templateId: 't1', scheduledFor: '2026-07-14', slot: 'morning' }))
      .toBe('t1|2026-07-14|morning')
  })

  it('un créneau null a une clé stable (l’index est partiel, pas absent)', () => {
    expect(occurrenceKey({ templateId: 't1', scheduledFor: '2026-07-14', slot: null }))
      .toBe('t1|2026-07-14|∅')
  })

  it('deux créneaux différents le même jour ne collisionnent pas', () => {
    const k1 = occurrenceKey({ templateId: 't1', scheduledFor: '2026-07-14', slot: 'morning' })
    const k2 = occurrenceKey({ templateId: 't1', scheduledFor: '2026-07-14', slot: 'evening' })
    expect(k1).not.toBe(k2)
  })

  it('même template, même date, même créneau → MÊME clé (c’est l’identité en base)', () => {
    const k1 = occurrenceKey({ templateId: 't1', scheduledFor: '2026-07-14', slot: 'morning' })
    const k2 = occurrenceKey({ templateId: 't1', scheduledFor: '2026-07-14', slot: 'morning' })
    expect(k1).toBe(k2)
  })

  it('l’heure précise n’entre pas dans la clé : 06:00 et 09:00 partagent « morning »', () => {
    // Conséquence du schéma (index sur le SLOT, pas sur l'heure), pas de ce module.
    // À la fusion, la version MATÉRIALISÉE devra gagner sur la projetée.
    const t = (hhmm: string): ProjectableTemplate =>
      ({ ...base, id: 't1', frequency: 'daily', planned_start_hhmm: hhmm }) as ProjectableTemplate
    const a = projectOccurrences({ templates: [t('06:00')], from: '2026-07-14', to: '2026-07-14' })[0]
    const b = projectOccurrences({ templates: [t('09:00')], from: '2026-07-14', to: '2026-07-14' })[0]
    expect(a.plannedStart).not.toBe(b.plannedStart)
    expect(occurrenceKeyOf(a)).toBe(occurrenceKeyOf(b)) // même identité, heure différente
  })

  it('deux templates distincts ne collisionnent jamais, même jour et même créneau', () => {
    const k1 = occurrenceKey({ templateId: 't1', scheduledFor: '2026-07-14', slot: 'morning' })
    const k2 = occurrenceKey({ templateId: 't2', scheduledFor: '2026-07-14', slot: 'morning' })
    expect(k1).not.toBe(k2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Pureté du module — aucun import serveur, aucune horloge
// ─────────────────────────────────────────────────────────────────────────────

describe('PL1 — le moteur est PUR et client-safe', () => {
  it('aucun import serveur, aucun accès à l’environnement, aucune horloge', async () => {
    const fs = await import('node:fs/promises')
    const src = await fs.readFile('lib/planning/projection.ts', 'utf8')
    for (const forbidden of [
      'server-only', 'supabase', 'next/headers', 'process.env',
      'getOrgId', 'createAdminClient', 'Date.now', 'todayLocalIso',
    ]) {
      expect(src).not.toContain(forbidden)
    }
    // `new Date(...)` est autorisé (dates PURES, toujours ancrées en UTC), mais
    // jamais un `new Date()` sans argument — qui dépendrait de l'horloge locale.
    expect(/new Date\(\s*\)/.test(src)).toBe(false)
  })
})
