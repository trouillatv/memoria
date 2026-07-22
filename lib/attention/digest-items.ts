// Ce qui mérite l'attention, au-delà des actions — règles PURES.
//
// Trois faits nouveaux entrent dans le digest du matin :
//   • un CONFLIT      — une prestation est prévue un jour où le chantier est fermé ;
//   • un DÉBRIEF      — une visite est finie, ses captures dorment non triées ;
//   • une FERMETURE   — le chantier est fermé aujourd'hui.
//
// La fermeture n'est PAS une alarme : un magasin fermé n'appelle aucune action.
// Elle se dit calmement. Le conflit, lui, est un fait déclaré (quelqu'un a écrit
// « fermé » ET quelqu'un a planifié) : il est rouge. Jamais d'inférence.
//
// Rien ici ne touche la base : ces fonctions se prouvent à sec.

import type { AttentionItem } from '@/lib/db/attention'
import type { ProjectableClosure } from '@/lib/planning/closures'
import { findClosureForDate, CLOSURE_REASON_FR } from '@/lib/planning/closures'
import type { ClosureConflict } from '@/lib/planning/conflicts'

/** Un chantier fermé aujourd'hui — dit, jamais alarmé. */
export interface ClosedSite {
  siteId: string
  siteName: string
  /** « Jour férié », « Fermeture client »… */
  reason: string
}

const nameOr = (nameOf: Map<string, string>, id: string): string => nameOf.get(id) ?? 'Chantier'

const plural = (n: number, one: string, many: string): string => (n > 1 ? many : one)

/**
 * 🔴 CONFLIT — « 2 prestations prévues un jour de fermeture ».
 *
 * Entrée = la sortie de `detectClosureConflicts` (PL3) : site → date → conflit.
 * Un item par CHANTIER (pas un par jour) : le matin, on ne noie pas Guillaume.
 */
export function buildConflictItems(
  conflictsBySite: Record<string, Record<string, ClosureConflict>>,
  nameOf: Map<string, string>,
  orgOf?: Map<string, string>,
): AttentionItem[] {
  const out: AttentionItem[] = []

  for (const [siteId, byDate] of Object.entries(conflictsBySite)) {
    const dates = Object.keys(byDate).sort()
    if (dates.length === 0) continue

    const expected = dates.reduce((n, d) => n + (byDate[d]?.expectedCount ?? 0), 0)
    if (expected === 0) continue

    const first = byDate[dates[0]]
    const raison = first?.closure?.reason ?? CLOSURE_REASON_FR[first?.closure?.reasonKind ?? 'other']

    out.push({
      tier: 'red',
      what: `${expected} ${plural(expected, 'prestation prévue', 'prestations prévues')} un jour de fermeture`,
      where: nameOr(nameOf, siteId),
      why:
        dates.length === 1
          ? `le ${frDay(dates[0])} — ${raison.toLowerCase()}`
          : `${dates.length} jours concernés, à partir du ${frDay(dates[0])}`,
      href: '/semaine',
      organizationId: orgOf?.get(siteId) ?? '',
    })
  }

  return out
}

/** Une visite finie dont les captures attendent encore d'être triées. */
export interface PendingDebrief {
  reportId: string
  siteId: string
  /** Combien de captures dorment. */
  remaining: number
  /** ISO — quand la visite s'est terminée. */
  endedAt: string | null
}

/**
 * 🟠 DÉBRIEF EN ATTENTE — « la visite de mardi n'a jamais été débriefée ».
 *
 * Fait déclaré : la visite est terminée (`ended_at`), et des captures sont
 * restées au statut `captured`. Aucune inférence sur qui aurait dû le faire.
 */
export function buildDebriefItems(
  pending: PendingDebrief[],
  nameOf: Map<string, string>,
  todayIso: string,
  orgOf?: Map<string, string>,
): AttentionItem[] {
  const bySite = new Map<string, PendingDebrief[]>()
  for (const p of pending) {
    if (p.remaining <= 0) continue
    const list = bySite.get(p.siteId) ?? []
    list.push(p)
    bySite.set(p.siteId, list)
  }

  const out: AttentionItem[] = []
  for (const [siteId, list] of bySite) {
    const n = list.length
    const oldest = list.reduce((o, x) => ((x.endedAt ?? '') < (o.endedAt ?? '') ? x : o))
    const jours = oldest.endedAt ? daysBetween(oldest.endedAt.slice(0, 10), todayIso) : 0
    const captures = list.reduce((s, x) => s + x.remaining, 0)

    out.push({
      tier: 'orange',
      what: `${n} ${plural(n, 'visite à débriefer', 'visites à débriefer')}`,
      where: nameOr(nameOf, siteId),
      why:
        jours <= 0
          ? `${captures} ${plural(captures, 'élément rapporté', 'éléments rapportés')} aujourd’hui, pas encore ${plural(captures, 'trié', 'triés')}`
          : `la plus ancienne date d’il y a ${jours} j — ${captures} ${plural(captures, 'élément', 'éléments')} en attente`,
      // Le débrief se reprend là où il s'est arrêté.
      href: `/sites/${siteId}/visites/${oldest.reportId}`,
      organizationId: orgOf?.get(siteId) ?? '',
    })
  }

  return out
}

/**
 * Les chantiers FERMÉS aujourd'hui. Ce n'est pas une alerte : c'est un fait de
 * la journée, dit une fois, sans couleur d'alarme.
 */
export function buildClosedToday(
  closuresBySite: Record<string, ProjectableClosure[]>,
  nameOf: Map<string, string>,
  todayIso: string,
): ClosedSite[] {
  const out: ClosedSite[] = []

  for (const [siteId, closures] of Object.entries(closuresBySite)) {
    const closure = findClosureForDate(closures ?? [], todayIso)
    if (!closure) continue
    out.push({
      siteId,
      siteName: nameOr(nameOf, siteId),
      reason: closure.reason?.trim() || CLOSURE_REASON_FR[closure.reasonKind],
    })
  }

  return out.sort((a, b) => a.siteName.localeCompare(b.siteName, 'fr'))
}

// ── Dates, dites comme on les dit ───────────────────────────────────────────

const MOIS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

/** « 14 juillet » — jamais « 2026-07-14 ». */
function frDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getUTCDate()} ${MOIS[d.getUTCMonth()]}`
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00.000Z`).getTime()
  const b = new Date(`${toIso}T00:00:00.000Z`).getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.max(0, Math.round((b - a) / 86_400_000))
}
