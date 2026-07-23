/**
 * scripts/dev/seed-batisud-demo.ts
 *
 * Seed additionnel, non destructif, pour une démo BTP gros œuvre.
 *
 * Garde-fous :
 * - aucun reset ;
 * - aucune suppression ;
 * - aucune migration / RLS ;
 * - aucun accès au compte Guillaume / MVO ;
 * - idempotence par noms BatiSud + titres d'interventions dans les notes.
 *
 * Usage : npm run db:seed-batisud-demo
 */
import * as fs from 'fs'
import { createHash } from 'node:crypto'

const ws = require('ws')
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
  ;(globalThis as { WebSocket: unknown }).WebSocket = ws
}

import { createAdminClient } from '@/lib/supabase/admin'
import { createContract } from '@/lib/db/contracts'
import { createSite } from '@/lib/db/sites'
import { createMission } from '@/lib/db/missions'
import {
  bulkInsertChecklistItems,
  createAnomaly,
  createIntervention,
  createValidation,
  insertPhoto,
  markChecklistItemDone,
} from '@/lib/db/interventions'
import {
  buildTeamTakesSitePayload,
  createHandoverBrief,
  shareHandoverBrief,
} from '@/lib/db/handover'
import { generateQrToken } from '@/lib/db/site-qr'
import type { ChecklistTemplateItem, DbHandoverBrief, InterventionStatus } from '@/types/db'
import {
  BATISUD_ADRIEN_EMAIL,
  BATISUD_CHEF_EMAIL,
  BATISUD_CLIENT_NAME,
  BATISUD_CONTRACT_NAME,
  BATISUD_DEMO_PASSWORD,
  BATISUD_DOCUMENTS,
  BATISUD_MISSIONS,
  BATISUD_SITE_NOTES,
  BATISUD_SITES,
  BATISUD_TEAM_MEMBERS,
  BATISUD_TEAMS,
  buildBatiSudInterventionSeeds,
  buildBatiSudSiteReturnNote,
  toIsoDate,
  type BatiSudTeamMemberSeed,
  type BatiSudInterventionCompany,
} from './batisud-demo-data'

type SupabaseAdmin = ReturnType<typeof createAdminClient>

interface SeedSummary {
  clientId: string
  contractId: string
  sitesCreated: number
  teamsCreated: number
  membersCreated: number
  membershipsCreated: number
  missionsCreated: number
  interventionsCreated: number
  interventionsUpdated: number
  anomaliesCreated: number
  photosCreated: number
  notesCreated: number
  documentsCreated: number
  handoversCreated: number
  companiesCreated: number
  qrTokensEnsured: number
  sharedToken: string | null
}

