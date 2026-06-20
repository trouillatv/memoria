// SURFACE DE VALIDATION — modèle métier consolidé (STRUCTURE avant UI).
//
// Décision Vincent 2026-06-20 (option 1) : stabiliser l'objet `PvValidation`
// AVANT de coder l'écran. Un mauvais modèle métier + une belle UI = dette ;
// un bon modèle + pas encore d'UI = aucun problème.
//
// Un objet unique rassemble TOUT ce que la mémoire a produit, en items typés et
// traçables. Chaque item porte son statut de validation humaine. L'IA reste
// rédacteur, jamais moteur : aucun item n'est inventé — chacun pointe vers une
// `source` déterministe (action / risque / anomalie / intervention / photo).
//
// L'UI (écran /meetings/[id]/pv/validation) consommera CE modèle ; elle n'est
// PAS codée ici. La persistance des décisions (accepted/edited/rejected) viendra
// avec l'UI ; ici tous les items naissent 'pending'.

import { loadMeetingContext } from './load-meeting-input'
import { pvReadiness, pointBloque, DEFAULT_PV_POLICY, type PvReadiness, type PvPointAConfirmer } from './meeting-to-cr-becib'
import { listPvSignalDecisions, type PvSignalDecision } from '@/lib/db/pv-signal-decisions'

export type ValidationStatut = 'pending' | 'accepted' | 'edited' | 'rejected'
export type PvSection = 'participants' | 'remarques_cr' | 'points_examines' | 'previsions' | 'photos'

export interface PvValidationItem {
  id: string                          // stable `${section}:${source}` (idempotent pour l'UI)
  section: PvSection
  type: string                        // sous-type DANS la section (rôle, type de point, kind…)
  texte: string                       // libellé lisible (déjà rédigé, déterministe)
  source: string                      // traçabilité : id DB (ou nom participant) de l'origine
  confiance: 'sûr' | 'à confirmer'
  statutValidation: ValidationStatut  // défaut 'pending' (aucune décision humaine encore)
  blocking: boolean                   // l'item EST un blocage métier (anomalie / dépendance)
  excluded: boolean                   // « Exclure du PV » : item retiré de la CR (ligne parasite)
  actionCodes?: string[]              // colonne ACTION mémorisée du point (ETV/MOA/… ; mig 132)
  // Prévisions STRUCTURÉES (mig 135) : la donnée derrière la ligne (qui/quand/fiabilité).
  titre?: string
  responsable?: string | null
  echeance?: string | null            // ISO (AAAA-MM-JJ) si connue
}

// Point à confirmer + la décision humaine éventuelle (reporter/ignorer/faux positif).
export type PvGapAnnote = PvPointAConfirmer & { decision: PvSignalDecision | null }

export interface PvValidation {
  reportId: string
  items: PvValidationItem[]
  counts: Record<PvSection, number>
  readiness: PvReadiness     // sévérité INTRINSÈQUE (compte par niveau, score) — avant décisions
  gaps: PvGapAnnote[]        // POINTS À CONFIRMER + décision éventuelle
  blocking: boolean          // GATE décision-aware : ≥1 bloquant DUR encore ACTIF → PDF désactivé
  durs: number               // bloquants durs ACTIFS (ignorés / faux positifs levés)
}

const SECTIONS: PvSection[] = ['participants', 'remarques_cr', 'points_examines', 'previsions', 'photos']

/**
 * Construit la surface de validation consolidée d'une réunion. Renvoie null si la
 * réunion est introuvable. Lecture seule (aucune écriture de statut ici).
 */
