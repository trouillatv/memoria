/**
 * Chantier de recette — le terrain de validation PERMANENT d'une organisation.
 *
 * Pourquoi un script et pas un clic dans l'app : le bac à sable doit exister à
 * l'identique pour tout le monde, être recréable après un reset de base, et porter
 * `is_sandbox = true` — un droit qu'aucun formulaire n'expose (et ne doit exposer).
 *
 * IDEMPOTENT : relancer ne crée pas de doublon, ne touche à aucune donnée.
 *
 *   npx tsx scripts/dev/ensure-sandbox-site.ts [slug-organisation]
 *   (défaut : agp)
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const SANDBOX_NAME = '🧪 Recette'

async function main() {
  const orgSlug = process.argv[2] ?? 'agp'
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants')
  const db = createClient(url, key)

  const { data: org } = await db.from('organizations').select('id, name').eq('slug', orgSlug).maybeSingle()
  if (!org) throw new Error(`Organisation « ${orgSlug} » introuvable`)

  const { data: existing } = await db
    .from('sites')
    .select('id, name, is_sandbox')
    .eq('organization_id', org.id)
    .eq('is_sandbox', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (existing) {
    console.log(`✓ Chantier de recette déjà présent chez ${org.name} : ${existing.name} (${existing.id})`)
    return
  }

  // Sans client : un bac à sable n'appartient à personne (mig 210 l'autorise).
  const { data: created, error } = await db
    .from('sites')
    .insert({
      organization_id: org.id,
      name: SANDBOX_NAME,
      client_id: null,
      contract_id: null,
      address: null,
      notes: "Terrain de validation. Tout y est jetable : le bouton « Réinitialiser le chantier » efface visites, actions, propositions et réserves. Ne jamais y mettre de donnée réelle.",
      phase: 'actif',
      is_sandbox: true,
    })
    .select('id')
    .single()
  if (error) throw error

  console.log(`✓ Chantier de recette créé chez ${org.name} : ${SANDBOX_NAME} (${created.id})`)
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1) })
