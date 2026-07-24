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
      className="flex items-end justify-between gap-5 rounded-2xl border border-slate-200/70 bg-white/80 px-5 py-5 shadow-[0_8px_30px_rgba(15,23,42,0.03)] sm:px-7"
    >
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Poste de pilotage</p>
        <h1 className="text-3xl font-semibold tracking-[-0.035em] text-slate-950">Bonjour {firstName}.</h1>
        <p className="mt-2 text-sm text-slate-500">
          Voici ce qui demande votre attention aujourd&apos;hui.
        </p>
        {orgNames.length > 1 && (
          <p className="text-xs text-muted-foreground/70 mt-0.5">{orgNames.join(' · ')}</p>
        )}
      </div>
      <div className="hidden text-right text-xs font-medium capitalize text-slate-400 sm:block">{dateLabel}</div>
    </header>
  )
}
