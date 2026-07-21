// LE CR DE VISITE DEVIENT UN DOCUMENT (Vincent, 2026-07-21).
//
// Guillaume ne demande pas une meilleure IA — il l'a jugée bonne. Il demande à
// POUVOIR CORRIGER : « MemorIA propose → je corrige → je valide ». Ce cycle
// existe déjà dans le dépôt, mais pour le PV de réunion : `report_documents`
// (mig 120) porte `sections` comme source de vérité, un statut
// draft → validated → exported, et l'édition par section tant que c'est un
// brouillon.
//
// Rien n'interdisait de l'utiliser pour une visite : `report_documents.report_id`
// référence `site_reports`, et une visite EST un `site_report` (`origin`
// non-null). AUCUNE migration n'est donc nécessaire — seulement une conversion.
//
// Ce module est cette conversion, et RIEN d'autre : il est PUR (aucun accès
// base, aucun `next/headers`), donc testable et utilisable des deux côtés.
//
// Doctrine appliquée :
//   - on n'invente rien : une section sans matière reste VIDE, jamais remplie
//     d'un « aucune action identifiée » qui se lirait comme un constat ;
//   - une échéance sans date garde SA contrainte dite (« Avant le démarrage »),
//     jamais une date déduite d'un délai ;
//   - le contenu est du texte que le conducteur relit et corrige, pas du JSON.

import type { ReportDocumentSection } from '@/types/db'

/** Clé de template du CR de visite. Distincte du PV de réunion : même moteur,
 *  gabarits différents. */
export const CR_VISITE_TEMPLATE_KEY = 'cr_visite.v1'

/** La matière produite par le débrief de visite (`StoredDebriefAnalysis`).
 *  Redéclarée en STRUCTURELLE et tolérante : ce module doit rester pur, et une
 *  analyse ancienne (champs absents) ne doit jamais faire tomber le CR. */
export interface VisitCrAnalysis {
  summary?: string
  decisions?: string[]
  actions?: Array<{
    title?: string
    rationale?: string
    priority?: 'haute' | 'moyenne' | 'basse' | null
    owner?: string
    due?: string
  }>
  watchpoints?: Array<{ label?: string; impact?: string; owner?: string; due?: string }>
  a_savoir?: string[]
  echeances?: Array<{ label?: string; date?: string; constraint?: string }>
  intervenants?: string[]
}

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** Une liste de puces, ou '' si rien ne tient debout. */
function bullets(lines: Array<string | null>): string {
  const kept = lines.map((l) => clean(l)).filter(Boolean)
  return kept.length > 0 ? kept.map((l) => `- ${l}`).join('\n') : ''
}

/** « — Guillaume, pour le 2026-07-24 » : le complément ne s'écrit que si on le
 *  sait. Ni responsable ni date connus → la ligne dit juste ce qu'il y a à faire. */
function withOwnerAndDue(label: string, owner: unknown, due: unknown): string | null {
  const head = clean(label)
  if (!head) return null
  const who = clean(owner)
  const when = clean(due)
  const tail = [who, when ? `pour le ${when}` : ''].filter(Boolean).join(', ')
  return tail ? `${head} — ${tail}` : head
}

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/**
 * Convertit l'analyse d'une visite en sections éditables d'un `report_document`.
 * Toujours SEPT sections, dans l'ordre de lecture du conducteur — même vides :
 * un CR dont une rubrique disparaît selon la visite n'est pas relisible.
 */
export function buildVisitCrSections(analysis: VisitCrAnalysis): ReportDocumentSection[] {
  const a = analysis ?? ({} as VisitCrAnalysis)

  const sections: Array<{ key: string; title: string; content: string }> = [
    { key: 'resume', title: 'Résumé', content: clean(a.summary) },
    { key: 'decisions', title: 'Décisions', content: bullets(list(a.decisions).map((d) => clean(d))) },
    {
      key: 'actions',
      title: 'Actions',
      content: bullets(
        list(a.actions).map((raw) => {
          const item = (raw ?? {}) as NonNullable<VisitCrAnalysis['actions']>[number]
          return withOwnerAndDue(clean(item.title), item.owner, item.due)
        }),
      ),
    },
    {
      key: 'vigilances',
      title: 'Points de vigilance',
      content: bullets(
        list(a.watchpoints).map((raw) => {
          const item = (raw ?? {}) as NonNullable<VisitCrAnalysis['watchpoints']>[number]
          const label = clean(item.label)
          if (!label) return null
          const impact = clean(item.impact)
          return impact ? `${label} — ${impact}` : label
        }),
      ),
    },
    { key: 'a_savoir', title: 'À savoir', content: bullets(list(a.a_savoir).map((s) => clean(s))) },
    {
      key: 'echeances',
      title: 'Échéances',
      content: bullets(
        list(a.echeances).map((raw) => {
          const item = (raw ?? {}) as NonNullable<VisitCrAnalysis['echeances']>[number]
          const label = clean(item.label)
          if (!label) return null
          // La date DITE d'abord ; à défaut la contrainte dite. Jamais l'une
          // convertie en l'autre — l'humain tranche, MemorIA ne devine pas.
          const when = clean(item.date) || clean(item.constraint)
          return when ? `${label} — ${when}` : label
        }),
      ),
    },
    { key: 'intervenants', title: 'Intervenants', content: bullets(list(a.intervenants).map((i) => clean(i))) },
  ]

  return sections.map((s) => ({ ...s, kind: 'generative' as const }))
}
