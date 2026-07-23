interface DashboardHeaderProps {
  firstName: string
  orgNames: string[]
}

export function DashboardHeader({ firstName, orgNames }: DashboardHeaderProps) {
  const today = new Date()
  const dateLabel = today.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return (
    <header
      data-slot="dashboard-header"
      className="flex items-start justify-between gap-4 flex-wrap"
    >
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-bold">Bonjour {firstName}.</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Voici ce qui demande votre attention aujourd&apos;hui.
        </p>
        {orgNames.length > 1 && (
          <p className="text-xs text-muted-foreground/70 mt-0.5">{orgNames.join(' · ')}</p>
        )}
      </div>
      <div className="text-xs text-muted-foreground capitalize">{dateLabel}</div>
    </header>
  )
}
