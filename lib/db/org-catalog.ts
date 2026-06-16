import 'server-only'

// Lecture du catalogue de vocabulaire par organisation, AVEC FALLBACK sur le
// template du métier de l'org tant que le catalogue n'est pas seedé. Garantit
// zéro changement de comportement pour l'existant (orgs 'cleaning' → libellés
// historiques) et l'adaptation métier pour les nouvelles.
//
// Sprint 2-B = la fondation : ces lecteurs existent ; le câblage des écrans
// (anomalies, spécialités) sur ces lecteurs se fait progressivement ensuite.

import { createAdminClient } from '@/lib/supabase/admin'
import {
  INDUSTRY_TEMPLATES,
  isIndustryTemplate,
  type CatalogKind,
  type IndustryTemplate,
} from '@/lib/catalog/industry-templates'

export interface CatalogItem {
  key: string
  label: string
  icon: string | null
  color: string | null
  sortOrder: number
  metadata: Record<string, unknown>
}

/** Métier déclaré de l'organisation (défaut 'generic' si absent/inconnu/null). */
export async function getOrgIndustryTemplate(orgId: string | null): Promise<IndustryTemplate> {
  if (!orgId) return 'generic'
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('organizations')
    .select('industry_template')
    .eq('id', orgId)
    .maybeSingle()
  const t = (data as { industry_template?: string } | null)?.industry_template
  return isIndustryTemplate(t) ? t : 'generic'
}

function fallbackItems(template: IndustryTemplate, kind: CatalogKind): CatalogItem[] {
  const entries = INDUSTRY_TEMPLATES[template]?.[kind] ?? INDUSTRY_TEMPLATES.generic[kind] ?? []
  return entries.map((e, i) => ({
    key: e.key,
    label: e.label,
    icon: e.icon ?? null,
    color: e.color ?? null,
    sortOrder: i,
    metadata: e.metadata ?? {},
  }))
}

/** Entrées de catalogue d'un kind pour une org. Catalogue d'abord, sinon le
 *  template du métier de l'org (fallback non destructif). */
export async function listOrgCatalog(orgId: string | null, kind: CatalogKind): Promise<CatalogItem[]> {
  if (orgId) {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('org_catalog')
      .select('key, label, icon, color, sort_order, metadata')
      .eq('organization_id', orgId)
      .eq('kind', kind)
      .eq('active', true)
      .order('sort_order', { ascending: true })

    const rows = (data ?? []) as Array<{
      key: string; label: string; icon: string | null; color: string | null
      sort_order: number; metadata: Record<string, unknown> | null
    }>

    if (rows.length > 0) {
      return rows.map((r) => ({
        key: r.key, label: r.label, icon: r.icon, color: r.color,
        sortOrder: r.sort_order, metadata: r.metadata ?? {},
      }))
    }
  }
  return fallbackItems(await getOrgIndustryTemplate(orgId), kind)
}

/** Libellé affichable d'une clé (fallback = la clé brute si introuvable). */
export async function getCatalogLabel(orgId: string, kind: CatalogKind, key: string): Promise<string> {
  const items = await listOrgCatalog(orgId, kind)
  return items.find((i) => i.key === key)?.label ?? key
}

/** Seed idempotent : copie le template d'un métier dans le catalogue de l'org.
 *  N'écrase rien (ignoreDuplicates). Appelé plus tard à l'onboarding / admin. */
export async function seedOrgCatalog(orgId: string, template: IndustryTemplate): Promise<void> {
  const supabase = createAdminClient()
  const byKind = INDUSTRY_TEMPLATES[template] ?? {}
  const rows: Array<Record<string, unknown>> = []
  for (const [kind, entries] of Object.entries(byKind)) {
    entries.forEach((e, i) => {
      rows.push({
        organization_id: orgId,
        kind,
        key: e.key,
        label: e.label,
        icon: e.icon ?? null,
        color: e.color ?? null,
        sort_order: i,
        metadata: e.metadata ?? {},
      })
    })
  }
  if (rows.length === 0) return
  await supabase
    .from('org_catalog')
    .upsert(rows, { onConflict: 'organization_id,kind,key', ignoreDuplicates: true })
}
