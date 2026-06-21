// lib/db/site-export.ts
//
// S2 — Export « propriété des données » (Vincent 2026-06-21). Répond à la peur
// de Guillaume « que se passe-t-il si MemorIA disparaît ». On rassemble TOUTE la
// donnée d'un chantier (réunions, actions, réserves, obligations, sujets,
// décisions) + les binaires (photos, documents) pour un ZIP exportable.
//
// Doctrine : un document `litige` n'est JAMAIS exposé automatiquement → exclu de
// l'export en masse (téléchargeable individuellement par ailleurs).

import { createAdminClient } from '@/lib/supabase/admin'
import { listReportsBySite } from './site-reports'
import { listSiteActionsBySite } from './site-actions'
import { getSiteReserves } from './site-reserve'
import { getSiteObligations } from './obligations'
import { listSubjectsBySite } from './subjects'
import { listDecisionsBySite } from './site-decisions'
import { listSitePhotos } from './site-photos'
import { listDocumentsForTarget } from './documents'
import type { DbSiteReport } from '@/types/db'

export interface SiteExportBinary {
  /** Chemin storage (bucket donné séparément). */
  path: string
  /** Nom de fichier proposé dans le ZIP. */
  name: string
  /** Légende / libellé (pour la feuille d'index). */
  caption: string
}

export interface SiteExportData {
  site: { id: string; name: string; address: string | null; organizationId: string | null }
  reports: DbSiteReport[]
  actions: Awaited<ReturnType<typeof listSiteActionsBySite>>
  reserves: Awaited<ReturnType<typeof getSiteReserves>>
  obligations: Awaited<ReturnType<typeof getSiteObligations>>
  subjects: Awaited<ReturnType<typeof listSubjectsBySite>>
  decisions: Awaited<ReturnType<typeof listDecisionsBySite>>
  /** Photos (bucket intervention-photos). */
  photos: SiteExportBinary[]
  /** Documents (bucket documents), hors litige. */
  documents: SiteExportBinary[]
}

function extOf(path: string, fallback: string): string {
  const raw = (path.split('.').pop() ?? '').toLowerCase().slice(0, 5)
  return /^[a-z0-9]+$/.test(raw) ? raw : fallback
}

function safeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9-_. ]/g, '_').slice(0, 80).trim() || 'sans-nom'
}

export async function gatherSiteExport(siteId: string): Promise<SiteExportData | null> {
  const supabase = createAdminClient()
  const { data: siteRow } = await supabase
    .from('sites')
    .select('id, name, address, organization_id')
    .eq('id', siteId)
    .maybeSingle()
  const site = siteRow as { id: string; name: string; address: string | null; organization_id: string | null } | null
  if (!site) return null

  const [reports, actions, reserves, obligations, subjects, decisions, sitePhotos, docs] = await Promise.all([
    listReportsBySite(siteId),
    listSiteActionsBySite(siteId),
    getSiteReserves(siteId),
    getSiteObligations(siteId),
    listSubjectsBySite(siteId),
    listDecisionsBySite(siteId),
    listSitePhotos(siteId),
    listDocumentsForTarget('site', siteId),
  ])

  const photos: SiteExportBinary[] = sitePhotos.map((p, i) => ({
    path: p.storagePath,
    name: `${String(i + 1).padStart(3, '0')}-${p.source}.${extOf(p.storagePath, 'jpg')}`,
    caption: p.legende,
  }))

  // Doctrine : litige exclu de l'export en masse.
  const documents: SiteExportBinary[] = docs
    .filter((d) => d.document_type !== 'litige')
    .map((d) => ({
      path: d.storage_path,
      name: safeName(d.filename || `${d.document_type}.${extOf(d.storage_path, 'pdf')}`),
      caption: d.document_type,
    }))

  return {
    site: { id: site.id, name: site.name, address: site.address, organizationId: site.organization_id },
    reports,
    actions,
    reserves,
    obligations,
    subjects,
    decisions,
    photos,
    documents,
  }
}
