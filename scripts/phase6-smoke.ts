/**
 * scripts/phase6-smoke.ts
 *
 * Smoke test programmatique du flow Phase 6 — Récurrence simple.
 *
 * Couvre :
 *   1. Génération d'un template daily sur 7 jours → 7 interventions créées
 *   2. Idempotence : re-run sur la même fenêtre → 0 generated, 7 skipped
 *   3. Scope vide (siteId sans template) → 0 generated / 0 skipped sans crash
 *   4. Cleanup : suppression du template de test → les interventions générées
 *      sont effacées via cascade (template_id ON DELETE SET NULL)? — non, on
 *      DELETE les interventions explicitement puis le template, pour rester
 *      indépendant des règles ON DELETE.
 *
 * Usage : `npx tsx scripts/phase6-smoke.ts`
 *
 * Critère de succès : tous les asserts passent. Sinon, exit 1.
 */
import * as fs from 'fs'

// Node 20 lacks native WebSocket — Supabase realtime client requires it.
 
const ws = require('ws')
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
  ;(globalThis as { WebSocket: unknown }).WebSocket = ws
}

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

import { createAdminClient } from '@/lib/supabase/admin'
import {
  createTemplate,
  generateInterventionsFromTemplates,
} from '@/lib/db/intervention-templates'

const SMOKE_TEMPLATE_TITLE = '[SMOKE] Phase 6 — daily template'

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function daysFromNow(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d
}

function assertEq(actual: number, expected: number, label: string): void {
  if (actual !== expected) {
    console.error(`❌ Assert failed [${label}] : expected ${expected}, got ${actual}`)
    process.exit(1)
  }
  console.log(`   ✓ ${label} = ${actual}`)
}

type SupabaseAdmin = ReturnType<typeof createAdminClient>

