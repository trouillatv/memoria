/**
 * scripts/seed-demo.ts
 *
 * Seeds 3 fully-populated demo contracts representing different sectors :
 *   1. CHU Régional (hospital) — mature, all 5 segments lit
 *   2. Banque Centrale (tertiaire bureau) — partial, 3 segments
 *   3. École Jean Jaurès (éducation) — early-stage, 2 segments
 *
 * Idempotent : checks for existing tender by title before creating.
 * Photos = SVG inline-generated (no binary in repo).
 *
 * Usage : `npm run db:seed-demo`
 */
import * as fs from 'fs'

// Node 20 lacks native WebSocket — Supabase realtime client requires it at construction.
// Polyfill `globalThis.WebSocket` BEFORE any @supabase/* import.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ws = require('ws')
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
  ;(globalThis as { WebSocket: unknown }).WebSocket = ws
}

import { createAdminClient } from '@/lib/supabase/admin'
import { bulkInsertEngagements, activateEngagementsForContract } from '@/lib/db/engagements'
import { createContract } from '@/lib/db/contracts'
import { createSite } from '@/lib/db/sites'
import { createMission } from '@/lib/db/missions'
import {
  createIntervention,
  bulkInsertChecklistItems,
  markChecklistItemDone,
  insertPhoto,
  updateInterventionStatus,
  createValidation,
  createAnomaly,
} from '@/lib/db/interventions'
import {
  createTemplate,
  generateInterventionsFromTemplates,
} from '@/lib/db/intervention-templates'
import type {
  ChecklistTemplateItem,
  EngagementCategory,
  EngagementSourceType,
  AnomalyCategory,
  PhotoKind,
  MissionCadence,
  DbEngagement,
  InterventionFrequency,
  InterventionSlot,
} from '@/types/db'

