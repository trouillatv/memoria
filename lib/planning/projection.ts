// PL1 — Le moteur de projection des rythmes. PUR, client-safe, testable à sec.
//
// Décision produit 2026-07-13 : on NE lève PAS le cap de 7 jours de
// matérialisation. Une vue mois ne lit pas la table `interventions` (elle
// serait vide à 75 %) : elle PROJETTE les rythmes sur la période demandée.
//
//     Rythmes → projection sur [from, to]
//             → fusion avec les occurrences DÉJÀ matérialisées
//             → fusion avec les exceptions
//             → affichage
//
// Règle non négociable : **un seul moteur de calcul** pour la semaine, le mois,
// les alertes ET la génération glissante. Ce fichier est ce moteur ; la
// génération (lib/db/intervention-templates.ts) l'appelle au lieu de refaire
// le calcul. Deux logiques divergentes = deux vérités.
//
// Doctrine préservée : ce moteur ne connaît ni personne, ni disponibilité, ni
// heure travaillée. Il projette des PRESTATIONS (mission × date × créneau).
// L'équipe reste l'unité planifiée ; elle est héritée de la mission au moment
// de la matérialisation, pas ici.

import { buildScheduledAt, slotFromUtcHour, isValidHHMM } from '@/lib/time/prestation-slot'
import type { InterventionFrequency, InterventionSlot } from '@/types/db'

// ─── Contrat d'entrée : rien d'invalide ne se propage ────────────────────────
//
// Politique EXPLICITE (une entrée invalide ne produit jamais un `Invalid Date`
// ni un timestamp corrompu — elle est IGNORÉE, silencieusement mais sûrement) :
//
//   • `from`/`to` non conformes à yyyy-mm-dd, ou date inexistante (2026-02-30)
//        → aucune occurrence (tableau vide).
//   • `starts_on` d'un template invalide → template ignoré.
//   • `planned_start_hhmm` invalide (« 25:80 ») → traité comme ABSENT :
//        on retombe sur les créneaux legacy, puis sur l'ancrage null.
//   • `planned_end_hhmm` invalide → traité comme absent (`plannedEnd = null`).
//   • fréquence inconnue → aucune occurrence pour ce template.
//
// ⚠️ DIVERGENCE ASSUMÉE avec l'algorithme d'avant PL1 : celui-ci testait
// `/^\d{2}:\d{2}$/`, qui accepte « 25:80 », et fabriquait alors un
// `planned_start` corrompu (`…T25:80:00.000Z`). La base n'a AUCUN CHECK sur ces
// colonnes (mig 085) : le cas est atteignable. On corrige ; c'est la seule
// différence de comportement, et elle ne concerne que des données déjà cassées.

const DATE_ISO_RE = /^\d{4}-\d{2}-\d{2}$/

/** Date de planning valide : forme yyyy-mm-dd ET jour réellement existant
 *  (2026-02-30 est refusé, pas silencieusement décalé au 2 mars). */
