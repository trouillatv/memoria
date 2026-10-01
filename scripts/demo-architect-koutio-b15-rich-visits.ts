#!/usr/bin/env npx tsx
/**
 * B1.5 — Richesse de visite Koutio Horizon : exerce réellement la couche
 * « intelligence » de MemorIA au-dessus du seed B1 (demo-architect-koutio-seed.ts),
 * qui n'écrit que des lignes brutes via SQL et ne passe jamais par le pipeline
 * débrief → propositions → réconciliation → confirmation humaine → CR.
 *
 * Ce script :
 *   1. Enrichit debrief_analysis de report:03 et report:07 (decisions/watchpoints/
 *      a_savoir/echeances, vides dans le seed B1) ;
 *   2. Insère 15 visit_capture (kind='note') sur 5 visites cibles ;
 *   3. Projette report:03/04/06/07 via projectDebriefToProposals() (le vrai moteur) ;
 *   4. Réconcilie explicitement (awaited) les nouvelles propositions éligibles ;
 *   5. Confirme humainement 7 intervenants + 4/5 décisions de report:11 via
 *      promoteProposal(), et écarte 2 intervenants via dismissProposal() ;
 *   6. Matérialise les CR de report:04 et report:11 via getOrCreateVisitCrDocument().
 *
 * N'écrit que via createAdminClient() (supabase-js, service-role) — jamais de SQL
 * brut : les écritures passent par le VRAI code applicatif, pas par une copie.
 * Idempotent et réexécutable : chaque étape vérifie l'état avant d'agir.
 *
 * Usage :
 *   npx tsx scripts/demo-architect-koutio-b15-rich-visits.ts --dry-run
 *   npx tsx scripts/demo-architect-koutio-b15-rich-visits.ts --rollback --dry-run
 *   npx tsx scripts/demo-architect-koutio-b15-rich-visits.ts --rollback
 *   npx tsx scripts/demo-architect-koutio-b15-rich-visits.ts
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

function loadEnv() {
  const envFile = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(envFile)) return
  for (const line of fs.readFileSync(envFile, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim()
  }
}
loadEnv()

// supabase-js peut référencer WebSocket (canal realtime) même en usage purement
// admin/REST côté Node — polyfill défensif, même convention que les autres
// scripts @/lib/db (cf. scripts/dev/seed-collaboration-demo.ts).
const ws = require('ws')
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
  ;(globalThis as { WebSocket: unknown }).WebSocket = ws
}

import { ORG_ID, SITE_ID, duid, SEED_KEY, PROTECTED_ORGS, assertSafeOrgId, DAVID_ID } from './demo-architect-koutio-seed'
import { createAdminClient } from '@/lib/supabase/admin'
import { projectDebriefToProposals, promoteProposal, dismissProposal } from '@/lib/db/knowledge-proposals'
import { reconcileProposalToCanonical, ELIGIBLE_KINDS } from '@/lib/db/canonical-subject-reconcile'
import { getOrCreateVisitCrDocument } from '@/lib/db/visit-cr-documents'

assertSafeOrgId(ORG_ID, 'b15:auto-check ORG_ID vs liste protégée')

// ════════════════════════════════════════════════════════════════════════════════
// IDENTIFIANTS — report ids déterministes, IDENTIQUES à ceux du seed B1
// (reportId(key) = duid(key), cf. demo-architect-koutio-seed.ts:388)
// ════════════════════════════════════════════════════════════════════════════════

const REPORT = {
  '03': duid('report:03'),
  '04': duid('report:04'),
  '06': duid('report:06'),
  '07': duid('report:07'),
  '11': duid('report:11'),
} as const

// Sociétés/contacts — mêmes clés que COMPANIES/CONTACTS du seed B1 (non exportées
// là-bas : on réapplique la même formule déterministe ici).
const companyId = (key: string) => duid(`company:${key}`)
const contactId = (key: string) => duid(`contact:${key}`)

type StakeholderTarget = {
  name: string
  companyId: string
  contactId: string
  role: string
}

// Les 7 intervenants à CONFIRMER humainement — identité pleinement résolue
// (entreprise + contact connus dans le seed B1, cf. CONTACTS).
const STAKEHOLDERS_TO_PROMOTE: StakeholderTarget[] = [
  { name: 'Sophie Martin', companyId: companyId('atelier-bouvier'), contactId: contactId('sophie-martin'), role: 'Architecte projet' },
  { name: 'Léa Ménézo', companyId: companyId('coordination-pacifique'), contactId: contactId('lea-menezo'), role: 'OPC' },
  { name: 'Marc Delmas', companyId: companyId('pacifique-btp'), contactId: contactId('marc-delmas'), role: 'Conducteur de travaux' },
  { name: 'Alain Koteureu', companyId: companyId('pacifique-btp'), contactId: contactId('alain-koteureu'), role: 'Chef de chantier' },
  { name: 'Paul Garcia', companyId: companyId('bureau-control-nc'), contactId: contactId('paul-garcia'), role: 'Contrôleur technique' },
  { name: 'Éric Nakamura', companyId: companyId('e2nc'), contactId: contactId('eric-nakamura'), role: 'BET électricité' },
  { name: 'Thierry Lopes', companyId: companyId('hydro-nc'), contactId: contactId('thierry-lopes'), role: 'Étanchéité' },
]

// Les 2 intervenants de report:11 à ÉCARTER (pas d'identité propre à matérialiser).
const STAKEHOLDERS_TO_DISMISS: Array<{ name: string; reason: string }> = [
  {
    name: 'David Bouvier',
    reason: "Compte architecte mandataire déjà représenté ailleurs dans le système — pas un intervenant externe à matérialiser.",
  },
  {
    name: 'Mélanie Durand',
    reason: "Représentante MOA sans fiche contact identifiée — aucune identité propre à rattacher sans en inventer une.",
  },
]

// Les décisions de report:11 à CONFIRMER (4 des 5 — la 5ᵉ reste 'proposed', backlog
// de revue humaine réaliste).
const REPORT_11_DECISIONS_TO_PROMOTE = [
  "Référence alternative de carrelage retenue pour le hall en cas de rupture de stock.",
  "Validation définitive de la teinte de façade.",
  "Maintien de la porte technique existante en local poubelles.",
  "Adaptation du seuil PMR du commerce RDC — solution de reprise à valider avec STRUCT NC.",
]

// ════════════════════════════════════════════════════════════════════════════════
// ENRICHISSEMENT DEBRIEF — report:03 et report:07
// ════════════════════════════════════════════════════════════════════════════════

const DEBRIEF_ENRICHMENT: Record<'03' | '07', { decisions: string[]; watchpoints: Array<{ label: string; impact: string; owner: string; due: string }>; a_savoir: string[]; echeances: Array<{ label: string; date: string; constraint: string }> }> = {
  '03': {
    decisions: [
      "Réalisation d'un sondage localisé de l'étanchéité avant d'engager une reprise lourde, pour confirmer l'origine de la stagnation.",
    ],
    watchpoints: [
      {
        label: "Si la stagnation réapparaît après le sondage ponctuel, anticiper une reprise complète de l'étanchéité et de la chape de forme.",
        impact: "Risque d'infiltration vers l'appartement B301 en cas de nouvelle pluie forte.",
        owner: 'Marc Delmas',
        due: '',
      },
    ],
    a_savoir: [
      "La baie de la terrasse B302 est au point bas du relevé d'étanchéité — zone déjà identifiée comme sensible lors du design.",
    ],
    echeances: [
      { label: "Contre-essai d'arrosage après le sondage localisé", date: '', constraint: 'Avant la prochaine visite de contrôle' },
    ],
  },
  '07': {
    decisions: [
      "Levée de la réserve sur le déplacement du tableau électrique A204 — travaux conformes.",
    ],
    watchpoints: [
      {
        label: "Terrasse B302 : la nouvelle étanchéité n'a pas encore subi d'essai d'arrosage complémentaire avant l'OPR.",
        impact: "Risque de découvrir une non-conformité tardive, après la levée des autres réserves.",
        owner: 'Thierry Lopes',
        due: '2026-09-20',
      },
    ],
    a_savoir: [
      "Le déplacement du tableau électrique A204 a nécessité une adaptation mineure du cheminement des gaines, sans impact sur le planning.",
    ],
    echeances: [
      { label: "Essai d'arrosage complémentaire de la terrasse B302", date: '2026-09-20', constraint: 'Avant l’OPR' },
    ],
  },
}

async function enrichDebrief(admin: ReturnType<typeof createAdminClient>, key: '03' | '07'): Promise<{ changed: boolean; version: number }> {
  const reportId = REPORT[key]
  const { data, error } = await admin.from('site_reports').select('debrief_analysis').eq('id', reportId).single()
  if (error || !data) throw new Error(`report:${key} introuvable (${reportId}) — ${error?.message ?? 'no data'}`)
  const current = (data as { debrief_analysis: Record<string, unknown> }).debrief_analysis
  const enrich = DEBRIEF_ENRICHMENT[key]

  // Idempotence : si déjà enrichi (décisions déjà présentes), ne rien refaire.
  const alreadyDone = Array.isArray(current.decisions) && current.decisions.length > 0 && JSON.stringify(current.decisions) === JSON.stringify(enrich.decisions)
  if (alreadyDone) {
    return { changed: false, version: (current.analysis_version as number) ?? 1 }
  }

  const nextVersion = ((current.analysis_version as number) ?? 1) + (((current.analysis_version as number) ?? 1) === 1 ? 1 : 0)
  const updated = {
    ...current,
    decisions: enrich.decisions,
    watchpoints: enrich.watchpoints,
    a_savoir: enrich.a_savoir,
    echeances: enrich.echeances,
    analysis_version: Math.max(nextVersion, 2),
  }
  const { error: updErr } = await admin.from('site_reports').update({ debrief_analysis: updated }).eq('id', reportId)
  if (updErr) throw updErr
  return { changed: true, version: updated.analysis_version }
}

// ════════════════════════════════════════════════════════════════════════════════
// VISIT_CAPTURE — 15 notes réalistes sur 5 visites cibles
// ════════════════════════════════════════════════════════════════════════════════

type CaptureDef = { reportKey: keyof typeof REPORT; n: number; body: string }

const CAPTURES: CaptureDef[] = [
  // report:03 — Terrasse B302, 1re stagnation
  { reportKey: '03', n: 1, body: "Flaque d'eau stagnante devant la baie coulissante de la terrasse B302, environ 1h après l'arrêt de l'arrosage." },
  { reportKey: '03', n: 2, body: "Pente de la terrasse correcte visuellement ; l'eau reste surtout contre le seuil de la baie." },
  { reportKey: '03', n: 3, body: "Thierry Lopes propose un sondage ponctuel de l'étanchéité sous le seuil avant d'envisager une reprise complète." },
  // report:04 — récidive
  { reportKey: '04', n: 1, body: "Même zone que la visite du 21/05 : stagnation d'eau reconstatée après un nouvel essai d'arrosage." },
  { reportKey: '04', n: 2, body: "Le sondage réalisé entre les deux visites confirme un défaut d'étanchéité sous la chape, pas seulement en surface." },
  { reportKey: '04', n: 3, body: "Décision de reprise lourde actée avec Marc Delmas et Thierry Lopes : dépose, reprise de chape, nouvelle étanchéité." },
  // report:06 — tableau électrique A204
  { reportKey: '06', n: 1, body: "Le tableau électrique de la cuisine A204 empiète sur le passage prévu entre cuisine et séjour." },
  { reportKey: '06', n: 2, body: "Éric Nakamura confirme un déplacement de 35 cm possible sans toucher au tableau de répartition général." },
  // report:07 — contrôle A204/B302
  { reportKey: '07', n: 1, body: "A204 : le tableau électrique déplacé de 35 cm — passage dégagé, réserve levée sur place." },
  { reportKey: '07', n: 2, body: "B302 : la nouvelle étanchéité tient visuellement, pas de trace d'humidité sous le seuil." },
  { reportKey: '07', n: 3, body: "Thierry Lopes recommande un essai d'arrosage complémentaire avant l'OPR pour sécuriser la levée définitive de la réserve B302." },
  // report:11 — pré-OPR
  { reportKey: '11', n: 1, body: "Carrelage du hall : le lot initial est en rupture de stock chez le fournisseur, une référence alternative proche est proposée." },
  { reportKey: '11', n: 2, body: "Teinte de façade : les deux nuanciers posés sur le mur test sont comparés en lumière naturelle du matin." },
  { reportKey: '11', n: 3, body: "Fissure constatée dans le mur du séjour de l'appartement A301, à surveiller — nouvelle action ouverte." },
  { reportKey: '11', n: 4, body: "Seuil PMR du commerce RDC : la solution actuelle ne respecte pas la hauteur réglementaire, à valider avec STRUCT NC." },
]

const VISIT_START: Record<keyof typeof REPORT, string> = {
  '03': '2026-05-21T08:00:00+11:00',
  '04': '2026-06-18T08:00:00+11:00',
  '06': '2026-07-16T08:00:00+11:00',
  '07': '2026-07-30T08:00:00+11:00',
  '11': '2026-09-24T08:00:00+11:00',
}

function captureId(c: CaptureDef): string {
  return duid(`b15:capture:report:${c.reportKey}:${c.n}`)
}

async function insertCaptures(admin: ReturnType<typeof createAdminClient>): Promise<{ inserted: number; alreadyPresent: number }> {
  const ids = CAPTURES.map(captureId)
  const { data: existingRows, error: selErr } = await admin.from('visit_capture').select('id').in('id', ids)
  if (selErr) throw selErr
  const existing = new Set((existingRows ?? []).map((r: { id: string }) => r.id))

  const toInsert = CAPTURES.filter((c) => !existing.has(captureId(c))).map((c) => {
    const start = new Date(VISIT_START[c.reportKey])
    const capturedAt = new Date(start.getTime() + (c.n - 1) * 10 * 60 * 1000)
    return {
      id: captureId(c),
      organization_id: ORG_ID,
      site_id: SITE_ID,
      report_id: REPORT[c.reportKey],
      kind: 'note',
      status: 'kept',
      body: c.body,
      triage_intent: 'memoire',
      processing_stage: 'ready',
      source: 'field_visit',
      captured_at: capturedAt.toISOString(),
      captured_at_source: 'visit',
      created_by: DAVID_ID,
    }
  })

  if (toInsert.length > 0) {
    const { error: insErr } = await admin.from('visit_capture').insert(toInsert)
    if (insErr) throw insErr
  }
  return { inserted: toInsert.length, alreadyPresent: existing.size }
}

// ════════════════════════════════════════════════════════════════════════════════
// PROJECTION + RÉCONCILIATION EXPLICITE
// ════════════════════════════════════════════════════════════════════════════════

async function projectAndReconcile(admin: ReturnType<typeof createAdminClient>, key: '03' | '04' | '06' | '07'): Promise<{ inserted: number; refreshed: number; reconciled: number }> {
  const reportId = REPORT[key]
  const { data, error } = await admin
    .from('site_reports')
    .select('debrief_analysis')
    .eq('id', reportId)
    .single()
  if (error || !data) throw new Error(`report:${key} introuvable pour projection — ${error?.message ?? 'no data'}`)
  const analysis = (data as { debrief_analysis: Record<string, unknown> }).debrief_analysis

  const result = await projectDebriefToProposals({
    reportId,
    siteId: SITE_ID,
    organizationId: ORG_ID,
    analysis: analysis as never,
  })

  // Réconciliation EXPLICITE et AWAITED des propositions nouvellement créées et
  // éligibles — projectDebriefToProposals la lance déjà en fire-and-forget
  // (non-awaited), insuffisant dans un process de script court-vécu.
  const { data: proposals, error: propErr } = await admin
    .from('site_knowledge_proposals')
    .select('id, kind, title, body, created_at')
    .eq('report_id', reportId)
    .eq('status', 'proposed')
  if (propErr) throw propErr

  let reconciled = 0
  for (const p of (proposals ?? []) as Array<{ id: string; kind: string; title: string; body: string | null; created_at: string }>) {
    if (!ELIGIBLE_KINDS.has(p.kind)) continue
    await reconcileProposalToCanonical({
      proposalId: p.id,
      siteId: SITE_ID,
      reportId,
      proposalKind: p.kind,
      proposalTitle: p.title,
      proposalBody: p.body,
      proposalCreatedAt: p.created_at,
      createdBy: null,
      validationStatus: 'observed',
    })
    reconciled++
  }

  return { inserted: result.inserted, refreshed: result.refreshed, reconciled }
}

// ════════════════════════════════════════════════════════════════════════════════
// CONFIRMATION HUMAINE — promote / dismiss
// ════════════════════════════════════════════════════════════════════════════════

async function promoteStakeholders(admin: ReturnType<typeof createAdminClient>): Promise<{ promoted: string[]; alreadyPromoted: string[]; notFound: string[] }> {
  const promoted: string[] = []
  const alreadyPromoted: string[] = []
  const notFound: string[] = []

  for (const s of STAKEHOLDERS_TO_PROMOTE) {
    const { data, error } = await admin
      .from('site_knowledge_proposals')
      .select('id, status')
      .eq('site_id', SITE_ID)
      .eq('kind', 'stakeholder')
      .eq('title', s.name)
      .limit(1)
    if (error) throw error
    const row = (data ?? [])[0] as { id: string; status: string } | undefined
    if (!row) {
      notFound.push(s.name)
      continue
    }
    if (row.status === 'confirmed' || row.status === 'fulfilled') {
      alreadyPromoted.push(s.name)
      continue
    }
    const outcome = await promoteProposal({
      id: row.id,
      userId: DAVID_ID,
      organizationId: ORG_ID,
      input: { companyId: s.companyId, contactId: s.contactId, role: s.role },
    })
    if (outcome.status === 'promoted') promoted.push(s.name)
    else alreadyPromoted.push(`${s.name} (${outcome.status})`)
  }
  return { promoted, alreadyPromoted, notFound }
}

async function dismissStakeholders(admin: ReturnType<typeof createAdminClient>): Promise<{ dismissed: string[]; alreadyDismissed: string[]; notFound: string[] }> {
  const dismissed: string[] = []
  const alreadyDismissed: string[] = []
  const notFound: string[] = []

  for (const s of STAKEHOLDERS_TO_DISMISS) {
    const { data, error } = await admin
      .from('site_knowledge_proposals')
      .select('id, status')
      .eq('site_id', SITE_ID)
      .eq('kind', 'stakeholder')
      .eq('title', s.name)
      .limit(1)
    if (error) throw error
    const row = (data ?? [])[0] as { id: string; status: string } | undefined
    if (!row) {
      notFound.push(s.name)
      continue
    }
    if (row.status === 'dismissed') {
      alreadyDismissed.push(s.name)
      continue
    }
    const ok = await dismissProposal(row.id, DAVID_ID, s.reason, ORG_ID, 'not_relevant')
    if (ok) dismissed.push(s.name)
    else alreadyDismissed.push(`${s.name} (update refusée — déjà traité ?)`)
  }
  return { dismissed, alreadyDismissed, notFound }
}

async function promoteReport11Decisions(admin: ReturnType<typeof createAdminClient>): Promise<{ promoted: string[]; alreadyPromoted: string[]; notFound: string[] }> {
  const promoted: string[] = []
  const alreadyPromoted: string[] = []
  const notFound: string[] = []

  for (const title of REPORT_11_DECISIONS_TO_PROMOTE) {
    const { data, error } = await admin
      .from('site_knowledge_proposals')
      .select('id, status')
      .eq('report_id', REPORT['11'])
      .eq('kind', 'decision')
      .eq('title', title)
      .limit(1)
    if (error) throw error
    const row = (data ?? [])[0] as { id: string; status: string } | undefined
    if (!row) {
      notFound.push(title)
      continue
    }
    if (row.status === 'confirmed' || row.status === 'fulfilled') {
      alreadyPromoted.push(title)
      continue
    }
    const outcome = await promoteProposal({ id: row.id, userId: DAVID_ID, organizationId: ORG_ID })
    if (outcome.status === 'promoted') promoted.push(title)
    else alreadyPromoted.push(`${title} (${outcome.status})`)
  }
  return { promoted, alreadyPromoted, notFound }
}

// ════════════════════════════════════════════════════════════════════════════════
// CR DE VISITE — report:04 et report:11
// ════════════════════════════════════════════════════════════════════════════════

async function materializeCrDocuments(): Promise<Array<{ key: string; status: 'created' | 'reused' | 'no_analysis' }>> {
  const out: Array<{ key: string; status: 'created' | 'reused' | 'no_analysis' }> = []
  for (const key of ['04', '11'] as const) {
    // actorUserId explicite : ce script tourne hors contexte requête (pas de
    // cookies) — PROVENANCE (created_by=DAVID_ID) != AUTORISATION (actorUserId).
    const before = await getOrCreateVisitCrDocument(REPORT[key], DAVID_ID, DAVID_ID)
    if (!before) {
      out.push({ key, status: 'no_analysis' })
      continue
    }
    out.push({ key, status: 'created' })
  }
  return out
}

// ════════════════════════════════════════════════════════════════════════════════
// SEED PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════════

async function seed() {
  assertSafeOrgId(ORG_ID, 'seed')
  const admin = createAdminClient()

  console.log(`\n🚀 B1.5 — Richesse de visite Koutio Horizon (org ${ORG_ID})\n`)

  console.log('1) Enrichissement debrief_analysis (report:03, report:07)')
  for (const key of ['03', '07'] as const) {
    const r = await enrichDebrief(admin, key)
    console.log(`   report:${key} — ${r.changed ? `enrichi (analysis_version=${r.version})` : `déjà enrichi (analysis_version=${r.version})`}`)
  }

  console.log('\n2) Insertion visit_capture (15 notes cibles)')
  const capRes = await insertCaptures(admin)
  console.log(`   ${capRes.inserted} insérée(s), ${capRes.alreadyPresent} déjà présente(s)`)

  console.log('\n3) Projection debrief → propositions + réconciliation explicite (report:03/04/06/07)')
  for (const key of ['03', '04', '06', '07'] as const) {
    const r = await projectAndReconcile(admin, key)
    console.log(`   report:${key} — inserted=${r.inserted} refreshed=${r.refreshed} reconciled=${r.reconciled}`)
  }

  console.log('\n4) Confirmation humaine — 7 intervenants')
  const promRes = await promoteStakeholders(admin)
  console.log(`   promus: ${promRes.promoted.join(', ') || '(aucun)'}`)
  if (promRes.alreadyPromoted.length) console.log(`   déjà promus: ${promRes.alreadyPromoted.join(', ')}`)
  if (promRes.notFound.length) console.log(`   ⚠️ introuvables: ${promRes.notFound.join(', ')}`)

  console.log('\n5) Écartement humain — 2 intervenants (report:11)')
  const dismRes = await dismissStakeholders(admin)
  console.log(`   écartés: ${dismRes.dismissed.join(', ') || '(aucun)'}`)
  if (dismRes.alreadyDismissed.length) console.log(`   déjà écartés: ${dismRes.alreadyDismissed.join(', ')}`)
  if (dismRes.notFound.length) console.log(`   ⚠️ introuvables: ${dismRes.notFound.join(', ')}`)

  console.log('\n6) Confirmation humaine — 4/5 décisions report:11')
  const decRes = await promoteReport11Decisions(admin)
  console.log(`   promues: ${decRes.promoted.length}`)
  if (decRes.alreadyPromoted.length) console.log(`   déjà promues: ${decRes.alreadyPromoted.length}`)
  if (decRes.notFound.length) console.log(`   ⚠️ introuvables: ${decRes.notFound.join(', ')}`)

  console.log('\n7) Matérialisation des CR de visite (report:04, report:11)')
  const crRes = await materializeCrDocuments()
  for (const r of crRes) console.log(`   report:${r.key} — ${r.status}`)

  console.log('\n✅ B1.5 terminé.')
}

// ════════════════════════════════════════════════════════════════════════════════
// DRY-RUN — plan, aucune écriture
// ════════════════════════════════════════════════════════════════════════════════

async function dryRun() {
  assertSafeOrgId(ORG_ID, 'dryRun')
  console.log(`\n🔎 DRY-RUN — B1.5 Koutio Horizon (aucune écriture)\n`)
  console.log('Plan :')
  console.log(`  - Enrichir debrief_analysis de report:03 (${REPORT['03']}) et report:07 (${REPORT['07']})`)
  console.log(`  - Insérer ${CAPTURES.length} visit_capture (report:03=3, 04=3, 06=2, 07=3, 11=4)`)
  console.log(`  - Projeter report:03/04/06/07 via projectDebriefToProposals() + réconciliation awaited`)
  console.log(`  - Promouvoir ${STAKEHOLDERS_TO_PROMOTE.length} intervenants : ${STAKEHOLDERS_TO_PROMOTE.map((s) => s.name).join(', ')}`)
  console.log(`  - Écarter ${STAKEHOLDERS_TO_DISMISS.length} intervenants : ${STAKEHOLDERS_TO_DISMISS.map((s) => s.name).join(', ')}`)
  console.log(`  - Promouvoir ${REPORT_11_DECISIONS_TO_PROMOTE.length}/5 décisions de report:11`)
  console.log(`  - Matérialiser les CR de report:04 et report:11`)
  console.log('\nAucune écriture exécutée (mode --dry-run).')
}

// ════════════════════════════════════════════════════════════════════════════════
// ROLLBACK — défait exactement ce que B1.5 a produit, jamais le seed B1 lui-même
// ════════════════════════════════════════════════════════════════════════════════

function buildDebriefAnalysisPristine(current: Record<string, unknown>) {
  return {
    ...current,
    decisions: [],
    watchpoints: [],
    a_savoir: [],
    echeances: [],
    analysis_version: 1,
  }
}

async function rollbackDryRun() {
  assertSafeOrgId(ORG_ID, 'rollbackDryRun')
  const admin = createAdminClient()
  console.log(`\n🔎 Rollback --dry-run — B1.5 Koutio Horizon (${ORG_ID})\n`)

  const capIds = CAPTURES.map(captureId)
  const { data: caps } = await admin.from('visit_capture').select('id').in('id', capIds)
  console.log(`  visit_capture (B1.5)              : ${(caps ?? []).length} ligne(s) seraient supprimées`)

  const { data: props } = await admin
    .from('site_knowledge_proposals')
    .select('id, kind, status, report_id')
    .in('report_id', [REPORT['03'], REPORT['04'], REPORT['06'], REPORT['07']])
  console.log(`  site_knowledge_proposals (03/04/06/07) : ${(props ?? []).length} ligne(s) seraient supprimées (créées par B1.5, inexistantes avant)`)

  const { data: decisions } = await admin.from('site_decisions').select('id').eq('site_id', SITE_ID)
  console.log(`  site_decisions                    : ${(decisions ?? []).length} ligne(s) seraient supprimées`)

  const { data: intervenants } = await admin
    .from('site_intervenants')
    .select('id')
    .eq('site_id', SITE_ID)
    .in(
      'main_contact_id',
      STAKEHOLDERS_TO_PROMOTE.map((s) => s.contactId),
    )
  console.log(`  site_intervenants (7 promus)       : ${(intervenants ?? []).length} ligne(s) seraient supprimées`)

  const { data: crDocs } = await admin
    .from('report_documents')
    .select('id')
    .in('report_id', [REPORT['04'], REPORT['11']])
  console.log(`  report_documents (CR 04/11)        : ${(crDocs ?? []).length} ligne(s) seraient supprimées`)

  console.log('\nreport:11 : les 12 propositions pré-existantes seraient repassées à status=proposed (pas supprimées).')
  console.log('report:03/07 : debrief_analysis serait remis à l’état vide (version 1).')
  console.log('\nAucune suppression exécutée (mode --rollback --dry-run).')
}

async function rollbackReal() {
  assertSafeOrgId(ORG_ID, 'rollbackReal')
  const admin = createAdminClient()
  console.log(`\n🗑️  ROLLBACK RÉEL — B1.5 Koutio Horizon (${ORG_ID})\n`)

  // 1) CR de visite créés par B1.5 (report:04, report:11 — 0 existait avant).
  const { error: crErr, count: crCount } = await admin
    .from('report_documents')
    .delete({ count: 'exact' })
    .in('report_id', [REPORT['04'], REPORT['11']])
  if (crErr) throw crErr
  console.log(`  report_documents (CR 04/11)        : ${crCount ?? 0} ligne(s) supprimée(s)`)

  // 2) site_intervenants ouverts par les 7 promotions.
  const { error: siErr, count: siCount } = await admin
    .from('site_intervenants')
    .delete({ count: 'exact' })
    .eq('site_id', SITE_ID)
    .in(
      'main_contact_id',
      STAKEHOLDERS_TO_PROMOTE.map((s) => s.contactId),
    )
  if (siErr) throw siErr
  console.log(`  site_intervenants (7 promus)       : ${siCount ?? 0} ligne(s) supprimée(s)`)

  // 3) site_decisions créées par les 4 promotions de report:11.
  const { error: sdErr, count: sdCount } = await admin
    .from('site_decisions')
    .delete({ count: 'exact' })
    .eq('site_id', SITE_ID)
  if (sdErr) throw sdErr
  console.log(`  site_decisions                    : ${sdCount ?? 0} ligne(s) supprimée(s)`)

  // 4) site_knowledge_proposals créées par la projection de report:03/04/06/07
  //    (n'existaient pas avant B1.5 — à la différence de report:11).
  const { error: propErr, count: propCount } = await admin
    .from('site_knowledge_proposals')
    .delete({ count: 'exact' })
    .in('report_id', [REPORT['03'], REPORT['04'], REPORT['06'], REPORT['07']])
  if (propErr) throw propErr
  console.log(`  site_knowledge_proposals (03/04/06/07) : ${propCount ?? 0} ligne(s) supprimée(s)`)

  // 5) report:11 — propositions PRÉ-EXISTANTES : remises à status='proposed',
  //    jamais supprimées (elles existaient avant B1.5).
  const { error: resetErr, count: resetCount } = await admin
    .from('site_knowledge_proposals')
    .update({ status: 'proposed', reviewed_at: null, reviewed_by: null, dismiss_reason: null, dismiss_kind: null, promoted_object_type: null, promoted_object_id: null })
    .eq('report_id', REPORT['11'])
    .select('id', { count: 'exact' })
  if (resetErr) throw resetErr
  console.log(`  site_knowledge_proposals (report:11) : ${resetCount ?? 0} ligne(s) remise(s) à 'proposed'`)

  // 6) canonical_subject_occurrence liées aux propositions remises à zéro/supprimées.
  const { error: occErr, count: occCount } = await admin
    .from('canonical_subject_occurrence')
    .delete({ count: 'exact' })
    .eq('source_kind', 'field_visit')
    .in('source_ref_id', [REPORT['03'], REPORT['04'], REPORT['06'], REPORT['07']])
  if (occErr) throw occErr
  console.log(`  canonical_subject_occurrence (03/04/06/07) : ${occCount ?? 0} ligne(s) supprimée(s)`)

  // 7) visit_capture des 15 notes B1.5.
  const capIds = CAPTURES.map(captureId)
  const { error: capErr, count: capCount } = await admin.from('visit_capture').delete({ count: 'exact' }).in('id', capIds)
  if (capErr) throw capErr
  console.log(`  visit_capture (15 notes B1.5)      : ${capCount ?? 0} ligne(s) supprimée(s)`)

  // 8) debrief_analysis de report:03/07 — retour à l'état vide (version 1).
  for (const key of ['03', '07'] as const) {
    const { data } = await admin.from('site_reports').select('debrief_analysis').eq('id', REPORT[key]).single()
    if (!data) continue
    const current = (data as { debrief_analysis: Record<string, unknown> }).debrief_analysis
    const pristine = buildDebriefAnalysisPristine(current)
    const { error } = await admin.from('site_reports').update({ debrief_analysis: pristine }).eq('id', REPORT[key])
    if (error) throw error
    console.log(`  report:${key} debrief_analysis     : remis à l'état vide (analysis_version=1)`)
  }

  console.log('\n✅ Rollback B1.5 réel terminé.')
}

// ════════════════════════════════════════════════════════════════════════════════
// CLI
// ════════════════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2)
  const isDryRun = args.includes('--dry-run')
  const isRollback = args.includes('--rollback')

  if (isRollback && isDryRun) {
    await rollbackDryRun()
    return
  }
  if (isRollback && !isDryRun) {
    await rollbackReal()
    return
  }
  if (isDryRun) {
    await dryRun()
    return
  }
  await seed()
}

const isMainModule = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false
if (isMainModule) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}

export { REPORT, STAKEHOLDERS_TO_PROMOTE, STAKEHOLDERS_TO_DISMISS, REPORT_11_DECISIONS_TO_PROMOTE, CAPTURES }