// ---------------------------------------------------------------------------
// Env loading (mirror scripts/db-push.ts pattern — load .env.local manually)
// ---------------------------------------------------------------------------
function loadEnvLocal() {
  const path = '.env.local'
  if (!fs.existsSync(path)) return
  const raw = fs.readFileSync(path, 'utf8')
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
loadEnvLocal()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SupabaseAdmin = ReturnType<typeof createAdminClient>

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

function daysFromNow(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function isoTimestamp(d: Date): string {
  return d.toISOString()
}

/**
 * SVG photo generator — used to populate the intervention-photos bucket
 * with placeholder visuals (no binary in repo).
 * 800x600, fond coloré (Tailwind palette), texte centré.
 */
function svgPhoto(text: string, bgColor: string): Buffer {
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <rect width="800" height="600" fill="${bgColor}"/>
  <rect x="20" y="20" width="760" height="560" fill="rgba(255,255,255,0.08)" rx="8"/>
  <text x="400" y="280" font-family="system-ui, -apple-system, sans-serif" font-size="42" font-weight="600" text-anchor="middle" fill="white">
    ${safe}
  </text>
  <text x="400" y="340" font-family="system-ui, sans-serif" font-size="20" text-anchor="middle" fill="rgba(255,255,255,0.7)">
    [seed photo]
  </text>
</svg>`
  return Buffer.from(svg, 'utf-8')
}

const PHOTO_COLORS: Record<PhotoKind, string> = {
  before: '#f59e0b', // amber-500
  after: '#10b981', // emerald-500
  proof: '#0ea5e9', // sky-500
  anomaly: '#dc2626', // red-600
  passage: '#64748b', // slate-500 (V5.1 — couleur sobre)
}

async function uploadSeedPhoto(
  supabase: SupabaseAdmin,
  interventionId: string,
  label: string,
  kind: PhotoKind
): Promise<string> {
  const buffer = svgPhoto(label, PHOTO_COLORS[kind])
  const ts = Date.now() + Math.floor(Math.random() * 10000)
  const storagePath = `${interventionId}/seed-${kind}-${ts}.svg`
  const { error } = await supabase.storage
    .from('intervention-photos')
    .upload(storagePath, buffer, {
      contentType: 'image/svg+xml',
      upsert: false,
    })
  if (error) throw error
  return storagePath
}

/**
 * Ensures a tender + document + analysis exists. Idempotent on title.
 * When `refreshAnalysis` is true, an existing analysis is updated so re-running
 * the seed reflects changes to technicalMemo / summary (useful for the demo
 * tender used by the cross-tender matching panel).
 */
async function ensureTender(
  supabase: SupabaseAdmin,
  title: string,
  clientName: string,
  extractedText: string,
  technicalMemo: string,
  summary: string,
  adminId: string,
  opts: { refreshAnalysis?: boolean } = {}
): Promise<{ tenderId: string; created: boolean }> {
  const { data: existing } = await supabase
    .from('tenders')
    .select('id')
    .eq('title', title)
    .maybeSingle()
  if (existing) {
    console.log(`  ↳ Tender '${title}' already exists, reusing (id=${existing.id})`)
    if (opts.refreshAnalysis) {
      const { data: ana } = await supabase
        .from('tender_analyses')
        .select('id')
        .eq('tender_id', existing.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (ana) {
        await supabase
          .from('tender_analyses')
          .update({ technical_memo: technicalMemo, summary })
          .eq('id', ana.id)
        console.log(`  ↳ Refreshed analysis on existing tender`)
      }
    }
    return { tenderId: existing.id, created: false }
  }

  const { data, error } = await supabase
    .from('tenders')
    .insert({
      title,
      client_name: clientName,
      status: 'ready',
      created_by: adminId,
    })
    .select('id')
    .single()
  if (error) throw error
  const tenderId = data.id as string

  // Document with extracted_text
  const { error: docErr } = await supabase.from('tender_documents').insert({
    tender_id: tenderId,
    storage_path: `seed/${tenderId}/source.pdf`,
    filename: `${title}.pdf`,
    extracted_text: extractedText,
    page_count: Math.max(1, Math.ceil(extractedText.length / 3000)),
  })
  if (docErr) throw docErr

  // Analysis with mémoire technique
  const { error: anaErr } = await supabase.from('tender_analyses').insert({
    tender_id: tenderId,
    summary,
    technical_memo: technicalMemo,
    constraints: [],
    risks: [],
    checklist: [],
    provider: 'mock',
    raw_response: { seed: true },
  })
  if (anaErr) throw anaErr

  console.log(`  ↳ Created tender '${title}' (id=${tenderId})`)
  return { tenderId, created: true }
}

/**
 * Ensures a clients row matching name exists (sites.client_id NOT NULL).
 */
async function ensureClient(supabase: SupabaseAdmin, name: string): Promise<string> {
  const { data: existing } = await supabase
    .from('clients')
    .select('id')
    .eq('name', name)
    .is('deleted_at', null)
    .maybeSingle()
  if (existing) return existing.id
  const { data, error } = await supabase
    .from('clients')
    .insert({ name })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

/**
 * Looks up an existing contract by name. Used for idempotence.
 */
async function findContractByName(
  supabase: SupabaseAdmin,
  name: string
): Promise<string | null> {
  const { data } = await supabase
    .from('contracts')
    .select('id')
    .eq('name', name)
    .is('deleted_at', null)
    .maybeSingle()
  return data?.id ?? null
}

/**
 * Looks up a mission by exact name on a given site. Used by the recurrence
 * seed to attach templates to existing missions without depending on the
 * order or IDs returned by createMission earlier in the seed.
 */
async function findMissionByName(
  supabase: SupabaseAdmin,
  siteId: string,
  name: string
): Promise<string | null> {
  const { data } = await supabase
    .from('missions')
    .select('id')
    .eq('site_id', siteId)
    .eq('name', name)
    .is('deleted_at', null)
    .maybeSingle()
  return data?.id ?? null
}

/**
 * Liste les sites d'un contrat (utilisé par le seed récurrences pour
 * retrouver missions par site sans dépendre des IDs précédemment retournés).
 */
async function listSitesForContract(
  supabase: SupabaseAdmin,
  contractId: string
): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await supabase
    .from('sites')
    .select('id, name')
    .eq('contract_id', contractId)
    .is('deleted_at', null)
  if (error) throw error
  return data ?? []
}

/**
 * Signature d'un template récurrent — utilisée pour l'idempotence du seed.
 * On considère qu'un template est déjà présent s'il existe sur la même
 * (mission_id, frequency, day_of_week, day_of_month, slots) — peu importe le
 * titre. L'utilisateur peut renommer un template depuis l'UI sans qu'on le
 * recrée derrière son dos.
 */
interface TemplateSeedParams {
  title: string
  description?: string | null
  frequency: InterventionFrequency
  slots?: InterventionSlot[] | null
  day_of_week?: number | null
  day_of_month?: number | null
  starts_on?: string
  ends_on?: string | null
}

function slotsKey(slots: InterventionSlot[] | null | undefined): string {
  if (!slots || slots.length === 0) return '∅'
  return [...slots].sort().join('+')
}

async function upsertTemplate(
  supabase: SupabaseAdmin,
  missionId: string,
  params: TemplateSeedParams,
  createdBy: string
): Promise<{ id: string; created: boolean }> {
  // Charge tous les templates existants de la mission (deleted_at null) puis
  // matche en mémoire sur la signature (frequency + slots + day_of_week +
  // day_of_month). Plus simple à raisonner qu'un WHERE composite avec NULLs.
  const { data: existing, error } = await supabase
    .from('intervention_templates')
    .select('id, frequency, slots, day_of_week, day_of_month')
    .eq('mission_id', missionId)
    .is('deleted_at', null)
  if (error) throw error

  const targetKey = `${params.frequency}|${slotsKey(params.slots)}|${params.day_of_week ?? '∅'}|${params.day_of_month ?? '∅'}`
  for (const t of existing ?? []) {
    const k = `${t.frequency}|${slotsKey(t.slots as InterventionSlot[] | null)}|${t.day_of_week ?? '∅'}|${t.day_of_month ?? '∅'}`
    if (k === targetKey) {
      return { id: t.id as string, created: false }
    }
  }

  const created = await createTemplate({
    mission_id: missionId,
    title: params.title,
    description: params.description ?? null,
    frequency: params.frequency,
    slots: params.slots ?? null,
    day_of_week: params.day_of_week ?? null,
    day_of_month: params.day_of_month ?? null,
    starts_on: params.starts_on ?? isoDate(new Date()),
    ends_on: params.ends_on ?? null,
    created_by: createdBy,
  })
  return { id: created.id, created: true }
}

/**
 * Pour chaque (siteName → missionName → templates[]), crée idempotemment les
 * templates et retourne les IDs créés ou retrouvés. À appeler une fois les
 * missions du contrat existantes.
 */
async function seedTemplatesForContract(
  supabase: SupabaseAdmin,
  contractId: string,
  contractLabel: string,
  spec: Array<{
    siteName: string
    missionName: string
    templates: TemplateSeedParams[]
  }>,
  adminId: string
): Promise<string[]> {
  const sites = await listSitesForContract(supabase, contractId)
  const siteByName = new Map(sites.map((s) => [s.name, s.id]))
  const ids: string[] = []
  let created = 0
  let reused = 0
  let missingMission = 0

  for (const entry of spec) {
    const siteId = siteByName.get(entry.siteName)
    if (!siteId) {
      console.log(`    ↳ Site '${entry.siteName}' not found, skipping templates`)
      continue
    }
    const missionId = await findMissionByName(supabase, siteId, entry.missionName)
    if (!missionId) {
      missingMission++
      continue
    }
    for (const tpl of entry.templates) {
      const { id, created: wasCreated } = await upsertTemplate(
        supabase,
        missionId,
        tpl,
        adminId
      )
      ids.push(id)
      if (wasCreated) created++
      else reused++
    }
  }

  console.log(
    `  ↳ [${contractLabel}] Templates récurrence : ${created} créés / ${reused} réutilisés${
      missingMission ? ` (${missingMission} missions introuvables)` : ''
    }`
  )
  return ids
}

// ---------------------------------------------------------------------------
// CONTRACT 1 — CHU Régional (hospital, mature)
// ---------------------------------------------------------------------------

const CHU_TENDER_TITLE = '[DEMO] CHU Régional — Bionettoyage 2026-2028'
const CHU_CONTRACT_NAME = 'CHU Régional — Bionettoyage 2026-2028'
const CHU_CLIENT_NAME = 'CHU Régional'

const CHU_EXTRACTED_TEXT = `APPEL D'OFFRES NETTOYAGE — CHU RÉGIONAL — LOT BIONETTOYAGE
Référence : CHU-2026-NETT-01
Durée : 24 mois renouvelables une fois
Surface totale : 12 400 m² répartis sur 3 bâtiments

1. PRESTATIONS ATTENDUES

L'attributaire effectuera un bionettoyage biquotidien des sanitaires, salles de soins et zones à risque infectieux avec produits écolabel certifiés Ecocert. Les fréquences seront strictement respectées : 2x/jour pour les sanitaires, 1x/jour pour les couloirs et salles d'attente, 1x/semaine pour les vitres et surfaces hautes.

2. EXIGENCES QUALITÉ

Le prestataire devra maintenir sa certification ISO 9001:2015 pendant toute la durée du marché. Un audit qualité hebdomadaire sera conduit conjointement avec le service Hygiène Hospitalière, avec rapport écrit transmis sous 48h.

3. CONFORMITÉ RÉGLEMENTAIRE

Tous les produits utilisés devront satisfaire aux exigences Ecolabel européen. Les fiches de données de sécurité (FDS) seront tenues à disposition. Le personnel devra disposer de la formation Bionettoyage en milieu hospitalier (CQP APH ou équivalent).

4. NIVEAU DE SERVICE

En cas d'incident sanitaire signalé, l'équipe de nettoyage devra intervenir sous 4 heures ouvrées 7 jours sur 7. Les pénalités contractuelles s'élèveront à 0,5% du marché par jour de retard, plafonnées à 5%.

5. REPORTING

Un reporting mensuel structuré sera produit, incluant : photos avant/après par zone critique, indicateurs de performance qualité, anomalies traitées et non-traitées, suggestions d'amélioration. Le reporting sera transmis avant le 5 du mois suivant.

6. CONFIDENTIALITÉ

Le personnel devra signer une charte de confidentialité respectant le secret médical. Aucune photographie incluant des patients ne sera autorisée.`

const CHU_TECHNICAL_MEMO = `# Mémoire technique — Réponse à l'AO CHU Régional

## 1. Notre approche du bionettoyage hospitalier

Nous nous engageons à effectuer le bionettoyage biquotidien des sanitaires avec produits écolabel certifiés Ecocert, conformément aux fréquences strictes du cahier des charges. Notre équipe dédiée de 4 ETP est spécifiquement formée au CQP APH (Certificat de Qualification Professionnelle Agent de Propreté Hospitalière).

## 2. Maintien des certifications

Nous maintiendrons notre certification ISO 9001:2015 pendant toute la durée du marché. Notre service qualité interne effectuera un audit hebdomadaire en collaboration avec le service Hygiène Hospitalière du CHU, avec rapport écrit transmis sous 48h.

## 3. Engagements réglementaires

Tous nos produits sont certifiés Ecolabel européen. Nous tenons à disposition les fiches de données de sécurité (FDS) actualisées dans un classeur dédié sur chaque site. Notre personnel détient la formation Bionettoyage hospitalier requise.

## 4. Engagement de service

Nous garantissons une intervention sous 4 heures ouvrées 7j/7 en cas d'incident sanitaire, avec une équipe d'astreinte joignable 24h/24. Notre organisation prévoit une rotation permettant de couvrir tous les créneaux.

## 5. Reporting mensuel

Nous fournirons un rapport mensuel structuré comprenant photos avant/après géolocalisées (sans patient), indicateurs qualité (taux de conformité par zone, délai moyen de résolution incident), liste des anomalies signalées et résolues, et suggestions opérationnelles. Reporting transmis avant le 5 du mois suivant.

## 6. Confidentialité et déontologie

L'ensemble du personnel signera votre charte de confidentialité avant prise de poste, et respectera le secret médical. Aucune photographie incluant des patients ne sera prise.`

const CHU_SUMMARY =
  'CHU Régional — bionettoyage hospitalier multi-bâtiments. Marché de 24 mois, 12 400 m², exigences ISO 9001:2015 + Ecolabel + CQP APH. SLA reprise 4h ouvrées 7j/7. Reporting mensuel structuré avec photos avant/après. Profil de marché aligné avec nos certifications.'

const CHU_ENGAGEMENTS: Array<{
  source_type: EngagementSourceType
  source_excerpt: string
  source_ref: Record<string, unknown>
  category: EngagementCategory
  short_label: string
  measurable: boolean
  ai_confidence: number
}> = [
  {
    source_type: 'memoire_engagement',
    source_excerpt:
      'Bionettoyage biquotidien des sanitaires avec produits écolabel certifiés Ecocert',
    source_ref: { page: 1, section: '1' },
    category: 'frequency',
    short_label: 'Sanitaires bionettoyage 2x/jour écolabel',
    measurable: true,
    ai_confidence: 0.94,
  },
  {
    source_type: 'memoire_engagement',
    source_excerpt:
      'Maintien de la certification ISO 9001:2015 pendant toute la durée du marché',
    source_ref: { page: 1, section: '2' },
    category: 'compliance',
    short_label: 'ISO 9001:2015 maintenue',
    measurable: false,
    ai_confidence: 0.92,
  },
  {
    source_type: 'memoire_engagement',
    source_excerpt: 'Audit qualité hebdomadaire avec rapport écrit transmis sous 48h',
    source_ref: { page: 1, section: '2' },
    category: 'reporting',
    short_label: 'Audit qualité hebdomadaire',
    measurable: true,
    ai_confidence: 0.9,
  },
  {
    source_type: 'memoire_engagement',
    source_excerpt: "Intervention sous 4 heures ouvrées 7j/7 en cas d'incident sanitaire",
    source_ref: { page: 1, section: '4' },
    category: 'sla',
    short_label: 'Reprise sous 4h ouvrées 7j/7',
    measurable: true,
    ai_confidence: 0.93,
  },
  {
    source_type: 'memoire_engagement',
    source_excerpt:
      'Reporting mensuel structuré avec photos avant/après et indicateurs qualité',
    source_ref: { page: 1, section: '5' },
    category: 'reporting',
    short_label: 'Reporting mensuel photos avant/après',
    measurable: true,
    ai_confidence: 0.88,
  },
]

async function seedContract1(adminId: string, supabase: SupabaseAdmin) {
  const existingContract = await findContractByName(supabase, CHU_CONTRACT_NAME)
  if (existingContract) {
    console.log(`  ↳ Contract '${CHU_CONTRACT_NAME}' already exists, skipping`)
    return
  }

  // Tender + analysis
  const { tenderId } = await ensureTender(
    supabase,
    CHU_TENDER_TITLE,
    CHU_CLIENT_NAME,
    CHU_EXTRACTED_TEXT,
    CHU_TECHNICAL_MEMO,
    CHU_SUMMARY,
    adminId
  )

  // Engagements (extracted)
  const engagements = await bulkInsertEngagements({
    tender_id: tenderId,
    created_by: adminId,
    engagements: CHU_ENGAGEMENTS,
  })
  console.log(`  ↳ Inserted ${engagements.length} engagements`)

  // Contract
  const contractId = await createContract({
    tender_id: tenderId,
    name: CHU_CONTRACT_NAME,
    client_name: CHU_CLIENT_NAME,
    start_date: isoDate(daysAgo(180)), // 6 months ago
    end_date: isoDate(daysFromNow(540)), // 18 months from now → 24 months total
    created_by: adminId,
  })
  console.log(`  ↳ Created contract (id=${contractId})`)

  // Activate engagements
  const activated = await activateEngagementsForContract(tenderId, contractId)
  console.log(`  ↳ Activated ${activated} engagements on contract`)

  // Refresh engagements with contract_id (still same row IDs, just status change)
  const eByLabel = new Map<string, DbEngagement>()
  for (const e of engagements) eByLabel.set(e.short_label, e)
  const idSanitaires = eByLabel.get('Sanitaires bionettoyage 2x/jour écolabel')!.id
  const idISO = eByLabel.get('ISO 9001:2015 maintenue')!.id
  const idAudit = eByLabel.get('Audit qualité hebdomadaire')!.id
  const idSLA = eByLabel.get('Reprise sous 4h ouvrées 7j/7')!.id
  const idReporting = eByLabel.get('Reporting mensuel photos avant/après')!.id

  // Client + sites
  const clientId = await ensureClient(supabase, CHU_CLIENT_NAME)
  const siteNames = ['Tour Médecine', 'Tour Chirurgie', 'Bâtiment Annexe']
  const siteIds: string[] = []
  for (const name of siteNames) {
    const id = await createSite({
      client_id: clientId,
      contract_id: contractId,
      name,
      address: `CHU Régional — ${name}`,
      notes: null,
    })
    siteIds.push(id)
  }
  console.log(`  ↳ Created ${siteIds.length} sites`)

  // 3 missions per site (Bionettoyage / Couloirs / Audit)
  type MissionDef = {
    name: string
    description: string
    cadence: MissionCadence
    engagement_ids: string[]
    checklist: ChecklistTemplateItem[]
  }

  const missionsPerSite: MissionDef[] = [
    {
      name: 'Bionettoyage quotidien sanitaires',
      description: 'Bionettoyage biquotidien sanitaires avec produits écolabel.',
      cadence: 'daily',
      engagement_ids: [idSanitaires, idISO],
      checklist: [
        { label: 'Désinfection cuvettes', required: true, engagement_id: idSanitaires, position: 0 },
        { label: 'Nettoyage lavabos', required: true, engagement_id: idSanitaires, position: 1 },
        { label: 'Réapprovisionnement consommables', required: false, position: 2 },
        { label: 'Vérification produits écolabel', required: false, engagement_id: idISO, position: 3 },
      ],
    },
    {
      name: 'Nettoyage couloirs',
      description: 'Nettoyage quotidien des couloirs et salles d\'attente.',
      cadence: 'daily',
      engagement_ids: [idSLA],
      checklist: [
        { label: 'Aspirateur', required: false, position: 0 },
        { label: 'Lavage sol', required: false, position: 1 },
        { label: 'Désinfection mains courantes', required: true, position: 2 },
      ],
    },
    {
      name: 'Audit qualité',
      description: 'Audit hebdomadaire conjoint avec service Hygiène Hospitalière.',
      cadence: 'weekly',
      engagement_ids: [idAudit, idReporting],
      checklist: [
        { label: 'Inspection visuelle 5 zones', required: false, engagement_id: idAudit, position: 0 },
        { label: 'Photos avant/après documentées', required: false, engagement_id: idReporting, position: 1 },
        { label: 'Rédaction rapport', required: true, engagement_id: idAudit, position: 2 },
      ],
    },
  ]

  type MissionInstance = {
    id: string
    siteName: string
    def: MissionDef
  }
  const allMissions: MissionInstance[] = []
  for (let s = 0; s < siteIds.length; s++) {
    for (const def of missionsPerSite) {
      const id = await createMission({
        site_id: siteIds[s],
        name: def.name,
        description: def.description,
        cadence: def.cadence,
        default_team: [],
        engagement_ids: def.engagement_ids,
        default_checklist: def.checklist,
        created_by: adminId,
      })
      allMissions.push({ id, siteName: siteNames[s], def })
    }
  }
  console.log(`  ↳ Created ${allMissions.length} missions across ${siteIds.length} sites`)

  // Plan ~12 interventions over the past 4 weeks
  // Distribution :
  //   8 validated (with photos + checklist + validation)
  //   2 completed (no validation yet)
  //   2 planned (within next week)
  // Spread interventions across the 9 missions.
  type InterventionPlan = {
    missionIdx: number
    daysOffset: number  // negative = past, positive = future
    status: 'validated' | 'completed' | 'planned'
  }

  const plans: InterventionPlan[] = [
    // 8 validated, on past dates
    { missionIdx: 0, daysOffset: -25, status: 'validated' }, // TM Bionettoyage
    { missionIdx: 1, daysOffset: -22, status: 'validated' }, // TM Couloirs
    { missionIdx: 3, daysOffset: -20, status: 'validated' }, // TC Bionettoyage
    { missionIdx: 6, daysOffset: -18, status: 'validated' }, // BA Bionettoyage
    { missionIdx: 2, daysOffset: -15, status: 'validated' }, // TM Audit (weekly)
    { missionIdx: 4, daysOffset: -10, status: 'validated' }, // TC Couloirs
    { missionIdx: 7, daysOffset: -7, status: 'validated' }, // BA Couloirs
    { missionIdx: 5, daysOffset: -8, status: 'validated' }, // TC Audit
    // 2 completed (no validation)
    { missionIdx: 0, daysOffset: -2, status: 'completed' }, // TM Bionettoyage récent
    { missionIdx: 8, daysOffset: -3, status: 'completed' }, // BA Audit récent
    // 2 planned (future)
    { missionIdx: 1, daysOffset: 2, status: 'planned' }, // TM Couloirs demain+1
    { missionIdx: 3, daysOffset: 5, status: 'planned' }, // TC Bionettoyage future
  ]

  let validatedCount = 0
  let completedCount = 0
  let plannedCount = 0
  let totalChecklist = 0
  let totalPhotos = 0

  // Track 2 specific interventions for anomalies
  let resolvedAnomalyInterventionId: string | null = null
  let openAnomalyInterventionId: string | null = null

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i]
    const m = allMissions[plan.missionIdx]
    const scheduledAt = new Date()
    scheduledAt.setDate(scheduledAt.getDate() + plan.daysOffset)
    scheduledAt.setHours(8 + (i % 4), 0, 0, 0) // varied hours

    const interventionId = await createIntervention({
      mission_id: m.id,
      scheduled_at: isoTimestamp(scheduledAt),
      team: [adminId],
      created_by: adminId,
    })

    // Insert checklist from mission template
    const checklistRows = await bulkInsertChecklistItems(
      m.def.checklist.map((c, idx) => ({
        intervention_id: interventionId,
        engagement_id: c.engagement_id ?? null,
        label: c.label,
        position: c.position ?? idx,
        required: c.required ?? false,
      }))
    )
    totalChecklist += checklistRows.length

    if (plan.status === 'planned') {
      plannedCount++
      // Stays in 'planned' state, no checklist done, no photos
      continue
    }

    // For validated and completed: mark all checklist done + add photos
    for (const item of checklistRows) {
      await markChecklistItemDone(item.id, adminId)
    }

    // 3-5 photos
    const photoLabels: Array<{ label: string; kind: PhotoKind; checklistIdx?: number }> = [
      { label: `Avant — ${m.def.name.split(' ').slice(0, 2).join(' ')}`, kind: 'before', checklistIdx: 0 },
      { label: `Après — ${m.def.name.split(' ').slice(0, 2).join(' ')}`, kind: 'after', checklistIdx: 0 },
      { label: `Preuve — ${m.siteName}`, kind: 'proof' },
    ]
    if (i % 2 === 0) {
      photoLabels.push({ label: `Avant — Détail`, kind: 'before', checklistIdx: 1 })
      photoLabels.push({ label: `Après — Détail`, kind: 'after', checklistIdx: 1 })
    }

    for (const p of photoLabels) {
      const checklistItemId =
        p.checklistIdx !== undefined && checklistRows[p.checklistIdx]
          ? checklistRows[p.checklistIdx].id
          : null
      const storagePath = await uploadSeedPhoto(supabase, interventionId, p.label, p.kind)
      await insertPhoto({
        intervention_id: interventionId,
        checklist_item_id: checklistItemId,
        storage_path: storagePath,
        kind: p.kind,
        caption: p.label,
        taken_by: adminId,
      })
      totalPhotos++
    }

    // Update status to 'completed' first (intermediate state)
    const executedAt = new Date(scheduledAt)
    executedAt.setHours(executedAt.getHours() + 2)
    await updateInterventionStatus(interventionId, 'completed', isoTimestamp(executedAt))

    if (plan.status === 'validated') {
      // Add validation
      await createValidation({
        intervention_id: interventionId,
        validated_by: adminId,
        comment: 'Conforme — toutes zones nominal',
      })
      // Bump status to 'validated'
      await updateInterventionStatus(interventionId, 'validated', isoTimestamp(executedAt))
      validatedCount++
    } else {
      completedCount++
    }

    // Track interventions for anomalies :
    //   - resolved : on a "Nettoyage couloirs" intervention 2 weeks ago
    if (
      resolvedAnomalyInterventionId === null &&
      m.def.name === 'Nettoyage couloirs' &&
      plan.daysOffset <= -10 &&
      plan.daysOffset >= -25 &&
      plan.status === 'validated'
    ) {
      resolvedAnomalyInterventionId = interventionId
    }
    //   - open : on a recent "Audit qualité" intervention (completed)
    if (
      openAnomalyInterventionId === null &&
      m.def.name === 'Audit qualité' &&
      plan.status === 'completed'
    ) {
      openAnomalyInterventionId = interventionId
    }
  }

  console.log(
    `  ↳ Interventions seeded : ${validatedCount} validated / ${completedCount} completed / ${plannedCount} planned`
  )
  console.log(`  ↳ Checklist items : ${totalChecklist} ; Photos : ${totalPhotos}`)

  // Anomalies
  if (resolvedAnomalyInterventionId) {
    const resolvedAt = daysAgo(13)
    const { data, error } = await supabase
      .from('intervention_anomalies')
      .insert({
        intervention_id: resolvedAnomalyInterventionId,
        engagement_id: idSLA,
        category: 'materiel_casse' as AnomalyCategory,
        category_other: null,
        description: 'Aspirateur en panne en cours de prestation, remplacé sur place.',
        status: 'resolved',
        resolved_at: isoTimestamp(resolvedAt),
        resolution_note: 'Aspirateur de remplacement déployé sous 1h, tournée terminée à temps.',
        reported_by: adminId,
      })
      .select('id')
      .single()
    if (error) throw error
    console.log(`  ↳ Created resolved anomaly (id=${data.id})`)
  }

  if (openAnomalyInterventionId) {
    const anomalyId = await createAnomaly({
      intervention_id: openAnomalyInterventionId,
      engagement_id: idSanitaires,
      category: 'produit_manquant' as AnomalyCategory,
      description: "Stock de désinfectant écolabel insuffisant — réappro demandée à l'agence.",
      reported_by: adminId,
    })
    console.log(`  ↳ Created open anomaly (id=${anomalyId})`)
  }
}

// ---------------------------------------------------------------------------
// CONTRACT 2 — Banque Centrale (tertiaire, partial)
// ---------------------------------------------------------------------------

const BANQUE_TENDER_TITLE = '[DEMO] Banque Centrale — Tertiaire 2026'
const BANQUE_CONTRACT_NAME = 'Banque Centrale — Siège tertiaire 2026'
const BANQUE_CLIENT_NAME = 'Banque Centrale'

const BANQUE_EXTRACTED_TEXT = `APPEL D'OFFRES NETTOYAGE — BANQUE CENTRALE — SIÈGE
Référence : BC-2026-NETT-03
Durée : 24 mois
Surface totale : 8 000 m² sur 12 étages

1. PRESTATIONS ATTENDUES

Nettoyage quotidien des postes de travail, sanitaires et zones communes sur l'ensemble des 12 étages. Vitrerie mensuelle (vitres extérieures avec nacelle, vitres intérieures cloisons). Les équipes dédiées assureront la prestation 5 jours sur 7.

2. ACCÈS ET HORAIRES

L'accès au bâtiment se fait par badge nominatif délivré par le service sécurité de la Banque. Les horaires d'intervention sont strictement contraints : créneau matin 6h-8h, ou créneau soir 18h-20h. Toute personne intervenant sur site devra avoir signé une charte de confidentialité.

3. REPORTING

Un reporting mensuel sera transmis avant le 5 du mois suivant, incluant le respect des fréquences, les éventuelles anomalies et un indicateur de satisfaction des occupants.

4. CONFIDENTIALITÉ

Le personnel devra respecter la confidentialité des documents et écrans visibles dans les bureaux. Aucun document, aucune photographie de poste de travail occupé.`

const BANQUE_TECHNICAL_MEMO = `# Mémoire technique — Banque Centrale

## 1. Approche tertiaire haut de gamme

Nous nous engageons à un nettoyage quotidien des postes de travail et sanitaires sur les 12 étages, 5 jours sur 7. Notre équipe dédiée de 3 ETP travaille en horaires contraints (6h-8h ou 18h-20h) avec accès badge sécurisé.

## 2. Vitrerie mensuelle

Vitres extérieures effectuées une fois par mois avec nacelle louée auprès de notre partenaire certifié. Vitres intérieures (cloisons et baies) traitées en parallèle. Vérification systématique de l'équipement avant utilisation.

## 3. Sécurité et accès

L'ensemble de notre personnel sera doté d'un badge nominatif délivré par votre service sécurité. Charte de confidentialité signée à l'embauche. Pas d'usage de téléphone ni de photographie en zones bureaux.

## 4. Reporting mensuel

Reporting structuré transmis avant le 5 du mois suivant : taux de conformité par zone, anomalies, indicateur de satisfaction recueilli auprès des occupants par sondage trimestriel.`

const BANQUE_SUMMARY =
  'Banque Centrale — siège tertiaire 12 étages, 8 000 m². Marché 24 mois. Horaires contraints (6h-8h ou 18h-20h), accès badge, charte confidentialité. Vitrerie mensuelle. Reporting mensuel.'

const BANQUE_ENGAGEMENTS: Array<{
  source_type: EngagementSourceType
  source_excerpt: string
  source_ref: Record<string, unknown>
  category: EngagementCategory
  short_label: string
  measurable: boolean
  ai_confidence: number
}> = [
  {
    source_type: 'memoire_engagement',
    source_excerpt:
      'Nettoyage quotidien des postes de travail et sanitaires sur les 12 étages, 5 jours sur 7',
    source_ref: { page: 1, section: '1' },
    category: 'frequency',
    short_label: 'Postes nettoyage quotidien 5j/7',
    measurable: true,
    ai_confidence: 0.91,
  },
  {
    source_type: 'memoire_engagement',
    source_excerpt:
      'Vitres extérieures effectuées une fois par mois avec nacelle louée auprès de notre partenaire certifié',
    source_ref: { page: 1, section: '2' },
    category: 'frequency',
    short_label: 'Vitres mensuelles avec nacelle',
    measurable: true,
    ai_confidence: 0.89,
  },
  {
    source_type: 'memoire_engagement',
    source_excerpt:
      'Personnel doté d\'un badge nominatif délivré par votre service sécurité, charte de confidentialité signée',
    source_ref: { page: 1, section: '3' },
    category: 'compliance',
    short_label: 'Accès badge + charte confidentialité',
    measurable: false,
    ai_confidence: 0.87,
  },
  {
    source_type: 'memoire_engagement',
    source_excerpt:
      'Reporting structuré transmis avant le 5 du mois suivant : taux de conformité par zone, anomalies',
    source_ref: { page: 1, section: '4' },
    category: 'reporting',
    short_label: 'Reporting mensuel structuré',
    measurable: true,
    ai_confidence: 0.86,
  },
]

async function seedContract2(adminId: string, supabase: SupabaseAdmin) {
  const existingContract = await findContractByName(supabase, BANQUE_CONTRACT_NAME)
  if (existingContract) {
    console.log(`  ↳ Contract '${BANQUE_CONTRACT_NAME}' already exists, skipping`)
    return
  }

  const { tenderId } = await ensureTender(
    supabase,
    BANQUE_TENDER_TITLE,
    BANQUE_CLIENT_NAME,
    BANQUE_EXTRACTED_TEXT,
    BANQUE_TECHNICAL_MEMO,
    BANQUE_SUMMARY,
    adminId
  )

  const engagements = await bulkInsertEngagements({
    tender_id: tenderId,
    created_by: adminId,
    engagements: BANQUE_ENGAGEMENTS,
  })
  console.log(`  ↳ Inserted ${engagements.length} engagements`)

  const contractId = await createContract({
    tender_id: tenderId,
    name: BANQUE_CONTRACT_NAME,
    client_name: BANQUE_CLIENT_NAME,
    start_date: isoDate(daysAgo(60)), // 2 months ago
    end_date: isoDate(daysFromNow(670)),
    created_by: adminId,
  })
  console.log(`  ↳ Created contract (id=${contractId})`)

  await activateEngagementsForContract(tenderId, contractId)

  const eByLabel = new Map<string, DbEngagement>()
  for (const e of engagements) eByLabel.set(e.short_label, e)
  const idPostes = eByLabel.get('Postes nettoyage quotidien 5j/7')!.id
  const idVitres = eByLabel.get('Vitres mensuelles avec nacelle')!.id
  const idReporting = eByLabel.get('Reporting mensuel structuré')!.id

  const clientId = await ensureClient(supabase, BANQUE_CLIENT_NAME)
  const siteId = await createSite({
    client_id: clientId,
    contract_id: contractId,
    name: 'Banque Centrale — Siège',
    address: 'Siège — 12 étages',
    notes: 'Accès badge sécurisé, horaires 6h-8h ou 18h-20h.',
  })
  console.log(`  ↳ Created 1 site`)

  // 2 missions
  const missionQuoId = await createMission({
    site_id: siteId,
    name: 'Nettoyage quotidien étages',
    description: 'Nettoyage quotidien postes + sanitaires sur les 12 étages.',
    cadence: 'daily',
    default_team: [],
    engagement_ids: [idPostes, idReporting],
    default_checklist: [
      { label: 'Aspirateur', required: false, position: 0 },
      { label: 'Désinfection bureaux', required: false, engagement_id: idPostes, position: 1 },
      { label: 'Sanitaires étage', required: true, engagement_id: idPostes, position: 2 },
      { label: 'Vidage poubelles', required: false, position: 3 },
    ],
    created_by: adminId,
  })

  const missionVitresId = await createMission({
    site_id: siteId,
    name: 'Vitres mensuelles',
    description: 'Vitres extérieures + intérieures, fréquence mensuelle, avec nacelle.',
    cadence: 'monthly',
    default_team: [],
    engagement_ids: [idVitres],
    default_checklist: [
      { label: 'Vitres extérieures', required: false, engagement_id: idVitres, position: 0 },
      { label: 'Vitres intérieures', required: false, engagement_id: idVitres, position: 1 },
      { label: 'Vérification équipement nacelle', required: true, engagement_id: idVitres, position: 2 },
    ],
    created_by: adminId,
  })

  console.log(`  ↳ Created 2 missions`)

  // 5 interventions :
  //   3 validated with photos
  //   2 completed without photos (PROUVÉ partiel by design)
  type Plan = {
    missionId: string
    daysOffset: number
    status: 'validated' | 'completed'
    withPhotos: boolean
    template: ChecklistTemplateItem[]
  }

  const quoTpl: ChecklistTemplateItem[] = [
    { label: 'Aspirateur', required: false, position: 0 },
    { label: 'Désinfection bureaux', required: false, engagement_id: idPostes, position: 1 },
    { label: 'Sanitaires étage', required: true, engagement_id: idPostes, position: 2 },
    { label: 'Vidage poubelles', required: false, position: 3 },
  ]
  const vitresTpl: ChecklistTemplateItem[] = [
    { label: 'Vitres extérieures', required: false, engagement_id: idVitres, position: 0 },
    { label: 'Vitres intérieures', required: false, engagement_id: idVitres, position: 1 },
    { label: 'Vérification équipement nacelle', required: true, engagement_id: idVitres, position: 2 },
  ]

  const plans: Plan[] = [
    { missionId: missionQuoId, daysOffset: -30, status: 'validated', withPhotos: true, template: quoTpl },
    { missionId: missionQuoId, daysOffset: -20, status: 'validated', withPhotos: true, template: quoTpl },
    { missionId: missionVitresId, daysOffset: -28, status: 'validated', withPhotos: true, template: vitresTpl },
    { missionId: missionQuoId, daysOffset: -10, status: 'completed', withPhotos: false, template: quoTpl },
    { missionId: missionQuoId, daysOffset: -5, status: 'completed', withPhotos: false, template: quoTpl },
  ]

  let validated = 0
  let completed = 0
  let totalPhotos = 0

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i]
    const scheduledAt = new Date()
    scheduledAt.setDate(scheduledAt.getDate() + plan.daysOffset)
    scheduledAt.setHours(7, 0, 0, 0)

    const interventionId = await createIntervention({
      mission_id: plan.missionId,
      scheduled_at: isoTimestamp(scheduledAt),
      team: [adminId],
      created_by: adminId,
    })

    const checklistRows = await bulkInsertChecklistItems(
      plan.template.map((c, idx) => ({
        intervention_id: interventionId,
        engagement_id: c.engagement_id ?? null,
        label: c.label,
        position: c.position ?? idx,
        required: c.required ?? false,
      }))
    )

    for (const item of checklistRows) {
      await markChecklistItemDone(item.id, adminId)
    }

    if (plan.withPhotos) {
      const photoSpecs: Array<{ label: string; kind: PhotoKind }> = [
        { label: 'Avant — Étage', kind: 'before' },
        { label: 'Après — Étage', kind: 'after' },
        { label: 'Preuve fin', kind: 'proof' },
      ]
      for (const p of photoSpecs) {
        const path = await uploadSeedPhoto(supabase, interventionId, p.label, p.kind)
        await insertPhoto({
          intervention_id: interventionId,
          checklist_item_id: null,
          storage_path: path,
          kind: p.kind,
          caption: p.label,
          taken_by: adminId,
        })
        totalPhotos++
      }
    }

    const executedAt = new Date(scheduledAt)
    executedAt.setHours(executedAt.getHours() + 2)
    await updateInterventionStatus(interventionId, 'completed', isoTimestamp(executedAt))

    if (plan.status === 'validated') {
      await createValidation({
        intervention_id: interventionId,
        validated_by: adminId,
        comment: 'Conforme',
      })
      await updateInterventionStatus(interventionId, 'validated', isoTimestamp(executedAt))
      validated++
    } else {
      completed++
    }
  }

  console.log(
    `  ↳ Interventions seeded : ${validated} validated / ${completed} completed / 0 planned ; Photos : ${totalPhotos}`
  )
}

