import Link from 'next/link'

interface ActiveContractRef {
  id: string
  name: string
}

interface DashboardHeaderProps {
  firstName: string
  activeContractsCount: number
  /** Optionnel : noms + ids des contrats actifs pour les rendre cliquables
   *  juste sous le compteur. Si omis ou vide, seul le compteur s'affiche. */
  activeContracts?: ActiveContractRef[]
}

/**
 * Header chaleureux du dashboard cockpit (Slice 11.1).
 *
 * Doctrine UX :
 *   - "Bonjour {prénom}." sobre, sans emoji ni exclamation.
 *   - Sous-titre = macro state factuel (X contrat(s) actif(s)).
 *   - Liste des contrats actifs en chips cliquables sobres juste en-dessous.
 *   - Date du jour FR en discret en haut à droite.
 */
export function DashboardHeader({ firstName, activeContractsCount, activeContracts }: DashboardHeaderProps) {
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
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-bold">Bonjour {firstName}.</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {activeContractsCount} contrat{plural} actif{plural}.
        </p>
        {activeContracts && activeContracts.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 mt-2">
            {activeContracts.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/contracts/${c.id}`}
                  className="inline-flex items-center rounded-full border border-border bg-card px-2.5 py-0.5 text-xs text-foreground hover:bg-muted/50 transition-colors"
                >
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="text-xs text-muted-foreground capitalize">{dateLabel}</div>
    </header>
  )
}
