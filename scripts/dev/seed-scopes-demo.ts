// Seed de DÉMO pour valider S3 (nœuds de mémoire) — protocole produit de Vincent.
//
// Crée le site « Médipôle » avec 3 sous-périmètres (VRD, Électricité, Gros œuvre),
// les actions et anomalies du jeu de données, toutes rattachées. Idempotent
// (relançable sans doublon). Inserts directs avec organization_id explicite
// (les helpers lib/db dépendent de getOrgId() = null hors session).
//
// 🔒 ISOLATION COMPTE — ce script ne touche QUE l'organisation du compte
// `demo@memoria.nc`. L'org cible est résolue STRICTEMENT à partir de cet email
// (auth user → public.users.organization_id). Aucune autre entreprise n'est
// jamais affectée : pas de fallback « org unique », pas d'override par UUID
// arbitraire. Si l'org passée via DEMO_ORG_ID ne correspond pas au compte démo,
// le script refuse de tourner.
//
// Usage :
//   npx tsx scripts/dev/seed-scopes-demo.ts        (résout demo@memoria.nc tout seul)
//
// ⚠️ Met l'organisation DÉMO en industry_template='construction' et seede son
// catalogue BTP (corps_etat + anomaly_category) → Médipôle devient un démo BTP
// cohérent. C'est sans danger : la cible est garantie être le compte démo.
// KEEP_TEMPLATE=1 pour ne PAS toucher au template (les libellés d'anomalie
// tomberont alors en clé brute).

import { createAdminClient } from '@/lib/supabase/admin'
import { INDUSTRY_TEMPLATES } from '@/lib/catalog/industry-templates'

// ── Chargement .env.local (mirror des autres seeds) ──────────────────────────
import { readFileSync } from 'node:fs'
function loadEnvLocal() {
  try {
    const content = readFileSync('.env.local', 'utf-8')
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    /* pas de .env.local : on suppose les vars déjà exportées */
  }
}
loadEnvLocal()

type Admin = ReturnType<typeof createAdminClient>

// ── Jeu de données (exact, protocole Vincent) ────────────────────────────────
const SCOPES = [
  { key: 'vrd', label: 'VRD' },
  { key: 'electricite', label: 'Électricité' },
  { key: 'gros-oeuvre', label: 'Gros œuvre' },
] as const

const ACTIONS: { scope: string; title: string }[] = [
  { scope: 'vrd', title: 'Reprendre regard EP-17' },
  { scope: 'vrd', title: 'Contrôler pente réseau EP' },
  { scope: 'vrd', title: 'Reprise bordure parking' },
  { scope: 'electricite', title: 'Remplacement coffret TGBT' },
  { scope: 'electricite', title: 'Vérification éclairage parking' },
  { scope: 'gros-oeuvre', title: 'Reprise fissure voile nord' },
]

const ANOMALIES: { scope: string; description: string; category: string }[] = [
  { scope: 'vrd', description: 'Infiltration regard EP-17', category: 'reseau_eau' },
  { scope: 'vrd', description: 'Réserve évacuation eaux pluviales', category: 'reserve' },
  { scope: 'electricite', description: 'Non-conformité tableau divisionnaire', category: 'non_conformite' },
  { scope: 'gros-oeuvre', description: 'Malfaçon voile béton', category: 'non_conformite' },
]

const LABEL_BY_KEY = new Map(SCOPES.map((s) => [s.key, s.label]))

// Le SEUL compte que ce script a le droit de toucher. Toute la sécurité
// d'isolation tient à cette constante : l'org cible est dérivée de cet email.
const DEMO_EMAIL = 'demo@memoria.nc'

/**
 * Résout l'organisation du compte démo, et ELLE SEULE.
 * auth.users (par email) → public.users.organization_id. Pas de fallback sur
 * « l'org unique » ni sur un UUID arbitraire : impossible de viser une autre
 * entreprise par erreur. Renvoie aussi l'id du user démo (auteur des inserts).
 */
async function resolveDemoOrg(supabase: Admin): Promise<{ orgId: string; userId: string }> {
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 200 })
  if (listErr) throw listErr
  const authUser = list?.users?.find((u) => u.email === DEMO_EMAIL)
  if (!authUser) {
    console.error(`Compte démo introuvable (${DEMO_EMAIL}). Aucune action.`)
    process.exit(1)
  }

  const { data: profile, error: profErr } = await supabase
    .from('users')
    .select('organization_id')
    .eq('id', authUser.id)
    .maybeSingle()
  if (profErr) throw profErr
  const orgId = (profile as { organization_id: string } | null)?.organization_id
  if (!orgId) {
    console.error(`Le compte ${DEMO_EMAIL} n'a pas d'organization_id. Aucune action.`)
    process.exit(1)
  }

  // Garde-fou : si DEMO_ORG_ID est fourni, il DOIT être l'org du compte démo.
  if (process.env.DEMO_ORG_ID && process.env.DEMO_ORG_ID !== orgId) {
    console.error(
      `DEMO_ORG_ID (${process.env.DEMO_ORG_ID}) ≠ org du compte ${DEMO_EMAIL} (${orgId}).\n` +
        'Refus : ce script ne seede que le compte démo.',
    )
    process.exit(1)
  }

  return { orgId, userId: authUser.id }
}