// ---------------------------------------------------------------------------
// CONTRACT 3 — École Jean Jaurès (early-stage)
// ---------------------------------------------------------------------------

const ECOLE_TENDER_TITLE = '[DEMO] École Jean Jaurès — Multi-sites 2026-2027'
const ECOLE_CONTRACT_NAME = 'École Jean Jaurès — Multi-sites 2026-2027'
const ECOLE_CLIENT_NAME = 'Mairie — École Jean Jaurès'

const ECOLE_EXTRACTED_TEXT = `APPEL D'OFFRES NETTOYAGE — ÉCOLE JEAN JAURÈS — MULTI-SITES
Référence : ECOLE-2026-NETT-07
Durée : 18 mois
Surfaces : école principale (3 200 m²) + annexe maternelle (1 100 m²)

1. PRESTATIONS ATTENDUES

Le prestataire effectuera le nettoyage quotidien des classes, sanitaires enfants et couloirs. La cantine sera bionettoyée 2 fois par jour (avant et après chaque service) dans le strict respect des normes HACCP. Le gymnase fait l'objet d'un nettoyage hebdomadaire dédié (sols sportifs spécifiques).

2. PRODUITS ET SÉCURITÉ

L'ensemble des produits utilisés devra être adapté au contact d'enfants : sans solvants, sans parfum agressif, certifiés Ecolabel. Les fiches de données de sécurité (FDS) seront tenues à disposition.

3. PERSONNEL ET FORMATION

Le personnel intervenant en cantine devra être formé HACCP (formation initiale + recyclage tous les 3 ans). Une attestation à jour sera fournie pour chaque agent.

4. SOLS SPORTIFS — GYMNASE

Le sol du gymnase est un sol sportif de type Tarkett Omnisports : produits adaptés requis, pas de monobrosse rotative. Nettoyage hebdomadaire avec produit neutre dédié.

5. CLAUSES SOCIALES

Le marché comporte une clause sociale d'insertion : 5% des heures travaillées devront être effectuées par des personnels en parcours d'insertion (publics éloignés de l'emploi). Justificatif RH attendu trimestriellement.

6. REPORTING

Un compte-rendu mensuel sera adressé à la direction de l'école et à la fédération des parents d'élèves : indicateurs de propreté, anomalies, suivi de la clause sociale.`

