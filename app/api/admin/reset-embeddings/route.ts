// Route admin : RESET CONTRÔLÉ de l'espace vectoriel.
//
// Pourquoi cette route existe :
//   Le modèle d'embedding a changé (gemini-embedding-2 invalide →
//   text-embedding-004). Deux modèles = deux espaces vectoriels. Les vecteurs
//   produits par l'ancien modèle NE DOIVENT PAS cohabiter avec les nouveaux :
//   les similarités cosinus inter-modèles sont du bruit. Quand on change de
//   modèle, on repart proprement → purge totale puis backfill.
//
// Usage (admin uniquement, APRÈS déploiement du nouveau modèle + clé en prod) :
//   POST /api/admin/reset-embeddings
//   Header: x-internal-trigger: <INTERNAL_ANALYZE_SECRET>
//   Body:   { "confirm": "PURGE" }
//
// Séquence complète (runbook) :
//   1. Merge + deploy de la PR (nouveau modèle).
//   2. Vérifier GOOGLE_GENAI_API_KEY présente en Production Vercel.
//   3. POST /api/admin/reset-embeddings  → purge les 3 tables.
//   4. POST /api/admin/embed-backfill (en boucle, batch 50) → re-embedde.
//
// Garde-fous :
//   - secret obligatoire (même que embed-backfill) ;
//   - confirm:"PURGE" obligatoire (action destructive, jamais accidentelle) ;
//   - REFUSE si aucun provider embeddings configuré : on ne purge JAMAIS dans
//     le vide (sinon perte sèche, plus rien pour reconstruire).

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActiveProvider } from '@/lib/ai/embeddings'

const TABLES = [
  'trace_embeddings',
  'knowledge_chunks',
  'site_reading_candidates',
] as const

export async function POST(req: Request) {
  const expected = process.env.INTERNAL_ANALYZE_SECRET
  const got = req.headers.get('x-internal-trigger')
  if (!expected || got !== expected) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { confirm?: string } = {}
  try {
    body = (await req.json()) as { confirm?: string }
  } catch {
    /* corps vide → confirm manquant, géré ci-dessous */
  }
  if (body.confirm !== 'PURGE') {
    return NextResponse.json(
      { error: 'Confirmation requise : body { "confirm": "PURGE" }.' },
      { status: 400 },
    )
  }

  // Ne JAMAIS purger si on ne pourra pas reconstruire derrière.
  const provider = getActiveProvider()
  if (provider === null) {
    return NextResponse.json(
      {
        error:
          'Aucun provider embeddings configuré (GOOGLE_GENAI_API_KEY / OPENAI_API_KEY / VOYAGE_API_KEY). ' +
          'Purge refusée : on ne repart pas dans le vide.',
      },
      { status: 400 },
    )
  }

  const supabase = createAdminClient()
  const purged: Record<string, number> = {}
  const errors: string[] = []

  for (const table of TABLES) {
    const { count: before } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
    // id est PK uuid sur les 3 tables → filtre « toujours vrai » = delete all.
    const { error } = await supabase.from(table).delete().not('id', 'is', null)
    if (error) {
      errors.push(`${table}: ${error.message}`)
      purged[table] = -1
    } else {
      purged[table] = before ?? 0
    }
  }

  const ok = errors.length === 0
  return NextResponse.json(
    {
      ok,
      provider,
      purged,
      errors,
      next: ok
        ? 'Espace vectoriel vidé. Lancer maintenant POST /api/admin/embed-backfill (en boucle, batch 50) pour re-embedder avec le nouveau modèle.'
        : 'Purge partielle — voir errors. Ne PAS lancer le backfill tant que la purge n’est pas complète (risque de mélange ancien/nouveau modèle).',
    },
    { status: ok ? 200 : 500 },
  )
}