/** Upsert idempotent du catalogue BTP (corps_etat + anomaly_category). */
async function seedConstructionCatalog(supabase: Admin, orgId: string) {
  const byKind = INDUSTRY_TEMPLATES.construction
  const rows: Record<string, unknown>[] = []
  for (const [kind, entries] of Object.entries(byKind)) {
    entries.forEach((e, i) =>
      rows.push({
        organization_id: orgId, kind, key: e.key, label: e.label,
        icon: e.icon ?? null, color: e.color ?? null, sort_order: i,
        metadata: e.metadata ?? {},
      }),
    )
  }
  if (rows.length)
    await supabase.from('org_catalog').upsert(rows, {
      onConflict: 'organization_id,kind,key',
      ignoreDuplicates: true,
    })
}

async function ensureRow(
  supabase: Admin,
  table: string,
  match: Record<string, unknown>,
  insert: Record<string, unknown>,
): Promise<string> {
  let q = supabase.from(table).select('id')
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v as never)
  const { data: existing } = await q.maybeSingle()
  if (existing) return (existing as { id: string }).id
  const { data, error } = await supabase.from(table).insert(insert).select('id').single()
  if (error) throw new Error(`${table}: ${error.message}`)
  return (data as { id: string }).id
}

async function main() {
  const supabase = createAdminClient()
  const { orgId, userId: author } = await resolveDemoOrg(supabase)
  console.log(`Compte démo : ${DEMO_EMAIL}`)
  console.log(`Org cible    : ${orgId}`)

  if (!process.env.KEEP_TEMPLATE) {
    await supabase.from('organizations').update({ industry_template: 'construction' }).eq('id', orgId)
    await seedConstructionCatalog(supabase, orgId)
    console.log('→ template=construction + catalogue BTP seedé')
  }

  // Client + site
  const clientId = await ensureRow(
    supabase, 'clients',
    { name: 'Médipôle (démo)', organization_id: orgId },
    { name: 'Médipôle (démo)', organization_id: orgId },
  )
  const siteId = await ensureRow(
    supabase, 'sites',
    { name: 'Médipôle', client_id: clientId },
    {
      name: 'Médipôle', client_id: clientId, organization_id: orgId,
      address: 'Démo BTP — centre hospitalier', notes: 'Site de démonstration S3 (nœuds de mémoire).',
    },
  )
  console.log(`Site Médipôle : ${siteId}`)

  // Scopes
  const scopeId = new Map<string, string>()
  for (const s of SCOPES) {
    const id = await ensureRow(
      supabase, 'memory_scopes',
      { site_id: siteId, label: s.label, organization_id: orgId },
      {
        organization_id: orgId, site_id: siteId, parent_scope_id: null,
        scope_type_key: s.key, label: s.label, created_by: author,
      },
    )
    scopeId.set(s.key, id)
  }
  console.log(`Sous-périmètres : ${[...scopeId.keys()].join(', ')}`)

  // Actions rattachées
  for (const a of ACTIONS) {
    await ensureRow(
      supabase, 'site_actions',
      { site_id: siteId, title: a.title },
      {
        site_id: siteId, title: a.title, status: 'open',
        corps_etat: LABEL_BY_KEY.get(a.scope) ?? null,
        scope_id: scopeId.get(a.scope), created_by: author,
        created_from: 'seed_scopes_demo',
      },
    )
  }
  console.log(`Actions : ${ACTIONS.length} rattachées`)

  // Une mission + une intervention pour héberger les anomalies
  const missionId = await ensureRow(
    supabase, 'missions',
    { site_id: siteId, name: 'Suivi chantier Médipôle (démo)' },
    {
      site_id: siteId, name: 'Suivi chantier Médipôle (démo)', cadence: 'on_demand',
      organization_id: orgId, created_by: author,
    },
  )
  // status 'planned' (pas 'completed') : la contrainte chk_active_intervention_
  // requires_team (mig 048) exige une équipe affectée pour completed/validated/
  // in_progress. Ici l'intervention n'est qu'un PORTEUR d'anomalies pour peupler
  // les nœuds ; son statut est invisible côté S3 (les scopes comptent par scope_id).
  const interventionId = await ensureRow(
    supabase, 'interventions',
    { mission_id: missionId, notes: 'Relevé démo S3 — anomalies par sous-périmètre.' },
    {
      mission_id: missionId, scheduled_at: '2026-06-10T00:00:00.000Z',
      status: 'planned', team: [],
      notes: 'Relevé démo S3 — anomalies par sous-périmètre.',
      organization_id: orgId, created_by: author,
    },
  )

  // Anomalies rattachées
  for (const an of ANOMALIES) {
    await ensureRow(
      supabase, 'intervention_anomalies',
      { intervention_id: interventionId, description: an.description },
      {
        intervention_id: interventionId, category: an.category, description: an.description,
        status: 'open', scope_id: scopeId.get(an.scope),
        organization_id: orgId, reported_by: author,
      },
    )
  }
  console.log(`Anomalies : ${ANOMALIES.length} rattachées`)

  console.log('\n✓ Démo S3 prête.')
  console.log(`  Fiche site  : /sites/${siteId}?tab=memoire`)
  for (const s of SCOPES) console.log(`  ${s.label.padEnd(11)} : /sites/${siteId}/scopes/${scopeId.get(s.key)}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
