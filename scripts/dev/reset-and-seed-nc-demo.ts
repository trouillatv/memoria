/**
 * scripts/dev/reset-and-seed-nc-demo.ts
 *
 * RESET + SEED de la base MemorIA pour démo Nouvelle-Calédonie.
 * Crée 4 contrats, 6 sites, 3 équipes, ~80 interventions sur 4 semaines avec
 * photos/anomalies/validations, et 3 proof_share_tokens prêts pour démo.
 *
 *   ⚠️ DESTRUCTIF : efface toutes les données métier (sauf utilisateurs admin).
 *   ⚠️ DEV/STAGING UNIQUEMENT : refuse de tourner sans confirmation explicite.
 *
 * USAGE
 *
 *   1. Dry-run (montre ce qui SERAIT effacé, ne touche rien) :
 *      npm run db:reset-and-seed-nc-demo -- --confirm-reset-on=<sub-of-url>
 *
 *   2. Exécution réelle :
 *      npm run db:reset-and-seed-nc-demo -- --confirm-reset-on=<sub-of-url> --yes
 *
 *   Où <sub-of-url> = une sous-chaîne au moins de NEXT_PUBLIC_SUPABASE_URL.
 *   Par ex. si URL = https://abc123.supabase.co, passer --confirm-reset-on=abc123.
 *   C'est un anti-rampe-de-lancement : on ne supprime pas par mégarde une cible prod.
 *
 * Voir docs/dev/nc-demo-seed.md pour le scénario de démo et les comptes test.
 */

import * as fs from 'fs'

// Node 20 lacks native WebSocket — Supabase realtime client requires it.
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
  createValidation,
  createAnomaly,
} from '@/lib/db/interventions'
import { createTeam } from '@/lib/db/teams'
import { createShareToken } from '@/lib/db/proof-share'
import type {
  ChecklistTemplateItem,
  PhotoKind,
  InterventionStatus,
} from '@/types/db'

import {
  TEST_ACCOUNTS,
  TEST_PASSWORD,
  TEAMS,
  SITES,
  CONTRACTS,
  MISSIONS,
  ANOMALY_TEMPLATES,
  PHOTO_LABELS,
} from './nc-data'

// ============================================================================
// .env.local loader (même pattern que seed-demo.ts)
// ============================================================================

