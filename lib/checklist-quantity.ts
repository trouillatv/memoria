// Checklist enrichie « à quantité » — helpers purs, CLIENT-SAFE (aucun import
// serveur). Partagés par le formulaire token, l'action serveur et l'affichage
// boss, pour une seule définition du statut dérivé.
//
// Décision MVP : un item est « à quantité » si expected_qty != null. Le statut
// se DÉRIVE des chiffres, jamais un dropdown manuel.

export type ChecklistItemStatus = 'complet' | 'partiel' | 'non_livre'

/** Dérive le statut d'un item à quantité à partir du prévu et du livré. */
export function deriveChecklistItemStatus(
  expectedQty: number,
  deliveredQty: number,
): ChecklistItemStatus {
  if (deliveredQty >= expectedQty) return 'complet'
  if (deliveredQty <= 0) return 'non_livre'
  return 'partiel'
}

export const CHECKLIST_STATUS_META: Record<
  ChecklistItemStatus,
  { label: string; tone: 'ok' | 'warn' | 'bad' }
> = {
  complet:   { label: 'Complet',   tone: 'ok' },
  partiel:   { label: 'Partiel',   tone: 'warn' },
  non_livre: { label: 'Non livré', tone: 'bad' },
}
