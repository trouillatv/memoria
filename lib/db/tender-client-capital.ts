// AO-1 L4 — Capital client sur page AO.
//
// Vincent 2026-05-21 : « encart factuel : historique client connu ;
// nombre d'interventions ; nombre de sites ; nombre d'anomalies/preuves
// liées ; documents rattachés ; contrats liés si disponible.
//
// Pas de score, pas de prédiction, pas de jugement. »
//
// Approche : `tenders.client_name` est un text libre (pas de FK). On
// match les contrats par `contracts.client_name = tender.client_name`
// (case-insensitive), puis on remonte sites → interventions → artefacts.

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'

export interface TenderClientCapital {
  /** Nom du client tel qu'il apparaît sur l'AO. Null si non renseigné. */
  clientName: string | null
  /** Contrats actifs ou passés trouvés avec ce client_name. */
  contractsCount: number
  /** Sites uniques rattachés à ces contrats. */
  sitesCount: number
  /** Interventions documentées (status completed/validated) sur ces sites. */
  interventionsDocumentedCount: number
  /** Anomalies signalées sur ces sites. */
  anomaliesCount: number
  /** Photos déposées sur ces interventions. */
  photosCount: number
  /** Documents rattachés à un site/contrat de ce client (document_links). */
  documentsCount: number
  /** Liste compacte des noms de contrats (max 5) pour affichage rapide. */
  contractNamesSample: string[]
}

const EMPTY: TenderClientCapital = {
  clientName: null,
  contractsCount: 0,
  sitesCount: 0,
  interventionsDocumentedCount: 0,
  anomaliesCount: 0,
  photosCount: 0,
  documentsCount: 0,
  contractNamesSample: [],
}

/**
 * Calcule le capital client opérationnel pour un AO.
 *
 * - Match contrats par `contracts.client_name = tender.client_name` (insensitive).
 * - Tous les compteurs sont des FAITS — aucun score, aucune moyenne.
 * - Silencieux si client_name non renseigné OU aucun match.
 */
export async function getTenderClientCapital(
  clientName: string | null,
): Promise<TenderClientCapital> {
  if (!clientName || clientName.trim() === '') return EMPTY
  const admin = createAdminClient()
  const orgId = await getOrgId()

  // 1) Contrats avec ce client_name (case-insensitive via ilike)
  let qContracts = admin
    .from('contracts')
    .select('id, name')
    .ilike('client_name', clientName.trim())
    .is('deleted_at', null)
  if (orgId) qContracts = qContracts.eq('organization_id', orgId)
  const { data: contracts, error: cErr } = await qContracts
  if (cErr) throw cErr
  const contractRows = (contracts ?? []) as Array<{ id: string; name: string }>
  if (contractRows.length === 0) {
    return { ...EMPTY, clientName }
  }
  const contractIds = contractRows.map((c) => c.id)

  // 2) Sites rattachés à ces contrats
  const { data: sites } = await admin
    .from('sites')
    .select('id')
    .in('contract_id', contractIds)
    .is('deleted_at', null)
  const siteIds = (sites ?? []).map((s) => (s as { id: string }).id)
  const sitesCount = siteIds.length

  if (siteIds.length === 0) {
    return {
      ...EMPTY,
      clientName,
      contractsCount: contractRows.length,
      contractNamesSample: contractRows.slice(0, 5).map((c) => c.name),
    }
  }

  // 3) Missions de ces sites
  const { data: missions } = await admin
    .from('missions')
    .select('id')
    .in('site_id', siteIds)
    .is('deleted_at', null)
  const missionIds = (missions ?? []).map((m) => (m as { id: string }).id)

  let interventionIds: string[] = []
  let interventionsDocumentedCount = 0
  if (missionIds.length > 0) {
    const { data: interventions, count: docCount } = await admin
      .from('interventions')
      .select('id', { count: 'exact' })
      .in('mission_id', missionIds)
      .in('status', ['completed', 'validated'])
    interventionIds = (interventions ?? []).map((i) => (i as { id: string }).id)
    interventionsDocumentedCount = docCount ?? 0
  }

  // 4) Anomalies + photos en parallèle (filtre par interventionIds)
  let anomaliesCount = 0
  let photosCount = 0
  if (interventionIds.length > 0) {
    const [anomaliesRes, photosRes] = await Promise.all([
      admin
        .from('intervention_anomalies')
        .select('id', { count: 'exact', head: true })
        .in('intervention_id', interventionIds),
      admin
        .from('intervention_photos')
        .select('id', { count: 'exact', head: true })
        .in('intervention_id', interventionIds),
    ])
    anomaliesCount = anomaliesRes.count ?? 0
    photosCount = photosRes.count ?? 0
  }

  // 5) Documents rattachés (document_links sur site ou contrat de ce client)
  const [docsSiteRes, docsContractRes] = await Promise.all([
    siteIds.length > 0
      ? admin
          .from('document_links')
          .select('document_id', { count: 'exact', head: true })
          .eq('target_type', 'site')
          .in('target_id', siteIds)
      : Promise.resolve({ count: 0 }),
    admin
      .from('document_links')
      .select('document_id', { count: 'exact', head: true })
      .eq('target_type', 'contract')
      .in('target_id', contractIds),
  ])
  const documentsCount = (docsSiteRes.count ?? 0) + (docsContractRes.count ?? 0)

  return {
    clientName,
    contractsCount: contractRows.length,
    sitesCount,
    interventionsDocumentedCount,
    anomaliesCount,
    photosCount,
    documentsCount,
    contractNamesSample: contractRows.slice(0, 5).map((c) => c.name),
  }
}
