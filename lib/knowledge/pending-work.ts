import 'server-only'

// ── LE TRAVAIL QUI ATTEND UN GESTE HUMAIN ────────────────────────────────────
// « Les propositions doivent apparaître dans Travail, mais dans une zone
// distincte de l'exécution. » (Vincent, 2026-07-17)
//
// Une proposition EST du travail : quelqu'un doit la lire et trancher. La cacher
// laisse le conducteur croire qu'il n'a rien à faire pendant que dix faits
// attendent. Mais elle n'est pas EXÉCUTABLE : personne ne s'est engagé.
//
// ── LE CRITÈRE DE SÉCURITÉ, non négociable ─────────────────────────────────
// Une proposition ne doit JAMAIS : compter comme action ouverte, alimenter un
// indicateur de production réalisée, apparaître comme engagement confirmé,
// entrer dans le planning d'exécution, ni être exportée comme fait validé.
//
// Ce read model ne renvoie donc QUE des éléments à confirmer. Il ne se mélange
// pas aux actions ouvertes — c'est l'écran qui les met côte à côte, dans deux
// blocs, avec deux mots différents : « à confirmer » n'est pas « ouvert ».

import { getOrgId } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import { unwrap } from '@/lib/knowledge/read-guard'
import { getPromotionCapability, type PromotionCapability } from '@/lib/db/knowledge-proposals'
import { echeanceLine } from '@/lib/visits/echeance-labels'

/** Un fait qui attend une décision. Il ne porte AUCUN attribut d'exécution :
 *  ni assignation, ni statut, ni « terminé ». Ils n'existeront qu'après. */
export interface PendingItem {
  /** L'id de la PROPOSITION — le seul geste possible est de la promouvoir. */
  proposalId: string
  kind: string
  siteId: string
  siteName: string
  title: string
  detail: string | null
  owner: string | null
  /** La visite qui l'a fait apparaître — pour remonter à la preuve. */
  reportId: string | null
  capability: PromotionCapability
}

export interface PendingWork {
  /** Ce qui deviendra une action si un humain le décide. */
  actions: PendingItem[]
  /** Ce qui deviendra une échéance si un humain le décide. */
  deadlines: PendingItem[]
}

const EMPTY: PendingWork = { actions: [], deadlines: [] }

/**
 * Ce qui attend un geste — actions et échéances PROPOSÉES.
 *
 * Volontairement limité à ces deux types : ce sont ceux dont la suite est du
 * travail. Une connaissance ou un intervenant à confirmer relèvent de la
 * Mémoire, pas de Travail — les y mettre ferait de cet écran le fourre-tout de
 * tout ce qui traîne.
 */
export async function getPendingWork(opts: { siteIds?: string[] } = {}): Promise<PendingWork> {
  const orgId = await getOrgId()
  const db = createAdminClient()

  let q = db
    .from('site_knowledge_proposals')
    .select('id, kind, site_id, title, body, payload, report_id, organization_id')
    .eq('status', 'proposed')
    .in('kind', ['action', 'deadline'])
    .order('created_at', { ascending: true })
  // Garde fail-closed : le service-role bypasse la RLS, l'org se filtre ici.
  if (orgId) q = q.eq('organization_id', orgId)
  if (opts.siteIds?.length) q = q.in('site_id', opts.siteIds)

  const rows = unwrap<{
    id: string; kind: string; site_id: string; title: string; body: string | null
    payload: Record<string, unknown>; report_id: string | null
  }>('site_knowledge_proposals', 'getPendingWork', await q)
  if (rows.length === 0) return { ...EMPTY }

  const { data: sites } = await db
    .from('sites')
    .select('id, name')
    .in('id', [...new Set(rows.map((r) => r.site_id))])
  const nameOf = new Map(((sites ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]))

  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

  const item = (r: (typeof rows)[number]): PendingItem => ({
    proposalId: r.id,
    kind: r.kind,
    siteId: r.site_id,
    siteName: nameOf.get(r.site_id) ?? '—',
    // Une échéance dit CE QUI doit arriver et QUAND on le sait — mis en forme
    // ici, une seule fois, comme partout ailleurs.
    title: r.kind === 'deadline'
      ? echeanceLine({
          label: r.title,
          date: String(r.payload?.date ?? ''),
          constraint: String(r.payload?.constraint ?? ''),
        })
      : r.title,
    detail: r.body,
    owner: str(r.payload?.owner),
    reportId: r.report_id,
    capability: getPromotionCapability(r.kind),
  })

  return {
    actions: rows.filter((r) => r.kind === 'action').map(item),
    deadlines: rows.filter((r) => r.kind === 'deadline').map(item),
  }
}
