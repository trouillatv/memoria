import 'server-only'

// Identité d'en-tête du chantier (nom) — lecture STABLE dédupliquée par requête
// via React `cache()`. C'est le seul candidat au cache : une donnée d'affichage
// stable, jamais une autorisation. `cache()` ne survit pas à la requête (aucun
// cache durable). Le layout (chantier) et les pages la partagent sans double
// lecture de la base.

import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'

export const getSiteHeaderName = cache(async (siteId: string): Promise<string> => {
  const { data } = await createAdminClient()
    .from('sites')
    .select('name')
    .eq('id', siteId)
    .is('deleted_at', null)
    .maybeSingle()
  return (data as { name: string } | null)?.name ?? 'Chantier'
})
