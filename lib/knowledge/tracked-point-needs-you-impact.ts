// Phase 6E.4C — texte d'impact affiché AVANT confirmation, calculé uniquement à partir des
// mutations réelles des actions serveur déjà utilisées par 6E.4A (jamais un second moteur de
// détection) :
//   - duplicate_points   → merge_tracked_points (mig 391/392) : redirection logique pure, 0
//     suppression, 0 réécriture de preuve (status='merged'+merged_into_id, rien d'autre).
//   - attach_information → accept_trace_identity_candidate (mig 393) : un seul INSERT
//     tracked_point_member scope='thread' sur la cible désignée ; derivedState reste calculé par
//     le réducteur, jamais changé directement ici.
//   - confirm_trackability → confirm_pending_trackability (mig 395) : crée TOUJOURS un Point
//     neuf identity_status=PROVISIONAL, ne réutilise jamais un Point existant.
//   - assign_resolution  → associate_pending_resolution_to_point (mig 396) : rattache TOUJOURS à
//     la cible choisie par l'humain, +0 Point créé, +0 autre Point modifié.
//   - clarify_evidence   → resolve_pending_trace_evidence (mig 394) : 0 effet sur
//     tracked_point_member/derivedState/trajectoire — précise seulement la preuve retenue.
//
// Doctrine Vincent (gelée, mandat 6E.4C) : aucune promesse non prouvée ; jamais "supprimé" (une
// fusion est une redirection, pas une destruction) ; jamais "résolu"/"clôt" (une confirmation
// d'identité ne fabrique pas une preuve de résolution) ; jamais confondre identité du Point et
// état métier (derivedState) ; toujours distinguer ce qui change de ce qui ne change pas.

import type { ConsolidationQueueEntry } from './tracked-point-consolidation-queue'

export function duplicatePointsImpact(entry: ConsolidationQueueEntry): string[] {
  if (!entry.predictedTargetPointId) {
    return [
      "MemorIA ne peut pas encore déterminer lequel des deux suivis serait conservé — la fusion reste bloquée tant que ce conflit d'identité n'est pas résolu autrement.",
    ]
  }
  const target = entry.predictedTargetPointId === entry.pointA.id ? entry.pointA : entry.pointB
  const source = entry.predictedTargetPointId === entry.pointA.id ? entry.pointB : entry.pointA
  return [
    `Point conservé : « ${target.label} ».`,
    `Point absorbé : « ${source.label} » — son historique reste consultable dans « ${target.label} », rien n'est supprimé.`,
    "Aucune preuve n'est réécrite ni déplacée.",
  ]
}

export function attachInformationImpact(targetLabel: string): string[] {
  return [
    `Cette preuve apparaîtra dans l'historique de « ${targetLabel} ».`,
    "L'état actuel de ce suivi (ouvert, résolu…) ne change pas automatiquement.",
    "Aucun autre suivi du chantier n'est modifié.",
  ]
}

export function confirmTrackabilityImpact(): string[] {
  return [
    "MemorIA créera un suivi distinct, avec un statut provisoire (à confirmer par la suite avec de nouveaux éléments).",
    "Cette situation n'est rattachée à aucun suivi existant.",
  ]
}

export function assignResolutionImpact(targetLabel: string): string[] {
  return [
    `Cette preuve sera rattachée au suivi existant « ${targetLabel} ».`,
    "Aucun nouveau suivi n'est créé ; les autres suivis du chantier ne sont pas modifiés.",
  ]
}

export function clarifyEvidenceImpact(selectedCount: number): string[] {
  return [
    `Cette sélection (${selectedCount} information${selectedCount > 1 ? 's' : ''}) précise seulement la preuve qui sera utilisée pour la prochaine décision.`,
    "Aucun suivi n'est créé ni modifié par cette action.",
  ]
}
