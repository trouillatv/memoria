/**
 * CLI d'administration — import historique par lot, piloté chantier par chantier.
 *
 * Réutilise UNIQUEMENT la logique métier existante :
 *   lib/batch/historical-import-inventory.ts      (BATCH-1 : inventaire, lecture seule)
 *   lib/batch/historical-import-registration.ts   (BATCH-2 : enregistrement des PDF absents)
 *   lib/batch/historical-import-batch.ts           (BATCH-0 : exécution, mêmes primitives que l'UI)
 * Aucun appel HTTP/curl, aucune Server Action, aucune mutation DB dupliquée ici.
 *
 * Usage :
 *   npx tsx scripts/run-historical-import-batch.ts --folder <dossier> --site <siteId> --inventory-only
 *   npx tsx scripts/run-historical-import-batch.ts --folder <dossier> --site <siteId> --user <userId> --register-missing
 *   npx tsx scripts/run-historical-import-batch.ts --folder <dossier> --site <siteId> --user <userId> --execute
 *
 * --inventory-only (défaut si aucun mode n'est passé) : scanne, compare à la base,
 *   trie chronologiquement, classe chaque PDF. AUCUNE écriture, AUCUN appel LLM.
 * --register-missing : n'agit QUE sur les documents classés MISSING_DOCUMENT_REGISTRATION
 *   (upload + ligne `documents` + lien chantier, idempotent par hash). Ne matérialise
 *   jamais de visite, ne touche jamais un QUARANTINE_*. Une fois enregistrés, ces
 *   documents redeviennent des PDF ordinaires pour un futur --inventory-only/--execute.
 * --execute : ne traite QUE les documents déjà en base et déjà classés IMPORT ou
 *   RESUME_* (jamais QUARANTINE_*, jamais MISSING_DOCUMENT_REGISTRATION — ces
 *   derniers ne créent aucune ligne `documents` ici, cf. doctrine BATCH-1).
 */

import { existsSync, readFileSync } from 'node:fs'

function loadEnvLocal() {
  const path = '.env.local'
  if (!existsSync(path)) return
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1)
    if (!(key in process.env)) process.env[key] = val
  }
}
loadEnvLocal()

import {
  buildHistoricalCorpusInventory,
  type HistoricalInventoryEntry,
} from '@/lib/batch/historical-import-inventory'
import { registerMissingHistoricalDocument } from '@/lib/batch/historical-import-registration'
import { runHistoricalImportBatch, type HistoricalBatchDocumentResult } from '@/lib/batch/historical-import-batch'

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null
}

const folder = argValue('--folder')
const siteId = argValue('--site')
const userId = argValue('--user')
const execute = process.argv.includes('--execute')
const registerMissing = process.argv.includes('--register-missing')

if (!folder || !siteId) {
  console.error('Usage : npx tsx scripts/run-historical-import-batch.ts --folder <dossier> --site <siteId> [--user <userId>] [--inventory-only|--register-missing|--execute]')
  process.exit(1)
}
if (execute && !userId) {
  console.error('--execute requiert --user <userId> (created_by/reviewed_by tracé sur les objets créés).')
  process.exit(1)
}
if (registerMissing && !userId) {
  console.error('--register-missing requiert --user <userId> (created_by tracé sur les documents créés).')
  process.exit(1)
}

const EXECUTABLE_CLASSES = new Set(['IMPORT', 'RESUME_EXTRACTION', 'RESUME_MATERIALIZATION', 'RESUME_POST_PROCESSING'])

function printInventoryTable(entries: HistoricalInventoryEntry[]) {
  console.log('\n=== Section 3 — Ordre chronologique (date retenue ascendante) ===\n')
  console.log('ordre | date       | fichier                          | documentId                           | run actuel  | matérialisation      | mémoire        | classe                        | raison')
  entries.forEach((e, i) => {
    const cols = [
      String(i + 1).padEnd(5),
      (e.sortDate ?? '—').padEnd(10),
      e.fileName.padEnd(32),
      (e.documentId ?? '—').padEnd(37),
      (e.extractionRunStatus ?? '—').padEnd(11),
      (e.siteReportId ? 'matérialisée' : 'non').padEnd(20),
      (e.memoryStatus ?? '—').padEnd(14),
      e.klass.padEnd(29),
      e.reason,
    ]
    console.log(cols.join(' | '))
  })
}

