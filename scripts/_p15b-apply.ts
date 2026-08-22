// _p15b-apply.ts
// P1-5B — Application contrôlée de la re-canonicalisation OCEF
//
// Manifeste gelé depuis l'audit P1-5A (2026-08-22).
// Aucun nouveau Gemini. OCEF uniquement (2c939e67-e986-4635-86a0-638cda870480).
// Arrêt immédiat sur première anomalie.
//
// Usage : npx tsx scripts/_p15b-apply.ts

import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mergeWithJournal } from '../lib/db/canonical-subject-merge'

const OCEF_SITE_ID = '2c939e67-e986-4635-86a0-638cda870480'
const ENGINE_VERSION = 'p1-5b-v1'
const P02_CONFIDENCE = 90
const TOTAL_CS_AT_EXECUTION_START = 157  // état réel OCEF à l'exécution P1-5B (26 CS ajoutés depuis audit P1-5A)
const EXPECTED_MERGES = 27
const EXPECTED_CS_AFTER = TOTAL_CS_AT_EXECUTION_START - EXPECTED_MERGES  // 130

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

// ── Types ────────────────────────────────────────────────────────────────────

interface MergeOp {
  source: string
  sourceLabel: string
  target: string
  targetLabel: string
}

interface Cluster {
  name: string
  type: 'CLEAN' | 'CHOIX_B'
  merges: MergeOp[]
  lone?: Array<{ id: string; label: string }>  // CS préservé seul (Choix B uniquement)
}

interface MergeRecord {
  cluster: string
  sourceLabel: string
  targetLabel: string
  linksMoved: number
  selfLinksDeleted: number
  duplicateLinksDeleted: number
  durationMs: number
}

// ── Manifeste gelé (P1-5A 2026-08-22) ────────────────────────────────────────