function loadEnvLocal() {
  const path = '.env.local'
  if (!fs.existsSync(path)) return
  const raw = fs.readFileSync(path, 'utf8')
  for (const rawLine of raw.split('\n')) {
    // Windows CRLF safe : on retire le \r de fin
    const line = rawLine.replace(/\r$/, '')
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
loadEnvLocal()

// ============================================================================
// CLI args
// ============================================================================

interface CliArgs {
  confirmResetOn: string | null
  yes: boolean
}

function parseArgs(argv: string[]): CliArgs {
  let confirmResetOn: string | null = null
  let yes = false
  for (const arg of argv) {
    if (arg.startsWith('--confirm-reset-on=')) {
      confirmResetOn = arg.slice('--confirm-reset-on='.length).trim()
    } else if (arg === '--yes' || arg === '-y') {
      yes = true
    }
  }
  return { confirmResetOn, yes }
}

// ============================================================================
// SAFETY GUARDS — refus si moindre doute
// ============================================================================

function assertSafeEnvironment(args: CliArgs): void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const nodeEnv = process.env.NODE_ENV ?? 'development'

  console.log('[safety] NODE_ENV =', nodeEnv)
  console.log('[safety] SUPABASE_URL =', url || '(absent)')

  if (nodeEnv === 'production') {
    fail('NODE_ENV=production. Ce script refuse de tourner en production.')
  }

  if (!url) {
    fail('NEXT_PUBLIC_SUPABASE_URL absent. Vérifie .env.local.')
  }

  if (!args.confirmResetOn) {
    fail(
      'Argument requis : --confirm-reset-on=<sub-chaine-de-ton-url>. ' +
      'C\'est une protection volontaire — tu dois recopier une sous-chaîne de ton URL Supabase pour confirmer l\'intention.',
    )
  }

  if (!url.includes(args.confirmResetOn)) {
    fail(
      `La sous-chaîne "${args.confirmResetOn}" n'apparaît pas dans NEXT_PUBLIC_SUPABASE_URL. ` +
      'Tu vises peut-être un mauvais projet — vérifie deux fois et recommence.',
    )
  }

  // Heuristique anti-prod : refus si l'URL contient des marqueurs typiques prod
  const prodMarkers = ['prod', 'production', 'live']
  for (const m of prodMarkers) {
    if (url.toLowerCase().includes(m)) {
      fail(
        `L'URL Supabase contient "${m}" — abandon par précaution. ` +
        'Si c\'est un faux positif, renomme ou utilise un projet dev dédié.',
      )
    }
  }

  console.log('[safety] OK — toutes les vérifications passent.')
  if (!args.yes) {
    console.log('[safety] DRY-RUN (--yes absent) — aucune modification ne sera appliquée.')
  } else {
    console.log('[safety] ⚠️  MODE DESTRUCTIF ACTIF (--yes présent)')
  }
}

function fail(msg: string): never {
  console.error('[safety] REFUS:', msg)
  process.exit(1)
}

// ============================================================================
// Reset : DELETE en ordre de dépendance
// ============================================================================

// Ordre crucial : enfants → parents. On ne touche PAS aux users / users auth.
// On ne touche PAS aux logs (activity_logs, ai_usage) qui sont audit.
const RESET_TABLES: Array<{ name: string; label: string }> = [
  { name: 'proof_share_tokens', label: 'tokens de partage de preuve' },
  { name: 'intervention_photos', label: 'photos d\'intervention' },
  { name: 'intervention_validations', label: 'validations' },
  { name: 'intervention_anomalies', label: 'anomalies' },
  { name: 'intervention_checklist_items', label: 'items checklist intervention' },
  { name: 'interventions', label: 'interventions' },
  { name: 'intervention_templates', label: 'templates récurrence' },
  { name: 'mission_photos', label: 'photos mission (héritage)' },
  { name: 'mission_checklist_items', label: 'checklist mission (héritage)' },
  { name: 'missions', label: 'missions' },
  { name: 'engagements', label: 'engagements' },
  { name: 'sites', label: 'sites' },
  { name: 'contracts', label: 'contrats' },
  { name: 'tender_agent_analyses', label: 'analyses agents IA' },
  { name: 'tender_chat_attachments', label: 'pièces jointes atelier IA' },
  { name: 'tender_chat_messages', label: 'messages atelier IA' },
  { name: 'tender_analyses', label: 'analyses AO' },
  { name: 'tender_documents', label: 'documents AO' },
  { name: 'tenders', label: 'appels d\'offres' },
  { name: 'team_members', label: 'membres équipes' },
  { name: 'teams', label: 'équipes' },
  { name: 'incidents', label: 'incidents (héritage)' },
  { name: 'reports', label: 'reports (héritage)' },
  { name: 'knowledge_items', label: 'bibliothèque AGP' },
  { name: 'clients', label: 'clients' },
]

async function resetTables(dryRun: boolean): Promise<void> {
  console.log('\n[reset] Tables à vider :')
  const supabase = createAdminClient()

  for (const { name, label } of RESET_TABLES) {
    if (dryRun) {
      // Count uniquement
      const { count } = await supabase.from(name).select('*', { count: 'exact', head: true })
      console.log(`  - ${name} (${label}) : ${count ?? '?'} rows`)
    } else {
      // Delete all rows
      const { error } = await supabase
        .from(name)
        .delete()
        .gte('created_at', '1900-01-01') // filtre toujours vrai
      if (error) {
        // Certaines tables peuvent ne pas avoir created_at — fallback sur id
        const { error: err2 } = await supabase
          .from(name)
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000')
        if (err2) {
          console.error(`  ✗ ${name}: ${err2.message}`)
          continue
        }
      }
      console.log(`  ✓ ${name} vidée`)
    }
  }

  // Storage : nettoyer le bucket intervention-photos
  if (!dryRun) {
    console.log('[reset] Storage bucket intervention-photos…')
    const { data: files } = await supabase.storage.from('intervention-photos').list('', { limit: 1000 })
    if (files && files.length > 0) {
      // Liste à plat puis remove en batch — on garde simple, on supprime les dossiers
      const folderNames = files.map((f) => f.name)
      // Remove récursif via prefix
      for (const folder of folderNames) {
        const { data: subFiles } = await supabase.storage
          .from('intervention-photos')
          .list(folder, { limit: 1000 })
        if (subFiles && subFiles.length > 0) {
          const paths = subFiles.map((f) => `${folder}/${f.name}`)
          await supabase.storage.from('intervention-photos').remove(paths)
        }
      }
      console.log(`  ✓ ${folderNames.length} dossier(s) Storage nettoyés`)
    } else {
      console.log('  ✓ Bucket déjà vide')
    }
  }
}

// ============================================================================
// Helpers seed
// ============================================================================

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

function atHourUtc(date: Date, hour: number, minute = 0): Date {
  const d = new Date(date)
  d.setUTCHours(hour, minute, 0, 0)
  return d
}

function pickOne<T>(arr: T[], idx: number): T {
  return arr[idx % arr.length]
}

// SVG photo placeholder — couleurs Tailwind
const PHOTO_COLORS: Record<PhotoKind, string> = {
  before: '#f59e0b',
  after: '#10b981',
  proof: '#0ea5e9',
  anomaly: '#dc2626',
  passage: '#64748b', // V5.1 — slate-500, sobre
  access: '#64748b', // 070 — slate-500, sobre
}

function svgPhoto(text: string, bgColor: string): Buffer {
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <rect width="800" height="600" fill="${bgColor}"/>
  <rect x="20" y="20" width="760" height="560" fill="rgba(255,255,255,0.08)" rx="8"/>
  <text x="400" y="280" font-family="system-ui, -apple-system, sans-serif" font-size="42" font-weight="600" text-anchor="middle" fill="white">${safe}</text>
  <text x="400" y="340" font-family="system-ui, sans-serif" font-size="20" text-anchor="middle" fill="rgba(255,255,255,0.7)">[NC seed]</text>
</svg>`
  return Buffer.from(svg, 'utf-8')
}

async function uploadSeedPhoto(
  supabase: SupabaseAdmin,
  interventionId: string,
  label: string,
  kind: PhotoKind,
): Promise<string> {
  const buffer = svgPhoto(label, PHOTO_COLORS[kind])
  const ts = Date.now() + Math.floor(Math.random() * 100000)
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

// ============================================================================
// USERS / TEAMS
// ============================================================================

async function ensureTestUsers(
  supabase: SupabaseAdmin,
): Promise<Map<string, { id: string; fullName: string }>> {
  const result = new Map<string, { id: string; fullName: string }>()
  const { data: existing } = await supabase.auth.admin.listUsers()
  const byEmail = new Map(existing?.users?.map((u) => [u.email, u]) ?? [])

  for (const acc of TEST_ACCOUNTS) {
    let userId: string
    const found = byEmail.get(acc.email)

    if (found) {
      console.log(`  ↳ Utilisateur ${acc.email} existe déjà (id=${found.id}), réutilisé`)
      userId = found.id
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email: acc.email,
        password: TEST_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: acc.fullName, role: acc.role },
      })
      if (error) throw error
      if (!data.user) throw new Error(`Pas de user retourné pour ${acc.email}`)
      userId = data.user.id
      console.log(`  ✓ Créé ${acc.email} (id=${userId})`)
    }

    // Forcer le rôle + nom dans public.users (le trigger met chef_equipe par défaut)
    const { error: updateError } = await supabase
      .from('users')
      .update({ role: acc.role, full_name: acc.fullName, must_change_password: false })
      .eq('id', userId)
    if (updateError) throw updateError

    result.set(acc.email, { id: userId, fullName: acc.fullName })
  }
  return result
}

async function seedTeams(
  supabase: SupabaseAdmin,
  users: Map<string, { id: string; fullName: string }>,
  adminId: string,
): Promise<Map<string, string>> {
  const teamSlugToId = new Map<string, string>()
  const fullNameToUserId = new Map<string, string>()
  for (const [, u] of users) fullNameToUserId.set(u.fullName, u.id)

  for (const team of TEAMS) {
    const created = await createTeam({
      name: team.name,
      color: team.color,
      created_by: adminId,
    })
    teamSlugToId.set(team.slug, created.id)
    console.log(`  ✓ Équipe créée : ${team.name} (id=${created.id})`)

    // Ajouter membres (matching par fullName ; on insère uniquement les users existants)
    for (const memberName of team.members) {
      const memberId = fullNameToUserId.get(memberName)
      if (!memberId) {
        // Le membre n'est pas dans les comptes test : on l'ignore (on ne crée pas
        // d'auth users supplémentaires pour des noms purement décoratifs)
        continue
      }
      const { error } = await supabase.from('team_members').insert({
        team_id: created.id,
        user_id: memberId,
        joined_at: new Date().toISOString(),
      })
      if (error) {
        // FK ou unique violations possibles — on log
        console.log(`    ↳ team_members ${team.name} ← ${memberName} : ${error.message}`)
      }
    }
  }
  return teamSlugToId
}

// ============================================================================
// CLIENTS / TENDERS / CONTRACTS / SITES / MISSIONS / TEMPLATES
// ============================================================================

async function ensureClient(supabase: SupabaseAdmin, name: string): Promise<string> {
  const { data: existing } = await supabase
    .from('clients')
    .select('id')
    .eq('name', name)
    .is('deleted_at', null)
    .maybeSingle()
  if (existing) return existing.id
  const { data, error } = await supabase.from('clients').insert({ name }).select('id').single()
  if (error) throw error
  return data.id
}

async function seedTendersAndContracts(
  supabase: SupabaseAdmin,
  adminId: string,
): Promise<Map<string, { contractId: string; tenderId: string }>> {
  const result = new Map<string, { contractId: string; tenderId: string }>()

  for (const c of CONTRACTS) {
    console.log(`\n[contract] ${c.contractName}`)

    // 1) Tender
    const { data: tender, error: tErr } = await supabase
      .from('tenders')
      .insert({
        title: c.tenderTitle,
        client_name: c.clientName,
        status: 'ready',
        created_by: adminId,
      })
      .select('id')
      .single()
    if (tErr) throw tErr
    const tenderId = tender.id as string

    // 2) Document (extracted text)
    await supabase.from('tender_documents').insert({
      tender_id: tenderId,
      storage_path: `seed/${tenderId}/source.pdf`,
      filename: `${c.tenderTitle}.pdf`,
      extracted_text: c.tenderExtractedText,
      page_count: Math.max(1, Math.ceil(c.tenderExtractedText.length / 3000)),
    })

    // 3) Analysis (mémoire technique + résumé)
    await supabase.from('tender_analyses').insert({
      tender_id: tenderId,
      summary: c.summary,
      technical_memo: c.technicalMemo,
      constraints: [],
      risks: [],
      checklist: [],
      provider: 'mock',
      raw_response: { seed: 'nc-demo' },
    })

    // 4) Engagements
    const engagements = await bulkInsertEngagements({
      tender_id: tenderId,
      created_by: adminId,
      engagements: c.engagements,
    })
    console.log(`  ↳ ${engagements.length} engagements extraits`)

    // 5) Contract (start_date 90 jours dans le passé, fin 1 an+)
    const contractId = await createContract({
      tender_id: tenderId,
      name: c.contractName,
      client_name: c.clientName,
      start_date: isoDate(daysAgo(90)),
      end_date: isoDate(daysFromNow(365)),
      created_by: adminId,
    })
    console.log(`  ↳ Contrat créé`)

    // 6) Activer les engagements sur ce contrat
    const activated = await activateEngagementsForContract(tenderId, contractId)
    console.log(`  ↳ ${activated} engagements activés sur le contrat`)

    result.set(c.key, { contractId, tenderId })
  }
  return result
}

async function seedSites(
  supabase: SupabaseAdmin,
  contractMap: Map<string, { contractId: string; tenderId: string }>,
): Promise<Map<string, string>> {
  const result = new Map<string, string>() // siteName → siteId

  for (const s of SITES) {
    const contract = contractMap.get(s.contractKey)
    if (!contract) {
      console.log(`  ⚠ Site ${s.name} : contrat ${s.contractKey} introuvable, skip`)
      continue
    }
    const clientId = await ensureClient(supabase, CONTRACTS.find((c) => c.key === s.contractKey)!.clientName)

    const siteId = await createSite({
      client_id: clientId,
      contract_id: contract.contractId,
      name: s.name,
      address: s.address,
      notes: `Contact : ${s.contactName} · Tél. ${s.contactPhone}`,
    })
    result.set(s.name, siteId)
    console.log(`  ✓ Site ${s.name}`)
  }
  return result
}

async function seedMissions(
  supabase: SupabaseAdmin,
  siteMap: Map<string, string>,
  teamMap: Map<string, string>,
  adminId: string,
): Promise<Map<string, { missionId: string; checklist: ChecklistTemplateItem[]; teamId: string | null }>> {
  const result = new Map<string, { missionId: string; checklist: ChecklistTemplateItem[]; teamId: string | null }>()

  for (const m of MISSIONS) {
    const siteId = siteMap.get(m.siteName)
    if (!siteId) {
      console.log(`  ⚠ Mission ${m.missionName} : site ${m.siteName} introuvable, skip`)
      continue
    }
    const siteSeed = SITES.find((s) => s.name === m.siteName)!

    // Assigne une équipe par défaut selon la commune
    let teamSlug: 'noumea-centre' | 'grand-noumea' | 'nord-vkp' = 'noumea-centre'
    if (siteSeed.city === 'Koné' || siteSeed.city === 'Pouembout') teamSlug = 'nord-vkp'
    else if (
      siteSeed.city === 'Dumbéa' ||
      siteSeed.city === 'Mont-Dore' ||
      siteSeed.city === 'Païta'
    ) {
      teamSlug = 'grand-noumea'
    }
    const teamId = teamMap.get(teamSlug) ?? null

    const checklist: ChecklistTemplateItem[] = m.checklistItems.map((c, idx) => ({
      label: c.label,
      required: c.required,
      position: idx,
    }))

    const missionId = await createMission({
      site_id: siteId,
      name: m.missionName,
      description: m.description ?? null,
      cadence: m.cadence,
      engagement_ids: [],
      default_checklist: checklist,
      created_by: adminId,
    })

    // assigned_team_id n'est pas exposé par createMission — update direct.
    if (teamId) {
      const { error: teamErr } = await supabase
        .from('missions')
        .update({ assigned_team_id: teamId })
        .eq('id', missionId)
      if (teamErr) console.log(`    ↳ assigned_team_id : ${teamErr.message}`)
    }

    result.set(`${m.siteName}::${m.missionName}`, { missionId, checklist, teamId })
    console.log(`  ✓ Mission "${m.missionName}" @ ${m.siteName} → ${teamSlug}`)
  }
  return result
}

// ============================================================================
// INTERVENTIONS — 4 semaines d'historique
// ============================================================================

interface InterventionStat {
  total: number
  completed: number
  validated: number
  skipped: number
  withPhotos: number
  withAnomaly: number
}

async function seedInterventions(
  supabase: SupabaseAdmin,
  missions: Map<string, { missionId: string; checklist: ChecklistTemplateItem[]; teamId: string | null }>,
  adminId: string,
): Promise<InterventionStat> {
  const stat: InterventionStat = {
    total: 0,
    completed: 0,
    validated: 0,
    skipped: 0,
    withPhotos: 0,
    withAnomaly: 0,
  }

  // Pour chaque mission, on crée des interventions sur 4 semaines.
  // Daily : 3-4 jours/semaine (échantillon, pas chaque jour pour éviter 200+ interventions)
  // Weekly : 1/semaine
  // Le passé est complété/validé, demain+ planifié.

  let missionIdx = 0
  for (const [key, m] of missions) {
    const missionSeedKey = key.split('::')[1]
    const missionSeed = MISSIONS.find((x) => x.missionName === missionSeedKey)
    if (!missionSeed) continue

    // Sample jours selon la cadence
    const sampleDaysAgo: number[] = []
    if (missionSeed.cadence === 'daily') {
      // 4 semaines, 3 interventions/semaine (lundi/mercredi/vendredi)
      for (let week = 0; week < 4; week++) {
        sampleDaysAgo.push(week * 7 + 1, week * 7 + 3, week * 7 + 5)
      }
      // + 2 interventions futures (planifiées)
      sampleDaysAgo.push(-1, -3)
    } else if (missionSeed.cadence === 'weekly') {
      for (let week = 0; week < 4; week++) {
        sampleDaysAgo.push(week * 7 + 1)
      }
      sampleDaysAgo.push(-2)
    }

    for (let i = 0; i < sampleDaysAgo.length; i++) {
      const offset = sampleDaysAgo[i]
      const baseDate = offset >= 0 ? daysAgo(offset) : daysFromNow(-offset)
      // Choisir un slot dans ceux configurés
      const slot = pickOne(missionSeed.slots, i)
      const hour = slot === 'morning' ? 7 : slot === 'afternoon' ? 13 : 18
      const scheduledAt = atHourUtc(baseDate, hour)

      // Détermine le statut
      let status: InterventionStatus
      let hasAnomaly = false
      let executedAt: Date | null = null
      let durationMin: number | null = null

      if (offset < 0) {
        // futur : planned
        status = 'planned'
      } else if (offset > 1) {
        // passé > 1 jour : completed ou validated (90% completed, 10% skipped)
        const rand = (missionIdx + i) % 10
        if (rand === 0) {
          status = 'skipped'
        } else if (rand <= 4) {
          status = 'validated'
        } else {
          status = 'completed'
        }
        executedAt = atHourUtc(baseDate, hour, 15)
        durationMin = 45 + ((missionIdx + i) % 30) // 45-75 min
        hasAnomaly = (missionIdx * 7 + i) % 13 === 0 // ~1/13 interventions ont une anomalie
      } else {
        // aujourd'hui / hier : in_progress ou completed
        status = (missionIdx + i) % 3 === 0 ? 'in_progress' : 'completed'
        executedAt = (missionIdx + i) % 3 === 0 ? null : atHourUtc(baseDate, hour, 15)
        durationMin = status === 'completed' ? 50 : null
      }

      // Crée intervention (helper minimal — on update les champs custom juste après)
      const interventionId = await createIntervention({
        mission_id: m.missionId,
        scheduled_at: scheduledAt.toISOString(),
        team: [],
        created_by: adminId,
      })
      stat.total++

      // Update champs custom (status, executed_at, scheduled_for, slot, assigned_team_id).
      // scheduled_for = date pure UTC, lue par la Vue Semaine (Phase 9). Sans elle,
      // /semaine reste vide même si scheduled_at est correct (migration 021).
      // duration_minutes et team_size sont calculés à la volée par lib/db/proofs
      // (executed_at − scheduled_at et team.length), donc pas persistés ici.
      const updates: Record<string, unknown> = {
        status,
        scheduled_for: isoDate(baseDate),
        slot,
        assigned_team_id: m.teamId,
      }
      if (executedAt) updates.executed_at = executedAt.toISOString()

      if (status === 'skipped') {
        const reasons = [
          'Site fermé exceptionnellement (jour férié local)',
          'Réunion imprévue dans la zone à nettoyer',
          'Accès interdit suite à incident sanitaire (en attente protocole)',
        ]
        updates.skipped_at = scheduledAt.toISOString()
        updates.skipped_reason = pickOne(reasons, missionIdx + i)
        stat.skipped++
      }

      const { error: updErr } = await supabase
        .from('interventions')
        .update(updates)
        .eq('id', interventionId)
      if (updErr) {
        console.log(`    ⚠ intervention update : ${updErr.message}`)
      }

      // Insert checklist items
      const insertedChecklist = await bulkInsertChecklistItems(
        m.checklist.map((c, idx) => ({
          intervention_id: interventionId,
          label: c.label,
          required: c.required ?? true,
          position: idx,
          engagement_id: null,
        })),
      )

      // Si completed ou validated, cocher les items + ajouter photos + sometimes anomaly
      if (status === 'completed' || status === 'validated') {
        // Cocher 100% des items required, 80% des optional
        for (const item of insertedChecklist) {
          const shouldCheck =
            item.required ||
            (missionIdx + i + item.position) % 5 !== 0
          if (shouldCheck) {
            await markChecklistItemDone(item.id, adminId)
          }
        }

        // Photos : 3 (1 before, 1 after, 1 proof)
        await insertPhoto({
          intervention_id: interventionId,
          checklist_item_id: null,
          storage_path: await uploadSeedPhoto(
            supabase,
            interventionId,
            pickOne(PHOTO_LABELS.before, missionIdx + i),
            'before',
          ),
          kind: 'before',
          caption: null,
          taken_by: adminId,
        })
        await insertPhoto({
          intervention_id: interventionId,
          checklist_item_id: null,
          storage_path: await uploadSeedPhoto(
            supabase,
            interventionId,
            pickOne(PHOTO_LABELS.after, missionIdx + i),
            'after',
          ),
          kind: 'after',
          caption: null,
          taken_by: adminId,
        })
        await insertPhoto({
          intervention_id: interventionId,
          checklist_item_id: null,
          storage_path: await uploadSeedPhoto(
            supabase,
            interventionId,
            pickOne(PHOTO_LABELS.proof, missionIdx + i),
            'proof',
          ),
          kind: 'proof',
          caption: null,
          taken_by: adminId,
        })
        stat.withPhotos++

        // Validation : sur les interventions validated
        if (status === 'validated') {
          await createValidation({
            intervention_id: interventionId,
            validated_by: adminId,
            comment: 'Conformité visuelle vérifiée par chef d\'équipe',
          })
          stat.validated++
        } else {
          stat.completed++
        }

        // Anomalie
        if (hasAnomaly) {
          const anomalyTpl = pickOne(ANOMALY_TEMPLATES, missionIdx + i)
          // Photo anomalie d'abord (la table anomalies ne stocke pas le path,
          // on l'attache à l'intervention via intervention_photos kind='anomaly')
          await insertPhoto({
            intervention_id: interventionId,
            checklist_item_id: null,
            storage_path: await uploadSeedPhoto(
              supabase,
              interventionId,
              pickOne(PHOTO_LABELS.anomaly, missionIdx + i),
              'anomaly',
            ),
            kind: 'anomaly',
            caption: anomalyTpl.description,
            taken_by: adminId,
          })
          await createAnomaly({
            intervention_id: interventionId,
            category: anomalyTpl.category,
            description: anomalyTpl.description,
            reported_by: adminId,
          })
          stat.withAnomaly++
        }
      }
    }
    missionIdx++
  }
  return stat
}

// ============================================================================
// PROOF SHARE TOKENS — 3 scénarios démo
// ============================================================================

async function seedProofTokens(
  supabase: SupabaseAdmin,
  adminId: string,
): Promise<{ count: number; samples: Array<{ label: string; url: string }> }> {
  // Trouve 3 interventions completed avec photos pour les 3 cas démo
  const { data: candidates } = await supabase
    .from('interventions')
    .select('id, mission_id, executed_at')
    .in('status', ['completed', 'validated'])
    .not('executed_at', 'is', null)
    .order('executed_at', { ascending: false })
    .limit(10)

  if (!candidates || candidates.length < 3) {
    console.log('  ⚠ Pas assez d\'interventions terminées pour générer 3 proof tokens')
    return { count: 0, samples: [] }
  }

  const scenarios = [
    {
      label: 'Réclamation client — sanitaires mardi matin',
      durationDays: 14,
    },
    {
      label: 'Reporting mensuel — vue qualité 30 jours',
      durationDays: 30,
    },
    {
      label: 'Renouvellement contrat — historique 4 semaines',
      durationDays: 30,
    },
  ]

  const samples: Array<{ label: string; url: string }> = []
  for (let i = 0; i < 3; i++) {
    const intervention = candidates[i]
    const scenario = scenarios[i]
    const token = await createShareToken({
      interventionId: intervention.id,
      durationDays: scenario.durationDays,
      includeIdentities: false,
      createdBy: adminId,
    })
    samples.push({
      label: scenario.label,
      url: `/p/${token.token}`,
    })
    console.log(`  ✓ Token créé : ${scenario.label}`)
  }
  return { count: samples.length, samples }
}

// ============================================================================
// MAIN
// ============================================================================

async function confirmInteractive(args: CliArgs): Promise<boolean> {
  if (args.yes) return true
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  console.log('\n[confirm] Mode dry-run actif (--yes absent).')
  console.log('[confirm] Pour appliquer pour de vrai :')
  console.log(`           npm run db:reset-and-seed-nc-demo -- --confirm-reset-on=${args.confirmResetOn} --yes`)
  console.log(`[confirm] URL ciblée : ${url}`)
  return false
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  assertSafeEnvironment(args)

  const willApply = await confirmInteractive(args)
  const dryRun = !willApply

  const supabase = createAdminClient()

  // 1) Reset
  console.log('\n========== RESET ==========')
  await resetTables(dryRun)
  if (dryRun) {
    console.log('\n[dry-run] Fin du dry-run. Ajoute --yes pour appliquer.')
    return
  }

  // 2) Users + teams
  console.log('\n========== UTILISATEURS ==========')
  const users = await ensureTestUsers(supabase)
  const adminEmail = TEST_ACCOUNTS.find((a) => a.role === 'admin')!.email
  const admin = users.get(adminEmail)!
  console.log(`[admin] ${adminEmail} → id=${admin.id}`)

  console.log('\n========== ÉQUIPES ==========')
  const teamMap = await seedTeams(supabase, users, admin.id)

  // 3) Tenders + contracts
  console.log('\n========== APPELS D\'OFFRES & CONTRATS ==========')
  const contractMap = await seedTendersAndContracts(supabase, admin.id)

  // 4) Sites
  console.log('\n========== SITES ==========')
  const siteMap = await seedSites(supabase, contractMap)

  // 5) Missions
  console.log('\n========== MISSIONS ==========')
  const missionMap = await seedMissions(supabase, siteMap, teamMap, admin.id)

  // 6) Interventions sur 4 semaines
  console.log('\n========== INTERVENTIONS (4 semaines) ==========')
  const intervStat = await seedInterventions(supabase, missionMap, admin.id)

  // 7) Proof share tokens
  console.log('\n========== TOKENS DE PARTAGE ==========')
  const tokensInfo = await seedProofTokens(supabase, admin.id)

  // 8) Summary
  console.log('\n========== RÉSUMÉ FINAL ==========')
  console.log(`Tenders            : ${CONTRACTS.length}`)
  console.log(`Contracts          : ${contractMap.size}`)
  console.log(`Engagements        : ${CONTRACTS.reduce((s, c) => s + c.engagements.length, 0)}`)
  console.log(`Sites              : ${siteMap.size}`)
  console.log(`Missions           : ${missionMap.size}`)
  console.log(`Interventions      : ${intervStat.total}`)
  console.log(`   ↳ completed     : ${intervStat.completed}`)
  console.log(`   ↳ validated     : ${intervStat.validated}`)
  console.log(`   ↳ skipped       : ${intervStat.skipped}`)
  console.log(`   ↳ with photos   : ${intervStat.withPhotos}`)
  console.log(`   ↳ with anomaly  : ${intervStat.withAnomaly}`)
  console.log(`Teams              : ${teamMap.size}`)
  console.log(`Test users         : ${users.size}`)
  console.log(`Proof tokens       : ${tokensInfo.count}`)
  console.log('')
  console.log('Comptes de test (mot de passe commun : ' + TEST_PASSWORD + ')')
  for (const acc of TEST_ACCOUNTS) {
    console.log(`  · ${acc.email.padEnd(36)} → ${acc.role} (${acc.fullName})`)
  }
  console.log('')
  console.log('Liens de partage de preuve générés :')
  for (const s of tokensInfo.samples) {
    console.log(`  · ${s.label}`)
    console.log(`    http://localhost:3000${s.url}`)
  }
  console.log('\n[done] Seed NC démo terminé.')
}

main().catch((e) => {
  console.error('[reset-and-seed-nc-demo] failed:', e)
  if (e?.stack) console.error(e.stack)
  process.exit(1)
})