function loadEnvLocal() {
  const path = '.env.local'
  if (!fs.existsSync(path)) return
  const raw = fs.readFileSync(path, 'utf8')
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
loadEnvLocal()

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function svgPhoto(text: string, subtitle: string, bgColor: string): Buffer {
  const safeText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const safeSubtitle = subtitle.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700" viewBox="0 0 1000 700">
  <rect width="1000" height="700" fill="${bgColor}"/>
  <rect x="55" y="55" width="890" height="590" fill="rgba(255,255,255,0.10)" rx="10"/>
  <path d="M120 540h760" stroke="rgba(255,255,255,0.55)" stroke-width="18" stroke-linecap="round"/>
  <path d="M240 520l90-210h260l130 210" fill="none" stroke="rgba(255,255,255,0.65)" stroke-width="18" stroke-linejoin="round"/>
  <path d="M270 310h270M300 380h315M330 450h360" stroke="rgba(255,255,255,0.42)" stroke-width="12"/>
  <circle cx="760" cy="210" r="62" fill="rgba(255,255,255,0.16)"/>
  <text x="500" y="165" font-family="Arial, sans-serif" font-size="42" font-weight="700" text-anchor="middle" fill="white">${safeText}</text>
  <text x="500" y="220" font-family="Arial, sans-serif" font-size="22" text-anchor="middle" fill="rgba(255,255,255,0.82)">${safeSubtitle}</text>
  <text x="500" y="610" font-family="Arial, sans-serif" font-size="18" text-anchor="middle" fill="rgba(255,255,255,0.70)">BatiSud Construction · photo démo chantier</text>
</svg>`
  return Buffer.from(svg, 'utf-8')
}

const PHOTO_COLORS = {
  before: '#475569',
  after: '#15803d',
  proof: '#0369a1',
  anomaly: '#b91c1c',
  passage: '#7c3aed',
  access: '#ca8a04',
} as const

async function uploadSeedPhoto(
  supabase: SupabaseAdmin,
  interventionId: string,
  label: string,
  kind: keyof typeof PHOTO_COLORS,
): Promise<string> {
  const storagePath = `${interventionId}/batisud-${kind}-${slugify(label)}.svg`
  const buffer = svgPhoto(label, kind === 'anomaly' ? 'Incident / réserve' : 'Preuve terrain', PHOTO_COLORS[kind])
  const { error } = await supabase.storage
    .from('intervention-photos')
    .upload(storagePath, buffer, { contentType: 'image/svg+xml', upsert: true })
  if (error) throw error
  return storagePath
}

async function ensureClient(supabase: SupabaseAdmin): Promise<string> {
  const { data: existing, error: fetchErr } = await supabase
    .from('clients')
    .select('id')
    .eq('name', BATISUD_CLIENT_NAME)
    .is('deleted_at', null)
    .maybeSingle()
  if (fetchErr) throw fetchErr
  if (existing) return existing.id as string

  const { data, error } = await supabase
    .from('clients')
    .insert({ name: BATISUD_CLIENT_NAME })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

async function ensureContract(
  supabase: SupabaseAdmin,
  adminId: string,
): Promise<{ id: string; created: boolean }> {
  const { data: existing, error: fetchErr } = await supabase
    .from('contracts')
    .select('id, client_name')
    .eq('name', BATISUD_CONTRACT_NAME)
    .is('deleted_at', null)
    .maybeSingle()
  if (fetchErr) throw fetchErr
  if (existing) {
    if (existing.client_name !== BATISUD_CLIENT_NAME) {
      const { error } = await supabase
        .from('contracts')
        .update({ client_name: BATISUD_CLIENT_NAME })
        .eq('id', existing.id)
      if (error) throw error
    }
    return { id: existing.id as string, created: false }
  }

  const id = await createContract({
    tender_id: null,
    name: BATISUD_CONTRACT_NAME,
    client_name: BATISUD_CLIENT_NAME,
    start_date: toIsoDate(new Date(), -21),
    end_date: toIsoDate(new Date(), 365),
    created_by: adminId,
  })
  return { id, created: true }
}

async function ensureSite(
  supabase: SupabaseAdmin,
  clientId: string,
  contractId: string,
  site: (typeof BATISUD_SITES)[number],
  organizationId?: string,
): Promise<{ id: string; created: boolean }> {
  const { data: existing, error: fetchErr } = await supabase
    .from('sites')
    .select('id')
    .eq('name', site.name)
    .eq('client_id', clientId)
    .is('deleted_at', null)
    .maybeSingle()
  if (fetchErr) throw fetchErr
  const patch = {
    address: site.address,
    contact_name: site.contactName,
    contact_phone: site.contactPhone,
    access_hours: 'Lun-ven 06:00-16:30',
    access_instructions: site.accessInstructions,
    notes: 'Démo BTP gros œuvre BatiSud.',
  }
  if (existing) {
    const { error } = await supabase.from('sites').update({ ...patch, contract_id: contractId }).eq('id', existing.id)
    if (error) throw error
    return { id: existing.id as string, created: false }
  }

  const id = await createSite({
    client_id: clientId,
    contract_id: contractId,
    name: site.name,
    ...patch,
    ...(organizationId ? { organization_id: organizationId } : {}),
  })
  return { id, created: true }
}

async function ensureTeam(
  supabase: SupabaseAdmin,
  team: (typeof BATISUD_TEAMS)[number],
  adminId: string,
): Promise<{ id: string; created: boolean }> {
  const { data: existing, error: fetchErr } = await supabase
    .from('teams')
    .select('id')
    .eq('name', team.name)
    .is('deleted_at', null)
    .maybeSingle()
  if (fetchErr) throw fetchErr
  if (existing) {
    const { error } = await supabase
      .from('teams')
      .update({ color: team.color, icon: team.icon, active: true })
      .eq('id', existing.id)
    if (error) throw error
    return { id: existing.id as string, created: false }
  }

  const { data, error } = await supabase
    .from('teams')
    .insert({ name: team.name, color: team.color, icon: team.icon, created_by: adminId })
    .select('id')
    .single()
  if (error) throw error
  return { id: data.id as string, created: true }
}

async function ensureDemoUser(
  supabase: SupabaseAdmin,
  email: string,
  fullName: string,
  role: 'manager' | 'chef_equipe',
  phone: string,
  homePreference: 'dashboard' | 'terrain' = 'dashboard',
  organizationId: string | null = null,
  profile?: Pick<BatiSudTeamMemberSeed, 'commune' | 'employmentType'>,
): Promise<{ id: string; created: boolean }> {
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listErr) throw listErr
  const existing = list?.users?.find((user) => user.email?.toLowerCase() === email.toLowerCase())
  if (existing) {
    const { error: authErr } = await supabase.auth.admin.updateUserById(existing.id, {
      app_metadata: { ...(existing.app_metadata ?? {}), role },
      user_metadata: { ...(existing.user_metadata ?? {}), full_name: fullName, role },
    })
    if (authErr) throw authErr
    const { error: userErr } = await supabase
      .from('users')
      .update({
        email,
        full_name: fullName,
        role,
        phone,
        deleted_at: null,
        home_preference: homePreference,
        ...(organizationId ? { organization_id: organizationId } : {}),
        ...(profile?.commune ? { commune: profile.commune } : {}),
        ...(profile?.employmentType ? { employment_type: profile.employmentType } : {}),
      })
      .eq('id', existing.id)
    if (userErr) throw userErr
    return { id: existing.id, created: false }
  }

  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password: BATISUD_DEMO_PASSWORD,
    email_confirm: true,
    app_metadata: { role },
    user_metadata: { full_name: fullName, role },
  })
  if (createErr) throw createErr
  if (!created.user) throw new Error(`Création utilisateur impossible : ${email}`)

  const { error: upsertErr } = await supabase
    .from('users')
    .upsert({
      id: created.user.id,
      email,
      full_name: fullName,
      role,
      phone,
      must_change_password: true,
      deleted_at: null,
      home_preference: homePreference,
      ...(organizationId ? { organization_id: organizationId } : {}),
      ...(profile?.commune ? { commune: profile.commune } : {}),
      ...(profile?.employmentType ? { employment_type: profile.employmentType } : {}),
    })
  if (upsertErr) throw upsertErr
  return { id: created.user.id, created: true }
}

async function ensureMembership(
  supabase: SupabaseAdmin,
  teamId: string,
  userId: string,
  organizationId: string | null,
): Promise<boolean> {
  const { data: existing, error: fetchErr } = await supabase
    .from('team_members')
    .select('id')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .is('left_at', null)
    .maybeSingle()
  if (fetchErr) throw fetchErr
  if (existing) {
    if (organizationId) {
      const { error } = await supabase
        .from('team_members')
        .update({ organization_id: organizationId })
        .eq('id', existing.id)
      if (error) throw error
    }
    return false
  }

  const { error } = await supabase.from('team_members').insert({
    team_id: teamId,
    user_id: userId,
    ...(organizationId ? { organization_id: organizationId } : {}),
  })
  if (error) throw error
  return true
}

async function ensureMission(
  supabase: SupabaseAdmin,
  siteId: string,
  seed: (typeof BATISUD_MISSIONS)[number],
  teamId: string,
  adminId: string,
): Promise<{ id: string; created: boolean }> {
  const checklist: ChecklistTemplateItem[] = seed.checklist.map((label, index) => ({
    label,
    required: true,
    position: index,
  }))
  const { data: existing, error: fetchErr } = await supabase
    .from('missions')
    .select('id')
    .eq('site_id', siteId)
    .eq('name', seed.name)
    .is('deleted_at', null)
    .maybeSingle()
  if (fetchErr) throw fetchErr
  if (existing) {
    const { error } = await supabase
      .from('missions')
      .update({
        description: 'Contrôle chantier BTP gros œuvre - seed BatiSud.',
        cadence: seed.cadence,
        default_checklist: checklist,
        assigned_team_id: teamId,
      })
      .eq('id', existing.id)
    if (error) throw error
    return { id: existing.id as string, created: false }
  }

  const id = await createMission({
    site_id: siteId,
    name: seed.name,
    description: 'Contrôle chantier BTP gros œuvre - seed BatiSud.',
    cadence: seed.cadence,
    default_checklist: checklist,
    created_by: adminId,
  })
  const { error } = await supabase.from('missions').update({ assigned_team_id: teamId }).eq('id', id)
  if (error) throw error
  return { id, created: true }
}

async function ensureChecklistItems(
  supabase: SupabaseAdmin,
  interventionId: string,
  labels: string[],
  doneBy: string | null,
): Promise<void> {
  const { data: existing, error } = await supabase
    .from('intervention_checklist_items')
    .select('id, position')
    .eq('intervention_id', interventionId)
    .order('position', { ascending: true })
  if (error) throw error
  if (existing && existing.length > 0) {
    if (doneBy) {
      const ids = existing
        .slice(0, Math.max(1, existing.length - 1))
        .map((item) => item.id as string)
      const { error: updateErr } = await supabase
        .from('intervention_checklist_items')
        .update({ done: true, done_at: new Date().toISOString(), done_by: doneBy })
        .in('id', ids)
      if (updateErr) throw updateErr
    }
    return
  }

  const items = await bulkInsertChecklistItems(
    labels.map((label, index) => ({
      intervention_id: interventionId,
      engagement_id: null,
      label,
      position: index,
      required: true,
    })),
  )
  if (doneBy) {
    for (const item of items.slice(0, Math.max(1, items.length - 1))) {
      await markChecklistItemDone(item.id, doneBy)
    }
  }
}

function executedAtFor(date: string, status: InterventionStatus): string | null {
  if (!['completed', 'validated'].includes(status)) return null
  return `${date}T05:30:00.000Z`
}

async function ensureIntervention(
  supabase: SupabaseAdmin,
  input: {
    missionId: string
    missionChecklist: string[]
    title: string
    date: string
    slot: 'morning' | 'afternoon' | 'evening'
    plannedStart: string
    plannedEnd: string
    status: InterventionStatus
    notes: string
    teamId: string
    chefId: string
    adminId: string
    teamUserIds: string[]
    doneBy: string
  },
): Promise<{ id: string; created: boolean }> {
  const { data: existing, error: fetchErr } = await supabase
    .from('interventions')
    .select('id')
    .eq('mission_id', input.missionId)
    .ilike('notes', `%${input.title}%`)
    .maybeSingle()
  if (fetchErr) throw fetchErr

  const notes = `${input.title}. ${input.notes}`
  const executedAt = executedAtFor(input.date, input.status)

  if (existing) {
    const { error } = await supabase
      .from('interventions')
      .update({
        scheduled_for: input.date,
        slot: input.slot,
        planned_start: `${input.date}T${input.plannedStart}:00.000Z`,
        planned_end: `${input.date}T${input.plannedEnd}:00.000Z`,
        scheduled_at: `${input.date}T${input.plannedStart}:00.000Z`,
        status: input.status,
        executed_at: executedAt,
        assigned_team_id: input.teamId,
        team: input.teamUserIds,
        notes,
      })
      .eq('id', existing.id)
    if (error) throw error
    await ensureChecklistItems(
      supabase,
      existing.id as string,
      input.missionChecklist,
      input.status === 'planned' ? null : input.doneBy,
    )
    return { id: existing.id as string, created: false }
  }

  const id = await createIntervention({
    mission_id: input.missionId,
    scheduled_for: input.date,
    slot: input.slot,
    planned_start_hhmm: input.plannedStart,
    planned_end_hhmm: input.plannedEnd,
    team: input.teamUserIds,
    created_by: input.adminId,
  })
  const { error } = await supabase
    .from('interventions')
    .update({
      status: input.status,
      executed_at: executedAt,
      assigned_team_id: input.teamId,
      notes,
    })
    .eq('id', id)
  if (error) throw error
  await ensureChecklistItems(
    supabase,
    id,
    input.missionChecklist,
    input.status === 'planned' ? null : input.doneBy,
  )
  return { id, created: true }
}

async function ensureInterventionParticipants(
  supabase: SupabaseAdmin,
  input: {
    interventionId: string
    userIds: string[]
    referentId: string
    createdBy: string
  },
): Promise<void> {
  if (input.userIds.length === 0) return
  const { data: intervention, error: statusErr } = await supabase
    .from('interventions')
    .select('status')
    .eq('id', input.interventionId)
    .single()
  if (statusErr) throw statusErr
  const frozenStatus = ['completed', 'validated'].includes(intervention.status)
    ? intervention.status as InterventionStatus
    : null
  if (frozenStatus) {
    const { error } = await supabase
      .from('interventions')
      .update({ status: 'in_progress' })
      .eq('id', input.interventionId)
    if (error) throw error
  }
  try {
    const rows = input.userIds.map((userId) => ({
      intervention_id: input.interventionId,
      user_id: userId,
      role: userId === input.referentId ? 'referent' : 'participant',
      created_by: input.createdBy,
    }))
    const { error } = await supabase
      .from('intervention_participants')
      .upsert(rows, { onConflict: 'intervention_id,user_id' })
    if (error) throw error
  } finally {
    if (frozenStatus) {
      const { error: restoreErr } = await supabase
        .from('interventions')
        .update({ status: frozenStatus })
        .eq('id', input.interventionId)
      if (restoreErr) throw restoreErr
    }
  }
}

async function ensureAnomaly(
  supabase: SupabaseAdmin,
  input: {
    interventionId: string
    anomaly: NonNullable<ReturnType<typeof buildBatiSudInterventionSeeds>[number]['anomaly']>
    reportedBy: string
  },
): Promise<{ id: string; created: boolean }> {
  const { data: existing, error: fetchErr } = await supabase
    .from('intervention_anomalies')
    .select('id')
    .eq('intervention_id', input.interventionId)
    .eq('description', input.anomaly.description)
    .maybeSingle()
  if (fetchErr) throw fetchErr
  if (existing) {
    const { error } = await supabase
      .from('intervention_anomalies')
      .update({
        status: input.anomaly.resolved ? 'resolved' : 'open',
        reported_by: input.reportedBy,
        resolved_at: input.anomaly.resolved ? new Date().toISOString() : null,
        resolution_note: input.anomaly.resolved ? 'Résolu dans le seed BatiSud.' : null,
      })
      .eq('id', existing.id)
    if (error) throw error
    return { id: existing.id as string, created: false }
  }

  const id = await createAnomaly({
    intervention_id: input.interventionId,
    category: input.anomaly.category,
    category_other: input.anomaly.categoryOther ?? null,
    description: input.anomaly.description,
    reported_by: input.reportedBy,
  })
  if (input.anomaly.resolved) {
    const { error } = await supabase
      .from('intervention_anomalies')
      .update({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        resolution_note: 'Résolu dans le seed BatiSud.',
      })
      .eq('id', id)
    if (error) throw error
  }
  return { id, created: true }
}

async function ensurePhoto(
  supabase: SupabaseAdmin,
  input: {
    interventionId: string
    label: string
    kind: keyof typeof PHOTO_COLORS
    takenBy: string
    anomalyId?: string | null
  },
): Promise<boolean> {
  const storagePath = await uploadSeedPhoto(supabase, input.interventionId, input.label, input.kind)
  const { data: existing, error: fetchErr } = await supabase
    .from('intervention_photos')
    .select('id')
    .eq('intervention_id', input.interventionId)
    .eq('storage_path', storagePath)
    .maybeSingle()
  if (fetchErr) throw fetchErr
  if (existing) {
    const { error } = await supabase
      .from('intervention_photos')
      .update({
        kind: input.kind,
        caption: input.label,
        taken_by: input.takenBy,
        anomaly_id: input.anomalyId ?? null,
      })
      .eq('id', existing.id)
    if (error) throw error
    return false
  }

  await insertPhoto({
    intervention_id: input.interventionId,
    checklist_item_id: null,
    anomaly_id: input.anomalyId ?? null,
    storage_path: storagePath,
    kind: input.kind,
    caption: input.label,
    taken_by: input.takenBy,
    mime_type: 'image/svg+xml',
    size_bytes: svgPhoto(input.label, 'BatiSud', PHOTO_COLORS[input.kind]).byteLength,
    hash_origin: 'verified',
  })
  return true
}

async function ensureSiteNote(
  supabase: SupabaseAdmin,
  siteId: string,
  body: string,
  kind: 'note' | 'a_savoir',
  createdBy: string,
): Promise<boolean> {
  const { data: existing, error: fetchErr } = await supabase
    .from('site_notes')
    .select('id')
    .eq('site_id', siteId)
    .eq('body', body)
    .is('deleted_at', null)
    .maybeSingle()
  if (fetchErr) throw fetchErr
  if (existing) {
    const { error } = await supabase
      .from('site_notes')
      .update({ kind, created_by: createdBy })
      .eq('id', existing.id)
    if (error) throw error
    return false
  }

  const { error } = await supabase.from('site_notes').insert({
    site_id: siteId,
    body,
    kind,
    active_until: null,
    created_by: createdBy,
  })
  if (error) throw error
  return true
}

async function ensureCollection(
  supabase: SupabaseAdmin,
  contractId: string,
): Promise<string> {
  const name = 'BatiSud - Dossier chantier'
  const { data: existing, error: fetchErr } = await supabase
    .from('document_collections')
    .select('id')
    .eq('name', name)
    .eq('scope_type', 'contract')
    .eq('scope_id', contractId)
    .is('deleted_at', null)
    .maybeSingle()
  if (fetchErr) throw fetchErr
  if (existing) return existing.id as string

  const { data, error } = await supabase
    .from('document_collections')
    .insert({ name, scope_type: 'contract', scope_id: contractId })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

async function ensureDocument(
  supabase: SupabaseAdmin,
  input: {
    collectionId: string
    siteId: string
    contractId: string
    filename: string
    type: (typeof BATISUD_DOCUMENTS)[number]['type']
    text: string
    createdBy: string
  },
): Promise<boolean> {
  const { data: existing, error: fetchErr } = await supabase
    .from('documents')
    .select('id')
    .eq('filename', input.filename)
    .is('deleted_at', null)
    .maybeSingle()
  if (fetchErr) throw fetchErr

  const storagePath = `seed/batisud/${slugify(input.filename)}.txt`
  const bytes = Buffer.from(input.text, 'utf-8')
  const hash = createHash('sha256').update(bytes).digest('hex')
  const { error: storageErr } = await supabase.storage
    .from('documents')
    .upload(storagePath, bytes, { contentType: 'text/plain; charset=utf-8', upsert: true })
  if (storageErr) throw storageErr

  let documentId = existing?.id as string | undefined
  let created = false
  if (documentId) {
    const { error } = await supabase
      .from('documents')
      .update({
        collection_id: input.collectionId,
        document_type: input.type,
        storage_path: storagePath,
        extracted_text: input.text,
        analysis_status: 'ready',
        memory_tier: 'vivante',
        visibility_level: 'operations',
        tags: ['batisud', 'btp', 'chantier'],
        size_bytes: bytes.byteLength,
        content_hash: hash,
      })
      .eq('id', documentId)
    if (error) throw error
  } else {
    const { data, error } = await supabase
      .from('documents')
      .insert({
        collection_id: input.collectionId,
        document_type: input.type,
        storage_path: storagePath,
        filename: input.filename,
        visibility_level: 'operations',
        tags: ['batisud', 'btp', 'chantier'],
        size_bytes: bytes.byteLength,
        page_count: 1,
        content_hash: hash,
        analysis_status: 'ready',
        extraction_source: 'native',
        extracted_text: input.text,
        memory_tier: 'vivante',
        created_by: input.createdBy,
      })
      .select('id')
      .single()
    if (error) throw error
    documentId = data.id as string
    created = true
  }

  for (const [targetType, targetId] of [
    ['site', input.siteId],
    ['contract', input.contractId],
  ] as const) {
    const { error } = await supabase
      .from('document_links')
      .upsert(
        { document_id: documentId, target_type: targetType, target_id: targetId },
        { onConflict: 'document_id,target_type,target_id', ignoreDuplicates: true },
      )
    if (error) throw error
  }
  return created
}

async function ensureHandover(
  supabase: SupabaseAdmin,
  input: {
    title: string
    siteId: string
    targetTeamId: string
    createdBy: string
    share: boolean
    effectiveDate: string
  },
): Promise<{ created: boolean; token: string | null }> {
  const { data: existing, error: fetchErr } = await supabase
    .from('handover_briefs')
    .select('*')
    .eq('title', input.title)
    .is('deleted_at', null)
    .maybeSingle()
  if (fetchErr) throw fetchErr

  let brief = existing as DbHandoverBrief | null
  let created = false
  if (!brief) {
    const { payload } = await buildTeamTakesSitePayload({
      targetTeamId: input.targetTeamId,
      siteId: input.siteId,
    })
    brief = await createHandoverBrief({
      kind: 'team_takes_site',
      targetTeamId: input.targetTeamId,
      siteId: input.siteId,
      payload: {
        ...payload,
        context: input.title,
        manualNotes: [
          payload.manualNotes,
          'Passation démo BatiSud : décisions chantier, incidents récents, documents et points à savoir.',
        ].filter(Boolean).join('\n\n'),
      },
      title: input.title,
      effectiveDate: input.effectiveDate,
      createdBy: input.createdBy,
    })
    created = true
  }

  if (!input.share) return { created, token: brief.shared_token ?? null }
  if (brief.shared_token) return { created, token: brief.shared_token }

  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 45)
  const { token } = await shareHandoverBrief(brief.id, expiresAt)
  return { created, token }
}

async function verifySeed(
  supabase: SupabaseAdmin,
  input: {
    chefId: string
    contractId: string
    siteIds: string[]
    token: string | null
  },
) {
  const today = new Date()
  const startHistory = toIsoDate(today, -14)
  const endPlanning = toIsoDate(today, 21)
  const todayIso = toIsoDate(today, 0)

  const { count: chefCount } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('id', input.chefId)
    .eq('email', BATISUD_CHEF_EMAIL)
    .eq('role', 'chef_equipe')

  const { data: memberships } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', input.chefId)
    .is('left_at', null)
  const teamIds = (memberships ?? []).map((row) => row.team_id as string)

  const { count: mobileCount } = await supabase
    .from('interventions')
    .select('id', { count: 'exact', head: true })
    .in('assigned_team_id', teamIds.length > 0 ? teamIds : ['00000000-0000-0000-0000-000000000000'])
    .gte('scheduled_for', toIsoDate(today, -1))
    .lte('scheduled_for', toIsoDate(today, 7))

  const { count: planningCount } = await supabase
    .from('interventions')
    .select('id', { count: 'exact', head: true })
    .in('status', ['planned'])
    .gte('scheduled_for', todayIso)
    .lte('scheduled_for', endPlanning)

  const { data: missions } = await supabase
    .from('missions')
    .select('id')
    .in('site_id', input.siteIds)
    .is('deleted_at', null)
  const missionIds = (missions ?? []).map((mission) => mission.id as string)

  const { count: historyCount } = await supabase
    .from('interventions')
    .select('id', { count: 'exact', head: true })
    .in('mission_id', missionIds.length > 0 ? missionIds : ['00000000-0000-0000-0000-000000000000'])
    .gte('scheduled_for', startHistory)
    .lt('scheduled_for', todayIso)

  const { count: siteCount } = await supabase
    .from('sites')
    .select('id', { count: 'exact', head: true })
    .in('id', input.siteIds)
    .eq('contract_id', input.contractId)

  const { count: contractCount } = await supabase
    .from('contracts')
    .select('id', { count: 'exact', head: true })
    .eq('id', input.contractId)
    .eq('name', BATISUD_CONTRACT_NAME)

  const { count: tokenCount } = input.token
    ? await supabase
        .from('handover_briefs')
        .select('id', { count: 'exact', head: true })
        .eq('shared_token', input.token)
        .eq('status', 'shared')
    : { count: 0 }

  return {
    chefAccount: chefCount ?? 0,
    mobileVisibleInterventions: mobileCount ?? 0,
    planningNext3Weeks: planningCount ?? 0,
    historyLast2Weeks: historyCount ?? 0,
    batisudSites: siteCount ?? 0,
    batisudContracts: contractCount ?? 0,
    sharedHandovers: tokenCount ?? 0,
  }
}

async function ensureInterventionCompanies(
  supabase: SupabaseAdmin,
  interventionId: string,
  companies: BatiSudInterventionCompany[],
  adminId: string,
  organizationId: string,
): Promise<number> {
  if (companies.length === 0) return 0
  const { data: existing, error: fetchErr } = await supabase
    .from('intervention_companies')
    .select('company_name')
    .eq('intervention_id', interventionId)
  if (fetchErr) {
    if ((fetchErr as { code?: string }).code === '42P01') return 0
    throw fetchErr
  }
  const existingNames = new Set((existing ?? []).map((r) => (r.company_name as string).toLowerCase()))
  let inserted = 0
  for (const company of companies) {
    if (existingNames.has(company.company_name.toLowerCase())) continue
    const { error } = await supabase.from('intervention_companies').insert({
      intervention_id: interventionId,
      company_name: company.company_name,
      role_description: company.role_description ?? null,
      created_by: adminId,
      organization_id: organizationId,
    })
    if (error) {
      if ((error as { code?: string }).code === '42P01') return inserted
      throw error
    }
    inserted++
  }
  return inserted
}

async function main() {
  const supabase = createAdminClient()
  const summary: SeedSummary = {
    clientId: '',
    contractId: '',
    sitesCreated: 0,
    teamsCreated: 0,
    membersCreated: 0,
    membershipsCreated: 0,
    missionsCreated: 0,
    interventionsCreated: 0,
    interventionsUpdated: 0,
    anomaliesCreated: 0,
    photosCreated: 0,
    notesCreated: 0,
    documentsCreated: 0,
    handoversCreated: 0,
    companiesCreated: 0,
    qrTokensEnsured: 0,
    sharedToken: null,
  }

  const { data: admin, error: adminErr } = await supabase
    .from('users')
    .select('id, organization_id')
    .eq('role', 'admin')
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  if (adminErr) throw adminErr
  if (!admin) throw new Error('Aucun admin trouvé. Lance db:bootstrap-admin avant ce seed.')
  const adminId = admin.id as string
  const organizationId = admin.organization_id as string

  summary.clientId = await ensureClient(supabase)
  const contract = await ensureContract(supabase, adminId)
  summary.contractId = contract.id

  // Adrien = manager BTP, profil "terrain" : ouvre /m au login.
  const adrien = await ensureDemoUser(
    supabase,
    BATISUD_ADRIEN_EMAIL,
    'Adrien Démo BatiSud',
    'manager',
    '+687701234',
    'terrain',
    organizationId,
  )

  const teamIds = new Map<string, string>()
  for (const teamSeed of BATISUD_TEAMS) {
    const team = await ensureTeam(supabase, teamSeed, adminId)
    teamIds.set(teamSeed.name, team.id)
    if (team.created) summary.teamsCreated += 1
  }

  const memberIdsByTeam = new Map<string, string[]>()
  const memberIdsByEmail = new Map<string, string>()
  for (const memberSeed of BATISUD_TEAM_MEMBERS) {
    const teamId = teamIds.get(memberSeed.teamName)
    if (!teamId) throw new Error(`Équipe introuvable pour membre : ${memberSeed.fullName}`)
    const member = await ensureDemoUser(
      supabase,
      memberSeed.email,
      memberSeed.fullName,
      'chef_equipe',
      memberSeed.phone,
      'terrain',
      organizationId,
      memberSeed,
    )
    if (member.created) summary.membersCreated += 1
    memberIdsByEmail.set(memberSeed.email, member.id)
    const membershipCreated = await ensureMembership(supabase, teamId, member.id, organizationId)
    if (membershipCreated) summary.membershipsCreated += 1
    const ids = memberIdsByTeam.get(memberSeed.teamName) ?? []
    ids.push(member.id)
    memberIdsByTeam.set(memberSeed.teamName, ids)
    if (memberSeed.referent) {
      const { error } = await supabase
        .from('teams')
        .update({ referent_user_id: member.id })
        .eq('id', teamId)
      if (error) throw error
    }
  }

  const chefId = memberIdsByEmail.get(BATISUD_CHEF_EMAIL)
  if (!chefId) throw new Error('Compte chef BatiSud introuvable après seed.')
  const chef = { id: chefId }

  const siteIds = new Map<string, string>()
  for (const siteSeed of BATISUD_SITES) {
    const site = await ensureSite(supabase, summary.clientId, summary.contractId, siteSeed, organizationId)
    siteIds.set(siteSeed.name, site.id)
    if (site.created) summary.sitesCreated += 1
    await generateQrToken(site.id, adminId)
    summary.qrTokensEnsured += 1
  }

  const missionIds = new Map<string, { id: string; checklist: string[]; teamId: string }>()
  for (const [siteName, siteId] of siteIds.entries()) {
    for (const missionSeed of BATISUD_MISSIONS) {
      const teamId = teamIds.get(missionSeed.teamName)
      if (!teamId) throw new Error(`Équipe introuvable pour mission ${missionSeed.name}`)
      const mission = await ensureMission(supabase, siteId, missionSeed, teamId, adminId)
      missionIds.set(`${siteName}::${missionSeed.name}`, {
        id: mission.id,
        checklist: missionSeed.checklist,
        teamId,
      })
      if (mission.created) summary.missionsCreated += 1
    }
  }

  for (const note of BATISUD_SITE_NOTES) {
    const siteId = siteIds.get(note.siteName)
    if (!siteId) throw new Error(`Site introuvable pour note : ${note.siteName}`)
    const created = await ensureSiteNote(supabase, siteId, note.body, note.kind, chef.id)
    if (created) summary.notesCreated += 1
  }

  const seeds = buildBatiSudInterventionSeeds(new Date())
  for (const seed of seeds) {
    const mission = missionIds.get(`${seed.siteName}::${seed.missionName}`)
    if (!mission) throw new Error(`Mission introuvable : ${seed.siteName} / ${seed.missionName}`)
    const teamId = teamIds.get(seed.teamName)
    if (!teamId) throw new Error(`Équipe introuvable : ${seed.teamName}`)
    const teamUserIds = memberIdsByTeam.get(seed.teamName) ?? [chef.id]
    const referentId = teamUserIds[0] ?? chef.id
    const actorId = teamUserIds[seeds.indexOf(seed) % teamUserIds.length] ?? referentId
    const date = toIsoDate(new Date(), seed.dayOffset)
    const intervention = await ensureIntervention(supabase, {
      missionId: mission.id,
      missionChecklist: mission.checklist,
      title: seed.title,
      date,
      slot: seed.slot,
      plannedStart: seed.plannedStart,
      plannedEnd: seed.plannedEnd,
      status: seed.status,
      notes: seed.notes,
      teamId,
      chefId: chef.id,
      adminId,
      teamUserIds,
      doneBy: actorId,
    })
    if (intervention.created) summary.interventionsCreated += 1
    else summary.interventionsUpdated += 1

    let anomalyId: string | null = null
    if (seed.anomaly) {
      const anomaly = await ensureAnomaly(supabase, {
        interventionId: intervention.id,
        anomaly: seed.anomaly,
        reportedBy: actorId,
      })
      anomalyId = anomaly.id
      if (anomaly.created) summary.anomaliesCreated += 1
    }

    for (const photo of seed.photos) {
      const created = await ensurePhoto(supabase, {
        interventionId: intervention.id,
        label: photo.label,
        kind: photo.kind,
        takenBy: actorId,
        anomalyId: photo.kind === 'anomaly' ? anomalyId : null,
      })
      if (created) summary.photosCreated += 1
    }

    await ensureInterventionParticipants(supabase, {
      interventionId: intervention.id,
      userIds: teamUserIds,
      referentId,
      createdBy: adminId,
    })

    if (seed.dayOffset < 0) {
      const siteId = siteIds.get(seed.siteName)
      if (siteId) {
        const created = await ensureSiteNote(
          supabase,
          siteId,
          buildBatiSudSiteReturnNote(seed),
          'note',
          actorId,
        )
        if (created) summary.notesCreated += 1
      }
    }

    if (seed.validate) {
      const { data: existingValidation, error } = await supabase
        .from('intervention_validations')
        .select('id')
        .eq('intervention_id', intervention.id)
        .maybeSingle()
      if (error) throw error
      if (!existingValidation) {
        await createValidation({
          intervention_id: intervention.id,
          validated_by: adrien.id,
          comment: 'Validation manager démo BatiSud après contrôle photos, notes terrain et réserves.',
        })
      } else {
        const { error: validationErr } = await supabase
          .from('intervention_validations')
          .update({ comment: 'Validation manager démo BatiSud après contrôle photos, notes terrain et réserves.' })
          .eq('id', existingValidation.id)
        if (validationErr) throw validationErr
      }
    }

    if (seed.companies.length > 0) {
      const inserted = await ensureInterventionCompanies(
        supabase,
        intervention.id,
        seed.companies,
        adminId,
        organizationId,
      )
      summary.companiesCreated += inserted
    }
  }

  const collectionId = await ensureCollection(supabase, summary.contractId)
  for (const doc of BATISUD_DOCUMENTS) {
    const siteId = siteIds.get(doc.targetSiteName)
    if (!siteId) throw new Error(`Site introuvable pour document : ${doc.targetSiteName}`)
    const created = await ensureDocument(supabase, {
      collectionId,
      siteId,
      contractId: summary.contractId,
      filename: doc.filename,
      type: doc.type,
      text: doc.text,
      createdBy: adrien.id,
    })
    if (created) summary.documentsCreated += 1
  }

  const handoverSeeds = [
    {
      title: 'Passation chantier Médipôle - voile Nord et contrôle SOCOTEC',
      siteName: 'Extension Médipôle',
      teamName: 'Gros œuvre Nord',
      share: true,
    },
    {
      title: 'Passation Lycée de Païta - coulage dalle bâtiment B',
      siteName: 'Chantier Lycée de Païta',
      teamName: 'Gros œuvre Nord',
      share: false,
    },
    {
      title: 'Passation Résidence Anse Vata - réservations techniques',
      siteName: 'Résidence Anse Vata',
      teamName: 'Finitions structure',
      share: false,
    },
    {
      title: 'Passation Port Autonome - accès et zones sécurisées',
      siteName: 'Réhabilitation Port Autonome',
      teamName: 'Sécurité & accès',
      share: false,
    },
    {
      title: 'Passation BatiSud - rotation chef de chantier semaine prochaine',
      siteName: 'Chantier Lycée de Païta',
      teamName: 'Gros œuvre Nord',
      share: false,
    },
  ]
  for (const handoverSeed of handoverSeeds) {
    const siteId = siteIds.get(handoverSeed.siteName)
    const teamId = teamIds.get(handoverSeed.teamName)
    if (!siteId || !teamId) throw new Error(`Passation incomplète : ${handoverSeed.title}`)
    const handover = await ensureHandover(supabase, {
      title: handoverSeed.title,
      siteId,
      targetTeamId: teamId,
      createdBy: adrien.id,
      share: handoverSeed.share,
      effectiveDate: toIsoDate(new Date(), 3),
    })
    if (handover.created) summary.handoversCreated += 1
    if (handover.token) summary.sharedToken = handover.token
  }

  const verification = await verifySeed(supabase, {
    chefId: chef.id,
    contractId: summary.contractId,
    siteIds: Array.from(siteIds.values()),
    token: summary.sharedToken,
  })

  console.log('\n[BatiSud seed] Terminé.')
  console.log(JSON.stringify({
    comptes: {
      adrien: BATISUD_ADRIEN_EMAIL,
      chef: BATISUD_CHEF_EMAIL,
      motDePasseTemporaire: BATISUD_DEMO_PASSWORD,
    },
    summary,
    verification,
    sharedUrl: summary.sharedToken ? `/h/${summary.sharedToken}` : null,
    gardeFous: {
      reset: false,
      delete: false,
      migrations: false,
      rls: false,
      guillaumeTouched: false,
    },
  }, null, 2))
}

main().catch((error) => {
  console.error('[BatiSud seed] Échec:', error)
  process.exit(1)
})
