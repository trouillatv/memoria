/**
 * Exploration : trouver les canonical_subjects OCEF Compostage aux labels proches
 * pour identifier les vrais faux-éclatements à utiliser dans le test.
 *
 * Usage :
 *   npx tsx scripts/discover-split-pairs.ts [--keyword r4]
 */

import { existsSync, readFileSync } from 'node:fs'

function loadEnvLocal() {
  const path = '.env.local'
  if (!existsSync(path)) return
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1)
    if (!(key in process.env)) process.env[key] = val
  }
}
loadEnvLocal()

async function sql(query: string): Promise<unknown[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN
  const res = await fetch('https://api.supabase.com/v1/projects/srixnofmaydxouhucawn/database/query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`API ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

const SITE_COMPOSTAGE = '2c939e67-e986-4635-86a0-638cda870480'

const STOPWORDS = new Set([
  'de','du','la','le','les','des','un','une','et','ou','au','aux',
  'en','par','pour','sur','sous','dans','avec','sans','ce','se',
  'l','d','est','sont','ete','etre','avoir','y','il','ils',
])

function normalize(label: string): Set<string> {
  const tokens = label
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
  return new Set(tokens)
}

function jaccard(a: string, b: string): number {
  const tA = normalize(a)
  const tB = normalize(b)
  if (tA.size === 0 && tB.size === 0) return 1
  if (tA.size === 0 || tB.size === 0) return 0
  let inter = 0
  for (const t of tA) if (tB.has(t)) inter++
  return inter / (tA.size + tB.size - inter)
}

function extractCodes(label: string): Set<string> {
  const matches = label.toUpperCase().match(/\b([A-Z]{1,4}\d+|\d+[A-Z]{1,3})\b/g) ?? []
  return new Set(matches)
}

async function main() {
  const kwIdx = process.argv.indexOf('--keyword')
  const keyword = kwIdx !== -1 ? process.argv[kwIdx + 1] : null

  // Tous les canonical_subjects du site avec leur thread_id
  const rows = await sql(`
    SELECT cs.id AS cs_id, cs.label, cs.aliases,
           sti.subject_thread_id
    FROM canonical_subject cs
    JOIN subject_thread_identity sti ON sti.canonical_subject_id = cs.id
    WHERE cs.site_id = '${SITE_COMPOSTAGE}'
      AND cs.status = 'active'
    ORDER BY cs.label
  `) as Array<{ cs_id: string; label: string; aliases: string[]; subject_thread_id: string }>

  console.log(`Total canonical_subjects : ${rows.length}\n`)

  // Filtrer par keyword si demandé
  const filtered = keyword
    ? rows.filter((r) => r.label.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').includes(keyword.toLowerCase()))
    : rows

  if (keyword) {
    console.log(`Résultats pour keyword "${keyword}" :\n`)
    for (const r of filtered) {
      console.log(`  [${r.cs_id}]`)
      console.log(`    label  : ${r.label}`)
      console.log(`    thread : ${r.subject_thread_id}`)
      console.log()
    }
    return
  }

  // Sinon : trouver les paires avec Jaccard > 0.30 ou code technique commun
  console.log('=== Paires potentiellement faux-éclatées (Jaccard > 0.30 ou code commun) ===\n')
  const pairs: Array<{ a: typeof rows[0]; b: typeof rows[0]; score: number; sharedCode: boolean }> = []

  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i]
      const b = rows[j]
      const score = jaccard(a.label, b.label)
      const codesA = extractCodes(a.label)
      const codesB = extractCodes(b.label)
      const sharedCode = [...codesA].some((c) => codesB.has(c))
      if (score > 0.30 || sharedCode) {
        pairs.push({ a, b, score, sharedCode })
      }
    }
  }

  // Trier par score décroissant
  pairs.sort((x, y) => y.score - x.score)

  console.log(`${pairs.length} paires trouvées\n`)

  // Afficher les 50 premières
  for (const p of pairs.slice(0, 50)) {
    const codeFlag = p.sharedCode ? ' [CODE_COMMUN]' : ''
    console.log(`Jaccard=${p.score.toFixed(2)}${codeFlag}`)
    console.log(`  A: [${p.a.cs_id.slice(0, 8)}…] "${p.a.label}"`)
    console.log(`  B: [${p.b.cs_id.slice(0, 8)}…] "${p.b.label}"`)
    console.log()
  }
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1) })
