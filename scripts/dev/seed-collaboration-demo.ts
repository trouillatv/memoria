/**
 * scripts/dev/seed-collaboration-demo.ts
 *
 * Jeu de données de DÉMONSTRATION pour la recette visuelle du graphe de
 * collaboration (V3 UX-1B). NON DESTRUCTIF, IDEMPOTENT, strictement scopé à l'org
 * « Démo MemorIA ». Aucune suppression, aucun reset, aucune autre org touchée.
 *
 * Diversité (spec Vincent) : entreprises centrales/périphériques, collaborations
 * faible/moyenne/forte, une relation ancienne (castings clôturés), une récente,
 * personnes croisées via actions, co-équipe, une entreprise isolée.
 *
 * Usage : tsx scripts/dev/seed-collaboration-demo.ts
 */
import * as fs from 'fs'

const ws = require('ws')
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
  ;(globalThis as { WebSocket: unknown }).WebSocket = ws
}

import { createAdminClient } from '@/lib/supabase/admin'
import { findOrCreateCompanyByName } from '@/lib/db/companies'
import { openSiteIntervenant, closeSiteIntervenant } from '@/lib/db/site-intervenants'
import { createSiteAction } from '@/lib/db/site-actions'

const DEMO_ORG_NAME = 'Démo MemorIA'
const DEMO_ORG_ID = '95df55b5-11cf-4ace-b2ca-18b000ba9b25'
const P = '[Démo] ' // préfixe seed → idempotence + n'écrase jamais une vraie donnée

function loadEnvLocal() {
  const path = '.env.local'
  if (!fs.existsSync(path)) return
  for (const rawLine of fs.readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!
  }
}

type Admin = ReturnType<typeof createAdminClient>

async function ensureContact(db: Admin, orgId: string, companyId: string, fullName: string, fn: string, internal = false): Promise<string> {
  const { data: existing } = await db.from('company_contacts').select('id').eq('organization_id', orgId).eq('company_id', companyId).eq('full_name', fullName).is('deleted_at', null).maybeSingle()
  if (existing) return (existing as { id: string }).id
  const { data, error } = await db.from('company_contacts').insert({ organization_id: orgId, company_id: companyId, full_name: fullName, function: fn, is_internal_agent: internal }).select('id').single()
  if (error) throw error
  return (data as { id: string }).id
}

async function ensureCasting(db: Admin, siteId: string, role: string, companyId: string, from: string, to: string | null, mainContactId: string | null): Promise<void> {
  // Idempotence : un seul lien (site, entreprise) — quel que soit son état.
  const { data: existing } = await db.from('site_intervenants').select('id').eq('site_id', siteId).eq('company_id', companyId).maybeSingle()
  if (existing) return
  const id = await openSiteIntervenant({ siteId, role, companyId, mainContactId, effectiveFrom: from })
  if (to) await closeSiteIntervenant(siteId, id, to)
}

async function ensureAction(db: Admin, siteId: string, title: string, contactId: string, companyId: string): Promise<void> {
  const { data: existing } = await db.from('site_actions').select('id').eq('site_id', siteId).eq('title', title).maybeSingle()
  if (existing) return
  await createSiteAction({ site_id: siteId, title, assigned_contact_id: contactId, assigned_company_id: companyId, created_by: null })
}

async function ensureTeamWithMembers(db: Admin, orgId: string, name: string, contactIds: string[]): Promise<void> {
  let teamId: string
  const { data: existing } = await db.from('teams').select('id').eq('organization_id', orgId).eq('name', name).is('deleted_at', null).maybeSingle()
  if (existing) teamId = (existing as { id: string }).id
  else {
    const { data, error } = await db.from('teams').insert({ organization_id: orgId, name }).select('id').single()
    if (error) throw error
    teamId = (data as { id: string }).id
  }
  for (const contactId of contactIds) {
    const { data: m } = await db.from('team_field_members').select('id').eq('team_id', teamId).eq('contact_id', contactId).is('left_at', null).maybeSingle()
    if (!m) { const { error } = await db.from('team_field_members').insert({ organization_id: orgId, team_id: teamId, contact_id: contactId, created_by: null }); if (error) throw error }
  }
}

