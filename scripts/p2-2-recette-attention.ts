// P2-2 — Recette LIVE Attention (grammaire transverse act_now|watch|dormant|documentary_silence).
// Recette A : distribution EXACTE de la population navigable + population Attention par catégorie,
// réconciliation présent/absent, témoins de silence, contrôle des one-shots informatifs.
//
// Usage : npx tsx scripts/p2-2-recette-attention.ts [--site <id>]
// Sans --site : auto-détection du chantier avec le plus de PV historiques (corpus RUS).

import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { createAdminClient } from '../lib/supabase/admin'
import { getNavigableSubjectsForSite } from '../lib/db/canonical-subject-life'
import { deriveCanonicalAttentionItems, classifyAttentionCategory, type AttentionCategory } from '../lib/knowledge/canonical-attention'

const args = process.argv.slice(2)
function getArg(flag: string): string | undefined {
  const idx = args.indexOf(`--${flag}`)
  return idx >= 0 ? args[idx + 1] : undefined
}

async function resolveRusSite(): Promise<{ id: string; name: string; runs: number }> {
  const admin = createAdminClient()
  const explicit = getArg('site')
  if (explicit) {
    const { data } = await admin.from('sites').select('id, name').eq('id', explicit).single()
    return { id: explicit, name: (data?.name as string) ?? '?', runs: -1 }
  }
  // Auto : chantier avec le plus d'occurrences historical_pdf.
  const { data: occ } = await admin
    .from('canonical_subject_occurrence')
    .select('site_id')
    .eq('source_kind', 'historical_pdf')
  const bySite = new Map<string, number>()
  for (const r of (occ ?? []) as Array<{ site_id: string }>) bySite.set(r.site_id, (bySite.get(r.site_id) ?? 0) + 1)
  const top = [...bySite.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!top) throw new Error('Aucun chantier avec occurrences historiques.')
  const { data } = await admin.from('sites').select('id, name').eq('id', top[0]).single()
  return { id: top[0], name: (data?.name as string) ?? '?', runs: top[1] }
}

function fmt(iso: string | null): string { return iso ?? '—' }

async function main() {
  const site = await resolveRusSite()
  console.log(`\n=== P2-2 Recette Attention — LIVE ===`)
  console.log(`Site : ${site.name} (${site.id})`)
  console.log(`Date : ${new Date().toISOString().slice(0, 10)}\n`)

  const subjects = await getNavigableSubjectsForSite(site.id)
  const items = await deriveCanonicalAttentionItems(site.id) // population complète (aucun cap)

  // ── Recette A.1 — population navigable + métriques documentaires ─────────────
  const present = subjects.filter((s) => s.presentInLastPv).length
  const absent = subjects.length - present
  const sinceHisto = new Map<number, number>()
  for (const s of subjects) sinceHisto.set(s.pvSinceLastMention, (sinceHisto.get(s.pvSinceLastMention) ?? 0) + 1)
  console.log(`── Population navigable : ${subjects.length} sujets`)
  console.log(`   présents au dernier PV : ${present}`)
  console.log(`   absents du dernier PV  : ${absent}`)
  console.log(`   pvSinceLastMention (histogramme) :`)
  for (const k of [...sinceHisto.keys()].sort((a, b) => a - b)) {
    console.log(`      ${k} PV : ${sinceHisto.get(k)}`)
  }

  // ── Recette A.2 — population Attention par catégorie ─────────────────────────
  const byCat: Record<AttentionCategory, typeof items> = { act_now: [], watch: [], dormant: [], documentary_silence: [] }
  for (const it of items) byCat[it.category].push(it)
  console.log(`\n── Population Attention : ${items.length} sujets (aucun cap)`)
  for (const cat of ['act_now', 'watch', 'dormant', 'documentary_silence'] as AttentionCategory[]) {
    console.log(`   ${cat.padEnd(20)} : ${byCat[cat].length}`)
  }

  // ── Réconciliation absents ↔ silence ─────────────────────────────────────────
  const silentSubjects = subjects.filter((s) => s.pvSinceLastMention >= 2 && s.activeObjectsCboAware > 0)
  const absentNotSilent = subjects.filter((s) => !s.presentInLastPv && !(s.pvSinceLastMention >= 2 && s.activeObjectsCboAware > 0))
  console.log(`\n── Réconciliation`)
  console.log(`   absents (>=1 PV) : ${absent}`)
  console.log(`     dont éligibles silence (>=2 PV ET activité durable) : ${silentSubjects.length}`)
  console.log(`     dont NON silence (1 PV, ou activité durable nulle)  : ${absentNotSilent.length}`)
  console.log(`   → catégorie documentary_silence affichée : ${byCat.documentary_silence.length}`)

  // ── Témoins de silence (>=5) : dernière mention | PV écoulés | pertinence | displayState ──
  console.log(`\n── Témoins de silence documentaire (preuve) :`)
  const witnesses = silentSubjects
    .sort((a, b) => b.pvSinceLastMention - a.pvSinceLastMention)
    .slice(0, 8)
  for (const s of witnesses) {
    console.log(`   • ${s.title}`)
    console.log(`       dernière mention : ${fmt(s.lastSeenAt)} | PV écoulés : ${s.pvSinceLastMention} | activité durable (CBO) : ${s.activeObjectsCboAware} | displayState : ${s.displayState}`)
  }

  // ── Contrôle : one-shots informatifs NE DOIVENT PAS entrer en silence ────────
  console.log(`\n── Contrôle one-shots informatifs (attendu : PAS documentary_silence) :`)
  const oneShotHints = ['adresse', 'type', 'catégorie erp', 'categorie erp', 'sources électriques', 'sources electriques', 'formation extincteur']
  const suspects = subjects.filter((s) => oneShotHints.some((h) => s.title.toLowerCase().includes(h)))
  if (suspects.length === 0) console.log(`   (aucun sujet au libellé one-shot repéré dans le corpus)`)
  for (const s of suspects) {
    const cat = classifyAttentionCategory({
      signals: [], isStagnant: s.isStagnant, pvSinceLastMention: s.pvSinceLastMention, activeObjectsCboAware: s.activeObjectsCboAware,
    })
    const flag = cat === 'documentary_silence' ? '❌ SILENCE (anomalie)' : `✅ ${cat} (activité durable ${s.activeObjectsCboAware})`
    console.log(`   • ${s.title} → ${flag}`)
  }

  // ── Garde-fou : aucune catégorie ne doit être « inventée » (somme = population) ──
  const sum = byCat.act_now.length + byCat.watch.length + byCat.dormant.length + byCat.documentary_silence.length
  console.log(`\n── Intégrité : somme catégories = ${sum} ; population Attention = ${items.length} → ${sum === items.length ? 'OK' : 'ÉCART'}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
