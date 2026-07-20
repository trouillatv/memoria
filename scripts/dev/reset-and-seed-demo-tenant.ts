/**
 * scripts/dev/reset-and-seed-demo-tenant.ts
 *
 * TENANT DE DÉMONSTRATION ISOLÉ (Vincent 2026-07-13).
 *
 * Règle impérative : le compte demo@memoria.nc vit dans SA PROPRE organisation.
 * Aucune donnée n'est écrite dans un autre tenant ; le reset ne touche QUE
 * l'organisation « Démo MemorIA ». Relançable à volonté : suppression complète
 * des données du tenant démo puis recréation À L'IDENTIQUE (scénario scripté,
 * dates relatives au jour d'exécution — la démo est toujours « vivante »).
 *
 * Scénario : chantiers crédibles Nouvelle-Calédonie, avec Petro Atiti en
 * vitrine (reconstruction post-émeutes 2024 : réunion → décisions → actions →
 * intervention → découverte → visite de contrôle → réserves → CR → prochaine
 * réunion). Aucun nom qui « sent le développement ».
 *
 * USAGE
 *   Dry-run  : npx tsx scripts/dev/reset-and-seed-demo-tenant.ts --confirm-reset-on=<frag-url>
 *   Exécuter : npx tsx scripts/dev/reset-and-seed-demo-tenant.ts --confirm-reset-on=<frag-url> --yes
 */

import * as fs from 'fs'

function loadEnvLocal() {
  const path = '.env.local'
  if (!fs.existsSync(path)) return
  for (const rawLine of fs.readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    if (!(key in process.env)) process.env[key] = val
  }
}
loadEnvLocal()

import { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

// ============================================================================
// Constantes du tenant démo
// ============================================================================

const DEMO_ORG_NAME = 'Démo MemorIA'
const DEMO_PASSWORD = 'demo-memoria-2026!'
const DEMO_ACCOUNTS = [
  { email: 'demo@memoria.nc', fullName: 'Guillaume Démo', role: 'manager' },
  { email: 'demo-chef@memoria.nc', fullName: 'Sylvain Chef', role: 'chef_equipe' },
] as const

// Jour civil Nouméa (+11, pas de DST) décalé de `off` jours.
function d(off: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Noumea', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() + off * 86_400_000))
}
// Instant ISO : jour décalé + heure locale Nouméa.
function t(off: number, hhmm: string): string {
  return `${d(off)}T${hhmm}:00+11:00`
}

// SVG placeholder — une « photo » de chantier lisible (même mécanique que le
// seed NC : aucune image binaire dans le dépôt).
function svgPhoto(label: string, color: string): Buffer {
  const safe = label.replace(/[&<>"]/g, ' ')
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">` +
    `<rect width="800" height="600" fill="${color}"/>` +
    `<rect x="24" y="24" width="752" height="552" fill="none" stroke="#ffffff55" stroke-width="4"/>` +
    `<text x="400" y="290" font-family="sans-serif" font-size="34" fill="#fff" text-anchor="middle">${safe}</text>` +
    `<text x="400" y="340" font-family="sans-serif" font-size="20" fill="#ffffffaa" text-anchor="middle">Photo de démonstration MemorIA</text>` +
    `</svg>`,
  )
}

let stepFailures = 0
async function step<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const out = await fn()
    console.log(`  ✓ ${label}`)
    return out
  } catch (e) {
    stepFailures++
    console.error(`  ✗ ${label} — ${(e as Error).message}`)
    return null
  }
}

// ============================================================================
// Guards
// ============================================================================

const args = process.argv.slice(2)
const confirmArg = args.find((a) => a.startsWith('--confirm-reset-on='))?.split('=')[1]
const yes = args.includes('--yes')
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
if (!confirmArg || !url.includes(confirmArg)) {
  console.error('Refus : --confirm-reset-on=<fragment de NEXT_PUBLIC_SUPABASE_URL> requis et doit correspondre.')
  process.exit(1)
}

// ============================================================================
// Org + comptes
// ============================================================================

async function ensureOrg(supabase: Admin): Promise<string> {
  const { data: existing } = await supabase.from('organizations').select('id').eq('name', DEMO_ORG_NAME).maybeSingle()
  if (existing) return (existing as { id: string }).id
  const { data, error } = await supabase.from('organizations').insert({ name: DEMO_ORG_NAME }).select('id').single()
  if (error) throw error
  return (data as { id: string }).id
}