const CLUSTERS: Cluster[] = [

  // ── 1. Coordination LOT01/LOT02 (CLEAN) ─────────────────────────────────────
  {
    name: 'Coordination LOT01/LOT02',
    type: 'CLEAN',
    merges: [
      {
        source: '2f514786-fd98-4b24-b5c4-43743eb19b6d',
        sourceLabel: 'Coordination Réseaux sous-dalle LOT01 et LOT02',
        target: 'ef62540a-79d4-49a1-9ee4-d0b12b1acc63',
        targetLabel: 'Coordination à faire entre LOT01 et LOT02',
      },
      {
        source: 'a79264a0-aa3e-4a79-ab1d-1de7d4c5533c',
        sourceLabel: 'Coordination réseaux sous-dalle (LOT01 & LOT02)',
        target: 'ef62540a-79d4-49a1-9ee4-d0b12b1acc63',
        targetLabel: 'Coordination à faire entre LOT01 et LOT02',
      },
      {
        source: '34eb0140-a995-4a1a-ab24-0c23588b9d75',
        sourceLabel: 'Prévision : Coordination Réseaux sous-dalle LOT01 et LOT02',
        target: 'ef62540a-79d4-49a1-9ee4-d0b12b1acc63',
        targetLabel: 'Coordination à faire entre LOT01 et LOT02',
      },
    ],
  },

  // ── 2. Transmission fiches techniques matériaux (CLEAN) ──────────────────────
  {
    name: 'Transmission fiches techniques',
    type: 'CLEAN',
    merges: [
      {
        source: '17a1543e-fa0b-4e60-b361-dfd158dbe30d',
        sourceLabel: 'Transmission fiches techniques matériaux',
        target: 'd7c22ed3-43a7-488f-9657-de32ad8f5c67',
        targetLabel: 'Transmission des fiches techniques matériaux',
      },
    ],
  },

  // ── 3. Journal de chantier (CLEAN) ───────────────────────────────────────────
  {
    name: 'Journal de chantier',
    type: 'CLEAN',
    merges: [
      {
        source: 'e68d9b5f-5698-4c26-8f88-bbbbc710cf9a',
        sourceLabel: 'Tenir à jour un journal de chantier',
        target: '680917ad-aec2-47c0-bede-584de2bb9f32',
        targetLabel: 'Journal de chantier à tenir à jour',
      },
    ],
  },

  // ── 4. GDE - Fossé (CLEAN) ───────────────────────────────────────────────────
  {
    name: 'GDE - Fossé',
    type: 'CLEAN',
    merges: [
      {
        source: '8d5b888c-4b75-4f75-8dd3-3b043f8bacce',
        sourceLabel: 'Gestion des Eaux (GDE) : Fossé',
        target: '3339f975-5d3a-4a60-8c9e-2d3a770f5ab7',
        targetLabel: 'GDE - Fossé',
      },
      {
        source: '9231d02b-09be-4a78-ae42-bad370e9dc47',
        sourceLabel: 'Fossé GDE',
        target: '3339f975-5d3a-4a60-8c9e-2d3a770f5ab7',
        targetLabel: 'GDE - Fossé',
      },
    ],
  },

  // ── 5. GDE - Busage Provisoire (CLEAN) ───────────────────────────────────────
  {
    name: 'GDE - Busage Provisoire',
    type: 'CLEAN',
    merges: [
      {
        source: 'bc17b950-1116-457f-8952-8468cc72d3a2',
        sourceLabel: 'Gestion des Eaux (GDE) : Busage Provisoire',
        target: '5a507b15-eae0-49dd-9076-2c915e45d3d6',
        targetLabel: 'GDE - Busage Provisoire',
      },
      {
        source: '8b8c50da-b5a4-4242-8980-3484cff7abaa',
        sourceLabel: 'Busage Provisoire GDE',
        target: '5a507b15-eae0-49dd-9076-2c915e45d3d6',
        targetLabel: 'GDE - Busage Provisoire',
      },
    ],
  },

  // ── 6. Relevés météo (CLEAN) ──────────────────────────────────────────────────
  {
    name: 'Relevés météo',
    type: 'CLEAN',
    merges: [
      {
        source: '811971c5-9ce6-4bab-8afe-ccf2ad11fab1',
        sourceLabel: 'Transmission des relevés météo',
        target: 'ae7e9bb3-d7e6-49b2-b614-8d17018554a6',
        targetLabel: 'Transmettre les relevés météo',
      },
      {
        source: 'c6c166ad-c310-4aa4-bf19-12174c0f6395',
        sourceLabel: 'Transmission relevés météo',
        target: 'ae7e9bb3-d7e6-49b2-b614-8d17018554a6',
        targetLabel: 'Transmettre les relevés météo',
      },
    ],
  },

  // ── 7. Couche de forme GNT (CHOIX_B) ─────────────────────────────────────────
  // Arête RELATED : d9bb24b2 (GNT) ↔ 7f684dad (Prévision) — frontière de composante
  // Fusion autorisée : 949cb00d → d9bb24b2 (même composante SAFE_SAME)
  // 7f684dad (Prévision) préservé seul — ne jamais traverser l'arête RELATED
  {
    name: 'Couche de forme GNT',
    type: 'CHOIX_B',
    merges: [
      {
        source: '949cb00d-c42b-4d32-9213-98613da12e34',
        sourceLabel: 'Mise en place de la couche de forme',
        target: 'd9bb24b2-d51a-41db-a270-c934d3d4cec4',
        targetLabel: 'Mise en place couche de forme (GNT)',
      },
    ],
    lone: [
      { id: '7f684dad-d939-4580-8d57-dc26a8f2ac9c', label: 'Prévision : Mise en place couche de forme' },
    ],
  },

  // ── 8. Accès Plateforme - Travaux réalisés (CLEAN) ───────────────────────────
  {
    name: 'Accès Plateforme - Travaux réalisés',
    type: 'CLEAN',
    merges: [
      {
        source: '9dc5bb4b-a651-4b91-9f1b-db907a479e32',
        sourceLabel: 'Accès Plateforme : Déblais réalisés',
        target: '0229f88a-e24f-4673-9633-6a31407bb975',
        targetLabel: 'Accès Plateforme - Travaux réalisés',
      },
    ],
  },

  // ── 9. BECIB interlocuteur LOT01 (CLEAN) ─────────────────────────────────────
  {
    name: 'BECIB interlocuteur LOT01',
    type: 'CLEAN',
    merges: [
      {
        source: '45d57ad3-d1f3-4fb8-9c2a-20d81da0c767',
        sourceLabel: "BECIB interlocuteur privilégié de l'entreprise pour le lot 01",
        target: '283ed1e0-016b-47ea-a74a-ba5be6bbc3f2',
        targetLabel: "BECIB est l'interlocuteur privilégié de l'entreprise pour le lot 01",
      },
      {
        source: 'de5dea37-a163-4001-8a43-1c816a323e80',
        sourceLabel: 'BECIB interlocuteur privilégié pour le lot 01',
        target: '283ed1e0-016b-47ea-a74a-ba5be6bbc3f2',
        targetLabel: "BECIB est l'interlocuteur privilégié de l'entreprise pour le lot 01",
      },
    ],
  },

  // ── 10. Plan de gestion des eaux (CLEAN) ─────────────────────────────────────
  {
    name: 'Plan gestion des eaux',
    type: 'CLEAN',
    merges: [
      {
        source: '6bc367fa-43ea-4ee9-bc6e-cd812abde771',
        sourceLabel: 'Transmission plan de gestion des eaux',
        target: '8cf8b62d-ef30-46d6-bee7-8e89c99849e5',
        targetLabel: 'Plan de gestion des eaux pluviales',
      },
      {
        source: '7d7038fa-cc3e-480c-8424-301d7da846e4',
        sourceLabel: 'Transmission du plan de gestion des eaux',
        target: '8cf8b62d-ef30-46d6-bee7-8e89c99849e5',
        targetLabel: 'Plan de gestion des eaux pluviales',
      },
    ],
  },

  // ── 11. Moyens matériels sur site (CLEAN) ────────────────────────────────────
  {
    name: 'Moyens matériels sur site',
    type: 'CLEAN',
    merges: [
      {
        source: '1e14312c-85fa-46fb-8c89-4e2014c1c5fa',
        sourceLabel: 'Moyens matériels présents sur site',
        target: '7daf3310-f60a-4a29-ab9f-36c36a1faa19',
        targetLabel: 'Moyens matériels sur site',
      },
      {
        source: '90e4c3bd-ac25-4349-a49c-3a047692f500',
        sourceLabel: 'Moyens matériels présents',
        target: '7daf3310-f60a-4a29-ab9f-36c36a1faa19',
        targetLabel: 'Moyens matériels sur site',
      },
      {
        source: 'bb0f1a32-8e3a-4400-8ba9-a7bb20373b19',
        sourceLabel: 'Moyens humains et matériels sur site',
        target: '7daf3310-f60a-4a29-ab9f-36c36a1faa19',
        targetLabel: 'Moyens matériels sur site',
      },
    ],
  },

  // ── 12. Terrassement Plateforme Déblais/Remblais (CLEAN) ─────────────────────
  {
    name: 'Terrassement Plateforme Déblais/Remblais',
    type: 'CLEAN',
    merges: [
      {
        source: 'f6fc384f-c291-4fb1-bc11-0edacc1a5f94',
        sourceLabel: 'Déblais/Remblais plateforme',
        target: '9dcaaf3d-bf08-44e4-a070-3a211b5eb7b5',
        targetLabel: 'Terrassement Plateforme Déblais/Remblais',
      },
    ],
  },

  // ── 13. Purge Plateforme (CHOIX_B) ────────────────────────────────────────────
  // Arête RELATED : 4fd2f51a (Purge) ↔ 78e477a2 (Démarrage purge) — frontière
  // Sous-composante réalisation : 4fd2f51a → 43e59642
  // Sous-composante démarrage   : 9192db79 → 78e477a2
  // 43e59642 et 78e477a2 restent deux sujets distincts (frontière RELATED préservée)
  {
    name: 'Purge Plateforme',
    type: 'CHOIX_B',
    merges: [
      {
        source: '4fd2f51a-a23b-4f93-befd-6175fc0bcf3a',
        sourceLabel: 'Purge de la plateforme',
        target: '43e59642-1b78-4331-a995-1e626bf8fb86',
        targetLabel: 'Réalisation Purge Plateforme',
      },
      {
        source: '9192db79-f8a3-4ec0-8a6e-0a7c956f70f4',
        sourceLabel: 'Terrassement plateforme : Démarrage purge',
        target: '78e477a2-a75b-4147-a314-14a825c0386f',
        targetLabel: 'Démarrage purge plateforme',
      },
    ],
  },

  // ── 14. Reprise accès (sortie) (CLEAN) ───────────────────────────────────────
  {
    name: 'Reprise accès sortie',
    type: 'CLEAN',
    merges: [
      {
        source: '36f3abd4-f290-479a-9366-b9357ea2b07f',
        sourceLabel: 'Reprise accès Est',
        target: '63408aba-1c84-4962-82ea-d018784ea5c7',
        targetLabel: 'Prévision : Reprise accès (sortie)',
      },
    ],
  },

  // ── 15. Propreté des abords (CLEAN) ──────────────────────────────────────────
  {
    name: 'Propreté abords chantier',
    type: 'CLEAN',
    merges: [
      {
        source: 'dbc63b83-2637-4d1a-9453-873e8ad34adb',
        sourceLabel: 'Attention à la propreté générale des abords du chantier',
        target: '6ae60809-fc09-42d9-94f3-68f406ec7ab2',
        targetLabel: 'Propreté des abords du chantier',
      },
    ],
  },

  // ── 16. Visite mairie secteur (CLEAN) ─────────────────────────────────────────
  {
    name: 'Visite mairie secteur sous plateforme',
    type: 'CLEAN',
    merges: [
      {
        source: '20dd4ed8-2d29-46f6-8c4e-e30fadba3740',
        sourceLabel: 'Assainissement : Visite de la mairie',
        target: 'bb6db95c-056d-4638-8a82-edafc760d7d3',
        targetLabel: 'Visite mairie secteur sous plateforme',
      },
    ],
  },

  // ── 17. Transmission Rapport/CR Visite Mairie (CLEAN) ────────────────────────
  {
    name: 'Transmission Rapport/CR Visite Mairie',
    type: 'CLEAN',
    merges: [
      {
        source: '4b8207d9-2d6c-4737-8106-2fce474cb6cc',
        sourceLabel: 'Rapport mairie',
        target: '17f5d684-fc96-4ecd-ae17-b391bdade9d0',
        targetLabel: 'Transmission Rapport/CR Visite Mairie',
      },
    ],
  },
]