const ECOLE_TECHNICAL_MEMO = `# Mémoire technique — École Jean Jaurès

## 1. Approche scolaire et présence enfants

Notre équipe dédiée de 2 ETP nettoie quotidiennement les classes, sanitaires enfants et couloirs des deux sites (école principale + annexe maternelle). Tous nos produits sont sans solvants, sans parfum agressif, certifiés Ecolabel européen — adaptés au contact d'enfants.

## 2. Cantine HACCP biquotidienne

La cantine est bionettoyée 2x/jour (avant et après chaque service), dans le strict respect des normes HACCP. Notre personnel cantine est intégralement formé HACCP avec recyclage triennal. Les attestations sont disponibles à tout contrôle.

## 3. Personnel certifié

Tous nos agents intervenant en cantine détiennent une attestation HACCP en cours de validité. Notre service formation interne organise les recyclages selon le calendrier réglementaire.

## 4. Sols sportifs — Gymnase

Le sol Tarkett Omnisports du gymnase est traité avec un produit neutre dédié et un matériel adapté (pas de monobrosse rotative). Nettoyage hebdomadaire conformément au cahier des charges.

## 5. Engagement clause sociale

Nous nous engageons à atteindre les 5% d'heures effectuées par des personnels en parcours d'insertion. Notre partenariat avec la régie de quartier nous permet de mobiliser ces profils. Justificatif RH transmis trimestriellement.

## 6. Reporting parents

Compte-rendu mensuel transmis à la direction et à la fédération des parents d'élèves : indicateurs propreté, anomalies, suivi clause sociale.`

