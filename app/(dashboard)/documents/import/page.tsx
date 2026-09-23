import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
import { listDocumentCollections } from '@/lib/db/documents'
import { listContracts } from '@/lib/db/contracts'
import { listSites, listClients } from '@/lib/db/sites'
import { listTenders } from '@/lib/db/tenders'
import { listTeams } from '@/lib/db/teams'
import { getSiteReport } from '@/lib/db/site-reports'
import { getAverageCostForFeatures } from '@/lib/db/ai-usage-rollup'
import { getOrgsForSelector } from '@/components/ui/org-selector'
import { getOrganizationLabels } from '@/lib/db/organisations'
import type { OrgOption } from '@/components/ui/org-selector-client'
import { BatchImportForm } from './BatchImportForm'

// Import par lot (Phase 2 V1) — dépôt multi-fichiers → triage → validation
// humaine → import séquentiel borné. Réutilise uploadDocumentAction + l'embedding
// sélectif déjà livré. Manager/admin uniquement (cohérent /documents).

export const dynamic = 'force-dynamic'

export default async function DocumentsImportPage({
  searchParams,
}: {
  searchParams: Promise<{ target_type?: string; target_id?: string }>
}) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') notFound()

  const sp = await searchParams

  const docAvgCost = await getAverageCostForFeatures(['embed_chunks_document'])

  const [allCollections, contracts, sites, clients, tenders, teams] = await Promise.all([
    listDocumentCollections(),
    listContracts(),
    listSites(),
    listClients(),
    listTenders(),
    listTeams(),
  ])

  const linkTargets: Record<string, { id: string; label: string }[]> = {
    contract: contracts.map((c) => ({ id: c.id, label: c.name })),
    site: sites.map((s) => ({ id: s.id, label: s.name })),
    client: clients.map((c) => ({ id: c.id, label: c.name })),
    tender: tenders.map((t) => ({ id: t.id, label: t.title })),
    team: teams.map((t) => ({ id: t.id, label: t.name })),
  }

  // Cible « réunion » (mig 164) : on n'expose pas TOUTES les réunions ; on résout
  // seulement celle préfixée par le lien « Ajouter un document mémoire ».
  if (sp.target_type === 'site_report' && sp.target_id) {
    const r = await getSiteReport(sp.target_id).catch(() => null)
    if (r) linkTargets.site_report = [{ id: r.id, label: r.title || `Réunion du ${new Date(r.created_at).toLocaleDateString('fr-FR')}` }]
  }

  // Depuis une fiche chantier, l'organisation est déjà connue et non ambiguë —
  // on la présélectionne sans jamais redemander à l'utilisateur. `sites` est
  // déjà filtré par appartenance (listSites()), donc trouver le site ici
  // garantit que l'utilisateur en est membre. Sinon (bibliothèque globale),
  // on retombe sur le sélecteur générique (silencieux en mono-org).
  const contextSite =
    sp.target_type === 'site' && sp.target_id ? sites.find((s) => s.id === sp.target_id) : undefined
  let orgs: OrgOption[]
  if (contextSite?.organization_id) {
    const labels = await getOrganizationLabels([contextSite.organization_id])
    orgs = [
      { id: contextSite.organization_id, label: labels[contextSite.organization_id] ?? contextSite.organization_id },
    ]
  } else {
    orgs = await getOrgsForSelector()
  }

  // Chantier contextualisé → les collections proposées à l'import sont
  // restreintes à l'organisation du chantier (jamais une collection d'une
  // autre organisation d'appartenance). La Bibliothèque globale (pas de
  // contextSite) garde sa vue multi-organisation inchangée.
  const collections = contextSite?.organization_id
    ? allCollections.filter((c) => c.organization_id === contextSite.organization_id)
    : allCollections

  return (
    <div className="space-y-6 w-full">
      <header className="space-y-1">
        <Link href="/documents" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-3.5 w-3.5" /> Bibliothèque
        </Link>
        <h1 className="text-2xl font-semibold">Ajouter des documents</h1>
        <p className="text-sm text-muted-foreground">
          Déposez un ou plusieurs PDF. MemorIA propose une couche mémoire et
          l’indexation pour chacun — <strong>vous validez avant l’import</strong>. Rien
          n’est envoyé tant que vous ne lancez pas.
        </p>
      </header>

      <BatchImportForm
        collections={collections.map((c) => ({ id: c.id, name: c.name }))}
        linkTargets={linkTargets}
        prefillTargetType={sp.target_type}
        prefillTargetId={sp.target_id}
        avgCostUsd={docAvgCost.avgUsd}
        costSampleCount={docAvgCost.count}
        orgs={orgs}
      />
    </div>
  )
}