// ── Vérifications post-merge ──────────────────────────────────────────────────

function stopNow(reason: string): never {
  console.error(`\n✗ ARRÊT IMMÉDIAT — ${reason}`)
  process.exit(1)
}

async function verifySingleMerge(source: string, target: string): Promise<void> {
  const { data, error } = await sb
    .from('canonical_subject')
    .select('id, status, merged_into')
    .in('id', [source, target])

  if (error) stopNow(`DB error lors de la vérification : ${error.message}`)

  const srcCs = (data ?? []).find(r => r.id === source)
  const tgtCs = (data ?? []).find(r => r.id === target)

  if (!srcCs) stopNow(`source ${source} introuvable après merge`)
  if (srcCs.status !== 'merged') stopNow(`source ${source} status=${srcCs.status}, attendu 'merged'`)
  if (srcCs.merged_into !== target) stopNow(`source ${source} merged_into=${srcCs.merged_into}, attendu ${target}`)

  if (!tgtCs) stopNow(`target ${target} introuvable après merge`)
  if (tgtCs.status !== 'active') stopNow(`target ${target} status=${tgtCs.status}, attendu 'active'`)

  const { count: occCount, error: occErr } = await sb
    .from('canonical_subject_occurrence')
    .select('*', { count: 'exact', head: true })
    .eq('canonical_subject_id', source)

  if (occErr) stopNow(`DB error vérification occurrences : ${occErr.message}`)
  if ((occCount ?? 0) > 0) stopNow(`source ${source} a encore ${occCount} occurrence(s) non reroutée(s)`)

  const { data: journal, error: jErr } = await sb
    .from('canonical_subject_merge')
    .select('id, resolution_source, engine_version')
    .eq('loser_subject_id', source)
    .eq('winner_subject_id', target)
    .maybeSingle()

  if (jErr) stopNow(`DB error vérification journal : ${jErr.message}`)
  if (!journal) stopNow(`journal absent pour ${source} → ${target}`)
  if (journal.engine_version !== ENGINE_VERSION) stopNow(`journal engine_version=${journal.engine_version}, attendu ${ENGINE_VERSION}`)
  if (journal.resolution_source !== 'automatic') stopNow(`journal resolution_source=${journal.resolution_source}, attendu 'automatic'`)

  console.log(`    ✓ merge vérifié (source=merged, target=active, 0 occ., journal OK)`)
}

