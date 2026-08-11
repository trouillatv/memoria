// Corpus empirique Évolution V2 — extraction multi-angles
//
// Usage : npx tsx scripts/build-evolution-corpus.ts [--site <siteId>]
// Par défaut : site PETRO ATITI
//
// Output : scripts/evolution-corpus-raw.json
//
// Angles extraits :
//   A. Paires d'événements consécutifs  (transitions entre visites)
//   B. Sujets à occurrence unique        (contre-exemples : pas d'évolution possible)
//   C. Intra-événement                  (formulations différentes d'une même visite)
//
// verdictHumain : 'evolution' | 'remention' | 'ambigu' | 'contre-exemple' | ''
// changeType    : 'status' | 'scope' | 'operationalization' | 'consequence' | null | ''
// patternV2     : hypothèse de pattern, pas encore règle

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { writeFileSync } from 'fs'
import { join } from 'path'

config({ path: '.env.local' })

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const SITE_ARG = (() => {
  const idx = process.argv.indexOf('--site')
  return idx !== -1 ? process.argv[idx + 1] : '75bd3d23-d515-46bd-8de8-254495a5bade' // PETRO ATITI
})()

type RawOcc = {
  canonical_subject_id: string
  source_kind: string
  effective_date: string
  visit_status: string | null
  label: string
  evidence_count: number
}

type Event = {
  date: string
  visitStatus: string | null
  labels: string[]
  evidenceCount: number
}

type CorpusEntry = {
  angle: 'consecutive' | 'single-occurrence' | 'intra-event'
  subjectId: string
  subjectLabel: string
  eventA: Event | null
  eventB: Event | null
  /** À remplir manuellement */
  verdictHumain: 'evolution' | 'remention' | 'ambigu' | 'contre-exemple' | ''
  /** À remplir manuellement */
  changeType: 'status' | 'scope' | 'operationalization' | 'consequence' | '' | null
  /** À remplir manuellement */
  raisonMetier: string
  /** Hypothèse de pattern identifié (nullable) */
  patternV2: string | null
  v1Signal: boolean
  v1SignalReason: string
}

async function main() {
  console.log(`\n=== CORPUS ÉVOLUTION MULTI-ANGLES — site ${SITE_ARG} ===\n`)

  // 1. Sujets actifs du site
  const { data: subjects } = await sb
    .from('canonical_subject')
    .select('id, label')
    .eq('site_id', SITE_ARG)
    .eq('status', 'active')
    .order('label')

  if (!subjects?.length) { console.error('Aucun sujet actif'); process.exit(1) }

  const subjectIds = subjects.map((s: { id: string }) => s.id)
  const subjectMap = new Map(subjects.map((s: { id: string; label: string }) => [s.id, s.label]))

  // 2. Occurrences terrain
  const { data: occs } = await sb
    .from('canonical_subject_occurrence')
    .select('canonical_subject_id, source_kind, effective_date, visit_status, label, evidence_count')
    .in('canonical_subject_id', subjectIds)
    .in('source_kind', ['field_visit', 'meeting'])
    .neq('validation_status', 'rejected')
    .order('effective_date', { ascending: true })

  if (!occs?.length) { console.error('Aucune occurrence'); process.exit(1) }

  // 3. Grouper par sujet → par événement (sourceKind+date)
  const bySubject = new Map<string, Map<string, Event>>()
  for (const occ of (occs as RawOcc[])) {
    const sid = occ.canonical_subject_id
    if (!bySubject.has(sid)) bySubject.set(sid, new Map())
    const eventMap = bySubject.get(sid)!
    const key = `${occ.source_kind}\x00${occ.effective_date}`
    if (!eventMap.has(key)) {
      eventMap.set(key, { date: occ.effective_date, visitStatus: occ.visit_status, labels: [], evidenceCount: 0 })
    }
    const ev = eventMap.get(key)!
    ev.labels.push(occ.label)
    ev.evidenceCount += occ.evidence_count ?? 1
    if (ev.visitStatus === null && occ.visit_status !== null) ev.visitStatus = occ.visit_status
  }

  const corpus: CorpusEntry[] = []

  // ── Angle A : paires consécutives (transitions entre visites) ──────────────
  console.log('\n── Angle A : paires consécutives ──')
  for (const [sid, eventMap] of bySubject.entries()) {
    const events = [...eventMap.values()]
    if (events.length < 2) continue
    for (let i = 0; i < events.length - 1; i++) {
      const a = events[i]; const b = events[i + 1]
      const v1Signal = b.visitStatus !== a.visitStatus
      corpus.push({
        angle: 'consecutive',
        subjectId: sid, subjectLabel: subjectMap.get(sid) ?? sid,
        eventA: a, eventB: b,
        verdictHumain: '', changeType: '', raisonMetier: '', patternV2: null,
        v1Signal,
        v1SignalReason: v1Signal
          ? `visitStatus : "${a.visitStatus ?? 'null'}" → "${b.visitStatus ?? 'null'}"`
          : 'aucun (statuts identiques)',
      })
      console.log(`  [${subjectMap.get(sid)}] ${a.date} → ${b.date}`)
    }
  }

  // ── Angle B : sujets à occurrence unique (contre-exemples) ─────────────────
  console.log('\n── Angle B : sujets à occurrence unique ──')
  for (const [sid, eventMap] of bySubject.entries()) {
    const events = [...eventMap.values()]
    if (events.length !== 1) continue
    const ev = events[0]
    corpus.push({
      angle: 'single-occurrence',
      subjectId: sid, subjectLabel: subjectMap.get(sid) ?? sid,
      eventA: ev, eventB: null,
      verdictHumain: 'contre-exemple', changeType: null,
      raisonMetier: 'Sujet avec un seul événement — aucune transition possible.',
      patternV2: null,
      v1Signal: false, v1SignalReason: 'occurrence unique',
    })
    console.log(`  [${subjectMap.get(sid)}] ${ev.date} — ${ev.labels.length} preuve(s)`)
  }

  // ── Angle C : intra-événement (formulations différentes même visite) ────────
  console.log('\n── Angle C : intra-événement ──')
  for (const [sid, eventMap] of bySubject.entries()) {
    for (const ev of eventMap.values()) {
      if (ev.labels.length < 2) continue
      corpus.push({
        angle: 'intra-event',
        subjectId: sid, subjectLabel: subjectMap.get(sid) ?? sid,
        eventA: ev, eventB: null,
        verdictHumain: '', changeType: null,
        raisonMetier: '',
        patternV2: null,
        v1Signal: false,
        v1SignalReason: `${ev.labels.length} formulations dans le même événement`,
      })
      console.log(`  [${subjectMap.get(sid)}] ${ev.date} — ${ev.labels.length} formulations`)
    }
  }

  // ── Résumé ──────────────────────────────────────────────────────────────────
  const byAngle = (a: CorpusEntry['angle']) => corpus.filter((e) => e.angle === a).length
  console.log(`\n  Angle A (consécutives)  : ${byAngle('consecutive')}`)
  console.log(`  Angle B (unique)        : ${byAngle('single-occurrence')}`)
  console.log(`  Angle C (intra-événement): ${byAngle('intra-event')}`)
  console.log(`  Total                   : ${corpus.length}`)

  // Export
  const outPath = join(process.cwd(), 'scripts', 'evolution-corpus-raw.json')
  writeFileSync(outPath, JSON.stringify(corpus, null, 2), 'utf-8')
  console.log(`\n✅ Corpus sauvegardé : ${outPath}`)
}

main().catch((e) => { console.error('❌', e.message); process.exit(1) })
