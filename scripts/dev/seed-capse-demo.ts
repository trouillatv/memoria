/**
 * scripts/dev/seed-capse-demo.ts
 *
 * TENANT DE DÉMONSTRATION CAPSE NC — Bureau d'études HSE/audit/inspection.
 *
 * Règle impérative : données isolées dans l'organisation « CAPSE NC ».
 * Aucune donnée n'est écrite dans un autre tenant.
 * Relançable à volonté : reset complet du tenant CAPSE puis recréation
 * À L'IDENTIQUE (dates relatives au jour d'exécution).
 *
 * Scénario : mission d'inspection HSE sur site industriel Ducos, Nouméa.
 * 4 inspections passées · 14 constats/actions · 5 capsules sécurité ·
 * 3 événements futurs · casting HSE complet.
 *
 * USAGE
 *   Dry-run  : npx tsx scripts/dev/seed-capse-demo.ts --confirm-reset-on=<frag-url>
 *   Exécuter : npx tsx scripts/dev/seed-capse-demo.ts --confirm-reset-on=<frag-url> --yes
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
// Constantes du tenant CAPSE
// ============================================================================

const CAPSE_ORG_NAME = 'CAPSE NC'
const CAPSE_PASSWORD = 'capse-memoria-2026!'
const CAPSE_ACCOUNTS = [
  { email: 'capse@memoria.nc', fullName: 'Marie-Laure Fontaine', role: 'manager' },
  { email: 'capse-chef@memoria.nc', fullName: 'Henri Nommay', role: 'chef_equipe' },
] as const

// Jour civil Nouméa (+11, pas de DST) décalé de `off` jours.
function d(off: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Noumea', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(Date.now() + off * 86_400_000))
}
function t(off: number, hhmm: string): string {
  return `${d(off)}T${hhmm}:00+11:00`
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
  const { data: existing } = await supabase.from('organizations').select('id').eq('name', CAPSE_ORG_NAME).maybeSingle()
  if (existing) return (existing as { id: string }).id
  const { data, error } = await supabase.from('organizations').insert({ name: CAPSE_ORG_NAME }).select('id').single()
  if (error) throw error
  return (data as { id: string }).id
}

async function ensureUsers(supabase: Admin, orgId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const { data: existing } = await supabase.auth.admin.listUsers()
  const byEmail = new Map(existing?.users?.map((u) => [u.email, u]) ?? [])
  for (const acc of CAPSE_ACCOUNTS) {
    let userId: string
    const found = byEmail.get(acc.email)
    if (found) {
      userId = (found as { id: string }).id
      await supabase.auth.admin.updateUserById(userId, { password: CAPSE_PASSWORD })
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email: acc.email, password: CAPSE_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: acc.fullName, role: acc.role },
      })
      if (error) throw error
      userId = data.user!.id
    }
    await supabase
      .from('users')
      .update({ role: acc.role, full_name: acc.fullName, must_change_password: false, organization_id: orgId })
      .eq('id', userId)
    out.set(acc.email, userId)
    console.log(`  ✓ ${acc.email} (${acc.role})`)
  }
  return out
}

// ============================================================================
// RESET — scopé au tenant CAPSE UNIQUEMENT
// ============================================================================

async function resetTenant(supabase: Admin, orgId: string, dryRun: boolean) {
  const tables = ['sites', 'contracts', 'clients', 'teams', 'tenders', 'companies']
  for (const table of tables) {
    const { count } = await supabase.from(table).select('id', { count: 'exact', head: true }).eq('organization_id', orgId)
    console.log(`  [reset] ${table}: ${count ?? 0} ligne(s)${dryRun ? ' (dry-run)' : ''}`)
    if (!dryRun && (count ?? 0) > 0) {
      const { error } = await supabase.from(table).delete().eq('organization_id', orgId)
      if (error) console.error(`    ✗ ${table}: ${error.message}`)
    }
  }
}

// ============================================================================
// Helpers d'insertion
// ============================================================================

interface Ctx {
  supabase: Admin
  orgId: string
  managerId: string
  chefId: string
}

async function insertClient(c: Ctx, name: string): Promise<string> {
  const { data, error } = await c.supabase
    .from('clients').insert({ name, organization_id: c.orgId }).select('id').single()
  if (error) throw error
  return (data as { id: string }).id
}

async function insertSite(c: Ctx, clientId: string, name: string, address: string, notes?: string): Promise<string> {
  const base = {
    client_id: clientId, contract_id: null, name, address, notes: notes ?? null,
    phase: 'actif', organization_id: c.orgId,
  }
  const { data, error } = await c.supabase.from('sites').insert({ ...base, tenant_id: c.orgId }).select('id').single()
  if (error) {
    const { data: d2, error: e2 } = await c.supabase.from('sites').insert(base).select('id').single()
    if (e2) throw e2
    return (d2 as { id: string }).id
  }
  return (data as { id: string }).id
}

async function insertInspection(c: Ctx, input: {
  siteId: string; title: string; createdAt: string; text: string; status?: string
}): Promise<string> {
  const { data, error } = await c.supabase
    .from('site_reports')
    .insert({
      type: 'site', site_id: input.siteId, tenant_id: c.orgId, organization_id: c.orgId,
      created_by: c.managerId, status: input.status ?? 'curated', title: input.title,
      text_input: input.text, transcript_status: 'none',
      origin: 'planned',
      created_at: input.createdAt,
    })
    .select('id').single()
  if (error) throw error
  return (data as { id: string }).id
}

async function insertAction(c: Ctx, input: {
  siteId: string; title: string; createdAt: string; reportId?: string | null
  status?: string; dueDate?: string | null; lastProgressAt?: string | null
  corpsEtat?: string | null; doneAt?: string | null
  assignedContactId?: string | null; assignedToName?: string | null
}): Promise<string> {
  const { data, error } = await c.supabase
    .from('site_actions')
    .insert({
      site_id: input.siteId, title: input.title,
      status: input.status ?? 'open', created_by: c.managerId, created_at: input.createdAt,
      report_id: input.reportId ?? null, due_date: input.dueDate ?? null,
      last_progress_at: input.lastProgressAt ?? null, corps_etat: input.corpsEtat ?? null,
      done_at: input.doneAt ?? null,
      assigned_contact_id: input.assignedContactId ?? null,
      assigned_to: input.assignedToName ?? null,
    })
    .select('id').single()
  if (error) throw error
  return (data as { id: string }).id
}

async function insertCapture(c: Ctx, input: {
  reportId: string; siteId: string; kind: string; body: string; lat: number; lng: number; createdAt: string
}) {
  const { error } = await c.supabase.from('visit_capture').insert({
    report_id: input.reportId, site_id: input.siteId, organization_id: c.orgId,
    kind: input.kind, body: input.body, lat: input.lat, lng: input.lng,
    created_at: input.createdAt,
  })
  if (error) throw error
}

async function insertWatch(c: Ctx, input: {
  reportId: string; siteId: string; label: string; position: number; state: string; sourceKind: string
}) {
  const { error } = await c.supabase.from('visit_watchlist_item').insert({
    report_id: input.reportId, site_id: input.siteId, organization_id: c.orgId,
    label: input.label, position: input.position, state: input.state,
    source_kind: input.sourceKind, created_by: c.managerId,
  })
  if (error) throw error
}

async function insertReserve(c: Ctx, input: {
  siteId: string; label: string; location: string; issuedOn: string
  status?: 'open' | 'lifted'; liftedAt?: string | null; liftNote?: string | null
}) {
  const { error } = await c.supabase.from('site_reserve').insert({
    site_id: input.siteId, organization_id: c.orgId, label: input.label,
    location: input.location, issued_by: 'CAPSE NC', issued_on: input.issuedOn,
    status: input.status ?? 'open', created_by: c.managerId,
    lifted_at: input.liftedAt ?? null, lift_note: input.liftNote ?? null,
    updated_at: new Date().toISOString(),
  })
  if (error) throw error
}

async function insertNote(c: Ctx, siteId: string, body: string, kind: 'note' | 'a_savoir' = 'a_savoir') {
  const { error } = await c.supabase.from('site_notes').insert({
    site_id: siteId, body, kind, created_by: c.managerId,
  })
  if (error) throw error
}

async function insertDecision(c: Ctx, input: {
  siteId: string; titre: string; reportId: string; dateDecision: string
  description?: string; actionId?: string | null; decisionnaireContactId?: string | null
}) {
  const { error } = await c.supabase.from('site_decisions').insert({
    site_id: input.siteId, titre: input.titre,
    description: input.description ?? null, report_id: input.reportId,
    date_decision: input.dateDecision, created_by: c.managerId,
    action_id: input.actionId ?? null,
    decisionnaire_contact_id: input.decisionnaireContactId ?? null,
  })
  if (error) throw error
}

async function insertCompany(c: Ctx, name: string, shortName?: string): Promise<string> {
  const { data, error } = await c.supabase.from('companies')
    .insert({ organization_id: c.orgId, name, short_name: shortName ?? null })
    .select('id').single()
  if (error) throw error
  return (data as { id: string }).id
}

async function insertContact(c: Ctx, input: {
  companyId: string; fullName: string; fonction?: string; isMain?: boolean; phone?: string | null
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

async function insertScheduledEvent(c: Ctx, input: {
  siteId: string; type: string; title: string; plannedStart: string; plannedEnd?: string | null
  payload?: Record<string, unknown>; createdFrom?: string
}) {
  const { error } = await c.supabase.from('site_scheduled_events').insert({
    organization_id: c.orgId, site_id: input.siteId,
    type: input.type, title: input.title,
    planned_start: input.plannedStart, planned_end: input.plannedEnd ?? null,
    payload: JSON.stringify(input.payload ?? {}),
    created_from: input.createdFrom ?? 'manual',
    status: 'planned', created_by: c.managerId,
  })
  if (error) throw error
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const supabase = createAdminClient()
  console.log(`\n=== Tenant de démonstration « ${CAPSE_ORG_NAME} » ===\n`)

  const orgId = await ensureOrg(supabase)
  console.log(`  ✓ Organisation : ${orgId}`)
  const users = await ensureUsers(supabase, orgId)
  const managerId = users.get('capse@memoria.nc')!
  const chefId = users.get('capse-chef@memoria.nc')!

  console.log('\n[reset]')
  await resetTenant(supabase, orgId, !yes)
  if (!yes) {
    console.log('\nDry-run terminé. Relancer avec --yes pour exécuter.')
    return
  }

  console.log('\n[seed]')

  const c: Ctx = { supabase, orgId, managerId, chefId }

  // ── CLIENTS ─────────────────────────────────────────────────────────────
  const clients = await step('Clients', async () => {
    const map = new Map<string, string>()
    const names = [
      'Pacifique Industrie Services',
      'Société Pétrolière de Nouvelle-Calédonie',
      'NC Fret',
      'Enercal',
    ]
    for (const n of names) map.set(n, await insertClient(c, n))
    return map
  })
  if (!clients) { console.error('Clients manquants — arrêt.'); process.exit(1) }

  // ── SITES ────────────────────────────────────────────────────────────────
  const ducos = await step('Site vitrine — Atelier industriel Ducos (Pacifique Industrie)', () =>
    insertSite(c, clients.get('Pacifique Industrie Services')!,
      'Atelier industriel — Zone Ducos',
      'Zone industrielle de Ducos, Nouméa',
      'Atelier de fabrication et maintenance industrielle. Zone à risques multiples : chimique (solvants bâtiment C), électrique (HTA), mécanique (presses secteur A). Effectif : 47 personnes. CAPSE NC mandaté pour suivi HSE trimestriel.'))

  const depot = await step('Site — Dépôt carburant Port Autonome (SPNC)', () =>
    insertSite(c, clients.get('Société Pétrolière de Nouvelle-Calédonie')!,
      'Dépôt carburant — Port Autonome',
      'Grand Quai, Port Autonome de la Nouvelle-Calédonie',
      'Dépôt de stockage hydrocarbures. ICPE soumise à autorisation. Dernier audit annuel CAPSE : à planifier avant 31/12/2026.'))

  const fret = await step('Site — Entrepôt logistique Dumbéa (NC Fret)', () =>
    insertSite(c, clients.get('NC Fret')!,
      'Entrepôt logistique — Dumbéa sur Mer',
      'Zone commerciale Katiramona, Dumbéa',
      'Entrepôt de transit. Flux quotidien élevé (chariots élévateurs). Mission CAPSE : inspection trimestrielle + formation CACES.'))

  const centrale = await step('Site — Centrale Prony (Enercal)', () =>
    insertSite(c, clients.get('Enercal')!,
      'Centrale hydroélectrique de Yaté',
      'Prony, Province Sud',
      'Centrale hydroélectrique. Habilitations électriques requises. Inspection annuelle programmée.'))

  if (!ducos || !depot || !fret) {
    console.error('Sites essentiels manquants — arrêt.')
    process.exit(1)
  }

  // ══ ATELIER DUCOS — LE SITE VITRINE ══════════════════════════════════════
  // 4 inspections (J-90 → J-7) · 14 constats/actions · 5 capsules sécurité ·
  // 3 événements futurs · casting HSE complet.

  // ── CASTING ──────────────────────────────────────────────────────────────
  const casting = await step('Casting HSE — Pacifique Industrie + APAVE + bureau CHSCT', async () => {
    const pisCo = await insertCompany(c, 'Pacifique Industrie Services', 'PIS')
    const apaveCo = await insertCompany(c, 'APAVE Pacifique', 'APAVE')
    const chsstCo = await insertCompany(c, 'CHSCT PIS', 'CHSCT')

    const chauvin = await insertContact(c, {
      companyId: pisCo, fullName: 'Jean-Pierre Chauvin',
      fonction: 'Directeur HSE', isMain: true,
    })
    const wenehoua = await insertContact(c, {
      companyId: pisCo, fullName: 'Élodie Wénéhoua',
      fonction: 'Responsable sécurité', isMain: false,
    })
    const tjiou = await insertContact(c, {
      companyId: apaveCo, fullName: 'Maurice Tjiou',
      fonction: 'Inspecteur certifié', isMain: true,
    })
    const hnandoye = await insertContact(c, {
      companyId: chsstCo, fullName: 'Thomas Hnandoye',
      fonction: 'Représentant CHSCT', isMain: true,
    })

    await insertIntervenant(c, { siteId: ducos, role: 'Directeur HSE', companyId: pisCo, mainContactId: chauvin })
    await insertIntervenant(c, { siteId: ducos, role: 'Responsable sécurité', companyId: pisCo, mainContactId: wenehoua })
    await insertIntervenant(c, { siteId: ducos, role: 'Bureau de contrôle', companyId: apaveCo, mainContactId: tjiou })
    await insertIntervenant(c, { siteId: ducos, role: 'CHSCT', companyId: chsstCo, mainContactId: hnandoye })

    return { chauvin, wenehoua, tjiou, hnandoye }
  })

  // ── INSPECTION 1 — Audit initial (J-90) ──────────────────────────────────
  const insp1 = await step('Inspection 1 — Audit HSE initial (J-90)', () =>
    insertInspection(c, {
      siteId: ducos,
      title: 'Audit HSE initial — état des lieux',
      createdAt: t(-90, '08:30'),
      text: `Première visite d'inspection CAPSE NC. État des lieux complet. Constats critiques identifiés : extincteurs périmés bâtiment A (3 appareils), plan d'évacuation absent RDC, zone stockage solvants (bâtiment C) non balisée, EPI de manutention hors normes. Formation sécurité du personnel à programmer de toute urgence. Douches de sécurité secteur C absentes — réglementairement obligatoires pour zone chimique. Document unique d'évaluation des risques (DUERP) datant de 2022 — mise à jour obligatoire.`,
    }))

  const actions1 = insp1
    ? await step("Actions issues de l'inspection initiale (6 constats)", async () => {
        const a1 = await insertAction(c, {
          siteId: ducos, title: 'Remplacer les 3 extincteurs périmés — bâtiment A',
          createdAt: t(-90, '10:00'), reportId: insp1, status: 'done',
          dueDate: d(-75), doneAt: t(-72, '14:00'),
          corpsEtat: 'Sécurité incendie',
          assignedContactId: casting?.wenehoua ?? null,
          assignedToName: 'Élodie Wénéhoua',
        })
        const a2 = await insertAction(c, {
          siteId: ducos, title: "Afficher le plan d'évacuation RDC et niveaux supérieurs",
          createdAt: t(-90, '10:00'), reportId: insp1, status: 'done',
          dueDate: d(-80), doneAt: t(-78, '11:00'),
          corpsEtat: 'Sécurité incendie',
        })
        const a3 = await insertAction(c, {
          siteId: ducos, title: 'Baliser la zone à risque chimique — secteur C stockage solvants',
          createdAt: t(-90, '10:00'), reportId: insp1, status: 'done',
          dueDate: d(-75), doneAt: t(-70, '09:00'),
          corpsEtat: 'Prévention des risques',
          assignedContactId: casting?.wenehoua ?? null,
          assignedToName: 'Élodie Wénéhoua',
        })
        const a4 = await insertAction(c, {
          siteId: ducos, title: 'Former les manutentionnaires à la sécurité gestes et postures (8 pers.)',
          createdAt: t(-90, '10:00'), reportId: insp1, status: 'planned',
          dueDate: d(-15), lastProgressAt: t(-20, '16:00'),
          corpsEtat: 'Formation sécurité',
          assignedContactId: casting?.chauvin ?? null,
          assignedToName: 'Jean-Pierre Chauvin',
        })
        const a5 = await insertAction(c, {
          siteId: ducos, title: 'Installer les douches de sécurité secteur C (réglementation ICPE)',
          createdAt: t(-90, '10:00'), reportId: insp1, status: 'open',
          dueDate: d(10),
          corpsEtat: 'Équipements de sécurité',
          assignedContactId: casting?.chauvin ?? null,
          assignedToName: 'Jean-Pierre Chauvin',
        })
        const a6 = await insertAction(c, {
          siteId: ducos, title: "Mettre à jour le Document Unique d'Évaluation des Risques (DUERP)",
          createdAt: t(-90, '10:00'), reportId: insp1, status: 'open',
          dueDate: d(30),
          corpsEtat: 'Documentation réglementaire',
          assignedContactId: casting?.chauvin ?? null,
          assignedToName: 'Jean-Pierre Chauvin',
        })
        return [a1, a2, a3, a4, a5, a6]
      })
    : null

  // Décisions issues de l'inspection initiale
  if (insp1 && actions1 && casting) {
    await step('Décisions — Audit initial (3 décisions)', async () => {
      const [a1, , , a4, a5, a6] = actions1
      await insertDecision(c, {
        siteId: ducos, titre: 'Remplacement immédiat des extincteurs périmés',
        reportId: insp1, dateDecision: d(-90), actionId: a1,
        decisionnaireContactId: casting.chauvin,
        description: 'Constat critique — réglementairement obligatoire',
      })
      await insertDecision(c, {
        siteId: ducos, titre: 'Lancement du plan de formation sécurité 2026',
        reportId: insp1, dateDecision: d(-90), actionId: a4,
        decisionnaireContactId: casting.chauvin,
      })
      await insertDecision(c, {
        siteId: ducos, titre: 'Installation des douches de sécurité secteur C',
        reportId: insp1, dateDecision: d(-90), actionId: a5,
        description: 'Mise en conformité ICPE — délai maximum 3 mois',
      })
      // Décision sans action liée (état vide honnête)
      await insertDecision(c, {
        siteId: ducos, titre: "Révision du DUERP avec l'équipe CHSCT",
        reportId: insp1, dateDecision: d(-90), actionId: a6,
        decisionnaireContactId: casting.hnandoye,
      })
    })
  }

  // ── INSPECTION 2 — Incendie + EPI (J-60) ─────────────────────────────────
  const insp2 = await step('Inspection 2 — Incendie et EPI (J-60)', () =>
    insertInspection(c, {
      siteId: ducos,
      title: 'Inspection incendie et équipements de protection individuelle',
      createdAt: t(-60, '09:00'),
      text: `Inspection thématique incendie et EPI. Points positifs : extincteurs remplacés, plan d'évacuation affiché. Points à corriger : EPI de soudure hors norme (3 masques à remplacer), issues de secours côté est obstruées par du matériel de stockage temporaire. Détecteurs incendie bâtiment B non testés depuis 14 mois. Contrôle électrique annuel non planifié.`,
    }))

  const actions2 = insp2
    ? await step('Actions — Inspection incendie/EPI (4 constats)', async () => {
        const b1 = await insertAction(c, {
          siteId: ducos, title: 'Remplacer les 3 masques de soudure hors norme',
          createdAt: t(-60, '10:30'), reportId: insp2, status: 'done',
          dueDate: d(-50), doneAt: t(-48, '14:00'),
          corpsEtat: 'EPI',
          assignedContactId: casting?.wenehoua ?? null, assignedToName: 'Élodie Wénéhoua',
        })
        const b2 = await insertAction(c, {
          siteId: ducos, title: 'Dégager les issues de secours côté est — déplacer le stockage',
          createdAt: t(-60, '10:30'), reportId: insp2, status: 'done',
          dueDate: d(-55), doneAt: t(-53, '11:30'),
          corpsEtat: 'Sécurité incendie',
        })
        const b3 = await insertAction(c, {
          siteId: ducos, title: 'Tester et certifier les détecteurs incendie bâtiment B',
          createdAt: t(-60, '10:30'), reportId: insp2, status: 'planned',
          dueDate: d(-5), lastProgressAt: t(-10, '09:00'),
          corpsEtat: 'Sécurité incendie',
          assignedContactId: casting?.chauvin ?? null, assignedToName: 'Jean-Pierre Chauvin',
        })
        const b4 = await insertAction(c, {
          siteId: ducos, title: 'Planifier et réaliser le contrôle électrique annuel',
          createdAt: t(-60, '10:30'), reportId: insp2, status: 'open',
          dueDate: d(15),
          corpsEtat: 'Électricité HTA/BT',
          assignedContactId: casting?.chauvin ?? null, assignedToName: 'Jean-Pierre Chauvin',
        })
        return [b1, b2, b3, b4]
      })
    : null

  // ── INSPECTION 3 — Suivi plan d'actions (J-30) ───────────────────────────
  const insp3 = await step("Inspection 3 — Suivi plan d'actions (J-30)", () =>
    insertInspection(c, {
      siteId: ducos,
      title: "Inspection de suivi — avancement plan d'actions HSE",
      createdAt: t(-30, '09:00'),
      text: `Point d'avancement. 5 des 10 constats initiaux sont levés. Progrès significatifs sur la sécurité incendie. Nouveaux points : balisage de la route interne endommagé (marquage au sol effacé), registre de sécurité non à jour depuis octobre 2025. La formation manutention est planifiée mais pas encore réalisée.`,
    }))

  const actions3 = insp3
    ? await step('Actions — Inspection de suivi (2 nouveaux constats)', async () => {
        const c1 = await insertAction(c, {
          siteId: ducos, title: 'Refaire le marquage au sol de la route interne (balisage effacé)',
          createdAt: t(-30, '10:00'), reportId: insp3, status: 'planned',
          dueDate: d(-3), lastProgressAt: t(-5, '14:00'),
          corpsEtat: 'Signalisation',
        })
        const c2 = await insertAction(c, {
          siteId: ducos, title: 'Mettre à jour le registre de sécurité réglementaire (dernier : oct. 2025)',
          createdAt: t(-30, '10:00'), reportId: insp3, status: 'open',
          dueDate: d(7),
          corpsEtat: 'Documentation réglementaire',
          assignedContactId: casting?.wenehoua ?? null, assignedToName: 'Élodie Wénéhoua',
        })
        return [c1, c2]
      })
    : null

  void actions3

  // ── INSPECTION 4 — Contrôle (J-7) — LE PIVOT DE LA DÉMO ─────────────────
  const insp4 = await step('Inspection 4 — Contrôle avancement NC (J-7) + captures + watchlist', async () => {
    const v = await insertInspection(c, {
      siteId: ducos,
      title: 'Inspection de contrôle — levée des non-conformités critiques',
      createdAt: t(-7, '08:30'),
      text: `Contrôle ciblé sur les NC critiques. Extincteurs conformes, EPI remplacés, balisage secteur C en place. Réserve levée sur les issues de secours est. Douches de sécurité secteur C en cours d'installation — livraison matériel sous 10 jours. Formation manutention reprogrammée : session confirmée pour la semaine prochaine. Deux points restent ouverts : marquage route interne et registre de sécurité.`,
    })
    await insertCapture(c, {
      reportId: v, siteId: ducos, kind: 'note',
      body: 'Issues de secours côté est : dégagées, conformes. Réserve levée.',
      lat: -22.2380, lng: 166.4380, createdAt: t(-7, '09:00'),
    })
    await insertCapture(c, {
      reportId: v, siteId: ducos, kind: 'note',
      body: "Secteur C : balisage chimique conforme. Douches de securite en cours d'installation (livraison J+10).",
      lat: -22.2382, lng: 166.4375, createdAt: t(-7, '09:20'),
    })
    await insertCapture(c, {
      reportId: v, siteId: ducos, kind: 'note',
      body: 'Bâtiment B : test détecteurs incendie à confirmer — procès-verbal de test non encore remis.',
      lat: -22.2385, lng: 166.4385, createdAt: t(-7, '09:45'),
    })
    await insertCapture(c, {
      reportId: v, siteId: ducos, kind: 'note',
      body: 'Route interne : marquage au sol toujours effacé sur 40 m. Délai de reprise à reconfirmer.',
      lat: -22.2378, lng: 166.4390, createdAt: t(-7, '10:05'),
    })
    await insertWatch(c, { reportId: v, siteId: ducos, label: 'Issues de secours est — dégagées', position: 0, state: 'verified', sourceKind: 'reserve_open' })
    await insertWatch(c, { reportId: v, siteId: ducos, label: 'EPI de soudure — remplacés', position: 1, state: 'verified', sourceKind: 'manual' })
    await insertWatch(c, { reportId: v, siteId: ducos, label: 'Douches sécurité secteur C — installation en cours', position: 2, state: 'to_follow', sourceKind: 'manual' })
    await insertWatch(c, { reportId: v, siteId: ducos, label: 'PV détecteurs incendie bâtiment B — à réceptionner', position: 3, state: 'to_follow', sourceKind: 'manual' })
    await insertWatch(c, { reportId: v, siteId: ducos, label: 'Marquage route interne — à refaire', position: 4, state: 'to_follow', sourceKind: 'manual' })
    return v
  })

  void insp4

  // ── RÉSERVES ─────────────────────────────────────────────────────────────
  await step('Réserves (1 levée, 1 ouverte)', async () => {
    await insertReserve(c, {
      siteId: ducos, label: 'Issues de secours côté est obstruées par du stockage temporaire',
      location: 'Bâtiment B — côté est', issuedOn: d(-60),
      status: 'lifted', liftedAt: t(-7, '09:05'),
      liftNote: 'Stockage déplacé, dégagement complet confirmé en inspection du ' + d(-7) + '.',
    })
    await insertReserve(c, {
      siteId: ducos, label: 'Douches de sécurité secteur C absentes (réglementation ICPE)',
      location: 'Bâtiment C — stockage solvants', issuedOn: d(-90),
    })
  })

  // ── ACTION PRIORITAIRE SUPPLÉMENTAIRE ────────────────────────────────────
  await step('Action prioritaire — Rapport annuel HSE à livrer', () =>
    insertAction(c, {
      siteId: ducos, title: 'Préparer et transmettre le rapport annuel HSE 2026 à la DITTT',
      createdAt: t(-5, '09:00'), status: 'open',
      dueDate: d(14),
      corpsEtat: 'Documentation réglementaire',
      assignedContactId: casting?.chauvin ?? null, assignedToName: 'Jean-Pierre Chauvin',
    }))

  // ── CAPSULES / À SAVOIR ──────────────────────────────────────────────────
  await step('Capsules mémoire (5 Ducos + 1 par site secondaire)', async () => {
    const capsulesducos = [
      "Badge securite niveau 2 requis a l'entree principale — retrait obligatoire a la guerite.",
      "Batiment C : casque, lunettes de protection et gants chimiques obligatoires des l'entree.",
      'Référent sécurité sur site : Élodie Wénéhoua — disponible sur place 7h-17h les jours ouvrés.',
      'Prochain contrôle électrique réglementaire (HTA/BT) : avant le 30/09/2026.',
      'Accès interdit entre 22h et 6h sauf autorisation écrite du Directeur HSE.',
    ]
    for (const body of capsulesducos) await insertNote(c, ducos, body, 'a_savoir')
    if (depot) await insertNote(c, depot, "Accès périmètre ICPE : badge opérateur obligatoire ou accompagnement depuis le portique nord. Pas d'accès autonome.", 'a_savoir')
    if (fret) await insertNote(c, fret, "Responsable sécurité absent le vendredi — contacter le chef de quai en cas d'urgence ou d'accès hors horaires.", 'a_savoir')
    if (centrale) await insertNote(c, centrale, "Accès centrale Yaté : demande à adresser 48h à l'avance à la sécurité Enercal. Habilitation H0B0 minimum obligatoire.", 'a_savoir')
  })

  // ── ÉVÉNEMENTS FUTURS ────────────────────────────────────────────────────
  await step('Événements futurs — 3 inspections planifiées', async () => {
    // Prochain audit mensuel (1er lundi du mois prochain)
    const now = new Date()
    const nextMonthFirst = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const dayOfWeek = nextMonthFirst.getDay()
    const daysToMonday = (dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 0 : 8 - dayOfWeek)
    const firstMonday = new Date(nextMonthFirst.getTime() + daysToMonday * 86_400_000)
    const firstMondayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Noumea', year: 'numeric', month: '2-digit', day: '2-digit' }).format(firstMonday)

    await insertScheduledEvent(c, {
      siteId: ducos, type: 'inspection',
      title: 'Audit HSE mensuel — Atelier Ducos',
      plannedStart: `${firstMondayStr}T08:30:00+11:00`,
      plannedEnd: `${firstMondayStr}T12:00:00+11:00`,
      payload: { type: 'inspection', scope: 'Inspection mensuelle CAPSE NC — revue complète des constats ouverts et nouvelles zones.' },
      createdFrom: 'recurrence',
    })
    // Contrôle extincteurs dans 3 semaines
    await insertScheduledEvent(c, {
      siteId: ducos, type: 'inspection',
      title: 'Contrôle extincteurs — vérification annuelle',
      plannedStart: t(21, '10:00'),
      payload: { type: 'inspection', scope: 'Vérification annuelle des 18 extincteurs. Prestataire : SAPAS NC.' },
      createdFrom: 'manual',
    })
    // Réunion de suivi HSE dans 2 semaines
    await insertScheduledEvent(c, {
      siteId: ducos, type: 'meeting',
      title: "Reunion de suivi HSE — bilan plan d'actions",
      plannedStart: t(14, '14:00'),
      plannedEnd: t(14, '16:00'),
      payload: { type: 'meeting', agenda: 'Revue des 6 actions ouvertes — levée des NC critiques — planification Q3.' },
      createdFrom: 'manual',
    })
  })

  // ══ DÉPÔT CARBURANT — site secondaire ═══════════════════════════════════
  const depotInsp = await step('Dépôt SPNC — Inspection annuelle (J-45)', () =>
    insertInspection(c, {
      siteId: depot, title: 'Inspection annuelle ICPE — dépôt carburant',
      createdAt: t(-45, '09:00'),
      text: `Inspection annuelle reglementaire. Dispositifs de retention conformes. Pompe de transfert : vanne de securite a remplacer. Procedure d'urgence affichee mais non signee par le responsable.`,
    }))
  if (depotInsp) {
    await step('Dépôt SPNC — Actions (2 constats)', async () => {
      await insertAction(c, {
        siteId: depot, title: 'Remplacer la vanne de sécurité de la pompe de transfert',
        createdAt: t(-45, '10:00'), reportId: depotInsp, status: 'planned', dueDate: d(-10),
        corpsEtat: 'Équipements de sécurité',
      })
      await insertAction(c, {
        siteId: depot, title: "Faire signer la procedure d'urgence par le responsable de site",
        createdAt: t(-45, '10:00'), reportId: depotInsp, status: 'done',
        dueDate: d(-30), doneAt: t(-28, '14:00'),
      })
    })
  }

  // ══ ENTREPÔT NC FRET — site secondaire ══════════════════════════════════
  const fretInsp = await step('Entrepôt NC Fret — Inspection trimestrielle (J-20)', () =>
    insertInspection(c, {
      siteId: fret, title: 'Inspection trimestrielle — manutention et signalisation',
      createdAt: t(-20, '09:00'),
      text: 'Inspection trimestrielle. Chariots élévateurs : 2 sur 5 avec éclairage défectueux. Signalisation piétons/véhicules à renforcer dans la zone de chargement.',
    }))
  if (fretInsp) {
    await step('Entrepôt NC Fret — Actions (2 constats)', async () => {
      await insertAction(c, {
        siteId: fret, title: "Réparer l'éclairage des 2 chariots élévateurs défectueux",
        createdAt: t(-20, '10:00'), reportId: fretInsp, status: 'done',
        dueDate: d(-12), doneAt: t(-10, '16:00'),
        corpsEtat: 'Matériel',
      })
      await insertAction(c, {
        siteId: fret, title: 'Poser la signalisation piétons/véhicules zone de chargement',
        createdAt: t(-20, '10:00'), reportId: fretInsp, status: 'open',
        dueDate: d(5), corpsEtat: 'Signalisation',
      })
    })
  }

  // ── VÉRIFICATION DU GRAPHE ────────────────────────────────────────────────
  await step('Vérification du graphe de recette (Atelier Ducos)', async () => {
    const { data: decs } = await supabase.from('site_decisions').select('titre, action_id, decisionnaire_contact_id').eq('site_id', ducos)
    const { data: acts } = await supabase.from('site_actions').select('id, title, assigned_contact_id, status').eq('site_id', ducos)
    const { data: cast } = await supabase.from('site_intervenants').select('main_contact_id').eq('site_id', ducos)
    const { data: notes } = await supabase.from('site_notes').select('id').eq('site_id', ducos)
    const { data: reservs } = await supabase.from('site_reserve').select('id, status').eq('site_id', ducos)

    const decisions = (decs ?? []) as Array<{ titre: string; action_id: string | null; decisionnaire_contact_id: string | null }>
    const actions = (acts ?? []) as Array<{ id: string; title: string; assigned_contact_id: string | null; status: string }>
    const casting = (cast ?? []) as Array<{ main_contact_id: string | null }>
    const castingContacts = new Set(casting.map((x) => x.main_contact_id).filter(Boolean) as string[])
    const actionIds = new Set(actions.map((a) => a.id))

    const cas: Array<[string, boolean]> = [
      ['Au moins 4 inspections', (await supabase.from('site_reports').select('id', { count: 'exact', head: true }).eq('site_id', ducos).eq('origin', 'planned')).count! >= 4],
      ['Au moins 10 actions sur le site vitrine', actions.length >= 10],
      ['Actions terminées (done) présentes', actions.some((a) => a.status === 'done')],
      ['Actions ouvertes (open) présentes', actions.some((a) => a.status === 'open')],
      ['Actions planifiées (planned) présentes', actions.some((a) => a.status === 'planned')],
      ['Au moins 5 capsules À savoir', (notes ?? []).length >= 5],
      ['Réserve levée présente', ((reservs ?? []) as Array<{status: string}>).some((r) => r.status === 'lifted')],
      ['Réserve ouverte présente', ((reservs ?? []) as Array<{status: string}>).some((r) => r.status === 'open')],
      ['Casting avec 4 intervenants', casting.length >= 4],
      ['Actions reliées à des contacts du casting', actions.some((a) => a.assigned_contact_id && castingContacts.has(a.assigned_contact_id))],
      ['Décisions → Actions résolues dans le site', decisions.filter((d) => d.action_id).every((d) => actionIds.has(d.action_id!))],
    ]
    const manquants = cas.filter(([, ok]) => !ok).map(([nom]) => nom)
    for (const [nom, ok] of cas) console.log(`      ${ok ? '✓' : '✗'} ${nom}`)
    if (manquants.length > 0) throw new Error(`Graphe incomplet : ${manquants.join(' · ')}`)
  })

  console.log(`\n=== Terminé ${stepFailures > 0 ? `avec ${stepFailures} échec(s)` : 'sans échec'} ===`)
  console.log(`\nConnexion démo CAPSE : capse@memoria.nc / ${CAPSE_PASSWORD}`)
  console.log('Relancer = reset complet du tenant CAPSE + re-seed identique (dates recalées).')
  if (stepFailures > 0) process.exit(2)
}

main().catch((e) => { console.error(e); process.exit(1) })
