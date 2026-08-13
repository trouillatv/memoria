// Relation canonique PETRO — 2026-08-13
// SOURCE : "Accès sécurisé au chantier (portail et cadenas à code)"
// TARGET : "Gestion du matériel sur site non sécurisé"
// TYPE   : causes
// STATUS : confirmed (décision humaine, preuve textuelle directe)
//
// Preuve : "Le site n'étant pas sécurisé, le matériel ne peut pas être laissé sur place."
//
// Usage : npx tsx scripts/link-petro-acces-materiel.ts [--dry-run]

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const SITE    = '75bd3d23-d515-46bd-8de8-254495a5bade'
const DRY_RUN = process.argv.includes('--dry-run')

const SOURCE_LABEL = 'Accès sécurisé au chantier (portail et cadenas à code)'
const TARGET_LABEL = 'Gestion du matériel sur site non sécurisé'
const EVIDENCE_TEXT = 'Le site n\'étant pas sécurisé, le matériel ne peut pas être laissé sur place.'

async function main() {
  if (DRY_RUN) console.log('\n⚠️  MODE DRY-RUN — aucune modification en base')

  // ── Résolution IDs ──────────────────────────────────────────────────────────
  const { data: csAll } = await sb
    .from('canonical_subject')
    .select('id, label, status')
    .eq('site_id', SITE)
    .in('label', [SOURCE_LABEL, TARGET_LABEL])

  const source = (csAll ?? []).find((r: { label: string }) => r.label === SOURCE_LABEL) as
    { id: string; label: string; status: string } | undefined
  const target = (csAll ?? []).find((r: { label: string }) => r.label === TARGET_LABEL) as
    { id: string; label: string; status: string } | undefined

  if (!source) { console.error(`❌  Source introuvable : "${SOURCE_LABEL}"`); process.exit(1) }
  if (!target) { console.error(`❌  Target introuvable : "${TARGET_LABEL}"`); process.exit(1) }

  console.log(`\n=== LINK PETRO — causes ===`)
  console.log(`  SOURCE : [${source.id}] "${source.label}"`)
  console.log(`  → causes →`)
  console.log(`  TARGET : [${target.id}] "${target.label}"`)

  // ── Occurrence-preuve : note "Le site n'étant pas sécurisé..." ──────────────
  // L'occurrence est sur le TARGET (Gestion matériel) — c'est elle qui porte la causalité.
  const { data: occRows } = await sb
    .from('canonical_subject_occurrence')
    .select('id, effective_date, label, note')
    .eq('canonical_subject_id', target.id)
    .order('effective_date')

  const evidenceOcc = (occRows ?? []).find(
    (o: { note: string | null }) => o.note?.includes('n\'étant pas sécurisé') || o.note?.includes('pas sécurisé')
  ) as { id: string; effective_date: string; label: string; note: string } | undefined

  if (!evidenceOcc) {
    // Fallback : première occurrence du target
    const fallback = (occRows ?? [])[0] as { id: string; effective_date: string; label: string; note: string | null } | undefined
    if (!fallback) { console.error('❌  Aucune occurrence sur le target — impossible de créer la preuve'); process.exit(1) }
    console.log(`  ⚠  Note exacte introuvable — fallback sur première occurrence du target`)
    console.log(`  Preuve occurrence : [${fallback.id}] ${fallback.effective_date?.slice(0,10)} — ${fallback.label}`)
  } else {
    console.log(`  Preuve occurrence : [${evidenceOcc.id}] ${evidenceOcc.effective_date?.slice(0,10)} — ${evidenceOcc.label}`)
    console.log(`    note : ${evidenceOcc.note}`)
  }

  const occ = evidenceOcc ?? ((occRows ?? [])[0] as { id: string; effective_date: string; label: string; note: string | null })
  const observedAt = occ.effective_date?.slice(0, 10)

  // ── Vérifier doublon ────────────────────────────────────────────────────────
  const { data: existing } = await sb
    .from('canonical_subject_links')
    .select('id, relation_type, status')
    .eq('site_id', SITE)
    .or(`and(source_subject_id.eq.${source.id},target_subject_id.eq.${target.id}),and(source_subject_id.eq.${target.id},target_subject_id.eq.${source.id})`)

  if (existing && existing.length > 0) {
    const ex = existing[0] as { id: string; relation_type: string; status: string }
    console.log(`  ⚠  Relation existante : [${ex.relation_type}] status=${ex.status} — arrêt.`)
    process.exit(0)
  }

  if (DRY_RUN) { console.log('  [DRY-RUN] Arrêt.\n'); process.exit(0) }

  // ── Insertion du lien ────────────────────────────────────────────────────────
  const { data: linkRow, error: linkErr } = await sb
    .from('canonical_subject_links')
    .insert({
      site_id:           SITE,
      source_subject_id: source.id,
      target_subject_id: target.id,
      relation_type:     'causes',
      status:            'confirmed',
      confidence:        null,
      justification:     'Le site n\'étant pas sécurisé (problème cadenas/portail), le matériel ne peut pas être laissé sur place.',
      confirmed_at:      new Date().toISOString(),
    })
    .select('id')
    .single()

  if (linkErr) { console.error(`❌  lien : ${linkErr.message}`); process.exit(1) }
  const linkId = (linkRow as { id: string }).id
  console.log(`\n  ✅ Lien créé : ${linkId}`)

  // ── Insertion de la preuve ───────────────────────────────────────────────────
  const { error: evErr } = await sb
    .from('canonical_subject_link_evidence')
    .insert({
      link_id:       linkId,
      occurrence_id: occ.id,
      evidence_text: EVIDENCE_TEXT,
      observed_at:   observedAt,
    })

  if (evErr) { console.error(`❌  preuve : ${evErr.message}`); process.exit(1) }
  console.log(`  ✅ Preuve enregistrée`)
  console.log(`     "${EVIDENCE_TEXT}"`)
  console.log(`     observed_at : ${observedAt}`)
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1) })
