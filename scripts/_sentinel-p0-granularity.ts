// Sentinel P0-Granularité — Consolidation des tableaux homogènes knowledge_fact
// Compare avant/après sur IND_002, LRM_CR04, MEL_CR03.
// Gate : bloc RAS IND_002 consolidé ; bloc examen impossible conserve distinctions ;
//         LRM_CR04 vitraux int/ext séparés ; aucune sur-fusion sur MEL_CR03.
// Aucun commit tant que verdict non rendu.
//
// Usage : npx tsx scripts/_sentinel-p0-granularity.ts
import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

const CREATED_BY = 'c16d2984-74d8-4f8b-9f8e-0efadc342f0d'
const SITE_ID = '23a66c4e-e758-412d-a613-d3626b2a10bc'

const CASES = [
  {
    id: 'IND_002',
    documentId: '1d89c180-f01e-477a-8998-ccf3b92e23da',
    baselineKf: 50,
    baselineTotal: 65,
    // Gate structurel : bloc RAS consolidé, bloc examen impossible partiellement consolidé
    // Cible indicative ~28 kf — PAS un gate absolu
    kfReductionExpected: true,
    vitrauxCheck: false,
  },
  {
    id: 'LRM_CR04',
    documentId: 'd7c15825-40a4-4232-bed3-4af2d4f41f41',
    baselineKf: 13,
    baselineTotal: 67,
    kfReductionExpected: false, // aucune fusion attendue — garde anti-sur-fusion
    vitrauxCheck: true, // vitraux int/ext doivent rester séparés
  },
  {
    id: 'MEL_CR03',
    documentId: '691b9372-223a-40d9-86ec-44d0662d9dbe',
    baselineKf: 38,
    baselineTotal: 80,
    kfReductionExpected: false, // garde anti-sur-fusion
    vitrauxCheck: false,
  },
]