async function ensureUsers(supabase: Admin, orgId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const { data: existing } = await supabase.auth.admin.listUsers()
  const byEmail = new Map(existing?.users?.map((u) => [u.email, u]) ?? [])
  for (const acc of DEMO_ACCOUNTS) {
    let userId: string
    const found = byEmail.get(acc.email)
    if (found) {
      userId = found.id
      await supabase.auth.admin.updateUserById(userId, { password: DEMO_PASSWORD })
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email: acc.email,
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: acc.fullName, role: acc.role },
      })
      if (error) throw error
      userId = data.user!.id
    }
    const { error: upErr } = await supabase
      .from('users')
      .update({ role: acc.role, full_name: acc.fullName, must_change_password: false, organization_id: orgId })
      .eq('id', userId)
    if (upErr) throw upErr
    out.set(acc.email, userId)
    console.log(`  ✓ ${acc.email} (${acc.role})`)
  }
  return out
}

// ============================================================================
// RESET — scopé au tenant démo UNIQUEMENT
// ============================================================================

async function resetTenant(supabase: Admin, orgId: string, dryRun: boolean) {
  // Les sites cascadent l'essentiel (reports→captures/watchlist, actions,
  // réserves, décisions, missions→interventions→photos/checklist/anomalies).
  const tables = ['sites', 'contracts', 'clients', 'teams', 'tenders', 'companies']
  for (const table of tables) {
    const { count } = await supabase.from(table).select('id', { count: 'exact', head: true }).eq('organization_id', orgId)
    console.log(`  [reset] ${table}: ${count ?? 0} ligne(s) du tenant démo${dryRun ? ' (dry-run, rien supprimé)' : ''}`)
    if (!dryRun && (count ?? 0) > 0) {
      const { error } = await supabase.from(table).delete().eq('organization_id', orgId)
      if (error) console.error(`    ✗ ${table}: ${error.message}`)
    }
  }
}

// ============================================================================
// SEED — le scénario Nouvelle-Calédonie
// ============================================================================

interface Ctx {
  supabase: Admin
  orgId: string
  managerId: string
  chefId: string
  teamId: string | null
}