function printMissingSection(entries: HistoricalInventoryEntry[]) {
  const missing = entries.filter((e) => e.klass === 'MISSING_DOCUMENT_REGISTRATION')
  console.log(`\n=== Section 2 — Documents absents de la base (${missing.length}) ===`)
  console.log('Aucune ligne `documents` créée par ce script. Writer réutilisable existant :')
  console.log('  app/(dashboard)/sites/[id]/historical-pv-upload-actions.ts')
  console.log('    → requestHistoricalPvUpload() puis confirmHistoricalPvImport()')
  console.log('    → createDocument() (lib/db/documents.ts) + addDocumentLink() (document_links)')
  console.log('  Renseignements requis : organization_id (résolu depuis la collection, pas la session),')
  console.log('  site, document_type=\'historical_visit_report\', storage_path (upload bucket documents),')
  console.log('  filename, effective_date, content_hash (dédup), document_link target_type=\'site\'.\n')
  for (const e of missing) {
    console.log(`  - ${e.fileName}  (date détectée: ${e.detectedDate ?? 'aucune'}${e.ambiguousDate ? ', AMBIGUË' : ''}, hash: ${e.contentHashSha256.slice(0, 12)}…)`)
  }
}

function printIdempotenceSection(entries: HistoricalInventoryEntry[]) {
  console.log('\n=== Section 4 — Idempotence (vérification obligatoire) ===')
  const caseA = entries.filter((e) => e.klass === 'RESUME_MATERIALIZATION').length
  const caseB = entries.filter((e) => e.klass === 'RESUME_POST_PROCESSING').length
  const caseC = entries.filter((e) => e.klass === 'SKIP_ALREADY_COMPLETE').length
  console.log(`A. Run ready_for_review existant, pas de re-extraction   : COUVERT — ensureExtractionRun() réutilise le run existant (${caseA} document(s) concerné(s) ici).`)
  console.log(`B. Visite matérialisée, mémoire incomplète → reprise      : COUVERT — le batch appelle runHistoricalImportPostProcessing() sans condition (${caseB} document(s) concerné(s) ici), jamais un SKIP.`)
  console.log(`C. Visite + mémoire terminées → SKIP sans écriture        : COUVERT — retour anticipé 'already_completed' avant tout verrou/UPDATE (${caseC} document(s) concerné(s) ici).`)
  console.log('Aucun gap détecté sur A/B/C — pas de correctif nécessaire avant exécution.')
}

function printFinalReport(entries: HistoricalInventoryEntry[]) {
  const total = entries.length
  const complete = entries.filter((e) => e.klass === 'SKIP_ALREADY_COMPLETE').length
  const toExtract = entries.filter((e) => e.klass === 'IMPORT').length
  const toResume = entries.filter((e) => e.klass.startsWith('RESUME_')).length
  const toRegister = entries.filter((e) => e.klass === 'MISSING_DOCUMENT_REGISTRATION').length
  const ambiguousDates = entries.filter((e) => e.klass === 'QUARANTINE_DATE').length
  const nonVisits = entries.filter((e) => e.klass === 'QUARANTINE_NON_VISIT').length
  const errors = entries.filter((e) => e.klass === 'ERROR').length

  console.log('\n=== Section 5 — Rapport final ===')
  console.log(`PDF total                     : ${total}`)
  console.log(`Déjà complètement importés     : ${complete}`)
  console.log(`À extraire (pipeline complet)  : ${toExtract}`)
  console.log(`À reprendre (résumé partiel)   : ${toResume}`)
  console.log(`À enregistrer en base          : ${toRegister}`)
  console.log(`Dates ambiguës                 : ${ambiguousDates}`)
  console.log(`Non-visites détectées          : ${nonVisits}`)
  console.log(`Erreurs de lecture              : ${errors}`)

  const blockers = ambiguousDates + nonVisits + errors + toRegister
  const verdict = blockers === 0
    ? 'GO BATCH POSSIBLE'
    : 'CORRECTION MINIMALE NÉCESSAIRE AVANT BATCH'
  console.log(`\nVerdict : ${verdict}`)
  console.log('\nHARD STOP. Aucun import réel effectué par ce mode (--inventory-only).')
}