const ECOLE_SUMMARY =
  'École Jean Jaurès — multi-sites (école principale + annexe maternelle), 4 300 m². 18 mois. Cantine HACCP 2x/jour, produits sans solvants pour enfants, sols sportifs gymnase, clause sociale 5% insertion.'

const ECOLE_ENGAGEMENTS: Array<{
  source_type: EngagementSourceType
  source_excerpt: string
  source_ref: Record<string, unknown>
  category: EngagementCategory
  short_label: string
  measurable: boolean
  ai_confidence: number
}> = [
  {
    source_type: 'memoire_engagement',
    source_excerpt:
      'La cantine est bionettoyée 2x/jour (avant et après chaque service), dans le strict respect des normes HACCP',
    source_ref: { page: 1, section: '2' },
    category: 'frequency',
    short_label: 'Cantine bionettoyage 2x/jour HACCP',
    measurable: true,
    ai_confidence: 0.93,
  },
  {
    source_type: 'memoire_engagement',
    source_excerpt:
      'Tous nos produits sont sans solvants, sans parfum agressif, certifiés Ecolabel européen — adaptés au contact d\'enfants',
    source_ref: { page: 1, section: '1' },
    category: 'quality',
    short_label: 'Produits sans solvants pour enfants',
    measurable: false,
    ai_confidence: 0.91,
  },
  {
    source_type: 'memoire_engagement',
    source_excerpt:
      'Tous nos agents intervenant en cantine détiennent une attestation HACCP en cours de validité',
    source_ref: { page: 1, section: '3' },
    category: 'compliance',
    short_label: 'Personnel HACCP certifié',
    measurable: false,
    ai_confidence: 0.92,
  },
  {
    source_type: 'memoire_engagement',
    source_excerpt:
      'Le sol Tarkett Omnisports du gymnase est traité avec un produit neutre dédié et un matériel adapté',
    source_ref: { page: 1, section: '4' },
    category: 'delivery',
    short_label: 'Sols sportifs gymnase produit neutre',
    measurable: false,
    ai_confidence: 0.88,
  },
  {
    source_type: 'memoire_engagement',
    source_excerpt:
      "Nous nous engageons à atteindre les 5% d'heures effectuées par des personnels en parcours d'insertion",
    source_ref: { page: 1, section: '5' },
    category: 'compliance',
    short_label: 'Clause sociale insertion 5%',
    measurable: true,
    ai_confidence: 0.9,
  },
  {
    source_type: 'memoire_engagement',
    source_excerpt:
      'Compte-rendu mensuel transmis à la direction et à la fédération des parents d\'élèves',
    source_ref: { page: 1, section: '6' },
    category: 'reporting',
    short_label: 'Reporting mensuel parents',
    measurable: true,
    ai_confidence: 0.87,
  },
]

