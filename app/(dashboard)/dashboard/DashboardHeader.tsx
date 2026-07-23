interface DashboardHeaderProps {
  orgNames: string[]
}

export function DashboardHeader({ orgNames }: DashboardHeaderProps) {
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
        <h1 className="text-2xl font-bold">Bonjour,</h1>
        {orgNames.length > 0 && (
          <p className="text-sm text-muted-foreground mt-1">
            {orgNames.join(' · ')}
          </p>
        )}
      </div>
      <div className="text-xs text-muted-foreground capitalize">{dateLabel}</div>
    </header>
  )
}