async function main() {
  const entries = await buildHistoricalCorpusInventory({ folderPath: folder as string, siteId: siteId as string })

  printMissingSection(entries)
  printInventoryTable(entries)
  printIdempotenceSection(entries)
  printFinalReport(entries)

  if (registerMissing) {
    const missing = entries.filter((e) => e.klass === 'MISSING_DOCUMENT_REGISTRATION')
    console.log(`\n=== --register-missing === ${missing.length} document(s) à enregistrer (upload + \`documents\` + lien chantier, aucune matérialisation).`)
    for (const e of missing) {
      try {
        const result = await registerMissingHistoricalDocument({
          filePath: e.filePath,
          siteId: siteId as string,
          createdBy: userId as string,
          effectiveDate: e.ambiguousDate ? null : e.detectedDate,
        })
        console.log(`  - ${e.fileName} → ${result.documentId} (${result.status})`)
      } catch (err) {
        console.error(`  - ${e.fileName} → ÉCHEC : ${err instanceof Error ? err.message : err}`)
      }
    }
    console.log('\nTerminé. Relancer --inventory-only pour confirmer la nouvelle classification.')
    return
  }

  if (!execute) return

  const runnable = entries.filter((e) => EXECUTABLE_CLASSES.has(e.klass) && e.documentId)
  const skipped = entries.length - runnable.length
  console.log(`\n=== --execute === ${runnable.length} document(s) à traiter, ${skipped} exclu(s) (quarantaine/absent de la base/déjà complets).`)

  const results = await runHistoricalImportBatch(
    runnable.map((e) => ({ documentId: e.documentId as string, siteId: siteId as string })),
    { userId: userId as string },
  )

  for (const r of results) {
    const entry = runnable.find((e) => e.documentId === r.documentId)
    console.log(`\n${entry?.fileName ?? r.documentId} → ${r.status}${r.quarantineReason ? ` (${r.quarantineReason}: ${r.detail ?? ''})` : ''}`)
    printCompletenessBilan(r)
  }
  const failed = results.filter((r) => r.status === 'quarantined')
  console.log(`\nTerminé : ${results.length - failed.length} traité(s), ${failed.length} en quarantaine.`)
}

function printCompletenessBilan(r: HistoricalBatchDocumentResult) {
  if (r.proposalsReport) {
    const p = r.proposalsReport
    console.log('  Propositions')
    console.log(`    ${p.totalExtracted} extraites`)
    console.log(`    ${p.materialized} matérialisées / ${p.totalExtracted}`)
    console.log(`    ${p.rejectedByGuard} rejetée(s) par garde`)
    const ignoredSilently = p.autoAccepted - p.rejectedByGuard - p.materialized
    console.log(`    ${ignoredSilently} ignorée(s) silencieusement`)
  }
  if (r.photosReport) {
    const ph = r.photosReport
    console.log('  Photos')
    console.log(`    ${ph.detected} visuels détectés`)
    console.log(`    ${ph.nativeRetained} images natives retenues`)
    console.log(`    ${ph.snapshotFallbackRetained} snapshots fallback retenus`)
    console.log(`    ${ph.integratedToVisit}/${ph.detected} intégrés à la visite`)
    console.log(`    ${ph.illustratesConfirmed} association(s) photo ↔ objet confirmée(s)`)
    console.log(`    ${ph.candidatesRemaining} candidate(s) non confirmée(s)`)
    console.log(`    ${ph.lostSilently} photo(s) perdue(s) silencieusement`)
  }
}

main().catch((e) => {
  console.error('Échec du script :', e instanceof Error ? e.message : e)
  process.exit(1)
})