async function verifyLoneCs(id: string, label: string): Promise<void> {
  const { data, error } = await sb
    .from('canonical_subject')
    .select('id, status, merged_into')
    .eq('id', id)
    .maybeSingle()

  if (error || !data) stopNow(`CS isolé ${id} (${label}) introuvable`)
  if (data.status !== 'active') stopNow(`CS isolé ${id} (${label}) status=${data.status}, attendu 'active'`)
  if (data.merged_into !== null) stopNow(`CS isolé ${id} (${label}) merged_into=${data.merged_into} (doit rester null)`)

  console.log(`    ✓ CS isolé préservé : ${label}`)
}

// ── Vérification globale ──────────────────────────────────────────────────────

async function globalVerification(): Promise<void> {
  console.log('\n[global] Vérification finale...')

  const { count: activeCount, error: cntErr } = await sb
    .from('canonical_subject')
    .select('*', { count: 'exact', head: true })
    .eq('site_id', OCEF_SITE_ID)
    .eq('status', 'active')

  if (cntErr) stopNow(`DB error global count : ${cntErr.message}`)
  if (activeCount !== EXPECTED_CS_AFTER) {
    stopNow(`CS actifs OCEF = ${activeCount}, attendu ${EXPECTED_CS_AFTER} (${TOTAL_CS_AT_EXECUTION_START} - ${EXPECTED_MERGES})`)
  }
  console.log(`  ✓ CS actifs OCEF : ${activeCount}`)

  // Frontières Choix B — les deux survivants de chaque grappe contaminée doivent rester distincts
  const protectedBoundaries: Array<[string, string, string]> = [
    ['43e59642-1b78-4331-a995-1e626bf8fb86', '78e477a2-a75b-4147-a314-14a825c0386f', 'Réalisation Purge ≠ Démarrage purge'],
    ['d9bb24b2-d51a-41db-a270-c934d3d4cec4', '7f684dad-d939-4580-8d57-dc26a8f2ac9c', 'GNT réalisation ≠ Prévision couche de forme'],
    ['3339f975-5d3a-4a60-8c9e-2d3a770f5ab7', '5a507b15-eae0-49dd-9076-2c915e45d3d6', 'GDE Fossé ≠ GDE Busage'],
  ]

  for (const [idA, idB, desc] of protectedBoundaries) {
    const { data, error } = await sb
      .from('canonical_subject')
      .select('id, status')
      .in('id', [idA, idB])

    if (error) stopNow(`DB error vérification frontière : ${error.message}`)

    const a = (data ?? []).find(r => r.id === idA)
    const b = (data ?? []).find(r => r.id === idB)

    if (a?.status !== 'active' || b?.status !== 'active') {
      stopNow(`Frontière violée : ${desc} — a.status=${a?.status}, b.status=${b?.status}`)
    }
    console.log(`  ✓ Frontière protégée : ${desc}`)
  }

  const { count: journalCount, error: jErr } = await sb
    .from('canonical_subject_merge')
    .select('*', { count: 'exact', head: true })
    .eq('engine_version', ENGINE_VERSION)

  if (jErr) stopNow(`DB error journal count : ${jErr.message}`)
  if (journalCount !== EXPECTED_MERGES) {
    stopNow(`Journal P1-5B : ${journalCount} entrées, attendu ${EXPECTED_MERGES}`)
  }
  console.log(`  ✓ Journal P1-5B : ${journalCount} entrées`)
}

