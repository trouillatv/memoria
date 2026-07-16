/**
 * Pose une visite terminée sur le chantier de recette, avec un débrief dicté.
 *
 * On sème la MATIÈRE (le texte du débrief), pas le résultat : l'analyse sera faite
 * par le vrai pipeline à l'ouverture du compte-rendu. Semer une analyse toute faite
 * validerait un chemin que personne n'emprunte — et la recette ne prouverait rien.
 *
 * IDEMPOTENT : ne crée rien si une visite existe déjà sur le bac à sable.
 *
 *   npx tsx scripts/dev/seed-sandbox-visit.ts [slug-organisation]
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

// Un débrief plausible de conducteur : des actions à faire, des dates floues, des
// intervenants nommés, du contexte. De quoi exercer TOUS les objets du contrat.
const DEBRIEF = `Visite de contrôle ce matin sur le chantier de recette avec Paul Vernier de l'entreprise Sotrap.
Le local technique est toujours encombré, il faut que Sotrap évacue les gravats avant la fin de la semaine.
J'ai demandé à Paul de m'envoyer l'attestation de conformité électrique, il dit qu'il l'aura d'ici une dizaine de jours.
Attention, l'accès au sous-sol se fait uniquement par la rampe côté nord, le portail est condamné depuis les travaux.
Le carrelage du hall est livré mais stocké dehors sous bâche, ça m'inquiète s'il pleut cette semaine.
Il faut que je prévienne le bureau d'études que la réservation pour la gaine n'est pas au bon endroit.
La réception des travaux est calée pour la fin du mois prochain.`

async function main() {
  const orgSlug = process.argv[2] ?? 'agp'
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: org } = await db.from('organizations').select('id, name').eq('slug', orgSlug).maybeSingle()
  if (!org) throw new Error(`Organisation « ${orgSlug} » introuvable`)

  const { data: site } = await db
    .from('sites')
    .select('id, name, tenant_id')
    .eq('organization_id', org.id)
    .eq('is_sandbox', true)
    .is('deleted_at', null)
    .maybeSingle()
  if (!site) throw new Error('Aucun chantier de recette — lance ensure-sandbox-site.ts d\'abord')

  const { count } = await db
    .from('site_reports')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', site.id)
    .is('deleted_at', null)
  if ((count ?? 0) > 0) {
    console.log(`✓ Le chantier de recette a déjà ${count} visite(s) — rien à faire.`)
    return
  }

  const { data: manager } = await db
    .from('users').select('id').eq('organization_id', org.id).eq('role', 'manager').limit(1).maybeSingle()

  // Une visite d'une demi-heure, terminée : le débrief est prêt à être analysé.
  const startedAt = new Date(Date.now() - 45 * 60_000).toISOString()
  const endedAt = new Date(Date.now() - 15 * 60_000).toISOString()

  const { data: report, error } = await db
    .from('site_reports')
    .insert({
      type: 'site',
      site_id: site.id,
      organization_id: org.id,
      tenant_id: site.tenant_id ?? null,
      created_by: manager?.id ?? null,
      status: 'draft',
      origin: 'spontaneous',
      visit_motive: 'avancement',
      objective: 'Contrôler l\'avancement et lever les points en attente',
      started_at: startedAt,
      ended_at: endedAt,
      text_input: DEBRIEF,
      transcript_status: 'none',
    })
    .select('id')
    .single()
  if (error) throw error

  await db.from('report_sites').insert({ report_id: report.id, site_id: site.id }).then(() => {}, () => {})

  console.log(`✓ Visite de recette créée sur « ${site.name} » : ${report.id}`)
  console.log(`  Compte-rendu : /m/visite/${report.id}/cr`)
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1) })