async function insertClient(c: Ctx, name: string): Promise<string> {
  const { data, error } = await c.supabase
    .from('clients')
    .insert({ name, organization_id: c.orgId })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

async function insertSite(c: Ctx, clientId: string, name: string, address: string, notes?: string): Promise<string> {
  const base = {
    client_id: clientId, contract_id: null, name, address, notes: notes ?? null,
    phase: 'actif', organization_id: c.orgId,
  }
  // tenant_id si la colonne existe (site_reports en dépend) — retry sinon.
  const { data, error } = await c.supabase.from('sites').insert({ ...base, tenant_id: c.orgId }).select('id').single()
  if (error) {
    const { data: d2, error: e2 } = await c.supabase.from('sites').insert(base).select('id').single()
    if (e2) throw e2
    return (d2 as { id: string }).id
  }
  return (data as { id: string }).id
}

async function insertReport(c: Ctx, input: {
  siteId: string; title: string; createdAt: string; text: string
  origin?: string | null; nextMeeting?: string | null; status?: string
}): Promise<string> {
  const { data, error } = await c.supabase
    .from('site_reports')
    .insert({
      type: 'site', site_id: input.siteId, tenant_id: c.orgId, organization_id: c.orgId,
      created_by: c.managerId, status: input.status ?? 'curated', title: input.title,
      text_input: input.text, transcript_status: 'none',
      origin: input.origin ?? null, next_meeting_at: input.nextMeeting ?? null,
      created_at: input.createdAt,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

async function insertAction(c: Ctx, input: {
  siteId: string; title: string; createdAt: string; reportId?: string | null
  status?: string; dueDate?: string | null; lastProgressAt?: string | null
  convertedType?: 'mission' | 'intervention' | null; convertedId?: string | null
  corpsEtat?: string | null
  /** Le RESPONSABLE structurel (contact du casting). `assigned_to` reçoit le nom
   *  en miroir lisible ; `assigned_contact_id` reste la preuve. Sans lui, la fiche
   *  Intervenant n'a aucune « Action à suivre » — donc aucun parcours à recetter. */
  assignedContactId?: string | null
  assignedToName?: string | null
}): Promise<string> {
  const { data, error } = await c.supabase
    .from('site_actions')
    .insert({
      site_id: input.siteId, title: input.title,
      status: input.status ?? 'open', created_by: c.managerId, created_at: input.createdAt,
      report_id: input.reportId ?? null, due_date: input.dueDate ?? null,
      last_progress_at: input.lastProgressAt ?? null, corps_etat: input.corpsEtat ?? null,
      converted_to_type: input.convertedType ?? null, converted_to_id: input.convertedId ?? null,
      assigned_contact_id: input.assignedContactId ?? null,
      assigned_to: input.assignedToName ?? null,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

async function insertMission(c: Ctx, siteId: string, name: string, cadence: string): Promise<string> {
  const { data, error } = await c.supabase
    .from('missions')
    .insert({ site_id: siteId, name, cadence, organization_id: c.orgId, created_by: c.managerId })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

async function insertIntervention(c: Ctx, input: {
  missionId: string; day: string; slot: 'morning' | 'afternoon'
  status: string; label?: string | null; executedAt?: string | null
}): Promise<string> {
  const { data, error } = await c.supabase
    .from('interventions')
    .insert({
      mission_id: input.missionId, scheduled_for: input.day,
      scheduled_at: `${input.day}T${input.slot === 'morning' ? '07' : '14'}:00:00+11:00`,
      slot: input.slot, status: input.status, label: input.label ?? null,
      assigned_team_id: c.teamId, team: [], organization_id: c.orgId,
      created_by: c.managerId, executed_at: input.executedAt ?? null,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

async function insertChecklist(c: Ctx, interventionId: string, items: Array<{ label: string; done: boolean }>) {
  const { error } = await c.supabase.from('intervention_checklist_items').insert(
    items.map((it, i) => ({
      intervention_id: interventionId, label: it.label, position: i, required: true,
      done: it.done, done_at: it.done ? new Date().toISOString() : null,
    })),
  )
  if (error) throw error
}

async function insertPhoto(c: Ctx, interventionId: string, label: string, kind: string, takenAt: string, color = '#5b7a8c') {
  const path = `${interventionId}/seed-${kind}-${Math.random().toString(36).slice(2, 9)}.svg`
  const { error: upErr } = await c.supabase.storage
    .from('intervention-photos')
    .upload(path, svgPhoto(label, color), { contentType: 'image/svg+xml', upsert: false })
  if (upErr) throw upErr
  const { error } = await c.supabase.from('intervention_photos').insert({
    intervention_id: interventionId, storage_path: path, kind, taken_by: c.chefId, taken_at: takenAt,
  })
  if (error) throw error
}

async function insertCapture(c: Ctx, input: {
  reportId: string; siteId: string; kind: string; body: string
  lat: number; lng: number; createdAt: string
}) {
  const { error } = await c.supabase.from('visit_capture').insert({
    report_id: input.reportId, site_id: input.siteId, organization_id: c.orgId,
    kind: input.kind, body: input.body, lat: input.lat, lng: input.lng,
    created_at: input.createdAt,
  })
  if (error) throw error
}

async function insertWatch(c: Ctx, input: {
  reportId: string; siteId: string; label: string; position: number
  state: string; sourceKind: string; sourceRef?: string | null
}) {
  const { error } = await c.supabase.from('visit_watchlist_item').insert({
    report_id: input.reportId, site_id: input.siteId, organization_id: c.orgId,
    label: input.label, position: input.position, state: input.state,
    source_kind: input.sourceKind, source_ref: input.sourceRef ?? null, created_by: c.managerId,
  })
  if (error) throw error
}

async function insertReserve(c: Ctx, input: {
  siteId: string; label: string; location: string; issuedOn: string
  status?: 'open' | 'lifted'; liftedAt?: string | null; liftNote?: string | null
}) {
  const { error } = await c.supabase.from('site_reserve').insert({
    site_id: input.siteId, organization_id: c.orgId, label: input.label,
    location: input.location, issued_by: 'MOE', issued_on: input.issuedOn,
    status: input.status ?? 'open', created_by: c.managerId,
    lifted_at: input.liftedAt ?? null, lift_note: input.liftNote ?? null,
    updated_at: new Date().toISOString(),
  })
  if (error) throw error
}

async function insertDecision(c: Ctx, input: {
  siteId: string; titre: string; reportId: string; dateDecision: string; description?: string
  /** La CONSÉQUENCE de la décision (site_decisions.action_id, 1:1 — mig 137).
   *  Sans lui, la décision existe en base mais n'apparaît NI dans les fils causals
   *  NI dans le chapô « Découle de / Produit » : la chaîne Réunion → Décision →
   *  Action est alors intestable. C'est ce lien qui fait exister le parcours. */
  actionId?: string | null
}) {
  const { error } = await c.supabase.from('site_decisions').insert({
    site_id: input.siteId, titre: input.titre,
    description: input.description ?? null, report_id: input.reportId,
    date_decision: input.dateDecision, created_by: c.managerId,
    action_id: input.actionId ?? null,
  })
  if (error) throw error
}

// ── LE CASTING — entreprise, personne, rôle sur le chantier (mig 137) ────────
async function insertCompany(c: Ctx, name: string, shortName?: string): Promise<string> {
  const { data, error } = await c.supabase.from('companies')
    .insert({ organization_id: c.orgId, name, short_name: shortName ?? null })
    .select('id').single()
  if (error) throw error
  return (data as { id: string }).id
}

async function insertContact(c: Ctx, input: {
  companyId: string; fullName: string; fonction?: string; isMain?: boolean
}): Promise<string> {
  const { data, error } = await c.supabase.from('company_contacts')
    .insert({
      organization_id: c.orgId,
      company_id: input.companyId, full_name: input.fullName,
      function: input.fonction ?? null, is_main: input.isMain ?? false,
    })
    .select('id').single()
  if (error) throw error
  return (data as { id: string }).id
}

async function insertIntervenant(c: Ctx, input: {
  siteId: string; role: string; companyId: string; mainContactId?: string | null
}) {
  const { error } = await c.supabase.from('site_intervenants').insert({
    site_id: input.siteId, role: input.role,
    company_id: input.companyId, main_contact_id: input.mainContactId ?? null,
  })
  if (error) throw error
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const supabase = createAdminClient()
  console.log(`\n=== Tenant de démonstration « ${DEMO_ORG_NAME} » ===\n`)

  const orgId = await ensureOrg(supabase)
  console.log(`  ✓ Organisation : ${orgId}`)
  const users = await ensureUsers(supabase, orgId)
  const managerId = users.get('demo@memoria.nc')!
  const chefId = users.get('demo-chef@memoria.nc')!

  console.log('\n[reset]')
  await resetTenant(supabase, orgId, !yes)
  if (!yes) {
    console.log('\nDry-run terminé. Relancer avec --yes pour exécuter.')
    return
  }

  console.log('\n[seed]')

  // Équipe
  const team = await step('Équipe « Équipe Bâtiment 1 »', async () => {
    const { data, error } = await supabase.from('teams')
      .insert({ name: 'Équipe Bâtiment 1', color: '#0ea5e9', organization_id: orgId, created_by: managerId })
      .select('id').single()
    if (error) throw error
    await supabase.from('team_members').insert({ team_id: (data as { id: string }).id, user_id: chefId, joined_at: new Date().toISOString() })
    return (data as { id: string }).id
  })

  const c: Ctx = { supabase, orgId, managerId, chefId, teamId: team }

  // Un CLIENT par maître d'ouvrage (crédibilité NC) + un contrat de décor.
  const moa = await step('Clients (maîtres d’ouvrage NC)', async () => {
    const names = ['Petro Atiti SA', 'Province Sud', 'Ville de Nouméa', 'OPT-NC', 'CAFAT', 'Port autonome de la Nouvelle-Calédonie', 'SIC', 'Gouvernement de la Nouvelle-Calédonie']
    const out = new Map<string, string>()
    for (const n of names) out.set(n, await insertClient(c, n))
    return out
  })
  if (!moa) { console.error('Clients manquants — arrêt.'); process.exit(1) }

  await step('Contrat — Marché entretien bâtiments provinciaux 2026', async () => {
    const { error } = await supabase.from('contracts').insert({
      name: 'Marché entretien bâtiments provinciaux 2026', client_name: 'Province Sud',
      start_date: d(-180), created_by: managerId, organization_id: orgId, tender_id: null,
    })
    if (error) throw error
  })

  // ── Les chantiers (crédibles NC) ────────────────────────────────────────
  const petro = await step('Chantier — Petro Atiti · Reconstruction post-émeutes', () =>
    insertSite(c, moa.get('Petro Atiti SA')!, 'Petro Atiti — Reconstruction', 'Rivière-Salée, Nouméa',
      'Reconstruction après incendie de mai 2024 (émeutes). Désamiantage terminé en mars 2026, gros œuvre livré en mai. Second œuvre en cours.'))
  const centreAdmin = await step('Chantier — Centre Administratif (Province Sud)', () =>
    insertSite(c, moa.get('Province Sud')!, 'Réhabilitation Centre Administratif — Province Sud', 'Artillerie, Nouméa'))
  const ecole = await step('Chantier — École Vallée-des-Colons (Ville de Nouméa)', () =>
    insertSite(c, moa.get('Ville de Nouméa')!, 'École primaire Vallée-des-Colons', 'Vallée-des-Colons, Nouméa'))
  const opt = await step('Chantier — Centre technique OPT Ducos', () =>
    insertSite(c, moa.get('OPT-NC')!, 'Modernisation centre technique OPT — Ducos', 'Ducos, Nouméa'))
  const cafat = await step('Chantier — Agence CAFAT', () =>
    insertSite(c, moa.get('CAFAT')!, 'Aménagement agence CAFAT — Centre-ville', 'Rue de Verdun, Nouméa'))
  const port = await step('Chantier — Entrepôt Port Autonome', () =>
    insertSite(c, moa.get('Port autonome de la Nouvelle-Calédonie')!, 'Réhabilitation entrepôt — Port Autonome', 'Grand Quai, Nouméa'))
  await step('Chantier — Résidence SIC (calme)', () =>
    insertSite(c, moa.get('SIC')!, 'Réhabilitation résidence Magenta — SIC', 'Magenta, Nouméa'))
  await step('Chantier — Bâtiment Gouvernement NC (calme)', () =>
    insertSite(c, moa.get('Gouvernement de la Nouvelle-Calédonie')!, 'Rénovation bâtiment administratif — Gouvernement NC', 'Centre-ville, Nouméa'))

  if (!petro || !ecole || !opt || !cafat || !centreAdmin || !port) {
    console.error('\nChantiers essentiels manquants — arrêt.')
    process.exit(1)
  }

  // ══ PETRO ATITI — LE CHANTIER VITRINE ═════════════════════════════════
  // Réunion (J-17) → décisions → actions → intervention (J-10) → découverte →
  // visite de contrôle (J-3) → réserve levée → CR → réunion (J-1) → prochaine (J+3).

  const petroR1 = await step('Petro — Réunion de coordination (J-17)', () =>
    insertReport(c, {
      siteId: petro, title: 'Coordination reconstruction — second œuvre',
      createdAt: t(-17, '08:00'),
      text: 'Coordination reconstruction Petro Atiti. Les zones incendiées sont sécurisées. Décisions : lancer les faux plafonds secteur B, commander les menuiseries extérieures, programmer le contrôle incendie, préparer la réception partielle de septembre.',
    }))

  const petroMission = await step('Petro — Mission « Second œuvre — faux plafonds »', () =>
    insertMission(c, petro, 'Second œuvre — faux plafonds secteur B', 'on_demand'))

  let petroIntv: string | null = null
  if (petroMission) {
    petroIntv = await step('Petro — Intervention terminée (J-10) + checklist + photos + découverte', async () => {
      const intv = await insertIntervention(c, {
        missionId: petroMission, day: d(-10), slot: 'morning', status: 'completed', executedAt: t(-10, '15:30'),
      })
      await insertChecklist(c, intv, [
        { label: 'Pose des rails secteur B', done: true },
        { label: 'Pose des dalles de faux plafond', done: true },
        { label: 'Vérification des réservations CVC', done: true },
      ])
      await insertPhoto(c, intv, 'Faux plafonds secteur B — avant', 'before', t(-10, '07:30'), '#7c6f5a')
      await insertPhoto(c, intv, 'Faux plafonds secteur B — après', 'after', t(-10, '15:00'), '#4a7a5c')
      const { error } = await supabase.from('intervention_anomalies').insert({
        intervention_id: intv, category: 'autre', category_other: 'Infiltration',
        description: 'Infiltration détectée sous le chéneau nord pendant la pose — zone à reprendre avant fermeture du plafond.',
        reported_by: chefId,
      })
      if (error) throw error
      return intv
    })
  }

  // Le CASTING : sans entreprise ni contact, aucune action n'a de responsable
  // structurel, donc la fiche Intervenant n'a rien à montrer et le parcours
  // Intervenant → Action n'existe pas.
  const petroContact = await step('Petro — Casting (entreprise + conducteur de travaux)', async () => {
    const company = await insertCompany(c, 'Clim Austral', 'Clim Austral')
    const contact = await insertContact(c, {
      companyId: company, fullName: 'Joseph Wamytan',
      fonction: 'Conducteur de travaux', isMain: true,
    })
    await insertIntervenant(c, { siteId: petro, role: 'ETV', companyId: company, mainContactId: contact })
    return contact
  })

  const petroActions = petroR1
    ? await step('Petro — Actions issues de la réunion (2 avec responsable)', async () => {
        const a1 = await insertAction(c, { siteId: petro, title: 'Vérifier les réservations CVC secteur B', createdAt: t(-17, '09:00'), reportId: petroR1, status: 'planned', convertedType: petroMission ? 'mission' : null, convertedId: petroMission })
        // a2 : PORTE le responsable ET reste SANS décision liée → c'est le cas
        // « Action sans Décision » du scénario de recette.
        const a2 = await insertAction(c, { siteId: petro, title: 'Contrôler les alimentations électriques provisoires', createdAt: t(-17, '09:00'), reportId: petroR1, dueDate: d(2), corpsEtat: 'Électricité', assignedContactId: petroContact, assignedToName: petroContact ? 'Joseph Wamytan' : null })
        const a3 = await insertAction(c, { siteId: petro, title: 'Valider les portes coupe-feu avec le bureau de contrôle', createdAt: t(-17, '09:00'), reportId: petroR1, dueDate: d(5), corpsEtat: 'Menuiserie' })
        // Deux actions pour le même responsable → la fiche Intervenant affiche une
        // LISTE « Actions à suivre » (et non le chapô à engagement unique).
        const a4 = await insertAction(c, { siteId: petro, title: 'Organiser la visite sécurité avec la Province', createdAt: t(-17, '09:00'), reportId: petroR1, lastProgressAt: t(-1, '16:00'), assignedContactId: petroContact, assignedToName: petroContact ? 'Joseph Wamytan' : null })
        return [a1, a2, a3, a4]
      })
    : null

  // Les décisions viennent APRÈS les actions, car chacune porte sa conséquence
  // (action_id). Sans ce lien, la chaîne Réunion → Décision → Action n'existe
  // ni dans les fils causals ni dans le chapô : la mémoire paraît incomplète.
  if (petroR1 && petroActions) {
    await step('Petro — 4 décisions de réunion (3 reliées à leur action)', async () => {
      const [a1, , a3, a4] = petroActions
      await insertDecision(c, { siteId: petro, titre: 'Lancer les faux plafonds secteur B', reportId: petroR1, dateDecision: d(-17), actionId: a1 })
      await insertDecision(c, { siteId: petro, titre: 'Commander les menuiseries extérieures', reportId: petroR1, dateDecision: d(-17), actionId: a3 })
      await insertDecision(c, { siteId: petro, titre: 'Programmer le contrôle incendie', reportId: petroR1, dateDecision: d(-17), actionId: a4 })
      // Volontairement SANS action liée : la fiche Décision doit aussi savoir dire
      // « aucune action liée à cette décision ». L'état vide fait partie du produit,
      // et la démo doit l'exposer plutôt que de le cacher.
      await insertDecision(c, { siteId: petro, titre: 'Préparer la réception partielle', reportId: petroR1, dateDecision: d(-17) })
    })
  }

  await step('Petro — Réserves (1 levée, 1 ouverte)', async () => {
    await insertReserve(c, {
      siteId: petro, label: 'Infiltration chéneau nord', location: 'Toiture secteur B',
      issuedOn: d(-10), status: 'lifted', liftedAt: t(-1, '10:00'),
      liftNote: 'Reprise d’étanchéité réalisée et contrôlée en visite — plus aucune trace d’humidité.',
    })
    await insertReserve(c, {
      siteId: petro, label: 'Signalétique incendie incomplète', location: 'Circulations RDC',
      issuedOn: d(-3),
    })
  })

  const petroVisit = await step('Petro — Visite de contrôle (J-3) + captures GPS + À vérifier', async () => {
    const v = await insertReport(c, {
      siteId: petro, title: 'Contrôle d’avancement reconstruction',
      createdAt: t(-3, '09:00'), origin: 'spontaneous', status: 'curated',
      text: 'Visite de contrôle : faux plafonds conformes, reprise d’étanchéité efficace, signalétique incendie à compléter.',
    })
    await insertCapture(c, { reportId: v, siteId: petro, kind: 'note', body: 'Faux plafonds secteur B conformes — alignement et réservations OK.', lat: -22.2495, lng: 166.4402, createdAt: t(-3, '09:20') })
    await insertCapture(c, { reportId: v, siteId: petro, kind: 'note', body: 'Reprise étanchéité chéneau nord : sec, plus aucune trace d’infiltration.', lat: -22.2493, lng: 166.4405, createdAt: t(-3, '09:40') })
    await insertCapture(c, { reportId: v, siteId: petro, kind: 'note', body: 'À vérifier : signalétique PMR manquante dans la circulation est — qui la fournit ?', lat: -22.2497, lng: 166.4401, createdAt: t(-3, '10:05') })
    await insertWatch(c, { reportId: v, siteId: petro, label: 'Constater sur place : Infiltration chéneau nord', position: 0, state: 'verified', sourceKind: 'reserve_open' })
    await insertWatch(c, { reportId: v, siteId: petro, label: 'Conformité des faux plafonds secteur B', position: 1, state: 'verified', sourceKind: 'manual' })
    await insertWatch(c, { reportId: v, siteId: petro, label: 'Évacuations incendie dégagées', position: 2, state: 'verified', sourceKind: 'manual' })
    await insertWatch(c, { reportId: v, siteId: petro, label: 'Signalétique PMR posée', position: 3, state: 'to_follow', sourceKind: 'manual' })
    return v
  })
  void petroVisit

  await step('Petro — Réunion de suivi (J-1) + PROCHAINE RÉUNION (J+3)', () =>
    insertReport(c, {
      siteId: petro, title: 'Suivi reconstruction — préparation réception partielle',
      createdAt: t(-1, '14:00'), nextMeeting: d(3),
      text: 'Les travaux progressent conformément au planning général. Les zones incendiées sont entièrement sécurisées. Réserve d’étanchéité levée. Restent les finitions et la signalétique incendie avant réception partielle.',
    }))
  void petroActions

  // ══ CENTRE ADMINISTRATIF — réunion + réserves + prochaine réunion ══════
  const caR = await step('Centre Admin — Réunion (J-2) + prochaine réunion (J+2)', () =>
    insertReport(c, {
      siteId: centreAdmin, title: 'Réunion de chantier hebdomadaire',
      createdAt: t(-2, '08:00'), nextMeeting: d(2),
      text: 'Avancement cloisons niveau 2. Deux réserves ouvertes sur les menuiseries intérieures. Livraison des luminaires attendue.',
    }))
  await step('Centre Admin — 2 réserves ouvertes + actions', async () => {
    await insertReserve(c, { siteId: centreAdmin, label: 'Porte niveau 2 voilée', location: 'Niveau 2 — aile est', issuedOn: d(-2) })
    await insertReserve(c, { siteId: centreAdmin, label: 'Plinthe décollée circulation', location: 'Niveau 1', issuedOn: d(-2) })
    if (caR) {
      await insertAction(c, { siteId: centreAdmin, title: 'Relancer le menuisier pour la porte voilée', createdAt: t(-2, '09:00'), reportId: caR, dueDate: d(0) })
      await insertAction(c, { siteId: centreAdmin, title: 'Réceptionner la livraison des luminaires', createdAt: t(-2, '09:00'), reportId: caR, dueDate: d(1) })
    }
  })

  // ══ ÉCOLE — mission récurrente + intervention AUJOURD'HUI ═══════════════
  const ecoleMission = await step('École — Mission récurrente « Entretien hebdomadaire »', () =>
    insertMission(c, ecole, 'Entretien hebdomadaire des locaux', 'weekly'))
  if (ecoleMission) {
    await step('École — Historique (2 terminées) + intervention du jour', async () => {
      for (const off of [-14, -7]) {
        const i = await insertIntervention(c, { missionId: ecoleMission, day: d(off), slot: 'morning', status: 'completed', executedAt: t(off, '11:00') })
        await insertChecklist(c, i, [
          { label: 'Nettoyage des salles de classe', done: true },
          { label: 'Vérification des sanitaires', done: true },
          { label: 'Contrôle de la cour et des préaux', done: true },
        ])
        await insertPhoto(c, i, 'Entretien école — passage validé', 'after', t(off, '10:45'), '#4a7a5c')
      }
      const today = await insertIntervention(c, { missionId: ecoleMission, day: d(0), slot: 'morning', status: 'planned' })
      await insertChecklist(c, today, [
        { label: 'Nettoyage des salles de classe', done: false },
        { label: 'Vérification des sanitaires', done: false },
        { label: 'Contrôle de la cour et des préaux', done: false },
      ])
    })
  }

  // ══ OPT DUCOS — visite HIER avec CR complet ═════════════════════════════
  await step('OPT Ducos — Visite (J-1) : captures GPS + à vérifier + CR', async () => {
    const v = await insertReport(c, {
      siteId: opt, title: 'Visite d’avancement — modernisation',
      createdAt: t(-1, '10:00'), origin: 'spontaneous', status: 'curated',
      text: 'Chemins de câbles posés au niveau 1. Local onduleurs prêt pour réception. Attention : stockage de matériel dans la circulation sud à faire évacuer.',
    })
    await insertCapture(c, { reportId: v, siteId: opt, kind: 'note', body: 'Chemins de câbles niveau 1 posés — conformes au plan.', lat: -22.2405, lng: 166.4288, createdAt: t(-1, '10:15') })
    await insertCapture(c, { reportId: v, siteId: opt, kind: 'note', body: 'Local onduleurs : peinture terminée, prêt pour réception.', lat: -22.2407, lng: 166.4291, createdAt: t(-1, '10:30') })
    await insertCapture(c, { reportId: v, siteId: opt, kind: 'note', body: 'À vérifier : stockage matériel dans la circulation sud — à évacuer avant le passage sécurité ?', lat: -22.2404, lng: 166.4293, createdAt: t(-1, '10:50') })
    await insertWatch(c, { reportId: v, siteId: opt, label: 'Réception du local onduleurs', position: 0, state: 'to_follow', sourceKind: 'manual' })
    await insertAction(c, { siteId: opt, title: 'Faire évacuer le stockage de la circulation sud', createdAt: t(-1, '11:30'), reportId: v, dueDate: d(1) })
  })

  // ══ CAFAT — actions qui réclament (accueil) ═════════════════════════════
  await step('CAFAT — action en retard + échéance aujourd’hui', async () => {
    await insertAction(c, { siteId: cafat, title: 'Transmettre le planning d’aménagement au client', createdAt: t(-9, '09:00'), dueDate: d(-2) })
    await insertAction(c, { siteId: cafat, title: 'Valider les coloris avec l’architecte', createdAt: t(-6, '09:00'), dueDate: d(0) })
  })

  // ══ PORT AUTONOME — suivi qui décroche (accueil orange) ═════════════════
  await step('Port Autonome — suivi sans avancée depuis 8 j', () =>
    insertAction(c, { siteId: port, title: 'Suivre le devis de reprise du bardage', createdAt: t(-20, '09:00'), lastProgressAt: t(-8, '09:00') }))

  // ══ LE SCÉNARIO DE RECETTE EST GARANTI PAR LA DÉMO ELLE-MÊME ═════════════
  // La démo n'est pas un décor : c'est le jeu de données fonctionnel. Si l'un de
  // ces quatre cas disparaît, le parcours correspondant devient intestable — et
  // dans six mois personne ne saurait pourquoi. Le seed le dit tout de suite.
  await step('Vérification du GRAPHE de recette (Petro Atiti)', async () => {
    const { data: decs } = await supabase.from('site_decisions').select('titre, action_id').eq('site_id', petro)
    const { data: acts } = await supabase.from('site_actions').select('id, title, assigned_contact_id').eq('site_id', petro)
    const { data: cast } = await supabase.from('site_intervenants').select('main_contact_id').eq('site_id', petro)
    const decisions = (decs ?? []) as Array<{ titre: string; action_id: string | null }>
    const actions = (acts ?? []) as Array<{ id: string; title: string; assigned_contact_id: string | null }>
    const casting = (cast ?? []) as Array<{ main_contact_id: string | null }>

    // On ne compte pas des lignes : on PARCOURT le graphe, comme le fera l'utilisateur.
    const actionsDuSite = new Set(actions.map((a) => a.id))
    const liees = new Set(decisions.map((x) => x.action_id).filter((v): v is string => !!v))
    const decLiees = decisions.filter((d) => d.action_id)
    // Le lien doit RÉSOUDRE, et vers une action du MÊME chantier (jamais d'orphelin
    // ni de fuite inter-chantiers).
    const decResolues = decLiees.filter((d) => actionsDuSite.has(d.action_id!))

    // Chaîne Action → contact → casting : c'est elle qui rend la fiche Intervenant
    // navigable. Un contact supprimé, ou hors casting, casse le parcours.
    const assignees = actions.filter((a) => a.assigned_contact_id)
    const contactIds = [...new Set(assignees.map((a) => a.assigned_contact_id!))]
    const { data: cts } = contactIds.length
      ? await supabase.from('company_contacts').select('id').in('id', contactIds)
      : { data: [] as Array<{ id: string }> }
    const contactsExistants = new Set(((cts ?? []) as Array<{ id: string }>).map((x) => x.id))
    const castingContacts = new Set(casting.map((x) => x.main_contact_id).filter((v): v is string => !!v))

    const cas: Array<[string, boolean]> = [
      ['Décision → Action : le lien résout vers une action du MÊME chantier', decResolues.length >= 1],
      ['aucun lien Décision → Action orphelin', decLiees.length === decResolues.length],
      ['une Décision SANS Action liée (état vide honnête)', decisions.some((x) => !x.action_id)],
      ['une Action SANS Décision liée (chapô absent)', actions.some((a) => !liees.has(a.id))],
      ['Action → responsable : le contact assigné EXISTE', assignees.length >= 1 && assignees.every((a) => contactsExistants.has(a.assigned_contact_id!))],
      ['responsable → casting : ce contact est main_contact du chantier', assignees.some((a) => castingContacts.has(a.assigned_contact_id!))],
    ]
    const manquants = cas.filter(([, ok]) => !ok).map(([nom]) => nom)
    for (const [nom, ok] of cas) console.log(`      ${ok ? '✓' : '✗'} ${nom}`)
    if (manquants.length > 0) {
      throw new Error(`Graphe de recette incomplet — ${manquants.length} rupture(s) : ${manquants.join(' · ')}`)
    }
  })

  console.log(`\n=== Terminé ${stepFailures > 0 ? `avec ${stepFailures} échec(s) — voir ✗ ci-dessus` : 'sans échec'} ===`)
  console.log(`\nConnexion démo : demo@memoria.nc / ${DEMO_PASSWORD}`)
  console.log('Relancer ce script = reset complet du tenant démo + re-seed identique (dates recalées sur aujourd’hui).')
  if (stepFailures > 0) process.exit(2)
}

main().catch((e) => { console.error(e); process.exit(1) })
