'use server'

// Log léger des visites de page — feedback PRODUIT (quels menus servent /
// sont morts), pas surveillance RH. Vincent 2026-05-25.
//
// Niveau FEATURE : on stocke la route, pas une note sur la personne.
// Réutilise activity_logs (entity_type='page') — aucune migration.

import { createClient as createServerClient } from '@/lib/supabase/server'
import { insertActivityLog } from '@/lib/db/activity-logs'

export async function logPageViewAction(route: string): Promise<void> {
  // Route interne uniquement (pas d'URL externe, pas de query string).
  if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//')) return
  const clean = route.split('?')[0]!.slice(0, 120)
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await insertActivityLog({
      userId: user.id,
      entityType: 'page',
      entityId: null,
      action: 'view',
      metadata: { route: clean },
    })
  } catch {
    // best-effort : un échec de log ne doit jamais gêner la navigation.
  }
}
