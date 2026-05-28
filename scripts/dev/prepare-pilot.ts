/**
 * scripts/dev/prepare-pilot.ts
 *
 * Prépare la base pour le pilote MVP Guillaume.
 *
 *   1. RESET des données métier (enfants→parents par FK) + logs de test
 *      (activity_logs, ai_usage). NE TOUCHE PAS : migrations, structure,
 *      policies, configs, ni les comptes auth (auth.users intact).
 *   2. Cadre les 3 comptes conservés (rôles uniquement). PAS de reset de mot de
 *      passe, PAS de must_change_password (décision « reset pas »).
 *   3. SEED sobre et crédible rattaché à guillaume.demene (chef terrain) :
 *      2 contrats NC, 1 client, 3 sites, 1 équipe, 3 missions, ~15 interventions
 *      sur ~2 semaines (photos, quelques anomalies, validations), 2 documents,
 *      1 passation partagée (/h/[token]).
 *
 *   ⚠️ DESTRUCTIF SUR LA CIBLE. Garde-fou : --confirm-on=<sous-chaîne de
 *      NEXT_PUBLIC_SUPABASE_URL> + --yes. Sans --yes → DRY-RUN (compte ce qui
 *      serait supprimé, affiche le plan de seed, n'écrit rien).
 *
 * USAGE
 *   Dry-run : npx tsx scripts/dev/prepare-pilot.ts --confirm-on=srixnofmaydxouhucawn
 *   Réel    : npx tsx scripts/dev/prepare-pilot.ts --confirm-on=srixnofmaydxouhucawn --yes
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })


const ws = require('ws')
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
  ;(globalThis as { WebSocket: unknown }).WebSocket = ws
}

import { createAdminClient } from '@/lib/supabase/admin'
import { createContract } from '@/lib/db/contracts'
import { bulkInsertEngagements, activateEngagementsForContract } from '@/lib/db/engagements'
import { createSite } from '@/lib/db/sites'
import { createMission } from '@/lib/db/missions'
import {
  createIntervention,
  bulkInsertChecklistItems,
  markChecklistItemDone,
  insertPhoto,
  createValidation,
  createAnomaly,
} from '@/lib/db/interventions'
import { createTeam } from '@/lib/db/teams'
import { buildTeamTakesSitePayload, createHandoverBrief, shareHandoverBrief } from '@/lib/db/handover'
import { createDocumentCollection, createDocument } from '@/lib/db/documents'
import type {
  ChecklistTemplateItem,
  PhotoKind,
  InterventionStatus,
  MissionCadence,
  AnomalyCategory,
  EngagementCategory,
  EngagementSourceType,
} from '@/types/db'

type Admin = ReturnType<typeof createAdminClient>

// ============================================================================
// Comptes à conserver (rôles cadrés ; mot de passe NON touché)
// ============================================================================
const KEEP = [
  { email: 'admin@memoria.nc', role: 'admin' as const },
  { email: 'manager@memoria.nc', role: 'manager' as const },
  { email: 'guillaume.demene@memoria.nc', role: 'chef_equipe' as const },
]
const FIELD_EMAIL = 'guillaume.demene@memoria.nc' // acteur terrain des interventions
const ADMIN_EMAIL = 'admin@memoria.nc' // créateur managérial (contrats/sites/missions/docs)

// ============================================================================
// Reset : ordre enfants→parents. JAMAIS users / auth. Les logs de test sont
// purgés à la fin (feuilles d'audit, sans enfants).
// ============================================================================
const RESET_TABLES: string[] = [
  // Passation + preuves + médias intervention
  'handover_briefs', 'proof_share_tokens', 'proof_verification_tokens', 'share_access_log',
  'intervention_access_events', 'intervention_photos', 'intervention_validations',
  'intervention_anomalies', 'intervention_checklist_items', 'intervention_participants',
  'intervention_voice_notes', 'interventions', 'intervention_templates',
  // Documents (feature /documents)
  'document_links', 'documents', 'document_collections',
  // Missions / engagements / sites / contrats
  'missions', 'engagements', 'site_reading_candidates', 'site_notes', 'sites', 'contracts',
  // Atelier IA / AO
  'tender_agent_analyses', 'tender_chat_attachments', 'tender_chat_messages',
  'tender_conversations', 'tender_analyses', 'tender_documents', 'tenders',
  // Mémoire / embeddings / connaissances
  'trace_embeddings', 'knowledge_chunks', 'knowledge_items',
  // Équipes
  'team_members', 'teams',
  // Divers / héritage
  'reports', 'feedback', 'clients',
  // Logs de test (Vincent) — purgés pour un démarrage propre
  'activity_logs', 'ai_usage',
]

// ============================================================================
// Helpers temps / photo
// ============================================================================
function daysAgo(n: number): Date { const d = new Date(); d.setDate(d.getDate() - n); return d }
function isoDate(d: Date): string { return d.toISOString().slice(0, 10) }
function atHourUtc(date: Date, hour: number, minute = 0): Date {
  const d = new Date(date); d.setUTCHours(hour, minute, 0, 0); return d
}

const PHOTO_COLORS: Record<string, string> = {
  before: '#f59e0b', after: '#10b981', proof: '#0ea5e9', anomaly: '#dc2626',
}
function svgPhoto(text: string, bg: string): Buffer {
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <rect width="800" height="600" fill="${bg}"/>
  <text x="400" y="300" font-family="system-ui, sans-serif" font-size="40" font-weight="600" text-anchor="middle" fill="white">${safe}</text>
  <text x="400" y="350" font-family="system-ui, sans-serif" font-size="18" text-anchor="middle" fill="rgba(255,255,255,0.7)">[pilote]</text>
</svg>`,
    'utf-8',
  )
}
async function uploadPhoto(supabase: Admin, interventionId: string, label: string, kind: PhotoKind): Promise<string> {
  const path = `${interventionId}/seed-${kind}-${Date.now()}-${Math.floor(Math.random() * 1e5)}.svg`
  const { error } = await supabase.storage
    .from('intervention-photos')
    .upload(path, svgPhoto(label, PHOTO_COLORS[kind] ?? '#64748b'), { contentType: 'image/svg+xml', upsert: false })
  if (error) throw error
  return path
}

// ============================================================================
// Données sobres et crédibles (Nouvelle-Calédonie)
// ============================================================================
const CLIENT_NAME = 'Centre Hospitalier Territorial Gaston-Bourret'

interface ContractSeed {
  name: string
  tenderTitle: string
  engagements: Array<{
    source_type: EngagementSourceType; source_excerpt: string;
    source_ref: Record<string, unknown> | null; category: EngagementCategory;
    short_label: string; measurable: boolean; ai_confidence: number | null
  }>
}
const CONTRACTS: ContractSeed[] = [
  {
    name: 'Bionettoyage CHT Magenta 2026',
    tenderTitle: 'Bionettoyage hospitalier — CHT Magenta [DEMO]',
    engagements: [
      { source_type: 'memoire_engagement', source_excerpt: 'Bionettoyage biquotidien des sanitaires, produits écolabel', source_ref: { page: 1 }, category: 'frequency', short_label: 'Sanitaires 2x/jour écolabel', measurable: true, ai_confidence: 0.95 },
      { source_type: 'memoire_engagement', source_excerpt: 'Personnel formé bionettoyage milieu hospitalier (CQP APH)', source_ref: { page: 1 }, category: 'quality', short_label: 'Équipe certifiée CQP APH', measurable: false, ai_confidence: 0.9 },
      { source_type: 'ao_clause', source_excerpt: 'Reprise sur incident sous 4 heures', source_ref: { page: 2 }, category: 'sla', short_label: 'Reprise incident < 4h', measurable: true, ai_confidence: 0.92 },
      { source_type: 'ao_clause', source_excerpt: 'Reporting mensuel photos avant/après', source_ref: { page: 3 }, category: 'reporting', short_label: 'Reporting mensuel photo', measurable: true, ai_confidence: 0.88 },
    ],
  },
  {
    name: 'Entretien Lycée Lapérouse 2026',
    tenderTitle: 'Entretien établissement scolaire — Lycée Lapérouse [DEMO]',
    engagements: [
      { source_type: 'memoire_engagement', source_excerpt: 'Nettoyage quotidien des salles de classe hors vacances', source_ref: { page: 1 }, category: 'frequency', short_label: 'Salles nettoyées chaque jour', measurable: true, ai_confidence: 0.94 },
      { source_type: 'ao_clause', source_excerpt: 'Vitrerie trimestrielle des parties communes', source_ref: { page: 2 }, category: 'frequency', short_label: 'Vitrerie trimestrielle', measurable: true, ai_confidence: 0.9 },
      { source_type: 'ao_clause', source_excerpt: 'Conformité protocole sanitaire établissement', source_ref: { page: 2 }, category: 'compliance', short_label: 'Protocole sanitaire respecté', measurable: false, ai_confidence: 0.85 },
    ],
  },
]

// Sites : (nom, adresse, contrat index)
const SITES = [
  { name: 'CHT Magenta — Bâtiment principal', address: '110 Bd Joseph Wamytan, Nouméa', contractIdx: 0 },
  { name: 'CHT Magenta — Aile pédiatrie', address: '110 Bd Joseph Wamytan, Nouméa', contractIdx: 0 },
  { name: 'Lycée Lapérouse — Centre-ville', address: '12 Rue Sébastopol, Nouméa', contractIdx: 1 },
]

// Missions : 1 par site
const MISSIONS: Array<{ siteIdx: number; name: string; cadence: MissionCadence; checklist: string[] }> = [
  { siteIdx: 0, name: 'Bionettoyage quotidien — bâtiment principal', cadence: 'daily', checklist: ['Sanitaires bionettoyés', 'Sols couloirs', 'Vidage corbeilles', 'Points de contact désinfectés'] },
  { siteIdx: 1, name: 'Bionettoyage quotidien — pédiatrie', cadence: 'daily', checklist: ['Sanitaires bionettoyés', 'Sols chambres', 'Jeux/surfaces désinfectés', 'Vidage corbeilles'] },
  { siteIdx: 2, name: 'Entretien quotidien — salles & communs', cadence: 'daily', checklist: ['Salles de classe', 'Sanitaires', 'Sols parties communes'] },
]

const ANOMALIES: Array<{ category: AnomalyCategory; description: string }> = [
  { category: 'produit_manquant', description: 'Recharge de savon désinfectant épuisée dans le sanitaire RDC — réapprovisionnement demandé.' },
  { category: 'materiel_casse', description: 'Distributeur essuie-mains de l’aile pédiatrie cassé — signalé au responsable de site.' },
  { category: 'acces_bloque', description: 'Salle 12 inaccessible (réunion en cours) — intervention reportée au créneau suivant.' },
]

// ============================================================================
// Reset
// ============================================================================
async function resetTables(supabase: Admin, dryRun: boolean): Promise<void> {
  console.log('\n========== RESET ==========')
  for (const name of RESET_TABLES) {
    if (dryRun) {
      const { count, error } = await supabase.from(name).select('*', { count: 'exact', head: true })
      console.log(`  - ${name.padEnd(34)} ${error ? `(table absente/erreur: ${error.message})` : `${count ?? 0} rows`}`)
      continue
    }
    let { error } = await supabase.from(name).delete().gte('created_at', '1900-01-01')
    if (error) {
      const r2 = await supabase.from(name).delete().neq('id', '00000000-0000-0000-0000-000000000000')
      error = r2.error ?? null
    }
    console.log(error ? `  ✗ ${name}: ${error.message}` : `  ✓ ${name} vidée`)
  }

  if (!dryRun) {
    // Storage : bucket intervention-photos
    const { data: folders } = await supabase.storage.from('intervention-photos').list('', { limit: 1000 })
    let cleaned = 0
    for (const f of folders ?? []) {
      const { data: sub } = await supabase.storage.from('intervention-photos').list(f.name, { limit: 1000 })
      if (sub && sub.length) {
        await supabase.storage.from('intervention-photos').remove(sub.map((s) => `${f.name}/${s.name}`))
        cleaned++
      }
    }
    console.log(`  ✓ Storage intervention-photos : ${cleaned} dossier(s) nettoyé(s)`)
  }
}

// ============================================================================
// Comptes conservés : cadrage des rôles (pas de mot de passe)
// ============================================================================
async function frameAccounts(supabase: Admin): Promise<Record<string, string>> {
  console.log('\n========== COMPTES CONSERVÉS (rôles ; mdp NON touché) ==========')
  const { data: list, error } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  if (error) throw error
  const byEmail = new Map((list?.users ?? []).map((u) => [u.email, u]))
  const ids: Record<string, string> = {}
  for (const k of KEEP) {
    const u = byEmail.get(k.email)
    if (!u) { console.log(`  ⚠ ${k.email} ABSENT — non créé (reset pas : pas de création de mdp).`); continue }
    ids[k.email] = u.id
    const { error: upErr } = await supabase.from('users').update({ role: k.role }).eq('id', u.id)
    console.log(upErr ? `  ✗ ${k.email}: ${upErr.message}` : `  ✓ ${k.email.padEnd(32)} → role=${k.role} (mdp inchangé)`)
  }
  return ids
}

// ============================================================================
// Seed
// ============================================================================
async function ensureClient(supabase: Admin, name: string): Promise<string> {
  const { data } = await supabase.from('clients').insert({ name }).select('id').single()
  return data!.id as string
}

async function seed(supabase: Admin, ids: Record<string, string>): Promise<Record<string, unknown>> {
  const adminId = ids[ADMIN_EMAIL]
  const fieldId = ids[FIELD_EMAIL]
  if (!adminId || !fieldId) throw new Error('Comptes admin/terrain introuvables — seed annulé.')

  // Équipe + rattachement de Guillaume
  console.log('\n========== ÉQUIPE ==========')
  const team = await createTeam({ name: 'Équipe Nouméa Centre', color: '#0ea5e9', created_by: adminId })
  await supabase.from('team_members').insert({ team_id: team.id, user_id: fieldId, joined_at: new Date().toISOString() })
  console.log(`  ✓ Équipe « Nouméa Centre » + Guillaume rattaché`)

  // Client
  const clientId = await ensureClient(supabase, CLIENT_NAME)

  // Contrats (tender + engagements + contract + activation)
  console.log('\n========== CONTRATS ==========')
  const contractIds: string[] = []
  for (const c of CONTRACTS) {
    const { data: tender, error: tErr } = await supabase.from('tenders')
      .insert({ title: c.tenderTitle, client_name: CLIENT_NAME, status: 'ready', created_by: adminId })
      .select('id').single()
    if (tErr) throw tErr
    await bulkInsertEngagements({ tender_id: tender.id, created_by: adminId, engagements: c.engagements })
    const contractId = await createContract({
      tender_id: tender.id, name: c.name, client_name: CLIENT_NAME,
      start_date: isoDate(daysAgo(120)), end_date: isoDate(daysAgo(-365)), created_by: adminId,
    })
    await activateEngagementsForContract(tender.id, contractId)
    contractIds.push(contractId)
    console.log(`  ✓ ${c.name} (${c.engagements.length} engagements)`)
  }

  // Sites
  console.log('\n========== SITES ==========')
  const siteIds: string[] = []
  for (const s of SITES) {
    const id = await createSite({
      client_id: clientId, contract_id: contractIds[s.contractIdx],
      name: s.name, address: s.address, notes: null,
    })
    siteIds.push(id)
    console.log(`  ✓ ${s.name}`)
  }

  // Missions
  console.log('\n========== MISSIONS ==========')
  const missionIds: string[] = []
  for (const m of MISSIONS) {
    const checklist: ChecklistTemplateItem[] = m.checklist.map((label, position) => ({ label, required: true, position }))
    const id = await createMission({
      site_id: siteIds[m.siteIdx], name: m.name, description: null,
      cadence: m.cadence, engagement_ids: [], default_checklist: checklist, created_by: adminId,
    })
    await supabase.from('missions').update({ assigned_team_id: team.id }).eq('id', id)
    missionIds.push(id)
    console.log(`  ✓ ${m.name}`)
  }

  // Interventions — sobres : 4 passées + 1 planifiée par mission (~15)
  console.log('\n========== INTERVENTIONS ==========')
  const offsets = [11, 8, 4, 1, -3] // jours ; <0 = futur planifié
  const stat = { total: 0, completed: 0, validated: 0, planned: 0, photos: 0, anomalies: 0 }
  let anomalyCursor = 0
  for (let mi = 0; mi < MISSIONS.length; mi++) {
    const m = MISSIONS[mi]
    for (let oi = 0; oi < offsets.length; oi++) {
      const offset = offsets[oi]
      const base = offset >= 0 ? daysAgo(offset) : daysAgo(offset) // daysAgo(neg) = futur
      const scheduledAt = atHourUtc(base, 7)
      let status: InterventionStatus
      let executedAt: Date | null = null
      if (offset < 0) status = 'planned'
      else if (offset >= 8) { status = 'validated'; executedAt = atHourUtc(base, 7, 40) }
      else { status = 'completed'; executedAt = atHourUtc(base, 7, 40) }

      const interventionId = await createIntervention({
        mission_id: missionIds[mi], scheduled_at: scheduledAt.toISOString(), team: [], created_by: fieldId,
      })
      stat.total++
      const updates: Record<string, unknown> = {
        status, scheduled_for: isoDate(base), slot: 'morning', assigned_team_id: team.id,
      }
      if (executedAt) updates.executed_at = executedAt.toISOString()
      await supabase.from('interventions').update(updates).eq('id', interventionId)

      const items = await bulkInsertChecklistItems(
        m.checklist.map((label, position) => ({ intervention_id: interventionId, label, required: true, position, engagement_id: null })),
      )

      if (status === 'completed' || status === 'validated') {
        for (const it of items) await markChecklistItemDone(it.id, fieldId)
        // Photos before/after/proof
        for (const kind of ['before', 'after', 'proof'] as PhotoKind[]) {
          await insertPhoto({
            intervention_id: interventionId, checklist_item_id: null,
            storage_path: await uploadPhoto(supabase, interventionId, m.name, kind),
            kind, caption: null, taken_by: fieldId,
          })
        }
        stat.photos++
        if (status === 'validated') {
          await createValidation({ intervention_id: interventionId, validated_by: fieldId, comment: 'Conformité visuelle vérifiée sur site.' })
          stat.validated++
        } else stat.completed++

        // ~1 anomalie par mission (sur la 2ᵉ intervention passée)
        if (oi === 1 && anomalyCursor < ANOMALIES.length) {
          const a = ANOMALIES[anomalyCursor++]
          await insertPhoto({
            intervention_id: interventionId, checklist_item_id: null,
            storage_path: await uploadPhoto(supabase, interventionId, 'Anomalie', 'anomaly'),
            kind: 'anomaly', caption: a.description, taken_by: fieldId,
          })
          await createAnomaly({ intervention_id: interventionId, category: a.category, description: a.description, reported_by: fieldId })
          stat.anomalies++
        }
      } else stat.planned++
    }
  }
  console.log(`  ✓ ${stat.total} interventions (${stat.validated} validées, ${stat.completed} terminées, ${stat.planned} planifiées, ${stat.anomalies} anomalies)`)

  // Documents
  console.log('\n========== DOCUMENTS ==========')
  const collectionId = await createDocumentCollection({ name: 'Contrats & procédures' })
  const docs = [
    { document_type: 'contrat' as const, filename: 'Contrat CHT Magenta — bionettoyage 2026.pdf', visibility_level: 'manager' as const, effective_date: isoDate(daysAgo(120)) },
    { document_type: 'procedure' as const, filename: 'Procédure bionettoyage hospitalier (CQP APH).pdf', visibility_level: 'operations' as const, effective_date: isoDate(daysAgo(90)) },
  ]
  for (const d of docs) {
    await createDocument({
      collection_id: collectionId, document_type: d.document_type,
      storage_path: `seed/${collectionId}/${d.filename}`, filename: d.filename,
      visibility_level: d.visibility_level, analysis_status: 'ready',
      memory_tier: 'consultable', effective_date: d.effective_date, created_by: adminId,
    })
    console.log(`  ✓ ${d.filename}`)
  }

  // Passation partagée (team_takes_site) → visible /handovers, /h/[token], /m
  console.log('\n========== PASSATION ==========')
  let handover: { token: string | null; title: string } | null = null
  try {
    const { payload, title } = await buildTeamTakesSitePayload({ targetTeamId: team.id, siteId: siteIds[0] })
    const brief = await createHandoverBrief({ kind: 'team_takes_site', targetTeamId: team.id, siteId: siteIds[0], payload, title, createdBy: adminId })
    const { token } = await shareHandoverBrief(brief.id, new Date(Date.now() + 30 * 864e5))
    handover = { token, title }
    console.log(`  ✓ « ${title} » → /h/${token}`)
  } catch (e) {
    console.log(`  ⚠ Passation non créée : ${(e as Error).message}`)
  }

  return {
    contracts: contractIds.length, sites: siteIds.length, missions: missionIds.length,
    interventions: stat, documents: docs.length, handover,
  }
}

// ============================================================================
// Main
// ============================================================================
async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const confirmOn = process.argv.find((a) => a.startsWith('--confirm-on='))?.slice('--confirm-on='.length)
  const yes = process.argv.includes('--yes')
  const resetOnly = process.argv.includes('--reset-only') // vide les données, garde les comptes, PAS de seed
  if (!confirmOn || !url.includes(confirmOn)) {
    console.error('✗ Sécurité : passe --confirm-on=<sous-chaîne de NEXT_PUBLIC_SUPABASE_URL>.')
    console.error(`  URL : ${url.replace(/(https?:\/\/[^.]+).*/, '$1...(masqué)')}`)
    process.exit(1)
  }
  const supabase = createAdminClient()
  const dryRun = !yes

  console.log(dryRun ? '\n*** DRY-RUN (rien ne sera écrit) ***' : '\n*** EXÉCUTION RÉELLE ***')
  console.log(`Mode  : ${resetOnly ? 'RESET-ONLY (vide tout, garde les comptes, pas de seed)' : 'reset + seed'}`)
  console.log(`Cible : ${url.replace(/(https?:\/\/[^.]+).*/, '$1...(masqué)')}`)

  await resetTables(supabase, dryRun)

  if (!dryRun && resetOnly) {
    console.log('\n[reset-only] Données métier vidées. Comptes auth conservés tels quels. Aucun seed.')
    console.log('Guillaume démarre sur une base vide.')
    return
  }

  if (dryRun) {
    console.log('\n========== PLAN DE SEED (non exécuté) ==========')
    console.log(`  Client       : ${CLIENT_NAME}`)
    console.log(`  Contrats     : ${CONTRACTS.length} (${CONTRACTS.map((c) => c.name).join(', ')})`)
    console.log(`  Sites        : ${SITES.length}`)
    console.log(`  Missions     : ${MISSIONS.length}`)
    console.log(`  Interventions: ~15 (4 passées + 1 planifiée / mission), 3 anomalies`)
    console.log(`  Documents    : 2 (contrat + procédure)`)
    console.log(`  Passation    : 1 brief partagé (/h/[token])`)
    console.log(`  Comptes      : rôles cadrés, mdp NON touchés`)
    console.log('\n[dry-run] Ajoute --yes pour appliquer.')
    return
  }

  const ids = await frameAccounts(supabase)
  const summary = await seed(supabase, ids)
  console.log('\n========== RÉSUMÉ ==========')
  console.log(JSON.stringify(summary, null, 2))
  console.log('\n[done] Base pilote prête.')
}

main().catch((e) => { console.error('PREPARE-PILOT FAILED:', e); if (e?.stack) console.error(e.stack); process.exit(1) })
