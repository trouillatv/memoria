// Corpus empirique Évolution V2
// Extrait les paires d'événements consécutifs par canonical_subject pour annotation humaine.
//
// Usage : npx tsx scripts/build-evolution-corpus.ts [--site <siteId>]
// Par défaut : site PETRO ATITI
//
// Output : scripts/evolution-corpus-raw.json
// Format de chaque entrée :
//   { subjectId, subjectLabel, eventA, eventB }
//   eventA / eventB : { date, visitStatus, labels[], evidenceCount }
//   → verdict humain à remplir manuellement : 'evolution' | 'remention' | 'ambigu' | ''

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
  subjectId: string
  subjectLabel: string
  eventA: Event
  eventB: Event
  /** À remplir manuellement : 'evolution' | 'remention' | 'ambigu' */
  verdictHumain: ''
  /** À remplir manuellement : raison métier en une phrase */
  raisonMetier: ''
  /** Rempli automatiquement : V1 aurait-il détecté un changement ? */
  v1Signal: boolean
  /** Rempli automatiquement : nature du signal V1 */
  v1SignalReason: string
}

async function main() {
  console.log(`\n=== CORPUS ÉVOLUTION — site ${SITE_ARG} ===\n`)

  // 1. Sujets actifs du site
  const { data: subjects } = await sb
    .from('canonical_subject')
    .select('id, label')
    .eq('site_id', SITE_ARG)
    .eq('status', 'active')
    .order('label')

  if (!subjects?.length) { console.error('Aucun sujet actif'); process.exit(1) }
  console.log(`Sujets actifs : ${subjects.length}`)

  // 2. Occurrences terrain de tous ces sujets
  const subjectIds = subjects.map((s: { id: string }) => s.id)
  const { data: occs } = await sb
    .from('canonical_subject_occurrence')
    .select('canonical_subject_id, source_kind, effective_date, visit_status, label, evidence_count')
    .in('canonical_subject_id', subjectIds)
    .in('source_kind', ['field_visit', 'meeting'])
    .neq('validation_status', 'rejected')
    .order('effective_date', { ascending: true })

  if (!occs?.length) { console.error('Aucune occurrence terrain'); process.exit(1) }

  // 3. Grouper par sujet puis par événement (sourceKind + date)
  const bySubject = new Map<string, Map<string, Event>>()

  for (const occ of (occs as RawOcc[])) {
    const sid = occ.canonical_subject_id
    if (!bySubject.has(sid)) bySubject.set(sid, new Map())
    const eventMap = bySubject.get(sid)!
    const key = `${occ.source_kind}\x00${occ.effective_date}`

    if (!eventMap.has(key)) {
      eventMap.set(key, {
        date: occ.effective_date,
        visitStatus: occ.visit_status,
        labels: [],
        evidenceCount: 0,
      })
    }
    const ev = eventMap.get(key)!
    ev.labels.push(occ.label)
    ev.evidenceCount += occ.evidence_count ?? 1
    // Enrichir le statut si null → non-null
    if (ev.visitStatus === null && occ.visit_status !== null) ev.visitStatus = occ.visit_status
  }

  // 4. Construire les paires consécutives
  const corpus: CorpusEntry[] = []
  const subjectMap = new Map(subjects.map((s: { id: string; label: string }) => [s.id, s.label]))

  for (const [sid, eventMap] of bySubject.entries()) {
    const events = [...eventMap.values()] // déjà trié (insertion-order = chrono)
    if (events.length < 2) {
      console.log(`  ${subjectMap.get(sid)} — 1 seul événement, pas de paire`)
      continue
    }

    for (let i = 0; i < events.length - 1; i++) {
      const a = events[i]
      const b = events[i + 1]

      // Signal V1 : changement de visitStatus entre A et B
      const v1Signal = b.visitStatus !== a.visitStatus
      const v1SignalReason = v1Signal
        ? `visitStatus : "${a.visitStatus ?? 'null'}" → "${b.visitStatus ?? 'null'}"`
        : 'aucun (statuts identiques)'

      corpus.push({
        subjectId: sid,
        subjectLabel: subjectMap.get(sid) ?? sid,
        eventA: a,
        eventB: b,
        verdictHumain: '',
        raisonMetier: '',
        v1Signal,
        v1SignalReason,
      })
    }
  }

  // 5. Résumé console
  console.log(`\nPaires extraites : ${corpus.length}`)
  console.log('\nAperçu :')
  for (const entry of corpus) {
    const signal = entry.v1Signal ? '🔴 SIGNAL' : '⬜ pas de signal'
    console.log(`\n  [${entry.subjectLabel}]`)
    console.log(`  A (${entry.eventA.date}) : ${entry.eventA.labels.slice(0, 2).join(' / ')} [${entry.eventA.visitStatus ?? 'null'}]`)
    console.log(`  B (${entry.eventB.date}) : ${entry.eventB.labels.slice(0, 2).join(' / ')} [${entry.eventB.visitStatus ?? 'null'}]`)
    console.log(`  V1 : ${signal} — ${entry.v1SignalReason}`)
  }

  // 6. Export JSON
  const outPath = join(process.cwd(), 'scripts', 'evolution-corpus-raw.json')
  writeFileSync(outPath, JSON.stringify(corpus, null, 2), 'utf-8')
  console.log(`\n✅ Corpus sauvegardé : ${outPath}`)
  console.log('   Remplir "verdictHumain" et "raisonMetier" pour chaque entrée.')
  console.log('   Valeurs verdictHumain : "evolution" | "remention" | "ambigu"')
}

main().catch((e) => {
  console.error('❌', e.message)
  process.exit(1)
})
