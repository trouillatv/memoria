interface DashboardHeaderProps {
  firstName: string
  activeContractsCount: number
}

/**
 * Header chaleureux du dashboard cockpit (Slice 11.1).
 *
 * Doctrine UX :
 *   - "Bonjour {prénom}." sobre, sans emoji ni exclamation.
 *   - Sous-titre = macro state factuel (X contrat(s) actif(s)).
 *   - Date du jour FR en discret en haut à droite.
 */
export function DashboardHeader({ firstName, activeContractsCount }: DashboardHeaderProps) {
  const today = new Date()
  const dateLabel = today.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const plural = activeContractsCount > 1 ? 's' : ''

  return (
    <header
      data-slot="dashboard-header"
      className="flex items-start justify-between gap-4 flex-wrap"
    >
      <div>
        <h1 className="text-2xl font-bold">Bonjour {firstName}.</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {activeContractsCount} contrat{plural} actif{plural}.
        </p>
      </div>
      <div className="text-xs text-muted-foreground capitalize">{dateLabel}</div>
    </header>
  )
}