async function seedContract3(adminId: string, supabase: SupabaseAdmin) {
  const existingContract = await findContractByName(supabase, ECOLE_CONTRACT_NAME)
  if (existingContract) {
    console.log(`  ↳ Contract '${ECOLE_CONTRACT_NAME}' already exists, skipping`)
    return
  }

  const { tenderId } = await ensureTender(
    supabase,
    ECOLE_TENDER_TITLE,
    ECOLE_CLIENT_NAME,
    ECOLE_EXTRACTED_TEXT,
    ECOLE_TECHNICAL_MEMO,
    ECOLE_SUMMARY,
    adminId
  )

  const engagements = await bulkInsertEngagements({
    tender_id: tenderId,
    created_by: adminId,
    engagements: ECOLE_ENGAGEMENTS,
  })
  console.log(`  ↳ Inserted ${engagements.length} engagements`)

  const contractId = await createContract({
    tender_id: tenderId,
    name: ECOLE_CONTRACT_NAME,
    client_name: ECOLE_CLIENT_NAME,
    start_date: isoDate(daysAgo(21)), // 3 weeks ago
    end_date: isoDate(daysFromNow(540 - 21)),
    created_by: adminId,
  })
  console.log(`  ↳ Created contract (id=${contractId})`)

  await activateEngagementsForContract(tenderId, contractId)

  const eByLabel = new Map<string, DbEngagement>()
  for (const e of engagements) eByLabel.set(e.short_label, e)
  const idCantine = eByLabel.get('Cantine bionettoyage 2x/jour HACCP')!.id
  const idProduits = eByLabel.get('Produits sans solvants pour enfants')!.id
  const idHACCP = eByLabel.get('Personnel HACCP certifié')!.id
  const idSols = eByLabel.get('Sols sportifs gymnase produit neutre')!.id

  const clientId = await ensureClient(supabase, ECOLE_CLIENT_NAME)
  const sitePrincipalId = await createSite({
    client_id: clientId,
    contract_id: contractId,
    name: 'École principale',
    address: 'Bâtiment principal',
    notes: null,
  })
  const siteAnnexeId = await createSite({
    client_id: clientId,
    contract_id: contractId,
    name: 'Annexe maternelle',
    address: 'Annexe',
    notes: null,
  })
  console.log(`  ↳ Created 2 sites`)

  // 3 missions (across both sites)
  const missionClassesId = await createMission({
    site_id: sitePrincipalId,
    name: 'Nettoyage quotidien classes',
    description: 'Nettoyage quotidien classes + couloirs avec produits sans solvants.',
    cadence: 'daily',
    default_team: [],
    engagement_ids: [idProduits, idHACCP],
    default_checklist: [
      { label: 'Aspirateur classes', required: false, position: 0 },
      { label: 'Lavage sols', required: false, engagement_id: idProduits, position: 1 },
      { label: 'Désinfection sanitaires enfants', required: true, engagement_id: idProduits, position: 2 },
      { label: 'Vidage poubelles', required: false, position: 3 },
    ],
    created_by: adminId,
  })

  const missionCantineId = await createMission({
    site_id: sitePrincipalId,
    name: 'Cantine 2x/jour HACCP',
    description: 'Bionettoyage cantine biquotidien — protocole HACCP.',
    cadence: 'daily',
    default_team: [],
    engagement_ids: [idCantine, idHACCP],
    default_checklist: [
      { label: 'Désinfection tables', required: true, engagement_id: idCantine, position: 0 },
      { label: 'Sols cuisine', required: true, engagement_id: idCantine, position: 1 },
      { label: 'Plan de travail HACCP', required: true, engagement_id: idHACCP, position: 2 },
    ],
    created_by: adminId,
  })

  const missionGymnaseId = await createMission({
    site_id: siteAnnexeId,
    name: 'Gymnase hebdo',
    description: 'Nettoyage hebdomadaire sol sportif Tarkett Omnisports.',
    cadence: 'weekly',
    default_team: [],
    engagement_ids: [idSols],
    default_checklist: [
      { label: 'Sol sportif produit neutre', required: true, engagement_id: idSols, position: 0 },
      { label: 'Vestiaires', required: false, position: 1 },
    ],
    created_by: adminId,
  })

  console.log(`  ↳ Created 3 missions`)

  // 2 interventions :
  //   1 in_progress (today, started but not finished — some checklist items done, no photos)
  //   1 planned (tomorrow)

  // In-progress (today, started 1h ago)
  const today = new Date()
  today.setHours(today.getHours() - 1, 0, 0, 0)
  const inProgressId = await createIntervention({
    mission_id: missionClassesId,
    scheduled_at: isoTimestamp(today),
    team: [adminId],
    created_by: adminId,
  })
  const ipChecklist: ChecklistTemplateItem[] = [
    { label: 'Aspirateur classes', required: false, position: 0 },
    { label: 'Lavage sols', required: false, engagement_id: idProduits, position: 1 },
    { label: 'Désinfection sanitaires enfants', required: true, engagement_id: idProduits, position: 2 },
    { label: 'Vidage poubelles', required: false, position: 3 },
  ]
  const ipRows = await bulkInsertChecklistItems(
    ipChecklist.map((c, idx) => ({
      intervention_id: inProgressId,
      engagement_id: c.engagement_id ?? null,
      label: c.label,
      position: c.position ?? idx,
      required: c.required ?? false,
    }))
  )
  // Mark first 2 items done (en cours)
  await markChecklistItemDone(ipRows[0].id, adminId)
  await markChecklistItemDone(ipRows[1].id, adminId)
  await updateInterventionStatus(inProgressId, 'in_progress')

  // Planned (tomorrow)
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(8, 0, 0, 0)
  const plannedId = await createIntervention({
    mission_id: missionCantineId,
    scheduled_at: isoTimestamp(tomorrow),
    team: [adminId],
    created_by: adminId,
  })
  const plannedChecklist: ChecklistTemplateItem[] = [
    { label: 'Désinfection tables', required: true, engagement_id: idCantine, position: 0 },
    { label: 'Sols cuisine', required: true, engagement_id: idCantine, position: 1 },
    { label: 'Plan de travail HACCP', required: true, engagement_id: idHACCP, position: 2 },
  ]
  await bulkInsertChecklistItems(
    plannedChecklist.map((c, idx) => ({
      intervention_id: plannedId,
      engagement_id: c.engagement_id ?? null,
      label: c.label,
      position: c.position ?? idx,
      required: c.required ?? false,
    }))
  )

  console.log(`  ↳ Interventions seeded : 0 validated / 0 completed / 1 in_progress / 1 planned`)
  console.log(`  ↳ Photos : 0 (early-stage scenario by design)`)
}

// ---------------------------------------------------------------------------
// DEMO TENDER 4 — Hôpital Sainte-Marie (AO en cours, pas de contrat)
//
// Ce tender est l'AO en cours d'analyse qu'un Resp. AO ouvrirait via
// `/tenders/<id>?view=memoire`. Le panel d'évidence à droite va chercher des
// engagements similaires dans les 3 contrats actifs (CHU / Banque / École).
//
// Le mémoire technique est construit pour matcher (pg_trgm) le vocabulaire
// présent dans les engagements des 3 contrats : bionettoyage, sanitaires
// écolabel, ISO 9001, audit qualité, reporting mensuel photos avant/après,
// HACCP cantine, produits sans solvants, etc.
// ---------------------------------------------------------------------------

const SAINTE_MARIE_TENDER_TITLE = '[DEMO] Hôpital Sainte-Marie — Bionettoyage 2026'
const SAINTE_MARIE_CLIENT_NAME = 'Hôpital Sainte-Marie'

const SAINTE_MARIE_EXTRACTED_TEXT = `APPEL D'OFFRES NETTOYAGE — HÔPITAL SAINTE-MARIE — LOT BIONETTOYAGE
Référence : SM-2026-NETT-12
Durée : 36 mois renouvelables
Surface totale : 9 800 m² répartis sur 2 bâtiments (pôle médecine + pôle restauration)

1. PRESTATIONS ATTENDUES

Bionettoyage biquotidien des sanitaires, chambres patients et zones à risque infectieux avec produits écolabel certifiés. Fréquences strictes : 2x/jour sanitaires, 1x/jour couloirs et salles d'attente, 1x/semaine vitres et surfaces hautes. Cantine du personnel bionettoyée 2x/jour dans le respect HACCP (avant et après chaque service).

2. EXIGENCES QUALITÉ

Le prestataire devra maintenir une certification ISO 9001:2015 pendant toute la durée du marché. Audit qualité hebdomadaire conjoint avec le service Hygiène Hospitalière, rapport écrit transmis sous 48h.

3. PRODUITS ET CONFORMITÉ

Tous les produits utilisés satisferont aux exigences Ecolabel européen et seront adaptés au milieu hospitalier. Fiches de données de sécurité (FDS) tenues à disposition. Personnel détenteur de la formation CQP APH ou équivalent. Personnel cantine formé HACCP avec recyclage triennal.

4. NIVEAU DE SERVICE

Reprise sous 4 heures ouvrées 7 jours sur 7 en cas d'incident sanitaire signalé. Pénalités contractuelles de 0,5% du marché par jour de retard, plafonnées à 5%.

5. REPORTING

Reporting mensuel structuré : photos avant/après par zone critique, indicateurs de performance qualité, anomalies traitées et non-traitées, suggestions d'amélioration. Transmission avant le 5 du mois suivant.

6. SÉCURITÉ ET CONFIDENTIALITÉ

Personnel doté de badge nominatif délivré par le service sécurité. Charte de confidentialité signée à l'embauche. Respect strict du secret médical. Vacation jour et nuit (équipes en rotation).`