async function main() {
  loadEnvLocal()
  const db = createAdminClient()

  // ── Garde de sécurité : uniquement l'org démo ──
  const { data: org } = await db.from('organizations').select('id, name').eq('id', DEMO_ORG_ID).maybeSingle()
  if (!org || (org as { name: string }).name !== DEMO_ORG_NAME) {
    throw new Error(`Refus : org cible introuvable ou différente de « ${DEMO_ORG_NAME} ». Aucune écriture.`)
  }
  const orgId = DEMO_ORG_ID
  console.log(`Org démo confirmée : ${DEMO_ORG_NAME} (${orgId})`)

  const { data: siteRows } = await db.from('sites').select('id, name').eq('organization_id', orgId).is('deleted_at', null).order('created_at', { ascending: true }).limit(8)
  const sites = ((siteRows ?? []) as Array<{ id: string; name: string }>).map((s) => s.id)
  if (sites.length < 6) throw new Error(`L'org démo a ${sites.length} chantiers ; il en faut au moins 6 pour la démo.`)
  const [S1, S2, S3, S4, S5, S6] = sites

  // ── Entreprises (idempotentes par nom normalisé) ──
  const co = {
    clim: await findOrCreateCompanyByName(orgId, `${P}Clim Austral`),
    pave: await findOrCreateCompanyByName(orgId, `${P}PAVE`),
    etv: await findOrCreateCompanyByName(orgId, `${P}ETV`),
    socomet: await findOrCreateCompanyByName(orgId, `${P}SOCOMET`),
    egc: await findOrCreateCompanyByName(orgId, `${P}EGC`),
    btpnc: await findOrCreateCompanyByName(orgId, `${P}BTP NC`),
    sopema: await findOrCreateCompanyByName(orgId, `${P}Sopema`),
    ceb: await findOrCreateCompanyByName(orgId, `${P}Ceb`), // isolée (aucune collab)
  }

  // ── Contacts (personnes croisées) ──
  const joseph = await ensureContact(db, orgId, co.clim, `${P}Joseph Wamytan`, 'Conducteur de travaux')
  const marc = await ensureContact(db, orgId, co.clim, `${P}Marc Tein`, 'Chef de chantier')
  const sophie = await ensureContact(db, orgId, co.clim, `${P}Sophie Diela`, 'Électricienne')
  const vincent = await ensureContact(db, orgId, co.pave, `${P}Vincent Milon`, 'MOE')
  const jean = await ensureContact(db, orgId, co.etv, `${P}Jean Dupont`, 'Conducteur')

  // ── Castings → co_casting (forces contrastées + ancien/récent) ──
  // FORT : Clim Austral × PAVE sur 3 chantiers, actifs.
  await ensureCasting(db, S1!, 'MOE', co.clim, '2024-06-01', null, joseph)
  await ensureCasting(db, S1!, 'GO', co.pave, '2024-06-01', null, vincent)
  await ensureCasting(db, S2!, 'MOE', co.clim, '2024-08-01', null, joseph)
  await ensureCasting(db, S2!, 'GO', co.pave, '2024-08-01', null, vincent)
  await ensureCasting(db, S3!, 'MOE', co.clim, '2025-01-01', null, marc)
  await ensureCasting(db, S3!, 'GO', co.pave, '2025-01-01', null, vincent)
  // MOYEN : Clim Austral × ETV sur 2 chantiers (S1 + S4).
  await ensureCasting(db, S1!, 'ELEC', co.etv, '2024-06-15', null, jean)
  await ensureCasting(db, S4!, 'ELEC', co.etv, '2025-03-01', null, jean)
  await ensureCasting(db, S4!, 'MOE', co.clim, '2025-03-01', null, joseph)
  // FAIBLE : Clim Austral × SOCOMET sur 1 chantier.
  await ensureCasting(db, S5!, 'MOE', co.clim, '2025-06-01', null, marc)
  await ensureCasting(db, S5!, 'VRD', co.socomet, '2025-06-01', null, null)
  // ANCIEN (clôturé il y a ~3 ans) : PAVE × EGC.
  await ensureCasting(db, S6!, 'GO', co.pave, '2022-01-15', '2023-06-30', vincent)
  await ensureCasting(db, S6!, 'CHARPENTE', co.egc, '2022-02-01', '2023-06-30', null)
  // RÉCENT (ce mois) : BTP NC × Sopema.
  await ensureCasting(db, S2!, 'TERRASSEMENT', co.btpnc, '2026-07-01', null, null)
  await ensureCasting(db, S2!, 'MENUISERIE', co.sopema, '2026-07-05', null, null)

  // ── Actions → co_action (référent personne ↔ entreprise responsable, croisé) ──
  await ensureAction(db, S1!, `${P}Reprise étanchéité toiture`, joseph, co.pave)   // Joseph (Clim) ↔ PAVE
  await ensureAction(db, S1!, `${P}Contrôle alimentations provisoires`, sophie, co.etv) // Sophie (Clim) ↔ ETV
  await ensureAction(db, S4!, `${P}Reprise réseau enterré`, jean, co.clim)          // Jean (ETV) ↔ Clim

  // ── Co-équipe (personnes de la même équipe) ──
  await ensureTeamWithMembers(db, orgId, `${P}Équipe Électricité`, [joseph, sophie])

  console.log('Seed collaboration démo : OK (idempotent).')
  console.log('Entreprises 8 · contacts 5 · castings forts/moyens/faibles/ancien/récent · 3 actions croisées · 1 co-équipe · Ceb isolée.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