// ── Pre-flight ────────────────────────────────────────────────────────────────

// Retourne le nombre de merges déjà complétés (pour reprise idempotente)
async function preflight(): Promise<number> {
  console.log('\n[preflight] Vérification de l\'état OCEF...')

  // Compter les merges P1-5B déjà journalisés (reprise idempotente)
  const { count: doneCount, error: doneErr } = await sb
    .from('canonical_subject_merge')
    .select('*', { count: 'exact', head: true })
    .eq('engine_version', ENGINE_VERSION)

  if (doneErr) stopNow(`DB error preflight journal count : ${doneErr.message}`)
  const alreadyDone = doneCount ?? 0

  const { count: activeCount, error: activeErr } = await sb
    .from('canonical_subject')
    .select('*', { count: 'exact', head: true })
    .eq('site_id', OCEF_SITE_ID)
    .eq('status', 'active')

  if (activeErr) stopNow(`DB error preflight active count : ${activeErr.message}`)

  const expectedActive = TOTAL_CS_AT_EXECUTION_START - alreadyDone
  console.log(`  CS actifs OCEF : ${activeCount ?? 0} (attendu ${expectedActive} après ${alreadyDone} merges déjà faits)`)

  if ((activeCount ?? 0) !== expectedActive) {
    console.error(`  Incohérence : activeCount=${activeCount}, alreadyDone=${alreadyDone}, base=${TOTAL_CS_AT_EXECUTION_START}`)
    stopNow('Préflight échoué — état DB incohérent avec le journal P1-5B')
  }

  if (alreadyDone > 0) {
    console.log(`  Reprise depuis le merge ${alreadyDone + 1}/${EXPECTED_MERGES}`)
  }

  // Vérifier que les targets et CS isolés sont toujours actifs
  const targetAndLoneIds = [...new Set([
    ...CLUSTERS.flatMap(c => c.merges.map(m => m.target)),
    ...CLUSTERS.flatMap(c => (c.lone ?? []).map(l => l.id)),
  ])]

  const { data: csData, error: csErr } = await sb
    .from('canonical_subject')
    .select('id, label, status')
    .in('id', targetAndLoneIds)

  if (csErr) stopNow(`DB error preflight CS lookup : ${csErr.message}`)

  const csMap = new Map((csData ?? []).map((r: Record<string, unknown>) => [r.id as string, r]))
  const problems: string[] = []

  for (const id of targetAndLoneIds) {
    const cs = csMap.get(id)
    if (!cs) problems.push(`INTROUVABLE: ${id}`)
    else if ((cs as Record<string, unknown>).status !== 'active') problems.push(`NON-ACTIF: ${id} (${(cs as Record<string, unknown>).label}) status=${(cs as Record<string, unknown>).status}`)
  }

  if (problems.length > 0) {
    console.error('  Cibles/isolés avec problème :')
    for (const p of problems) console.error(`    - ${p}`)
    stopNow(`${problems.length} cibles du manifeste non disponibles`)
  }

  console.log(`  ✓ Préflight OK — ${alreadyDone} merges déjà effectués`)
  return alreadyDone
}

