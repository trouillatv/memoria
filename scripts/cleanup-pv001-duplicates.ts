#!/usr/bin/env tsx
/**
 * Nettoyage des doublons PV001 — document canonique : 64cf7623…
 *
 * Exécution :
 *   npx tsx scripts/cleanup-pv001-duplicates.ts          → dry-run uniquement
 *   npx tsx scripts/cleanup-pv001-duplicates.ts --delete  → suppression réelle
 *
 * Le script affiche tout ce qui sera supprimé avant d'agir.
 * La suppression est transactionnelle (BEGIN / COMMIT ou ROLLBACK si erreur).
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

const DRY_RUN = !process.argv.includes('--delete')
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN!
const PROJECT_REF = 'srixnofmaydxouhucawn'
const CANONICAL_HASH = '0c4aaf79d065eaf189614179900986cf528e7f529d5794c7c1fe52b5ab1360de'

if (!TOKEN) { console.error('SUPABASE_ACCESS_TOKEN manquant'); process.exit(1) }

type Row = Record<string, unknown>

async function sql(query: string): Promise<Row[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`API ${res.status}: ${text}`)
  return JSON.parse(text) as Row[]
}

function sep(title: string) { console.log(`\n${'─'.repeat(60)}\n${title}`) }
function row(r: Row) { console.log(' ', JSON.stringify(r)) }

async function main() {
  console.log(DRY_RUN ? '\n[DRY-RUN] Aucune suppression ne sera effectuée.' : '\n[DELETE] Suppression réelle.')

  // ── 1. Identifier le document canonique et les doublons ─────────────────────

  sep('1. Document canonique (à conserver)')
  const canonicalRows = await sql(`
    SELECT d.id, d.filename, d.effective_date,
      (SELECT COUNT(*) FROM document_extraction_run r WHERE r.document_id = d.id) AS nb_runs,
      (SELECT COUNT(*) FROM document_extraction_run r JOIN document_extraction_proposal p ON p.extraction_run_id = r.id WHERE r.document_id = d.id) AS nb_proposals
    FROM documents d
    JOIN document_links dl ON dl.document_id = d.id AND dl.target_type = 'site'
    WHERE d.content_hash = '${CANONICAL_HASH}'
      AND d.document_type = 'historical_visit_report'
    ORDER BY nb_proposals DESC
    LIMIT 1;
  `)
  const canonical = canonicalRows[0]
  if (!canonical) { console.error('Document canonique introuvable — vérifier le hash.'); process.exit(1) }
  const canonicalId = canonical.id as string
  console.log(`  ID: ${canonicalId}`)
  console.log(`  Fichier: ${canonical.filename}`)
  console.log(`  Date PV: ${canonical.effective_date}`)
  console.log(`  Runs: ${canonical.nb_runs} | Proposals: ${canonical.nb_proposals}`)

  // ── 2. Documents à supprimer ─────────────────────────────────────────────────

  sep('2. Documents à supprimer (doublons)')
  const dupDocs = await sql(`
    SELECT d.id, d.filename, d.effective_date, d.created_at,
      (SELECT COUNT(*) FROM document_extraction_run r WHERE r.document_id = d.id) AS nb_runs
    FROM documents d
    JOIN document_links dl ON dl.document_id = d.id AND dl.target_type = 'site'
    WHERE d.content_hash = '${CANONICAL_HASH}'
      AND d.document_type = 'historical_visit_report'
      AND d.id != '${canonicalId}'
    ORDER BY d.created_at;
  `)
  const dupDocIds = dupDocs.map((r) => r.id as string)
  for (const d of dupDocs) row(d)
  console.log(`  → ${dupDocs.length} document(s) à supprimer`)
  if (dupDocIds.length === 0) { console.log('\nAucun doublon à supprimer.'); return }

  // ── 3. Runs des doublons ──────────────────────────────────────────────────────

  sep('3. Extraction runs des documents doublons')
  const dupRuns = await sql(`
    SELECT r.id AS run_id, r.document_id, r.status, r.created_at,
      (SELECT COUNT(*) FROM document_extraction_proposal p WHERE p.extraction_run_id = r.id) AS nb_proposals
    FROM document_extraction_run r
    WHERE r.document_id IN (${dupDocIds.map((id) => `'${id}'`).join(',')})
    ORDER BY r.document_id, r.created_at;
  `)
  const dupRunIds = dupRuns.map((r) => r.run_id as string)
  for (const r of dupRuns) row(r)
  console.log(`  → ${dupRuns.length} run(s) à supprimer`)

  // ── 4. Propositions des runs doublons ─────────────────────────────────────────

  let dupPropIds: string[] = []
  if (dupRunIds.length > 0) {
    sep('4. Propositions des runs doublons')
    const dupProps = await sql(`
      SELECT p.id AS proposal_id, p.extraction_run_id, p.proposal_family, p.label
      FROM document_extraction_proposal p
      WHERE p.extraction_run_id IN (${dupRunIds.map((id) => `'${id}'`).join(',')})
      ORDER BY p.extraction_run_id, p.proposal_family;
    `)
    dupPropIds = dupProps.map((p) => p.proposal_id as string)
    console.log(`  → ${dupProps.length} proposition(s) à supprimer`)
    const byFamily: Record<string, number> = {}
    for (const p of dupProps) {
      const f = p.proposal_family as string
      byFamily[f] = (byFamily[f] ?? 0) + 1
    }
    for (const [f, n] of Object.entries(byFamily)) console.log(`     ${f}: ${n}`)
  }

  // ── 5. Matérialisations (liens proposal → entité métier) ─────────────────────

  type MatRow = { materialization_id: string; proposal_id: string; target_entity_type: string; target_entity_id: string }
  let materializations: MatRow[] = []
  if (dupPropIds.length > 0) {
    sep('5. Matérialisations (document_proposal_materialization)')
    const mats = await sql(`
      SELECT id AS materialization_id, proposal_id, target_entity_type, target_entity_id
      FROM document_proposal_materialization
      WHERE proposal_id IN (${dupPropIds.map((id) => `'${id}'`).join(',')})
      ORDER BY target_entity_type, target_entity_id;
    `)
    materializations = mats as MatRow[]
    for (const m of materializations) row(m)
    console.log(`  → ${materializations.length} materialization(s) à supprimer`)
  }

  // ── 6. Objets métier issus de ces matérialisations ───────────────────────────

  const actionIds = materializations.filter((m) => m.target_entity_type === 'site_action').map((m) => m.target_entity_id)
  const deadlineIds = materializations.filter((m) => m.target_entity_type === 'site_deadline').map((m) => m.target_entity_id)

  if (actionIds.length > 0) {
    sep('6a. Actions à supprimer (site_actions)')
    const actions = await sql(`
      SELECT id, title, status, created_at
      FROM site_actions
      WHERE id IN (${actionIds.map((id) => `'${id}'`).join(',')});
    `)
    for (const a of actions) row(a)
    console.log(`  → ${actions.length} action(s)`)

    // Vérifier s'il y a des enfants sur ces actions (preuves, photos…)
    const actionChildren = await sql(`
      SELECT 'site_action_evidence' AS child_type, COUNT(*) AS n
      FROM site_action_evidence WHERE action_id IN (${actionIds.map((id) => `'${id}'`).join(',')})
      UNION ALL
      SELECT 'knowledge_facts', COUNT(*) FROM knowledge_facts WHERE action_id IN (${actionIds.map((id) => `'${id}'`).join(',')})
    `).catch(() => [])
    if (actionChildren.length > 0) {
      console.log('  Enfants des actions :')
      for (const c of actionChildren) if (Number(c.n) > 0) console.log(`    ${c.child_type}: ${c.n}`)
    }
  }

  if (deadlineIds.length > 0) {
    sep('6b. Échéances à supprimer (site_deadlines)')
    const deadlines = await sql(`
      SELECT id, title, due_date, status, created_at
      FROM site_deadlines
      WHERE id IN (${deadlineIds.map((id) => `'${id}'`).join(',')});
    `)
    for (const d of deadlines) row(d)
    console.log(`  → ${deadlines.length} échéance(s)`)
  }

  // ── 7. site_reports liés aux runs doublons ───────────────────────────────────

  let siteReportIds: string[] = []
  if (dupRunIds.length > 0) {
    sep('7. site_reports (visites historiques à supprimer)')
    const reports = await sql(`
      SELECT sr.id AS report_id, sr.origin, sr.extraction_run_id, sr.created_at
      FROM site_reports sr
      WHERE sr.extraction_run_id IN (${dupRunIds.map((id) => `'${id}'`).join(',')})
        AND sr.origin = 'import';
    `)
    siteReportIds = reports.map((r) => r.report_id as string)
    for (const r of reports) row(r)
    console.log(`  → ${reports.length} site_report(s)`)

    if (siteReportIds.length > 0) {
      const reportProps = await sql(`
        SELECT COUNT(*) AS n FROM site_report_proposals
        WHERE report_id IN (${siteReportIds.map((id) => `'${id}'`).join(',')});
      `)
      console.log(`  site_report_proposals liés: ${reportProps[0]?.n ?? 0}`)
    }
  }

  // ── 8. document_links des doublons ───────────────────────────────────────────

  sep('8. document_links à supprimer')
  const links = await sql(`
    SELECT id AS link_id, document_id, target_type, target_id
    FROM document_links
    WHERE document_id IN (${dupDocIds.map((id) => `'${id}'`).join(',')});
  `)
  for (const l of links) row(l)
  console.log(`  → ${links.length} lien(s)`)

  // ── Résumé du dry-run ─────────────────────────────────────────────────────────

  sep('RÉSUMÉ DU DRY-RUN')
  console.log(`  Documents à supprimer    : ${dupDocs.length}`)
  console.log(`  Runs à supprimer         : ${dupRuns.length}`)
  console.log(`  Propositions à supprimer : ${dupPropIds.length}`)
  console.log(`  Matérialisations         : ${materializations.length}`)
  console.log(`  site_actions             : ${actionIds.length}`)
  console.log(`  site_deadlines           : ${deadlineIds.length}`)
  console.log(`  site_reports             : ${siteReportIds.length}`)
  console.log(`  document_links           : ${links.length}`)
  console.log(`\n  Document canonique conservé : ${canonicalId}`)

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] Aucune suppression effectuée.')
    console.log('Relancer avec --delete pour appliquer.')
    return
  }

  // ── Suppression transactionnelle ─────────────────────────────────────────────

  console.log('\n[DELETE] Suppression en cours…')

  const deleteSQL = `
BEGIN;

-- a. site_report_proposals (enfants des site_reports)
${siteReportIds.length > 0 ? `
DELETE FROM public.site_report_proposals
WHERE report_id IN (${siteReportIds.map((id) => `'${id}'`).join(',')});
` : '-- (aucun site_report_proposals)'}

-- b. site_actions
${actionIds.length > 0 ? `
DELETE FROM public.site_actions
WHERE id IN (${actionIds.map((id) => `'${id}'`).join(',')});
` : '-- (aucune site_action)'}

-- c. site_deadlines
${deadlineIds.length > 0 ? `
DELETE FROM public.site_deadlines
WHERE id IN (${deadlineIds.map((id) => `'${id}'`).join(',')});
` : '-- (aucune site_deadline)'}

-- d. site_reports (origin=import uniquement)
${siteReportIds.length > 0 ? `
DELETE FROM public.site_reports
WHERE id IN (${siteReportIds.map((id) => `'${id}'`).join(',')})
  AND origin = 'import';
` : '-- (aucun site_report)'}

-- e. document_proposal_materialization
${dupPropIds.length > 0 ? `
DELETE FROM public.document_proposal_materialization
WHERE proposal_id IN (${dupPropIds.map((id) => `'${id}'`).join(',')});
` : '-- (aucune materialization)'}

-- f. document_extraction_proposal
${dupRunIds.length > 0 ? `
DELETE FROM public.document_extraction_proposal
WHERE extraction_run_id IN (${dupRunIds.map((id) => `'${id}'`).join(',')});
` : '-- (aucune proposition)'}

-- g. document_extraction_run
${dupRunIds.length > 0 ? `
DELETE FROM public.document_extraction_run
WHERE id IN (${dupRunIds.map((id) => `'${id}'`).join(',')});
` : '-- (aucun run)'}

-- h. document_links
${dupDocIds.length > 0 ? `
DELETE FROM public.document_links
WHERE document_id IN (${dupDocIds.map((id) => `'${id}'`).join(',')});
` : '-- (aucun lien)'}

-- i. documents (doublons)
DELETE FROM public.documents
WHERE id IN (${dupDocIds.map((id) => `'${id}'`).join(',')})
  AND content_hash = '${CANONICAL_HASH}';

-- j. Assertions pre-COMMIT (ROLLBACK automatique si une assertion échoue)
DO $$
DECLARE v int;
BEGIN
  -- 1. Exactement 1 document PV avec ce hash reste — actif (deleted_at IS NULL)
  SELECT COUNT(*) INTO v
  FROM public.documents d
  JOIN public.document_links dl ON dl.document_id = d.id AND dl.target_type = 'site'
  WHERE d.content_hash = '${CANONICAL_HASH}'
    AND d.document_type = 'historical_visit_report'
    AND d.deleted_at IS NULL;
  IF v != 1 THEN
    RAISE EXCEPTION 'ASSERTION 1 FAILED: % document(s) PV001 actifs restants (attendu: 1 non supprime)', v;
  END IF;

${siteReportIds.length > 0 ? `
  -- 2. Aucun site_report des doublons ne subsiste
  SELECT COUNT(*) INTO v
  FROM public.site_reports
  WHERE id IN (${siteReportIds.map((id) => `'${id}'`).join(',')});
  IF v != 0 THEN
    RAISE EXCEPTION 'ASSERTION 2 FAILED: % site_report(s) non supprime(s)', v;
  END IF;
` : '  -- (pas de site_reports a verifier)'}

${dupPropIds.length > 0 ? `
  -- 3. Aucune matérialisation des propositions supprimées ne subsiste
  SELECT COUNT(*) INTO v
  FROM public.document_proposal_materialization
  WHERE proposal_id IN (${dupPropIds.map((id) => `'${id}'`).join(',')});
  IF v != 0 THEN
    RAISE EXCEPTION 'ASSERTION 3 FAILED: % materialization(s) non supprimee(s)', v;
  END IF;
` : '  -- (pas de materialisations a verifier)'}
END;
$$;

COMMIT;
`

  const res = await sql(deleteSQL)
  console.log('[DELETE] Transaction exécutée.')
  console.log('Résultat:', JSON.stringify(res))

  // ── Vérifications post-suppression ───────────────────────────────────────────

  sep('VÉRIFICATIONS POST-SUPPRESSION')

  const remaining = await sql(`
    SELECT d.id, d.filename, d.effective_date, d.content_hash, d.deleted_at
    FROM documents d
    JOIN document_links dl ON dl.document_id = d.id AND dl.target_type = 'site'
    WHERE d.content_hash = '${CANONICAL_HASH}'
      AND d.document_type = 'historical_visit_report'
      AND d.deleted_at IS NULL;
  `)
  console.log(`\n  Documents actifs restants avec ce hash: ${remaining.length} (attendu: 1)`)
  for (const r of remaining) row(r)

  const orphanActions = actionIds.length > 0 ? await sql(`
    SELECT COUNT(*) AS n FROM site_actions
    WHERE id IN (${actionIds.map((id) => `'${id}'`).join(',')});
  `) : [{ n: 0 }]
  const orphanDeadlines = deadlineIds.length > 0 ? await sql(`
    SELECT COUNT(*) AS n FROM site_deadlines
    WHERE id IN (${deadlineIds.map((id) => `'${id}'`).join(',')});
  `) : [{ n: 0 }]
  const orphanReports = siteReportIds.length > 0 ? await sql(`
    SELECT COUNT(*) AS n FROM site_reports
    WHERE id IN (${siteReportIds.map((id) => `'${id}'`).join(',')});
  `) : [{ n: 0 }]

  console.log(`  Actions orphelines restantes  : ${orphanActions[0]?.n ?? 0} (attendu: 0)`)
  console.log(`  Deadlines orphelines restantes: ${orphanDeadlines[0]?.n ?? 0} (attendu: 0)`)
  console.log(`  site_reports orphelins restants: ${orphanReports[0]?.n ?? 0} (attendu: 0)`)

  const remainingDoc = remaining[0] as { id: string } | undefined
  if (remaining.length === 1 && remainingDoc?.id === canonicalId) {
    console.log('\n  ✓ Un seul document PV001 actif restant — document canonique confirmé.')
  } else if (remaining.length === 0) {
    console.log('\n  ✗ ERREUR : aucun document PV001 actif restant — le canonique est peut-être soft-deleted.')
  } else {
    console.log('\n  ✗ Attention : état inattendu après suppression — vérifier manuellement.')
  }
}

main().catch((err) => { console.error('[FATAL]', err); process.exit(1) })
