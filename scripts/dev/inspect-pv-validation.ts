// Inspecte la surface de validation (PvValidation) sur les RÉUNIONS RÉELLES.
// Vérifie : items typés par section, traçabilité (source), confiance, blocages,
// readiness + gaps, et la séparation CONSTAT (points) / TRAITEMENT (prévisions).
// Lecture seule. Usage : npx tsx scripts/dev/inspect-pv-validation.ts [reportId...]

import { readFileSync } from 'node:fs'
function loadEnvLocal() {
  try {
    const content = readFileSync('.env.local', 'utf-8')
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    /* vars déjà exportées */
  }
}
loadEnvLocal()

import { createAdminClient } from '@/lib/supabase/admin'
import { buildPvValidation, type PvSection } from '@/lib/documents/pv-validation'

const SECTION_LABEL: Record<PvSection, string> = {
  participants: 'PARTICIPANTS',
  remarques_cr: 'REMARQUES SUR CR PRÉCÉDENT',
  points_examines: 'POINTS EXAMINÉS',
  previsions: 'PRÉVISIONS',
  photos: 'PHOTOS',
}

async function recentReports(n: number): Promise<{ id: string; title: string | null }[]> {
  const sb = createAdminClient()
  const { data } = await sb
    .from('site_reports')
    .select('id, title, created_at')
    .not('site_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(n)
  return (data ?? []).map((r) => ({ id: r.id as string, title: (r.title as string | null) ?? null }))
}

async function main() {
  const argv = process.argv.slice(2)
  const targets = argv.length
    ? argv.map((id) => ({ id, title: null as string | null }))
    : await recentReports(2)

  if (targets.length === 0) { console.log('Aucune réunion rattachée à un site.'); return }

  for (const t of targets) {
    const pv = await buildPvValidation(t.id)
    console.log('\n══════════════════════════════════════════════════════════════')
    if (!pv) { console.log(`✗ ${t.id} — réunion introuvable`); continue }
    console.log(`RÉUNION  ${t.title ?? t.id}`)
    console.log(`  readiness ${pv.readiness.score}/100 · PDF ${pv.blocking ? 'BLOQUÉ' : 'autorisé'} · ${pv.items.length} items`)
    console.log(`  ${SECTIONS.map((s) => `${s}:${pv.counts[s]}`).join(' · ')}`)

    for (const section of SECTIONS) {
      const list = pv.items.filter((i) => i.section === section)
      if (!list.length) continue
      console.log(`\n  ── ${SECTION_LABEL[section]} (${list.length})`)
      for (const it of list) {
        const flags = [
          it.confiance === 'à confirmer' ? '⚠ à confirmer' : '',
          it.blocking ? '⛔ blocage' : '',
        ].filter(Boolean).join('  ')
        console.log(`     [${it.type}] ${it.texte}${flags ? `   ${flags}` : ''}`)
      }
    }

    if (pv.gaps.length) {
      const n = pv.readiness.niveaux
      console.log(`\n  ── POINTS À CONFIRMER (${pv.gaps.length})  🔴 ${n.bloquant} · 🟠 ${n.important} · 🟢 ${n.suggestion}`)
      const EMOJI = { bloquant: '🔴', important: '🟠', suggestion: '🟢' } as const
      for (const g of pv.gaps) console.log(`     ${EMOJI[g.niveau]} [${g.type}] ${g.libelle}${g.proposition ? `  → ${g.proposition}` : ''}`)
    }
  }
  console.log('')
}

const SECTIONS: PvSection[] = ['participants', 'remarques_cr', 'points_examines', 'previsions', 'photos']

main().catch((e) => { console.error(e); process.exit(1) })