// ── Rapport ───────────────────────────────────────────────────────────────────

function generateReport(records: MergeRecord[], startMs: number): string {
  const totalMs = Date.now() - startMs
  const totalLinks = records.reduce((s, r) => s + r.linksMoved, 0)
  const totalSelf = records.reduce((s, r) => s + r.selfLinksDeleted, 0)
  const totalDup = records.reduce((s, r) => s + r.duplicateLinksDeleted, 0)

  const rows = records.map(r =>
    `| ${r.cluster} | ${r.sourceLabel} → ${r.targetLabel} | ${r.linksMoved} | ${r.selfLinksDeleted} | ${r.duplicateLinksDeleted} | ${r.durationMs}ms |`
  ).join('\n')

  return `# P1-5B — Re-canonicalisation contrôlée OCEF

**Date :** 2026-08-22
**Engine :** ${ENGINE_VERSION}
**Site :** OCEF Compostage (${OCEF_SITE_ID})
**Durée totale :** ${Math.round(totalMs / 1000)}s

## Verdict

**PASS** — 27 fusions exécutées avec succès. Aucune anomalie détectée.

## Statistiques

| Métrique | Valeur |
|---|---|
| CS actifs avant P1-5B | ${TOTAL_CS_AT_EXECUTION_START} (audit P1-5A : 131, +26 ajoutés depuis 2026-08-02) |
| Fusions exécutées | ${EXPECTED_MERGES} |
| CS actifs après P1-5B | ${EXPECTED_CS_AFTER} |
| Grappes CLEAN | 15 |
| Grappes Choix B | 2 (GNT + Purge) |
| CS isolés préservés (Choix B) | 2 (Prévision GNT + Démarrage purge) |
| canonical_subject_links reroutés | ${totalLinks} |
| Self-links supprimés | ${totalSelf} |
| Liens dupliqués supprimés | ${totalDup} |

## Choix B — Frontières RELATED préservées

| Paire | Décision |
|---|---|
| Réalisation Purge Plateforme ↔ Démarrage purge plateforme | DISTINCT (arête RELATED — frontière de composante) |
| Mise en place couche de forme (GNT) ↔ Prévision : Mise en place couche de forme | DISTINCT (arête RELATED — frontière de composante) |

## Détail des fusions

| Grappe | Fusion | Links reroutés | Self-links supprimés | Duplic. supprimés | Durée |
|---|---|---|---|---|---|
${rows}

## Journal de traçabilité

Toutes les fusions sont journalisées dans \`canonical_subject_merge\` avec :
- \`engine_version = '${ENGINE_VERSION}'\`
- \`resolution_source = 'automatic'\`
- \`p02_confidence = ${P02_CONFIDENCE}\`
- Snapshot complet (links_snapshot_before, moved_link_ids, moved_occurrence_ids, moved_thread_ids)

## État post-P1-5B

- P1-5B : **CLOS**
- Prochaine étape : P1-3 / P1-4 (lastSeenAt / lastMeaningfulChangeAt) débloqués
- Idempotence théorique : 9 paires résiduelles P0-1 toutes DISTINCT par P0-2 (voir P1-5A dry-run)
`
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function isAlreadyMerged(sourceId: string, targetId: string): Promise<boolean> {
  const { data } = await sb
    .from('canonical_subject')
    .select('status, merged_into')
    .eq('id', sourceId)
    .maybeSingle()
  if (!data) return false
  if (data.status === 'merged' && data.merged_into === targetId) return true
  if (data.status === 'merged' && data.merged_into !== targetId) {
    stopNow(`source ${sourceId} est merged_into=${data.merged_into}, attendu ${targetId} — état incohérent`)
  }
  return false
}

async function main() {
  const startMs = Date.now()
  console.log('=== P1-5B — RE-CANONICALISATION CONTRÔLÉE OCEF ===')
  console.log(`  Engine  : ${ENGINE_VERSION}`)
  console.log(`  Site    : ${OCEF_SITE_ID}`)
  console.log(`  Grappes : ${CLUSTERS.length} (15 CLEAN + 2 CHOIX_B)`)
  console.log(`  Fusions : ${EXPECTED_MERGES} prévues`)

  await preflight()

  const records: MergeRecord[] = []

  for (const cluster of CLUSTERS) {
    console.log(`\n── ${cluster.name} [${cluster.type}] ──`)

    for (const op of cluster.merges) {
      // Reprise idempotente : sauter les merges déjà effectués
      if (await isAlreadyMerged(op.source, op.target)) {
        console.log(`  skip (déjà effectué) : ${op.sourceLabel} → ${op.targetLabel}`)
        records.push({ cluster: cluster.name, sourceLabel: op.sourceLabel, targetLabel: op.targetLabel, linksMoved: 0, selfLinksDeleted: 0, duplicateLinksDeleted: 0, durationMs: 0 })
        continue
      }

      console.log(`  merge : ${op.sourceLabel}`)
      console.log(`       → ${op.targetLabel}`)

      const t0 = Date.now()
      const res = await mergeWithJournal({
        sourceId: op.source,
        targetId: op.target,
        siteId: OCEF_SITE_ID,
        engineVersion: ENGINE_VERSION,
        p01Jaccard: null,
        p02Confidence: P02_CONFIDENCE,
        suggestedLabel: null,
      })
      const durationMs = Date.now() - t0

      if (!res.ok) {
        stopNow(`mergeWithJournal échoué : ${res.error}`)
      }

      const r = res.result as Record<string, unknown>
      const linksMoved = typeof r?.linksMoved === 'number' ? r.linksMoved : 0
      const selfLinksDeleted = typeof r?.selfLinksDeleted === 'number' ? r.selfLinksDeleted : 0
      const duplicateLinksDeleted = typeof r?.duplicateLinksDeleted === 'number' ? r.duplicateLinksDeleted : 0
      const dupOccDeleted = typeof r?.duplicateOccurrencesDeleted === 'number' ? r.duplicateOccurrencesDeleted : 0

      console.log(`    merge SQL OK (links=${linksMoved}, selfDel=${selfLinksDeleted}, dupLinks=${duplicateLinksDeleted}, dupOcc=${dupOccDeleted}, ${durationMs}ms)`)
      records.push({ cluster: cluster.name, sourceLabel: op.sourceLabel, targetLabel: op.targetLabel, linksMoved, selfLinksDeleted, duplicateLinksDeleted, durationMs })

      await verifySingleMerge(op.source, op.target)
    }

    for (const lone of (cluster.lone ?? [])) {
      await verifyLoneCs(lone.id, lone.label)
    }

    console.log(`  ✓ ${cluster.name} VALIDÉ`)
  }

  await globalVerification()

  const reportPath = join(process.cwd(), 'docs', 'memory-longitudinal-v1', 'P1-5B-RECANONICALIZATION-RESULT.md')
  writeFileSync(reportPath, generateReport(records, startMs), 'utf-8')
  console.log(`\nRapport : ${reportPath}`)

  const totalMs = Date.now() - startMs
  console.log(`\n=== P1-5B PASS — ${records.length} fusions | ${EXPECTED_CS_AFTER} CS actifs | ${Math.round(totalMs / 1000)}s ===`)
}

main().catch(e => { console.error(e); process.exit(1) })