const SAINTE_MARIE_TECHNICAL_MEMO = `# Mémoire technique — Réponse à l'AO Hôpital Sainte-Marie

## 1. Approche du bionettoyage hospitalier

Nous nous engageons à effectuer un **bionettoyage biquotidien des sanitaires** et des chambres patients avec **produits écolabel certifiés Ecocert**, dans le strict respect des fréquences imposées par le cahier des charges. Notre équipe dédiée de 5 ETP est intégralement formée au CQP APH (Certificat de Qualification Professionnelle Agent de Propreté Hospitalière).

Les zones à risque infectieux feront l'objet d'un protocole spécifique avec traçabilité écrite. Les couloirs et salles d'attente seront traités quotidiennement, les vitres et surfaces hautes hebdomadairement.

## 2. Cantine du personnel — protocole HACCP

La cantine du personnel sera **bionettoyée 2 fois par jour** (avant et après chaque service), dans le strict respect des **normes HACCP**. Notre personnel cantine est intégralement formé HACCP avec recyclage triennal. Les attestations à jour sont disponibles à tout contrôle inopiné.

Nous utiliserons exclusivement des produits sans solvants agressifs et adaptés au contact alimentaire, conformément aux exigences sanitaires.

## 3. Certifications et qualité

Nous maintiendrons notre **certification ISO 9001:2015** pendant toute la durée du marché. Notre service qualité interne effectuera un **audit qualité hebdomadaire** en collaboration avec le service Hygiène Hospitalière, avec rapport écrit transmis sous 48h.

Tous nos produits sont **certifiés Ecolabel européen**. Les fiches de données de sécurité (FDS) sont tenues à disposition dans un classeur dédié sur chaque site, mis à jour à chaque réapprovisionnement.

## 4. Engagement de service — SLA

Nous garantissons une **intervention sous 4 heures ouvrées 7j/7** en cas d'incident sanitaire, avec une équipe d'astreinte joignable 24h/24. Notre organisation prévoit une rotation **vacation jour et nuit** permettant de couvrir tous les créneaux, y compris les urgences post-opératoires.

## 5. Reporting mensuel structuré

Nous fournirons un **rapport mensuel structuré** comprenant :
- Photos avant/après géolocalisées par zone critique (sans patient identifiable)
- Indicateurs qualité : taux de conformité par zone, délai moyen de résolution d'incident
- Liste exhaustive des anomalies signalées et résolues
- Suggestions opérationnelles d'amélioration continue

Le reporting sera transmis avant le 5 du mois suivant, au format PDF + tableau de bord interactif.

## 6. Sécurité, accès et confidentialité

L'ensemble de notre personnel sera doté d'un **badge nominatif** délivré par votre service sécurité. **Charte de confidentialité** signée à l'embauche. Respect strict du secret médical : aucune photographie incluant un patient, aucun document non public.

## 7. Continuité et clause sociale

Nous nous engageons à reprendre les contrats des agents en place dans le respect du Code du travail. Notre démarche RSE intègre une clause sociale d'insertion : nous mobilisons des personnels en parcours d'insertion via notre partenariat avec la régie de quartier, justificatif RH transmis trimestriellement.`

const SAINTE_MARIE_SUMMARY =
  'Hôpital Sainte-Marie — bionettoyage hospitalier 9 800 m² sur 2 bâtiments. Marché 36 mois. Exigences ISO 9001:2015 + Ecolabel + CQP APH + HACCP cantine. SLA reprise 4h ouvrées 7j/7. Reporting mensuel photos avant/après. Vacation jour + nuit.'

/**
 * Crée (ou rafraîchit) le tender démo Sainte-Marie.
 * - status: 'ready' (analyse OK, pas de contrat converti)
 * - aucune engagement extrait — on consulte uniquement le mémoire pour matcher
 *   les engagements *des autres tenders* via cross-tender search
 */
async function seedDemoTenderSainteMarie(adminId: string, supabase: SupabaseAdmin) {
  await ensureTender(
    supabase,
    SAINTE_MARIE_TENDER_TITLE,
    SAINTE_MARIE_CLIENT_NAME,
    SAINTE_MARIE_EXTRACTED_TEXT,
    SAINTE_MARIE_TECHNICAL_MEMO,
    SAINTE_MARIE_SUMMARY,
    adminId,
    { refreshAnalysis: true }
  )
}

// ---------------------------------------------------------------------------
// RECURRENCES — Phase 6 (Slice 6.6)
//
// On définit des templates crédibles métier par contrat. Le seed est
// idempotent : relancer la commande ne crée pas de doublons (signature
// frequency+slots+day_of_week+day_of_month par mission). Après création, on
// lance une génération paresseuse sur 7 jours pour rendre la démo
// immédiatement vivante.
// ---------------------------------------------------------------------------

const TODAY_ISO = isoDate(new Date())

// CHU Régional — mission spécifique par site (Tour Médecine / Tour Chirurgie /
// Bâtiment Annexe). Bionettoyage 2x/jour, couloirs quotidiens en semaine,
// audit hebdomadaire.
function chuRecurrenceSpec() {
  const sites = ['Tour Médecine', 'Tour Chirurgie', 'Bâtiment Annexe']
  return sites.map((siteName) => ({
    siteName,
    missions: [
      {
        missionName: 'Bionettoyage quotidien sanitaires',
        templates: [
          {
            title: 'Sanitaires — bionettoyage 2x/jour',
            frequency: 'daily' as InterventionFrequency,
            slots: ['morning', 'evening'] as InterventionSlot[],
            starts_on: TODAY_ISO,
          },
        ],
      },
      {
        missionName: 'Nettoyage couloirs',
        templates: [
          {
            title: 'Couloirs — passage quotidien matin',
            frequency: 'weekdays' as InterventionFrequency,
            slots: ['morning'] as InterventionSlot[],
            starts_on: TODAY_ISO,
          },
        ],
      },
      {
        missionName: 'Audit qualité',
        templates: [
          {
            title: 'Audit Hygiène Hospitalière — hebdomadaire (jeudi)',
            frequency: 'weekly' as InterventionFrequency,
            day_of_week: 4, // jeudi
            slots: ['morning'] as InterventionSlot[],
            starts_on: TODAY_ISO,
          },
        ],
      },
    ],
  }))
}

// Banque Centrale — un seul site. Quotidien postes + vitres mensuelles.
function banqueRecurrenceSpec() {
  return [
    {
      siteName: 'Banque Centrale — Siège',
      missions: [
        {
          missionName: 'Nettoyage quotidien étages',
          templates: [
            {
              title: 'Postes & sanitaires — passage soir 5j/7',
              frequency: 'weekdays' as InterventionFrequency,
              slots: ['evening'] as InterventionSlot[],
              starts_on: TODAY_ISO,
            },
            {
              title: 'Sanitaires — passage renforcé 2x/jour',
              frequency: 'daily' as InterventionFrequency,
              slots: ['morning', 'afternoon'] as InterventionSlot[],
              starts_on: TODAY_ISO,
            },
          ],
        },
        {
          missionName: 'Vitres mensuelles',
          templates: [
            {
              title: 'Vitres — passage mensuel (1er du mois)',
              frequency: 'monthly' as InterventionFrequency,
              day_of_month: 1,
              slots: null,
              starts_on: TODAY_ISO,
            },
          ],
        },
      ],
    },
  ]
}

// École Jean Jaurès — école principale + annexe maternelle.
function ecoleRecurrenceSpec() {
  return [
    {
      siteName: 'École principale',
      missions: [
        {
          missionName: 'Nettoyage quotidien classes',
          templates: [
            {
              title: 'Salles de classe — passage soir 5j/7',
              frequency: 'weekdays' as InterventionFrequency,
              slots: ['evening'] as InterventionSlot[],
              starts_on: TODAY_ISO,
            },
          ],
        },
        {
          missionName: 'Cantine 2x/jour HACCP',
          templates: [
            {
              title: 'Cantine — après repas (HACCP, 5j/7)',
              frequency: 'weekdays' as InterventionFrequency,
              slots: ['afternoon'] as InterventionSlot[],
              starts_on: TODAY_ISO,
            },
          ],
        },
      ],
    },
    {
      siteName: 'Annexe maternelle',
      missions: [
        {
          missionName: 'Gymnase hebdo',
          templates: [
            {
              title: 'Gymnase — passage hebdomadaire (mercredi)',
              frequency: 'weekly' as InterventionFrequency,
              day_of_week: 3, // mercredi
              slots: ['evening'] as InterventionSlot[],
              starts_on: TODAY_ISO,
            },
          ],
        },
      ],
    },
  ]
}

/**
 * Aplatie la spec hiérarchique (site → mission → templates) au format attendu
 * par seedTemplatesForContract.
 */
function flattenRecurrenceSpec(
  spec: Array<{
    siteName: string
    missions: Array<{
      missionName: string
      templates: TemplateSeedParams[]
    }>
  }>
): Array<{ siteName: string; missionName: string; templates: TemplateSeedParams[] }> {
  const out: Array<{ siteName: string; missionName: string; templates: TemplateSeedParams[] }> = []
  for (const s of spec) {
    for (const m of s.missions) {
      out.push({ siteName: s.siteName, missionName: m.missionName, templates: m.templates })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Teams (Phase 9 — Vue Semaine & Équipes) — seed enrichissement (Slice 9.6)
// ---------------------------------------------------------------------------
//
// Doctrine V2 :
//  - Les équipes sont des CONTENEURS LOGISTIQUES de couverture.
//  - On affecte des missions ou interventions PLANIFIÉES à une équipe via
//    `assigned_team_id`.
//  - On laisse exprès certaines missions/interventions sans équipe pour
//    démontrer la ligne "Non-affecté" (ambre discret) sur la vue semaine.
//  - On crée aussi quelques chef_equipe (membres d'équipes) + on en laisse 1-2
//    « orphelins » pour démontrer la section orphelins sur /equipes.
//
// Idempotent : upsert par `name` (la team est réutilisée si elle existe déjà,
// les memberships sont insérés seulement si absents).

const TEAM_SEEDS: Array<{ name: string; color: string }> = [
  { name: 'Alpha', color: 'sky' },
  { name: 'Beta', color: 'emerald' },
  { name: 'Gamma', color: 'violet' },
]

// Quelques chef_equipe démo. Mot de passe identique (`Demo!2026`) pour la démo,
// rotation au premier login (must_change_password=true côté trigger).
// 3 affectés (1 par équipe), 2 orphelins (visibles section "Pas dans une équipe").
const CHEF_EQUIPE_SEEDS: Array<{
  email: string
  fullName: string
  assignTo: 'Alpha' | 'Beta' | 'Gamma' | null
}> = [
  { email: 'mehdi.demo@netoiage.local',   fullName: 'Mehdi Demo',   assignTo: 'Alpha' },
  { email: 'lea.demo@netoiage.local',     fullName: 'Léa Demo',     assignTo: 'Alpha' },
  { email: 'yann.demo@netoiage.local',    fullName: 'Yann Demo',    assignTo: 'Beta' },
  { email: 'aicha.demo@netoiage.local',   fullName: 'Aïcha Demo',   assignTo: 'Beta' },
  { email: 'tarek.demo@netoiage.local',   fullName: 'Tarek Demo',   assignTo: 'Gamma' },
  // Orphelins (pas dans une équipe — visible bandeau /equipes)
  { email: 'sofia.demo@netoiage.local',   fullName: 'Sofia Demo',   assignTo: null },
  { email: 'mathieu.demo@netoiage.local', fullName: 'Mathieu Demo', assignTo: null },
]

const CHEF_EQUIPE_DEMO_PASSWORD = 'Demo!2026'

async function ensureChefEquipe(
  supabase: SupabaseAdmin,
  email: string,
  fullName: string
): Promise<string> {
  // 1) auth.users : recherche par email via listUsers
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers()
  if (listErr) throw listErr
  const existing = list?.users?.find((u) => u.email === email)
  if (existing) {
    // Ensure public.users row is set to chef_equipe + correct name (trigger
    // default = chef_equipe déjà, mais on force au cas où).
    await supabase
      .from('users')
      .update({ role: 'chef_equipe', full_name: fullName })
      .eq('id', existing.id)
    return existing.id
  }

  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password: CHEF_EQUIPE_DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName, role: 'chef_equipe' },
  })
  if (createErr) throw createErr
  if (!created.user) throw new Error(`Failed to create user ${email}`)

  // Trigger handle_new_auth_user crée public.users avec role chef_equipe.
  // On force le nom (l'email seul ne suffit pas pour un affichage propre).
  const { error: upErr } = await supabase
    .from('users')
    .update({ role: 'chef_equipe', full_name: fullName })
    .eq('id', created.user.id)
  if (upErr) throw upErr

  return created.user.id
}

