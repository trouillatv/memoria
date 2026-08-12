// Dry-run du moteur de relations terrain sur le chantier PETRO.
//
// Attendu (audit P0-A) :
//   - "Lancement dépose → enables → Nettoyage isothermes" (conf ≥ 0.70)
//   - "Vérification électrique → validates → Absence courant TD" (conf ≥ 0.70)
//
// Critère GO/NO-GO P0-B1 :
//   - Précision >> rappel : 2 vraies relations explicables > 7 relations dont 3 discutables
//   - Audit humain sur chaque relation générée avant toute UI Explorer

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { produceRelationsFromOccurrences } from '../lib/ai/produce-relations-from-occurrences'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!

const PETRO_SITE_NAME = 'PETRO'   // filtre sur le nom du chantier

async function main() {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  })

  // Trouver le site PETRO
  const { data: sites } = await admin
    .from('sites')
    .select('id, name')
    .ilike('name', `%${PETRO_SITE_NAME}%`)

  if (!sites || sites.length === 0) {
    console.error(`Aucun chantier contenant "${PETRO_SITE_NAME}" trouvé.`)
    process.exit(1)
  }

  const site = sites[0]
  console.log(`Chantier : ${site.name} (${site.id})`)

  // Aperçu des occurrences disponibles
  const { data: occurrences, count } = await admin
    .from('canonical_subject_occurrence')
    .select('canonical_subject_id, source_kind, effective_date', { count: 'exact' })
    .eq('site_id', site.id)
    .in('source_kind', ['field_visit', 'meeting'])

  console.log(`\nOccurrences terrain disponibles : ${count ?? 0}`)

  if (!occurrences || occurrences.length === 0) {
    console.error('Aucune occurrence terrain — le moteur ne peut rien produire.')
    console.error('Vérifier que les visites de PETRO ont bien été réconciliées (mig 300/301).')
    process.exit(1)
  }

  const visitIds = new Set(occurrences.map(o => o.source_ref_id as string))
  const csIds    = new Set(occurrences.map(o => o.canonical_subject_id as string))
  console.log(`  Visites/réunions distinctes : ${visitIds.size}`)
  console.log(`  Sujets canoniques impliqués  : ${csIds.size}`)

  // Dry-run
  console.log('\n─── DRY-RUN (aucune écriture) ───────────────────────────────')
  const result = await produceRelationsFromOccurrences({
    siteId: site.id,
    admin,
    dryRun: true,
  })

  console.log('\n─── RÉSULTAT ────────────────────────────────────────────────')
  console.log(`Candidats évalués     : ${result.candidatesEvaluated}`)
  console.log(`Same-subject détectés : ${result.sameSubjectDetected}`)
  console.log(`Pas de relation        : ${result.noRelation}`)
  console.log(`Relates-to rejeté     : ${result.relatesTo}  (whitelist P0-B1)`)
  console.log(`Directionnels qualifiés: ${result.directional}`)
  console.log(`Confiance insuffisante : ${result.skippedLowConf}`)
  console.log(`Sans preuve texte      : ${result.skippedNoEvidence}`)
  console.log(`Erreurs               : ${result.errors}`)
  console.log(`→ Relations à écrire  : ${result.written}`)

  if (result.written === 0) {
    console.log('\n⚠  Aucune relation générée.')
    console.log('Raisons probables :')
    console.log('  1. Trop peu de visites communes entre sujets (seuil : 3)')
    console.log('  2. Lift insuffisant (seuil : 1.5)')
    console.log('  3. Aucun extrait textuel disponible dans les occurrences')
    console.log('  4. Qualification Gemini → no_relation sur toutes les paires')
  }
}

main().catch(e => { console.error(e); process.exit(1) })
