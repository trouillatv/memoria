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

// Whitelist des paramètres de navigation UX capturés — jamais la query string
// entière (FIX_REQUIRED Thread C, GO Vincent 2026-09-22). Ce sont des identifiants
// de VUE (enum de quelques valeurs stables), jamais des identifiants d'OBJET
// (person/action/decision sur /sites/[id] restent hors de cette liste : ce sont
// des uuid, pas des vues — les stocker n'apporterait rien et risquerait de
// capturer un jour un paramètre technique sans intérêt).
const NAV_PARAM_WHITELIST = ['tab', 'plantab'] as const

// Filet de sécurité générique (pas de couplage à la liste des onglets d'un
// module précis) : une valeur de vue est un court token [a-z0-9-], jamais un
// uuid ni un texte libre.
function sanitizeNavParam(v: string | null | undefined): string | null {
  if (!v) return null
  const trimmed = v.slice(0, 40)
  return /^[a-z0-9-]+$/.test(trimmed) ? trimmed : null
}

export async function logPageViewAction(
  route: string,
  navParams?: Partial<Record<(typeof NAV_PARAM_WHITELIST)[number], string | null>>,
): Promise<void> {
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
    const metadata: Record<string, unknown> = { route: clean, device: classifyDevice(ua) }
    for (const key of NAV_PARAM_WHITELIST) {
      const v = sanitizeNavParam(navParams?.[key])
      if (v) metadata[key] = v
    }
    await insertActivityLog({
      userId: user.id,
      entityType: 'page',
      entityId: null,
      action: 'view',
      metadata,
    })
  } catch {
    // best-effort : un échec de log ne doit jamais gêner la navigation.
  }
}
