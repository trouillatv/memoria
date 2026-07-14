// Vocabulaire conducteur, jamais développeur : aucun statut technique
// (`planned`, `in_progress`…) ne doit atteindre l'écran de Guillaume.

export function interventionStatusLabel(status: string): string {
  if (status === 'planned') return 'Planifiée'
  if (status === 'in_progress') return 'En cours'
  if (status === 'completed') return 'Terminée'
  if (status === 'validated') return 'Validée'
  if (status === 'skipped') return 'Non réalisée'
  return 'Prévue'
}

export function cycleStatusLabel(status: string): string {
  if (status === 'published') return 'Publié'
  if (status === 'draft') return 'Brouillon'
  if (status === 'archived') return 'Archivé'
  return 'À publier'
}