async function ensureTeam(
  supabase: SupabaseAdmin,
  name: string,
  color: string,
  adminId: string
): Promise<{ id: string; created: boolean }> {
  const { data: existing, error: fetchErr } = await supabase
    .from('teams')
    .select('id')
    .eq('name', name)
    .is('deleted_at', null)
    .maybeSingle()
  if (fetchErr) throw fetchErr
  if (existing) return { id: existing.id as string, created: false }

  const { data: created, error: insertErr } = await supabase
    .from('teams')
    .insert({ name, color, created_by: adminId })
    .select('id')
    .single()
  if (insertErr) throw insertErr
  return { id: created.id as string, created: true }
}

async function ensureMembership(
  supabase: SupabaseAdmin,
  teamId: string,
  userId: string
): Promise<boolean> {
  const { data: existing } = await supabase
    .from('team_members')
    .select('id')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .is('left_at', null)
    .maybeSingle()
  if (existing) return false

  const { error: insertErr } = await supabase
    .from('team_members')
    .insert({ team_id: teamId, user_id: userId })
  if (insertErr) throw insertErr
  return true
}

/**
 * Affecte (idempotent) une mission existante à une team par son nom de mission.
 * Skip si la mission n'existe pas (ex: un contrat démo absent) ou si elle est
 * déjà affectée à la bonne team.
 */
async function assignMissionToTeam(
  supabase: SupabaseAdmin,
  missionName: string,
  teamId: string
): Promise<boolean> {
  const { data: missions, error: fetchErr } = await supabase
    .from('missions')
    .select('id, assigned_team_id')
    .eq('name', missionName)
    .is('deleted_at', null)
  if (fetchErr) throw fetchErr
  if (!missions || missions.length === 0) return false

  let assigned = false
  for (const m of missions) {
    if (m.assigned_team_id === teamId) continue
    const { error: upErr } = await supabase
      .from('missions')
      .update({ assigned_team_id: teamId })
      .eq('id', m.id)
    if (upErr) throw upErr
    // Propage aux interventions PLANIFIÉES de cette mission (les exécutées
    // restent figées : immuabilité preuve).
    await supabase
      .from('interventions')
      .update({ assigned_team_id: teamId })
      .eq('mission_id', m.id)
      .eq('status', 'planned')
      .is('assigned_team_id', null)
    assigned = true
  }
  return assigned
}

async function seedTeams(adminId: string, supabase: SupabaseAdmin) {
  console.log('👥 Seeding teams (Phase 9) ...')

  // 1) Teams
  const teamIdByName = new Map<string, string>()
  for (const t of TEAM_SEEDS) {
    const { id, created } = await ensureTeam(supabase, t.name, t.color, adminId)
    teamIdByName.set(t.name, id)
    console.log(`  ↳ Team ${t.name} (${t.color}) ${created ? 'créée' : 'déjà présente'}`)
  }

  // 2) Chef_equipe + memberships
  let createdUsers = 0
  let addedMemberships = 0
  let orphanCount = 0
  for (const c of CHEF_EQUIPE_SEEDS) {
    const userId = await ensureChefEquipe(supabase, c.email, c.fullName)
    if (c.assignTo) {
      const teamId = teamIdByName.get(c.assignTo)
      if (teamId) {
        const added = await ensureMembership(supabase, teamId, userId)
        if (added) addedMemberships++
      }
    } else {
      orphanCount++
    }
    createdUsers++
  }
  console.log(
    `  ↳ ${createdUsers} chef_equipe en place — ${addedMemberships} nouveaux memberships, ` +
      `${orphanCount} laissés sans équipe (orphelins visibles /equipes)`
  )

  // 3) Affectations de missions à Alpha et Beta.
  //    On vise quelques missions DÉMO existantes (CHU + Banque). Certaines
  //    missions restent volontairement sans équipe → "Non-affecté" sur la vue
  //    semaine.
  const alphaId = teamIdByName.get('Alpha')!
  const betaId = teamIdByName.get('Beta')!

  const alphaTargets = [
    'Bionettoyage quotidien sanitaires', // CHU — toutes occurrences (3 sites)
    'Vitres mensuelles',                  // Banque
  ]
  const betaTargets = [
    'Nettoyage couloirs',                 // CHU
    'Open-space passage soir',            // Banque (si existe)
  ]
  // Gamma : on laisse vide pour démontrer une équipe seedée mais inutilisée
  // (lignes vides côté grille Équipe — info-only, jamais alarme).

  let assignedAlpha = 0
  let assignedBeta = 0
  for (const name of alphaTargets) {
    if (await assignMissionToTeam(supabase, name, alphaId)) assignedAlpha++
  }
  for (const name of betaTargets) {
    if (await assignMissionToTeam(supabase, name, betaId)) assignedBeta++
  }
  console.log(
    `  ↳ Affectations missions : Alpha=${assignedAlpha}, Beta=${assignedBeta}, ` +
      `Gamma=0 (vide volontaire, démo "équipe sans charge")`
  )
}

/**
 * Seed des templates de récurrence sur les 3 contrats démo, puis génération
 * paresseuse 7 jours sur l'ensemble des templates ainsi créés/retrouvés.
 */
async function seedRecurrences(adminId: string, supabase: SupabaseAdmin) {
  console.log('🔁 Seeding récurrences (Phase 6) ...')
  const allTemplateIds: string[] = []

  const chuId = await findContractByName(supabase, CHU_CONTRACT_NAME)
  if (chuId) {
    const ids = await seedTemplatesForContract(
      supabase,
      chuId,
      'CHU',
      flattenRecurrenceSpec(chuRecurrenceSpec()),
      adminId
    )
    allTemplateIds.push(...ids)
  } else {
    console.log('  ↳ [CHU] contrat absent, skip')
  }

  const banqueId = await findContractByName(supabase, BANQUE_CONTRACT_NAME)
  if (banqueId) {
    const ids = await seedTemplatesForContract(
      supabase,
      banqueId,
      'Banque',
      flattenRecurrenceSpec(banqueRecurrenceSpec()),
      adminId
    )
    allTemplateIds.push(...ids)
  } else {
    console.log('  ↳ [Banque] contrat absent, skip')
  }

  const ecoleId = await findContractByName(supabase, ECOLE_CONTRACT_NAME)
  if (ecoleId) {
    const ids = await seedTemplatesForContract(
      supabase,
      ecoleId,
      'École',
      flattenRecurrenceSpec(ecoleRecurrenceSpec()),
      adminId
    )
    allTemplateIds.push(...ids)
  } else {
    console.log('  ↳ [École] contrat absent, skip')
  }

  if (allTemplateIds.length === 0) {
    console.log('  ↳ Aucun template à générer (contrats démo absents)')
    return
  }

  // Génération paresseuse 7 jours pour rendre la démo immédiatement vivante.
  // Idempotente via UNIQUE (template_id, scheduled_for, slot) — re-running le
  // seed ne dupliquera pas les interventions générées.
  const fromDate = TODAY_ISO
  const toDate = isoDate(daysFromNow(6)) // 7 jours inclus
  const result = await generateInterventionsFromTemplates({
    fromDate,
    toDate,
    templateIds: allTemplateIds,
  })
  console.log(
    `  ↳ Génération 7 jours : ${result.generated} interventions créées / ` +
      `${result.skipped} déjà présentes / ${result.templatesProcessed} templates`
  )
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------

async function main() {
  const supabase = createAdminClient()

  // Find admin user
  const { data: admin, error: adminErr } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'admin')
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  if (adminErr) throw adminErr
  if (!admin) {
    throw new Error(
      'No admin user found. Run db:push and db:bootstrap-admin first.'
    )
  }
  const adminId = admin.id as string
  console.log(`Using admin user id=${adminId}`)

  console.log('🏥 Seeding Contract 1 — CHU régional...')
  await seedContract1(adminId, supabase)

  console.log('🏢 Seeding Contract 2 — Banque Centrale...')
  await seedContract2(adminId, supabase)

  console.log('🏫 Seeding Contract 3 — École Jean Jaurès...')
  await seedContract3(adminId, supabase)

  console.log('🏥 Seeding Demo Tender — Hôpital Sainte-Marie (AO en cours)...')
  await seedDemoTenderSainteMarie(adminId, supabase)

  await seedRecurrences(adminId, supabase)

  // Phase 9 — équipes + affectations missions. Doit tourner APRÈS les
  // contrats et les récurrences pour pouvoir affecter les missions et leurs
  // interventions planifiées générées.
  await seedTeams(adminId, supabase)

  console.log('✅ Seed complete')
}

main().catch((e) => {
  console.error('[seed-demo] Fatal:', e)
  process.exit(1)
})
