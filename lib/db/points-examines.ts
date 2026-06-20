// POINTS EXAMINÉS — réceptacle TYPÉ (couche 3 « extraction → objets typés »).
//
// Sprint DÉTERMINISTE (Vincent 2026-06-20) : on ne peuple QUE ce qui a une source
// structurée — actions créées dans la réunion, risques typés, anomalies non
// résolues. Les types decision / demande_moa / arbitrage restent VIDES jusqu'à la
// couche 2 LLM ; JAMAIS inventés sans source transcript explicite.
//
// Séparation stricte (sinon MemorIA s'effondre) :
//   Point examiné = sujet discuté ≠ Action = chose à faire ≠ Décision = arbitrage validé.
// 'action' est un TYPE de point à part entière (pas un simple champ secondaire).

import { createAdminClient } from '@/lib/supabase/admin'
import { listSiteActionsByReport } from '@/lib/db/site-actions'
import type { DbSiteReport } from '@/types/db'

export type PointExamineType =
  | 'info'
  | 'action'
  | 'decision'
  | 'demande_moa'
  | 'blocage'
  | 'risque'
  | 'controle_essai'
  | 'securite_environnement'

export type PointExamineStatut = 'fait' | 'en cours' | 'à faire' | 'en attente' | 'bloqué'

export interface PointExamine {
  type: PointExamineType
  sousTitre: string
  texte: string
  action: string | null // l'action éventuelle qui en découle (texte libre)
  statut: PointExamineStatut | null
  source: string // id de l'objet source (traçabilité / validation)
  confiance: 'sûr' | 'à confirmer'
  actionCodes?: string[] // colonne ACTION du PV (codes responsables ETV/MOA/MOE… ; mig 132)
}

function statutFromActionStatus(s: string): PointExamineStatut | null {
  if (s === 'done') return 'fait'
  if (s === 'planned') return 'en cours'
  if (s === 'open') return 'à faire'
  return null
}

/** Construit les points examinés typés depuis les sources DÉTERMINISTES d'une réunion. */
export async function buildPointsExamines(
  report: Pick<DbSiteReport, 'id' | 'site_id' | 'risks'>,
): Promise<PointExamine[]> {
  const sb = createAdminClient()
  const points: PointExamine[] = []

  // 1) ACTIONS créées dans la réunion → type 'action' (sujet à suivre, ≠ décision).
  const actions = await listSiteActionsByReport(report.id)
  for (const a of actions) {
    if (a.status === 'cancelled') continue
    points.push({
      type: 'action',
      sousTitre: (a.corps_etat ?? '').trim().toUpperCase() || 'ACTIONS À SUIVRE',
      texte: a.assigned_to ? `${a.title} — ${a.assigned_to}` : a.title,
      action: null,
      statut: statutFromActionStatus(a.status),
      source: a.id,
      confiance: a.due_date_status === 'estimated' ? 'à confirmer' : 'sûr',
    })
  }

  // 2) RISQUES typés du report → 'blocage' (dépendance) ou 'risque' (vigilance).
  const risks = report.risks ?? []
  for (let i = 0; i < risks.length; i++) {
    const r = risks[i]
    const isBlocage = r.kind === 'dependency'
    const detail = [r.rationale, r.waiting_party ? `en attente : ${r.waiting_party}` : null].filter(Boolean).join(' — ')
    points.push({
      type: isBlocage ? 'blocage' : 'risque',
      sousTitre: isBlocage ? 'POINTS BLOQUANTS' : 'POINTS DE VIGILANCE',
      texte: detail ? `${r.label} (${detail})` : r.label,
      action: r.awaited ?? null,
      statut: r.waiting_party ? 'en attente' : null,
      source: `risk:${report.id}:${i}`,
      confiance: 'sûr',
    })
  }

  // 3) ANOMALIES non résolues du site → 'blocage' (point bloquant examiné).
  if (report.site_id) {
    const { data: missions } = await sb.from('missions').select('id').eq('site_id', report.site_id).is('deleted_at', null)
    const missionIds = (missions ?? []).map((m) => m.id as string)
    if (missionIds.length > 0) {
      const { data: interventions } = await sb.from('interventions').select('id').in('mission_id', missionIds)
      const intvIds = (interventions ?? []).map((i) => i.id as string)
      if (intvIds.length > 0) {
        const { data } = await sb
          .from('intervention_anomalies')
          .select('id, description, category_other, resolved_at, created_at')
          .in('intervention_id', intvIds)
          .is('resolved_at', null)
          .order('created_at', { ascending: false })
        for (const an of data ?? []) {
          const desc = ((an.description as string | null) ?? (an.category_other as string | null) ?? '').trim()
          if (!desc) continue
          // Cadrage CONSTAT (Vincent 2026-06-20, option 3) : ici l'anomalie est le
          // point bloquant EXAMINÉ (« Anomalie signalée : … »). Le TRAITEMENT prévu
          // vit côté Prévisions (« Traitement / contrôle à prévoir : … ») — wording
          // distinct VOULU, jamais le même texte. INVARIANT : ne pas réaligner.
          points.push({
            type: 'blocage',
            sousTitre: 'ANOMALIES NON RÉSOLUES',
            texte: `Anomalie signalée : ${desc}`,
            action: null,
            statut: 'bloqué',
            source: an.id as string,
            confiance: 'sûr',
          })
        }
      }
    }
  }

  return points
}
