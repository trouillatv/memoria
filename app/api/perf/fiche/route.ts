import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import { getSiteDecisionFiche } from '@/lib/knowledge/decision-fiche'

export const dynamic = 'force-dynamic'

// ── SONDE TEMPORAIRE — enquête performance du 2026-07-20 ─────────────────────
// Elle attribue les ~2 s du rendu d'une fiche à des étapes nommées. Elle ne
// change aucun comportement et n'est appelée par aucune page.
//
// À SUPPRIMER dès que la correction est mesurée. Si elle traîne encore dans le
// dépôt, c'est que l'enquête est devenue un projet — exactement ce qu'on veut
// éviter.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const siteId = url.searchParams.get('site')
  const decisionId = url.searchParams.get('decision')
  if (!siteId || !decisionId) {
    return NextResponse.json({ erreur: 'site et decision requis' }, { status: 400 })
  }

  const etapes: Record<string, number> = {}
  const chrono = async <T>(nom: string, fn: () => Promise<T>): Promise<T> => {
    const t = performance.now()
    const r = await fn()
    etapes[nom] = Math.round(performance.now() - t)
    return r
  }

  const debut = performance.now()

  const supabase = await chrono('1_creation_client', async () => createServerClient())
  const auth = await chrono('2_auth_getUser', () => supabase.auth.getUser())
  if (!auth.data.user) return NextResponse.json({ erreur: 'non authentifié' }, { status: 401 })

  await chrono('3_profil_users', async () =>
    supabase.from('users').select('id, organization_id, role').eq('id', auth.data.user!.id).single(),
  )

  // Un aller-retour nu, pour connaître le coût plancher d'une requête.
  const db = createAdminClient()
  await chrono('4_requete_temoin', async () =>
    db.from('sites').select('id').eq('id', siteId).maybeSingle(),
  )

  // Cinq fois la MÊME requête triviale, en série. C'est la mesure qui décide :
  // si seule la première coûte cher, on paie une mise en relation (connexion,
  // TLS) et la correction est le partage de connexion ; si les cinq coûtent
  // pareil, c'est une latence payée à chaque appel et la correction est de
  // réduire le NOMBRE d'allers-retours.
  const serie: number[] = []
  for (let i = 0; i < 5; i++) {
    const t = performance.now()
    await db.from('sites').select('id').eq('id', siteId).maybeSingle()
    serie.push(Math.round(performance.now() - t))
  }
  etapes['4b_serie_identique'] = serie.reduce((a, b) => a + b, 0)

  // Les mêmes cinq requêtes, mais SIMULTANÉES : révèle si le coût est
  // parallélisable ou s'il y a une file d'attente.
  const tPar = performance.now()
  await Promise.all(
    Array.from({ length: 5 }, () => db.from('sites').select('id').eq('id', siteId).maybeSingle()),
  )
  etapes['4c_cinq_en_parallele'] = Math.round(performance.now() - tPar)

  // Le read model complet, tel que la route de la fiche l'appelle.
  const fiche = await chrono('5_read_model_complet', () => getSiteDecisionFiche(siteId, decisionId))

  const orgOk = (await getOrgId()) !== null

  return NextResponse.json({
    total: Math.round(performance.now() - debut),
    etapes,
    ficheTrouvee: !!fiche,
    orgOk,
    detailSerie: serie,
  })
}