export function isValidDateIso(value: string | null | undefined): boolean {
  if (!value || !DATE_ISO_RE.test(value)) return false
  const d = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/** Ce dont la projection a besoin — un sous-ensemble strict de
 *  DbInterventionTemplate (un `DbInterventionTemplate` est acceptable tel quel). */
export interface ProjectableTemplate {
  id: string
  mission_id: string
  frequency: InterventionFrequency
  slots: InterventionSlot[] | null
  day_of_week: number | null
  day_of_month: number | null
  planned_start_hhmm: string | null
  planned_end_hhmm: string | null
  starts_on: string
  ends_on: string | null

  // PL4 — le rythme peut appartenir à un ROULEMENT. Ces trois champs sont
  // OPTIONNELS : un rythme legacy (sans cycle) se comporte EXACTEMENT comme
  // avant — la branche cyclique est un no-op. C'est ce qui garde l'oracle vert.
  /** 1 à 4. Absent = pas de cycle. */
  cycle_length_weeks?: number | null
  /** Le lundi de la « semaine A ». Sans lui, un cycle se décalerait. */
  anchor_date?: string | null
  /** 0 = semaine A, 1 = semaine B… */
  week_index?: number | null
}

/** Une occurrence PROJETÉE — elle n'existe pas en base (pas d'id). Elle devient
 *  persistante seulement quand elle devient opérationnellement significative :
 *  déplacée, annulée, maintenue malgré une fermeture, démarrée, réalisée, ou
 *  porteuse d'une preuve. */
export interface ProjectedOccurrence {
  templateId: string
  missionId: string
  /** yyyy-mm-dd */
  scheduledFor: string
  slot: InterventionSlot | null
  /** Timestamp d'ancrage (même convention que `interventions.planned_start`). */
  plannedStart: string
  plannedEnd: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000

/** ISO day-of-week : 1=lundi … 7=dimanche. */
function isoDayOfWeek(date: Date): number {
  const d = date.getUTCDay() // 0=dimanche
  return d === 0 ? 7 : d
}

/**
 * Vrai si la date tombe sur le rythme du template. EXPORTÉ (PL1) : c'était une
 * fonction privée, or la vue mois, les alertes et la génération doivent toutes
 * répondre à la même question de la même façon.
 *
 * Travaille en UTC — les dates de planning sont des dates PURES (yyyy-mm-dd),
 * jamais des instants ; c'est ce qui garde Nouméa hors de l'équation ici.
 */
/**
 * PL4 — dans quelle semaine du cycle tombe cette date ?
 * 0 = semaine A, 1 = semaine B… L'ancrage est le point fixe : sans lui, la
 * rotation se décalerait à la première modification.
 *
 * Les semaines sont comptées depuis l'ancrage, pas depuis le calendrier ISO :
 * c'est le lundi d'ancrage qui définit « la semaine A ».
 */
export function cycleWeekIndex(
  anchorDateIso: string,
  dateIso: string,
  cycleLengthWeeks: number,
): number {
  const anchor = new Date(`${anchorDateIso}T00:00:00.000Z`).getTime()
  const target = new Date(`${dateIso}T00:00:00.000Z`).getTime()
  const weeks = Math.floor((target - anchor) / (7 * DAY_MS))
  // Modulo POSITIF : une date avant l'ancrage ne doit pas renvoyer un index négatif.
  return ((weeks % cycleLengthWeeks) + cycleLengthWeeks) % cycleLengthWeeks
}

export function matchesFrequency(template: ProjectableTemplate, date: Date): boolean {
  const dateIso = date.toISOString().slice(0, 10)

  if (template.ends_on && dateIso > template.ends_on) return false
  if (dateIso < template.starts_on) return false

  // PL4 — le rythme n'appartient à un cycle que si les TROIS champs sont là.
  // Sinon : no-op total, comportement d'avant, à la ligne près.
  const { cycle_length_weeks: len, anchor_date: anchor, week_index: wi } = template
  if (len && anchor && wi !== null && wi !== undefined) {
    if (cycleWeekIndex(anchor, dateIso, len) !== wi) return false
  }

  switch (template.frequency) {
    case 'daily':
      return true
    case 'weekdays': {
      const dow = isoDayOfWeek(date)
      return dow >= 1 && dow <= 5
    }
    case 'weekly':
      return template.day_of_week !== null && isoDayOfWeek(date) === template.day_of_week
    case 'monthly':
      return template.day_of_month !== null && date.getUTCDate() === template.day_of_month
    case 'one_shot':
      return dateIso === template.starts_on
    default:
      return false
  }
}

/** Dates yyyy-mm-dd de fromIso à toIso INCLUS. */
export function enumerateDates(fromIso: string, toIso: string): Date[] {
  const out: Date[] = []
  const from = new Date(`${fromIso}T00:00:00.000Z`).getTime()
  const to = new Date(`${toIso}T00:00:00.000Z`).getTime()
  for (let t = from; t <= to; t += DAY_MS) out.push(new Date(t))
  return out
}

/** Heure de début exploitable ? (`isValidHHMM` borne 00-23 / 00-59 — contrairement
 *  à la regex historique, qui laissait passer « 25:80 ».) */
function hasPreciseTime(tpl: ProjectableTemplate): boolean {
  return typeof tpl.planned_start_hhmm === 'string' && isValidHHMM(tpl.planned_start_hhmm)
}

/** Créneaux effectifs d'un template : l'heure précise (V6.2) prime sur les
 *  créneaux legacy ; sans rien, un seul créneau null. */
function effectiveSlots(tpl: ProjectableTemplate): (InterventionSlot | null)[] {
  if (hasPreciseTime(tpl)) {
    return [slotFromUtcHour(Number(tpl.planned_start_hhmm!.slice(0, 2)))]
  }
  if (tpl.slots && tpl.slots.length > 0) return tpl.slots
  return [null]
}

/**
 * Projette les rythmes sur [from, to] — période ARBITRAIRE (un mois, un
 * trimestre : rien n'est écrit en base, donc rien à plafonner).
 *
 * **Contrat d'ORDRE** (la vue mois et la fusion en dépendront) : sortie stable
 * et déterministe — pour chaque template, dans l'ordre reçu ; pour chaque
 * template, les dates croissantes ; pour chaque date, les créneaux dans l'ordre
 * du template. Aucun tri implicite. C'est exactement l'ordre que produisait la
 * génération d'avant PL1.
 *
 * Pur : mêmes entrées → mêmes sorties, aucun effet de bord, aucune horloge.
 */
export function projectOccurrences(params: {
  templates: ProjectableTemplate[]
  /** yyyy-mm-dd inclus */
  from: string
  /** yyyy-mm-dd inclus */
  to: string
}): ProjectedOccurrence[] {
  const { templates, from, to } = params
  // Contrat d'entrée : une fenêtre invalide ne projette rien (jamais d'Invalid Date).
  if (!isValidDateIso(from) || !isValidDateIso(to)) return []
  if (from > to) return []

  const out: ProjectedOccurrence[] = []

  for (const tpl of templates) {
    if (!isValidDateIso(tpl.starts_on)) continue

    // Fenêtre effective = [from, to] ∩ [starts_on, ends_on?]
    const effectiveStart = tpl.starts_on > from ? tpl.starts_on : from
    const effectiveEnd = tpl.ends_on && tpl.ends_on < to ? tpl.ends_on : to
    if (effectiveStart > effectiveEnd) continue

    const hasTime = hasPreciseTime(tpl)
    const slots = effectiveSlots(tpl)
    // Heure de fin : exploitable seulement si l'heure de début l'est aussi.
    const endHHMM =
      hasTime && typeof tpl.planned_end_hhmm === 'string' && isValidHHMM(tpl.planned_end_hhmm)
        ? tpl.planned_end_hhmm
        : null

    for (const date of enumerateDates(effectiveStart, effectiveEnd)) {
      if (!matchesFrequency(tpl, date)) continue
      const dateIso = date.toISOString().slice(0, 10)

      for (const slot of slots) {
        const plannedStart = hasTime
          ? `${dateIso}T${tpl.planned_start_hhmm}:00.000Z`
          : buildScheduledAt(dateIso, slot)
        const plannedEnd = endHHMM ? `${dateIso}T${endHHMM}:00.000Z` : null

        out.push({
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

  return out
}

/**
 * Clé d'identité d'une occurrence — EXACTEMENT celle de l'index unique partiel
 * de la base : `UNIQUE (template_id, scheduled_for, slot)
 * WHERE template_id IS NOT NULL` (mig 021:120). Ni plus, ni moins de champs :
 * une clé plus large créerait des doublons à la fusion, une clé plus étroite
 * des collisions.
 *
 * Conséquences à connaître (elles sont celles du schéma, pas de ce module) :
 *  - deux créneaux différents le même jour → deux occurrences distinctes ✅
 *  - l'heure précise n'entre PAS dans la clé : elle est réduite à son créneau
 *    dérivé (06:00 et 09:00 tombent tous deux sur `morning`). Deux prestations
 *    le même matin, même template, même jour sont donc UNE seule identité —
 *    c'est déjà la règle en base, la projection ne l'invente pas ;
 *  - une occurrence matérialisée dont on change l'heure garde sa clé (le
 *    créneau ne bouge que si l'heure franchit une borne) → la fusion la
 *    reconnaît, et c'est la version MATÉRIALISÉE qui doit gagner.
 */
export function occurrenceKey(o: {
  templateId: string | null
  scheduledFor: string | null
  slot: string | null
}): string {
  return `${o.templateId ?? ''}|${o.scheduledFor ?? ''}|${o.slot ?? '∅'}`
}
