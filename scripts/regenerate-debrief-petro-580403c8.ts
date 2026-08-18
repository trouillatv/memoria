// Étape 5 du lot STT (Vincent, 2026-08-18) : régénère le débrief de la visite
// PETRO du 17/08 (report 580403c8) maintenant que 6487ff04 est réparé
// (normalisation lexicale + garde anti-répétition). `runCapturePipeline`
// (transcription) et `loadOrRunVisitDebrief` (synthèse) sont deux étapes
// distinctes non chaînées automatiquement — la transcription réparée ne
// régénère pas seule le débrief déjà en cache.
import { config } from 'dotenv'
config({ path: '.env.local' })
import { loadOrRunVisitDebrief } from '../lib/visits/debrief-analysis'

const REPORT_ID = '580403c8-8a48-489f-a40f-6adef8e2c361'

async function main() {
  const result = await loadOrRunVisitDebrief(REPORT_ID, null, { force: true })
  if (!result.ok) {
    console.error('[KO]', result.error)
    process.exit(1)
  }
  if (result.status === 'generating') {
    console.error('[KO] une autre génération est déjà en cours')
    process.exit(1)
  }
  console.log('[OK] statut:', result.status)
  console.log('résumé:', result.loaded.analysis.summary ?? '(absent)')
  console.log('sujets ouverts:', result.loaded.openSubjects.map((s) => s.name))
}
main().catch((e) => { console.error(e); process.exit(1) })
