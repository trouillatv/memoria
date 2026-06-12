import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Search, MapPin, Users, Camera, AlertTriangle, Building2 } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { searchInterventions, type SearchHit, type MatchSource } from '@/lib/db/search'
import { SearchBar } from './SearchBar'

interface PageProps {
  searchParams: Promise<{ q?: string }>
}

// ── Helpers d'affichage ──────────────────────────────────────────────────────

const FR_MONTHS = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
]

function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return `${d} ${FR_MONTHS[m - 1]} ${y}`
}

const STATUS_LABEL: Record<string, string> = {
  validated: 'Validée',
  completed: 'Exécutée',
  in_progress: 'En cours',
  skipped: 'Sautée',
}

const STATUS_COLOR: Record<string, string> = {
  validated: 'text-green-700 border-green-300 bg-green-50',
  completed: 'text-emerald-700 border-emerald-300 bg-emerald-50',
  in_progress: 'text-amber-700 border-amber-300 bg-amber-50',
  skipped: 'text-muted-foreground border-border bg-muted/40',
}

const SOURCE_LABEL: Record<MatchSource, string> = {
  notes: 'Note terrain',
  mission: 'Mission',
  anomaly: 'Anomalie',
  company: 'Sous-traitant',
}

function truncateNotes(notes: string, maxLen = 160): string {
  if (notes.length <= maxLen) return notes
  return notes.slice(0, maxLen).trimEnd() + '…'
}

// ── Carte résultat ────────────────────────────────────────────────────────────

function HitCard({ hit }: { hit: SearchHit }) {
  const statusLabel = STATUS_LABEL[hit.status] ?? hit.status
  const statusClass = STATUS_COLOR[hit.status] ?? 'text-muted-foreground border-border bg-muted/40'

  return (
    <Link
      href={`/interventions/${hit.interventionId}`}
      className="block rounded-lg border bg-card p-4 hover:bg-muted/30 transition-colors space-y-2"
    >
      {/* Ligne 1 : site + date + statut */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <MapPin className="h-3 w-3 shrink-0" />
          <Link
            href={`/sites/${hit.siteId}`}
            className="hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {hit.siteName}
          </Link>
        </span>
        <span className="text-muted-foreground/50">·</span>
        <span className="text-xs text-muted-foreground">{formatDate(hit.date)}</span>
        <span
          className={`ml-auto inline-block border rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusClass}`}
        >
          {statusLabel}
        </span>
      </div>

      {/* Mission name */}
      <p className="font-medium text-sm leading-snug">{hit.missionName}</p>

      {/* Chips : équipe, participants, photos, anomalies */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {hit.teamName && (
          <span className="inline-flex items-center gap-1">
            <Users className="h-3 w-3" />
            {hit.teamName}
          </span>
        )}
        {hit.participantCount > 0 && (
          <span>
            {hit.participantCount} intervenant{hit.participantCount > 1 ? 's' : ''}
          </span>
        )}
        {hit.photoCount > 0 && (
          <span className="inline-flex items-center gap-1">
            <Camera className="h-3 w-3" />
            {hit.photoCount} photo{hit.photoCount > 1 ? 's' : ''}
          </span>
        )}
        {hit.openAnomalies > 0 && (
          <span className="inline-flex items-center gap-1 text-amber-600">
            <AlertTriangle className="h-3 w-3" />
            {hit.openAnomalies} anomalie{hit.openAnomalies > 1 ? 's' : ''} ouverte{hit.openAnomalies > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Entreprises */}
      {hit.companies.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {hit.companies.map((c) => (
            <span
              key={c.company_name}
              className="inline-flex items-center gap-1 rounded-full border bg-muted/30 px-2 py-0.5 text-muted-foreground"
            >
              <Building2 className="h-3 w-3 shrink-0" />
              {c.company_name}
              {c.role_description && (
                <span className="opacity-70"> — {c.role_description}</span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Notes snippet */}
      {hit.notes && hit.matchSources.includes('notes') && (
        <p className="text-xs text-muted-foreground border-l-2 border-border pl-2 italic leading-relaxed">
          {truncateNotes(hit.notes)}
        </p>
      )}

      {/* Sources du match */}
      <div className="flex flex-wrap gap-1 pt-0.5">
        {hit.matchSources.map((src) => (
          <span
            key={src}
            className="rounded border border-dashed px-1.5 py-0.5 text-[10px] text-muted-foreground"
          >
            {SOURCE_LABEL[src]}
          </span>
        ))}
      </div>
    </Link>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const EXAMPLES = ['ferraillage', 'porte 42', 'béton services', 'voile nord', 'SOCOTEC', 'plomberie']

export default async function RecherchePage({ searchParams }: PageProps) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { q } = await searchParams
  const query = q?.trim() ?? ''

  const hits: SearchHit[] = user.organization_id && query.length >= 2
    ? await searchInterventions(query, user.organization_id)
    : []

  return (
    <div className="space-y-6 w-full max-w-3xl">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
          <Search className="h-5 w-5 text-muted-foreground" />
          Recherche
        </h1>
        <p className="text-sm text-muted-foreground">
          Notes terrain, missions, sous-traitants, anomalies — sur tous les chantiers.
        </p>
      </header>

      <SearchBar defaultValue={query} />

      {/* Résultats */}
      {query.length >= 2 && (
        <div className="space-y-3">
          {hits.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Aucun résultat pour « {query} »
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {hits.length} résultat{hits.length > 1 ? 's' : ''} pour «&nbsp;{query}&nbsp;»
              </p>
              <div className="space-y-2">
                {hits.map((hit) => (
                  <HitCard key={hit.interventionId} hit={hit} />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* État vide — suggestions */}
      {!query && (
        <div className="py-12 text-center space-y-4">
          <p className="text-sm text-muted-foreground">Exemples de recherche :</p>
          <div className="flex flex-wrap gap-2 justify-center">
            {EXAMPLES.map((ex) => (
              <Link
                key={ex}
                href={`/recherche?q=${encodeURIComponent(ex)}`}
                className="rounded-full border px-3 py-1 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
              >
                {ex}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