async function findFirstActiveMission(
  supabase: SupabaseAdmin
): Promise<{ id: string; site_id: string; name: string } | null> {
  // On préfère une mission CHU démo (très probable d'exister). Sinon n'importe
  // quelle mission non supprimée.
  const { data, error } = await supabase
    .from('missions')
    .select('id, site_id, name')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

/**
 * Trouve un site qui n'a AUCUN template actif → utilisé pour le scope vide.
 * Si tous les sites ont un template, fallback : on cherche un site démo
 * (Annexe maternelle est rare en templates) ou n'importe quel site sans
 * mission.
 */
async function findSiteWithoutTemplates(
  supabase: SupabaseAdmin
): Promise<string | null> {
  const { data: sites, error: sErr } = await supabase
    .from('sites')
    .select('id')
    .is('deleted_at', null)
  if (sErr) throw sErr
  for (const s of sites ?? []) {
    const { data: missions } = await supabase
      .from('missions')
      .select('id')
      .eq('site_id', s.id)
      .is('deleted_at', null)
    if (!missions || missions.length === 0) {
      return s.id as string
    }
    const missionIds = missions.map((m) => m.id)
    const { data: templates } = await supabase
      .from('intervention_templates')
      .select('id')
      .in('mission_id', missionIds)
      .is('deleted_at', null)
      .limit(1)
    if (!templates || templates.length === 0) {
      return s.id as string
    }
  }
  return null
}

async function cleanupTemplate(supabase: SupabaseAdmin, templateId: string): Promise<void> {
  // Delete generated interventions first (FK ON DELETE SET NULL would otherwise
  // leave dangling rows referencing a NULL template_id — clean démo).
  const { error: delIntErr } = await supabase
    .from('interventions')
    .delete()
    .eq('template_id', templateId)
  if (delIntErr) throw delIntErr

  // Hard-delete the template row (skipping soft-delete — test artifact).
  const { error: delTplErr } = await supabase
    .from('intervention_templates')
    .delete()
    .eq('id', templateId)
  if (delTplErr) throw delTplErr
}

async function main() {
  const supabase = createAdminClient()

  console.log('Phase 6 smoke test — start')

  // 0) Pré-conditions : trouver une mission existante
  const mission = await findFirstActiveMission(supabase)
  if (!mission) {
    console.error(
      '❌ No mission found. Run `npx tsx scripts/seed-demo.ts` first.'
    )
    process.exit(1)
  }
  console.log(`Using mission '${mission.name}' (id=${mission.id})`)

  // 1) Trouver un admin pour created_by
  const { data: admin, error: adminErr } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'admin')
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  if (adminErr) throw adminErr
  if (!admin) {
    console.error('❌ No admin user found.')
    process.exit(1)
  }

  // 2) Cleanup éventuel d'un smoke test précédent (idempotence du smoke lui-même)
  const { data: existing } = await supabase
    .from('intervention_templates')
    .select('id')
    .eq('title', SMOKE_TEMPLATE_TITLE)
    .is('deleted_at', null)
  if (existing && existing.length > 0) {
    for (const t of existing) {
      await cleanupTemplate(supabase, t.id as string)
    }
    console.log(`   ↳ Cleaned up ${existing.length} stale smoke template(s)`)
  }

  // 3) Créer le template daily de test
  const fromDate = isoDate(new Date())
  const toDate = isoDate(daysFromNow(6)) // 7 jours inclus (today + 6)
  const template = await createTemplate({
    mission_id: mission.id,
    title: SMOKE_TEMPLATE_TITLE,
    description: 'Smoke test artifact — safe to delete',
    frequency: 'daily',
    slots: null, // 1 intervention par jour
    starts_on: fromDate,
    ends_on: null,
    created_by: admin.id as string,
  })
  console.log(`Created smoke template (id=${template.id})`)

  let templateIdForCleanup: string | null = template.id
  try {
    // 4) Première génération : 7 jours daily → 7 interventions
    console.log('Step 1 — initial generation (7 days, daily)')
    const r1 = await generateInterventionsFromTemplates({
      fromDate,
      toDate,
      templateIds: [template.id],
    })
    assertEq(r1.templatesProcessed, 1, 'templatesProcessed')
    assertEq(r1.generated, 7, 'generated')
    assertEq(r1.skipped, 0, 'skipped')

    // 5) Re-run : idempotence → 0 generated, 7 skipped
    console.log('Step 2 — re-run (idempotence)')
    const r2 = await generateInterventionsFromTemplates({
      fromDate,
      toDate,
      templateIds: [template.id],
    })
    assertEq(r2.templatesProcessed, 1, 'templatesProcessed (re-run)')
    assertEq(r2.generated, 0, 'generated (re-run)')
    assertEq(r2.skipped, 7, 'skipped (re-run)')

    // 6) Scope vide : un site sans template → 0/0/0 sans crash
    console.log('Step 3 — empty scope (site without templates)')
    const emptySiteId = await findSiteWithoutTemplates(supabase)
    if (emptySiteId) {
      const r3 = await generateInterventionsFromTemplates({
        fromDate,
        toDate,
        siteId: emptySiteId,
      })
      assertEq(r3.templatesProcessed, 0, 'templatesProcessed (empty scope)')
      assertEq(r3.generated, 0, 'generated (empty scope)')
      assertEq(r3.skipped, 0, 'skipped (empty scope)')
    } else {
      // Fallback : génère sur un templateId fictif (UUID inexistant) — toujours
      // 0/0/0 attendu, même garantie sans crash.
      const r3 = await generateInterventionsFromTemplates({
        fromDate,
        toDate,
        templateIds: ['00000000-0000-0000-0000-000000000000'],
      })
      assertEq(r3.templatesProcessed, 0, 'templatesProcessed (empty templateIds)')
      assertEq(r3.generated, 0, 'generated (empty templateIds)')
      assertEq(r3.skipped, 0, 'skipped (empty templateIds)')
    }

    // 7) Vérification finale en DB : 7 interventions liées au template
    const { data: finalCheck, error: fcErr } = await supabase
      .from('interventions')
      .select('id, scheduled_for, slot')
      .eq('template_id', template.id)
    if (fcErr) throw fcErr
    assertEq(finalCheck?.length ?? 0, 7, 'DB interventions count')
  } finally {
    // 8) Cleanup — toujours, même en cas d'échec d'un assert
    if (templateIdForCleanup) {
      await cleanupTemplate(supabase, templateIdForCleanup)
      templateIdForCleanup = null
      console.log('   ✓ Cleanup OK')
    }
  }

  console.log('')
  console.log('✅ Phase 6 smoke OK :')
  console.log('   - 7 interventions générées sur 7 jours (template daily)')
  console.log('   - Idempotence vérifiée (re-run = 0 generated, 7 skipped)')
  console.log('   - Scope vide retourne 0 sans crash')
  console.log('   - Cleanup OK')
}

main().catch((e) => {
  console.error('[phase6-smoke] Fatal:', e)
  process.exit(1)
})
