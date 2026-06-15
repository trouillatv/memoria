'use server'

// Log léger des visites de page — feedback PRODUIT (quels menus servent /
// sont morts), pas surveillance RH. Vincent 2026-05-25.
//
// Niveau FEATURE : on stocke la route, pas une note sur la personne.
// Réutilise activity_logs (entity_type='page') — aucune migration.

import { headers } from 'next/headers'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { insertActivityLog } from '@/lib/db/activity-logs'
import { classifyDevice } from '@/lib/navigation/device'

export async function logPageViewAction(route: string): Promise<void> {
  // Route interne uniquement (pas d'URL externe, pas de query string).
  if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//')) return
  const clean = route.split('?')[0]!.slice(0, 120)
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    // Catégorie d'appareil (ios/android/desktop) — alimente le graphe d'usage
    // terrain/bureau de l'admin. On ne stocke que la catégorie, pas le UA brut.
    const ua = (await headers()).get('user-agent')
    await insertActivityLog({
      userId: user.id,
      entityType: 'page',
      entityId: null,
      action: 'view',
      metadata: { route: clean, device: classifyDevice(ua) },
    })
  } catch {
    // best-effort : un échec de log ne doit jamais gêner la navigation.
  }
}
