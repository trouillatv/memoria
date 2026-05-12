// Slice B.0 — /preuves : page d'entrée du Dossier de preuves.
//
// Doctrine UX :
//   - Wedge émotionnel : un DG cleaning doit passer en <30 secondes de
//     « j'ai pas la preuve » à « la voilà ». La page est conçue pour ça :
//     barre de recherche au-dessus, filtres rapides (site / statut / période),
//     liste sobre antichronologique.
//   - Anonymisation par défaut : aucun prénom / nom d'agent, aucune photo de
//     profil. Le team[] reste interne (génération du rapport future).
//   - Sobriété calme : pas de bandeau ALERTE, pas de wording litige.
//     Sert au litige ET à la réunion client ET à l'audit.
//   - Empty state d'accueil rassurant — pas de query DB inutile quand aucun
//     filtre n'est posé.
//   - Accessibilité : `admin` et `manager`. `chef_equipe` est redirigé vers /m.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  FileSearch,
  MapPin,
  Image as ImageIcon,
  AlertTriangle,
  CheckCircle2,
  Clock,
} from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { FiltersBar } from '@/components/ui/filters-bar'
import { FilterSelect } from '@/components/ui/filter-select'
import { PaginationBar } from '@/components/ui/pagination-bar'
import { StatusBadge } from '@/components/ui/status-badge'

import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listSites } from '@/lib/db/sites'
import { searchProofs, type ProofIntervention } from '@/lib/db/proofs'

import { DateRangeFilter } from './DateRangeFilter'

const PAGE_SIZE = 50

interface PageProps {
  searchParams: Promise<{
    search?: string
    siteId?: string
    dateFrom?: string
    dateTo?: string
    status?: string
    page?: string
  }>
}

export default async function PreuvesPage({ searchParams }: PageProps) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const params = await searchParams
  const search = params.search?.trim() || undefined
  const siteId = params.siteId || undefined
  const dateFrom = params.dateFrom || undefined
  const dateTo = params.dateTo || undefined
  const status = params.status || undefined
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1)
  const offset = (page - 1) * PAGE_SIZE

  const sites = await listSites()
  const siteOptions = sites.map((s) => ({ value: s.id, label: s.name }))

  const hasAnyFilter = Boolean(search || siteId || dateFrom || dateTo || status)

  // Empty state d'accueil — pas de query DB inutile tant qu'aucun filtre n'est posé.
  if (!hasAnyFilter) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <Header />
        <FiltersWrapper siteOptions={siteOptions} hasActiveFilters={false} />
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={FileSearch}
              title="Quel dossier de preuves voulez-vous consulter ?"
              description="Tapez le nom d'un site, une date, ou un mot-clé pour retrouver instantanément les preuves d'intervention."
            />
          </CardContent>
        </Card>
      </div>
    )
  }

  const { items, total } = await searchProofs({
    search,
    siteId,
    dateFrom,
    dateTo,
    status,
    offset,
    limit: PAGE_SIZE,
  })

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <Header />
      <FiltersWrapper siteOptions={siteOptions} hasActiveFilters={hasAnyFilter} />

      {items.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={FileSearch}
              title="Aucune intervention ne correspond"
              description="Essayez d'élargir la période, de retirer un filtre, ou de vérifier l'orthographe."
              primaryAction={
                <Link
                  href="/preuves"
                  className="text-foreground underline underline-offset-4"
                >
                  Réinitialiser tous les filtres
                </Link>
              }
              variant="compact"
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <div className="px-6 py-2 text-sm text-muted-foreground border-b border-border/60 tabular-nums">
              {total} intervention{total > 1 ? 's' : ''} trouvée
              {total > 1 ? 's' : ''}
            </div>
            <CardContent className="p-0">
              <ul className="divide-y">
                {items.map((it) => (
                  <ProofRow key={it.id} item={it} />
                ))}
              </ul>
            </CardContent>
          </Card>
          <PaginationBar page={page} pageSize={PAGE_SIZE} total={total} />
        </>
      )}
    </div>
  )
}

function Header() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Dossier de preuves</h1>
      <p className="text-sm text-muted-foreground">
        Retrouvez instantanément toutes les preuves d&apos;intervention. Pour une
        réclamation client, un renouvellement, une réunion ou un audit qualité.
      </p>
    </div>
  )
}

function FiltersWrapper({
  siteOptions,
  hasActiveFilters,
}: {
  siteOptions: Array<{ value: string; label: string }>
  hasActiveFilters: boolean
}) {
  return (
    <FiltersBar
      searchPlaceholder="Rechercher un site, une intervention…"
      hasActiveFilters={hasActiveFilters}
      resetParams={['search', 'siteId', 'status', 'dateFrom', 'dateTo']}
    >
      <FilterSelect
        paramName="siteId"
        label="Site"
        emptyLabel="Tous les sites"
        options={siteOptions}
      />
      <FilterSelect
        paramName="status"
        label="Statut"
        emptyLabel="Tous"
        options={[
          { value: 'completed', label: 'Exécutée' },
          { value: 'validated', label: 'Validée' },
          { value: 'in_progress', label: 'En cours' },
          { value: 'planned', label: 'Planifiée' },
          { value: 'skipped', label: 'Sautée' },
        ]}
      />
      <DateRangeFilter />
    </FiltersBar>
  )
}

function ProofRow({ item }: { item: ProofIntervention }) {
  const dateSource = item.executed_at ?? item.scheduled_at
  const dateFr = dateSource
    ? new Date(dateSource).toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : 'Sans date'

  return (
    <li>
      <Link
        href={`/preuves/${item.id}`}
        className="flex items-start gap-4 px-6 py-3 hover:bg-muted/30 transition-colors"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-sm font-semibold truncate">{item.title}</span>
            <StatusBadge
              status={item.skipped_at ? 'skipped' : item.status}
              className="shrink-0"
            />
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
            <MapPin className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{item.site_name || '—'}</span>
            {item.contract_name && (
              <>
                <span>·</span>
                <span className="truncate">{item.contract_name}</span>
              </>
            )}
            <span>·</span>
            <Clock className="h-3 w-3 shrink-0" aria-hidden />
            <span>{dateFr}</span>
          </div>
          {/* Validations + anomalies en sous-ligne discrète */}
          {(item.validationsCount > 0 || item.anomaliesCount > 0) && (
            <div className="text-xs mt-1.5 flex items-center gap-3 text-muted-foreground tabular-nums">
              {item.validationsCount > 0 && (
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" aria-hidden />
                  {item.validationsCount} validation{item.validationsCount > 1 ? 's' : ''}
                </span>
              )}
              {item.anomaliesCount > 0 && (
                <span
                  className="flex items-center gap-1 text-amber-700"
                  title={`${item.anomaliesResolvedCount} résolue${
                    item.anomaliesResolvedCount > 1 ? 's' : ''
                  } sur ${item.anomaliesCount}`}
                >
                  <AlertTriangle className="h-3 w-3" aria-hidden />
                  {item.anomaliesCount} anomalie{item.anomaliesCount > 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}
        </div>
        {/* Compteur photos — cœur de la preuve, hiérarchisé à droite */}
        <div className="shrink-0 flex flex-col items-end justify-center tabular-nums" aria-label={`${item.photosCount} photo${item.photosCount > 1 ? 's' : ''}`}>
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <ImageIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span>{item.photosCount}</span>
          </div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
            photo{item.photosCount > 1 ? 's' : ''}
          </span>
        </div>
      </Link>
    </li>
  )
}

