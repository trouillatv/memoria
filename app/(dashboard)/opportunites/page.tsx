import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Compass, MapPin, ChevronRight, Plus } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listOpportunityDossiers } from '@/lib/db/dossiers'
import { createProspectAction } from './actions'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// « Le chantier existe avant le contrat. » Les dossiers d'opportunité (prévisite AO)
// vivent ici, hors de la grille chantier, tant qu'ils ne sont pas gagnés. Prototype :
// accessible par URL, pas encore dans la navigation principale. Cf. mig 171.

const PHASE_FR: Record<string, string> = { prospect: 'Prospection', en_ao: 'Appel d’offres' }

export default async function OpportunitesPage() {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/m')

  const opportunities = await listOpportunityDossiers()

  return (
    <div className="max-w-3xl space-y-8 py-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
          <Compass className="h-6 w-6 text-sky-600" /> Affaires
        </h1>
        <p className="text-sm text-muted-foreground">
          Une affaire naît dès la prévisite — avant le contrat. Si elle est gagnée,
          elle devient un chantier sans rien perdre de sa mémoire. L&apos;appel d&apos;offres n&apos;en est qu&apos;un épisode.
        </p>
      </header>

      {/* Créer un dossier d'opportunité. Saisie minimale : on ne veut pas réfléchir
          structure de données, juste « je vais voir un chantier ». */}
      <form action={createProspectAction} className="space-y-3 rounded-2xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Nouvelle affaire</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Nom de l&apos;affaire</span>
            <input
              name="name"
              required
              maxLength={200}
              placeholder="Ex : Réfection école Jules Ferry"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Donneur d&apos;ordre</span>
            <input
              name="clientName"
              required
              maxLength={200}
              placeholder="Ex : Mairie de Nouméa"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
        </div>
        <button
          type="submit"
          className="inline-flex items-center gap-2 rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Créer et préparer la prévisite
        </button>
      </form>

      {/* La liste des opportunités en cours. */}
      {opportunities.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
          Aucune affaire en cours. Créez-en une ci-dessus avant de partir en prévisite.
        </p>
      ) : (
        <ul className="space-y-2">
          {opportunities.map((o) => (
            <li key={o.id}>
              <Link
                href={`/dossiers/${o.id}`}
                className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 hover:bg-muted"
              >
                <MapPin className="h-4 w-4 shrink-0 text-sky-600" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{o.label ?? o.site_name ?? 'Dossier'}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {o.client_name ?? 'Donneur d’ordre à préciser'}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
                  {PHASE_FR[o.phase] ?? o.phase}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