export async function buildPvValidation(reportId: string): Promise<PvValidation | null> {
  const ctx = await loadMeetingContext(reportId)
  if (!ctx) return null
  const { input, sources } = ctx
  const items: Omit<PvValidationItem, 'excluded'>[] = []

  // 1) PARTICIPANTS détectés (source = nom ; pas d'id contact en V1).
  input.report.participants.forEach((p, i) => {
    items.push({
      id: `participants:${i}`,
      section: 'participants',
      type: p.role ?? 'participant',
      texte: p.role ? `${p.name} — ${p.role}` : p.name,
      source: p.name,
      confiance: 'sûr',
      statutValidation: 'pending',
      blocking: false,
    })
  })

  // 2) REMARQUES SUR CR PRÉCÉDENT (déterministe meeting_followup).
  for (const r of sources.remarques.items) {
    items.push({
      id: `remarques_cr:${r.source}`,
      section: 'remarques_cr',
      type: r.kind,
      texte: r.texte,
      source: r.source,
      confiance: r.confiance,
      statutValidation: 'pending',
      blocking: false,
    })
  }

  // 3) POINTS EXAMINÉS TYPÉS. type 'blocage' (anomalie/dépendance) = blocage métier.
  for (const p of sources.points) {
    items.push({
      id: `points_examines:${p.source}`,
      section: 'points_examines',
      type: p.type,
      texte: p.texte,
      source: p.source,
      confiance: p.confiance,
      statutValidation: 'pending',
      blocking: p.type === 'blocage',
      actionCodes: p.actionCodes ?? [], // codes responsables mémorisés (mig 132)
    })
  }

  // 4) PRÉVISIONS (anomalies non résolues + interventions à venir). Cadrage DISTINCT
  //    des points examinés (option 3) : ici = TRAITEMENT prévu, jamais le même texte
  //    que le constat bloquant. La même anomalie apparaît donc 2× — constat + action —
  //    et c'est VOULU : l'humain valide les deux séparément.
  for (const pv of sources.previsions) {
    items.push({
      id: `previsions:${pv.source}`,
      section: 'previsions',
      type: pv.kind,
      texte: pv.texte,
      source: pv.source,
      confiance: pv.confiance,
      statutValidation: 'pending',
      blocking: false,
      titre: pv.titre,
      responsable: pv.responsable,
      echeance: pv.echeance,
    })
  }

  // 5) PHOTOS (structure réutilisable ; légende manquante → à confirmer).
  for (const ph of sources.photos) {
    items.push({
      id: `photos:${ph.id}`,
      section: 'photos',
      type: ph.source, // 'intervention' | 'action'
      texte: ph.legende || '(photo sans légende)',
      source: ph.id,
      confiance: ph.legende ? 'sûr' : 'à confirmer',
      statutValidation: 'pending',
      blocking: false,
    })
  }

  const readiness = pvReadiness(input)
  const counts = Object.fromEntries(SECTIONS.map((s) => [s, 0])) as Record<PvSection, number>
  for (const it of items) counts[it.section]++

  // DÉCISIONS humaines : annotation des gaps (gate) + marquage des items exclus.
  // 'ignored'/'false_positive' LÈVENT un gap (gate) ET excluent un item (CR) ;
  // 'reported' reste bloquant (différé ≠ résolu).
  const decisions = await listPvSignalDecisions(reportId)
  const byId = new Map(decisions.map((d) => [d.signalId, d]))
  const excluded = new Set(
    decisions.filter((d) => d.statut === 'ignored' || d.statut === 'false_positive').map((d) => d.signalId),
  )
  const annotatedItems: PvValidationItem[] = items.map((it) => ({ ...it, excluded: excluded.has(it.source) }))
  const gaps: PvGapAnnote[] = readiness.gaps.map((g) => ({ ...g, decision: byId.get(g.id) ?? null }))
  const leve = (g: PvGapAnnote) => g.decision?.statut === 'ignored' || g.decision?.statut === 'false_positive'
  const durs = gaps.filter((g) => !leve(g) && pointBloque(g, DEFAULT_PV_POLICY)).length

  return { reportId, items: annotatedItems, counts, readiness, gaps, blocking: durs > 0, durs }
}