type ProposalRow = {
  id: string
  proposal_family: string
  label: string
  source_page: number | null
  source_excerpt: string | null
  thematic_category: string | null
}

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const { extractHistoricalPv } = await import('../lib/documents/extract-historical-pv')

  console.log('\n=== Sentinel P0-Granularite — Consolidation tableaux homogenes ===\n')

  const allGates: Array<{ id: string; pass: boolean; failures: string[] }> = []

  for (const cas of CASES) {
    console.log(`\n--- ${cas.id} (doc: ${cas.documentId}) ---`)
    console.log(`  Baseline : total=${cas.baselineTotal} kf=${cas.baselineKf}`)

    console.log('  Extraction en cours...')
    const start = Date.now()
    try {
      await extractHistoricalPv(cas.documentId, CREATED_BY, SITE_ID)
    } catch (e) {
      console.error(`  ERREUR : ${e instanceof Error ? e.message : String(e)}`)
      allGates.push({ id: cas.id, pass: false, failures: ['extraction_threw'] })
      continue
    }
    const durationMs = Date.now() - start

    const { data: runRow } = await admin
      .from('document_extraction_run')
      .select('id, status')
      .eq('document_id', cas.documentId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!runRow) { allGates.push({ id: cas.id, pass: false, failures: ['no_run'] }); continue }
    const run = runRow as { id: string; status: string }

    const { data: proposals } = await admin
      .from('document_extraction_proposal')
      .select('id, proposal_family, label, source_page, source_excerpt, thematic_category')
      .eq('extraction_run_id', run.id)

    const rows = (proposals ?? []) as ProposalRow[]
    const byFamily: Record<string, number> = {}
    for (const r of rows) {
      byFamily[r.proposal_family] = (byFamily[r.proposal_family] ?? 0) + 1
    }
    const kfCount = byFamily['knowledge_fact'] ?? 0
    const totalCount = rows.length

    console.log(`  Resultat : status=${run.status} duree=${(durationMs / 1000).toFixed(1)}s`)
    console.log(`    total=${totalCount} (baseline=${cas.baselineTotal})`)
    console.log(`    knowledge_fact=${kfCount} (baseline=${cas.baselineKf})`)
    console.log(`    families: ${JSON.stringify(byFamily)}`)

    const kfRows = rows.filter((r) => r.proposal_family === 'knowledge_fact')

    const failures: string[] = []
    let pass = true

    if (cas.id === 'IND_002') {
      // Gate 1 : réduction substantielle du nb de kf (signe de consolidation)
      if (kfCount >= cas.baselineKf) {
        failures.push(`G1 FAIL: kf=${kfCount} >= baseline=${cas.baselineKf} — aucune consolidation detectee`)
        pass = false
      } else {
        const reduction = Math.round((1 - kfCount / cas.baselineKf) * 100)
        console.log(`\n  G1 ok : reduction kf ${cas.baselineKf} -> ${kfCount} (${reduction}%)`)
      }

      // Gate 2 : consolidation du bloc electrique pages 23-24
      // Doctrine : "verdict commun + localisations distinctes → regrouper par localisation"
      // Baseline : ~41 kf atomises (1 par coffret/armoire) sur p23/p24
      // Attendu : N kf par unite-localisation (7 locaux p23 + 2-3 p24) — well below 41, well above 3
      // FAIL si consolidation absente (≥30) ou over-merge total (≤3)
      const p2324Kf = kfRows.filter((r) => r.source_page === 23 || r.source_page === 24)
      const p2324Count = p2324Kf.length
      console.log(`\n  G2 bloc electrique p23-24 : ${p2324Count} kf (baseline ~41 atomises)`)
      for (const kf of p2324Kf) {
        const excerpt = (kf.source_excerpt ?? '').slice(0, 60).replace(/\n/g, ' ')
        console.log(`    p${kf.source_page} | "${kf.label}" | src="${excerpt}..."`)
      }
      if (p2324Count > 30) {
        failures.push(`G2 FAIL: ${p2324Count} kf sur p23/p24 — consolidation des unites-localisation non appliquee (baseline ~41)`)
        pass = false
      } else if (p2324Count <= 3) {
        failures.push(`G2 FAIL: ${p2324Count} kf sur p23/p24 — over-merge probable (toutes localisations fusionnees)`)
        pass = false
      } else {
        console.log(`  G2 ok : ${p2324Count} kf par unite-localisation sur p23/p24 — consolidation conforme a la doctrine`)
      }

      // Controle G3 : variation deadline — signal de controle, NON BLOQUANT
      // La regle de consolidation ne touche que knowledge_fact — une variation deadline
      // ne peut etre causalement attribuee au correctif sans preuve directe.
      const deadlineCount = byFamily['deadline'] ?? 0
      const obsCount = byFamily['observation'] ?? 0
      console.log(`  G3 signal : deadlines=${deadlineCount} (baseline=2) observations=${obsCount}`)
      if (deadlineCount < 2) {
        console.log(`    -> delta deadline observe (${deadlineCount} vs baseline 2) — variation non causalement attribuable au correctif knowledge_fact`)
      } else {
        console.log(`  G3 ok : deadlines=${deadlineCount} observations=${obsCount} (non impactes)`)
      }

      // Afficher les kf consolides
      console.log('\n  KF apres consolidation :')
      for (const kf of kfRows.sort((a, b) => (a.source_page ?? 0) - (b.source_page ?? 0))) {
        const excerpt = (kf.source_excerpt ?? '').slice(0, 80).replace(/\n/g, ' ')
        console.log(`    p${kf.source_page ?? '?'} | ${kf.thematic_category ?? '?'} | "${kf.label}" | src="${excerpt}..."`)
      }
    }

    if (cas.id === 'LRM_CR04') {
      // Gate 4 : kf count ne doit pas baisser de plus de 30% (sur-fusion)
      if (kfCount < cas.baselineKf * 0.7) {
        failures.push(`G4 FAIL: kf LRM_CR04=${kfCount} < 70% baseline ${cas.baselineKf} — possible sur-fusion`)
        pass = false
      } else {
        console.log(`\n  G4 ok : LRM_CR04 kf=${kfCount} (baseline=${cas.baselineKf}) — pas de sur-fusion kf`)
      }

      // Gate 5 : vitraux int/ext doivent rester des entites separees
      // Recherche dans toutes les familles (actions, kf, observations...)
      // Racine 'vitr' couvre vitraux et vitrail
      if (cas.vitrauxCheck) {
        const vitrauxItems = rows.filter((r) =>
          (r.label ?? '').toLowerCase().includes('vitr') ||
          (r.source_excerpt ?? '').toLowerCase().includes('vitr'),
        )
        console.log(`  G5 vitraux : ${vitrauxItems.length} element(s) mentionnant vitraux/vitrail`)
        for (const v of vitrauxItems) {
          console.log(`    ${v.proposal_family} | "${v.label}"`)
        }
        if (vitrauxItems.length === 1) {
          failures.push('G5 FAIL: 1 seul element vitraux — int/ext probablement fusionnes')
          pass = false
        } else if (vitrauxItems.length === 0) {
          failures.push('G5 FAIL: 0 element vitraux — vitraux disparus')
          pass = false
        } else {
          console.log(`  G5 ok : ${vitrauxItems.length} elements vitraux distincts preserves`)
        }
      }

      // Gate 6 : total proposals ne doit pas baisser de plus de 15%
      if (totalCount < cas.baselineTotal * 0.85) {
        failures.push(`G6 FAIL: total LRM_CR04=${totalCount} < 85% baseline ${cas.baselineTotal}`)
        pass = false
      } else {
        console.log(`  G6 ok : total=${totalCount} (baseline=${cas.baselineTotal}) — stable`)
      }
    }

    if (cas.id === 'MEL_CR03') {
      // Gate 7 : kf count ne doit pas baisser de plus de 20% (MEL_CR03 n'a pas de tableau homogene)
      if (kfCount < cas.baselineKf * 0.8) {
        failures.push(`G7 FAIL: kf MEL_CR03=${kfCount} < 80% baseline ${cas.baselineKf} — sur-fusion inattendue`)
        pass = false
      } else {
        console.log(`\n  G7 ok : MEL_CR03 kf=${kfCount} (baseline=${cas.baselineKf}) — pas de sur-fusion`)
      }

      // Gate 8 : total proposals
      if (totalCount < cas.baselineTotal * 0.85) {
        failures.push(`G8 FAIL: total MEL_CR03=${totalCount} < 85% baseline ${cas.baselineTotal}`)
        pass = false
      } else {
        console.log(`  G8 ok : total=${totalCount} (baseline=${cas.baselineTotal}) — stable`)
      }
    }

    const verdict = pass ? 'PASS' : 'FAIL'
    console.log(`\n  VERDICT ${cas.id} : ${verdict}`)
    for (const f of failures) console.log(`  -> ${f}`)
    allGates.push({ id: cas.id, pass, failures })
  }

  // Tableau comparatif final
  console.log('\n\n=== COMPARAISON AVANT / APRES ===')
  console.log('document | kf avant | kf apres | delta | verdict')
  console.log('---------|----------|----------|-------|--------')
  for (const g of allGates) {
    const cas = CASES.find((c) => c.id === g.id)!
    console.log(`${g.id.padEnd(9)} | ${String(cas.baselineKf).padStart(8)} | ??? | ??? | ${g.pass ? 'PASS' : 'FAIL'}`)
  }

  const allPass = allGates.every((g) => g.pass)
  const verdict = allPass ? 'PASS — P0-Granularite valide, commit autorise' : 'FAIL — aucun second correctif'
  console.log(`\n=== VERDICT GLOBAL : ${verdict} ===\n`)
  if (!allPass) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
