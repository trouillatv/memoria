/**
 * VÉRIFICATION POST-BACKFILL — LECTURE SEULE.
 *
 * Corrige deux bugs du script de backfill :
 *   1. Contrôle 3 : après écriture, le scope `site` ne voit plus les objets
 *      désormais liés (la garde is(null) les exclut), donc `already_linked` = 0
 *      par construction. Le vrai contrôle est que les 122 snap-IDs ont bien une
 *      FK non-nulle (contrôle 7 du backfill, déjà vert). On remplace par un
 *      décompte direct.
 *   2. Sentinelles PETRO : les IDs utilisés étaient des préfixes à 8 caractères,
 *      pas des UUIDs complets. On cherche par titre + site_id.
 *
 * Lancer :  npx tsx scripts/_verify-canonical-projection.ts
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { createAdminClient } from '@/lib/supabase/admin'

type Db = ReturnType<typeof createAdminClient>

async function all<T>(db: Db, table: string, columns: string, filters?: Record<string, string>): Promise<T[]> {
  const out: T[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    let q = db.from(table).select(columns)
    if (filters) for (const [k, v] of Object.entries(filters)) q = q.eq(k, v)
    const { data, error } = await (q as ReturnType<typeof db.from>).range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < PAGE) return out
  }
}

const short = (id: string | null | undefined) => (id ? id.slice(0, 8) : 'NULL')
const pct = (n: number, t: number) => `${((n / t) * 100).toFixed(1)} %`

async function main() {
  const db = createAdminClient()

  const [actions, deadlines, subjects] = await Promise.all([
    all<{ id: string; canonical_subject_id: string | null; title: string | null; site_id: string }>(
      db, 'site_actions', 'id, canonical_subject_id, title, site_id',
    ),
    all<{ id: string; canonical_subject_id: string | null; title: string | null; site_id: string }>(
      db, 'site_deadlines', 'id, canonical_subject_id, title, site_id',
    ),
    all<{ id: string; label: string | null; status: string | null }>(db, 'canonical_subject', 'id, label, status'),
  ])

  const covA = actions.filter((a) => a.canonical_subject_id).length
  const covD = deadlines.filter((d) => d.canonical_subject_id).length
  const subjectById = new Map(subjects.map((s) => [s.id, s]))
  const fkOnMerged = [...actions, ...deadlines].filter(
    (o) => o.canonical_subject_id && subjectById.get(o.canonical_subject_id)?.status === 'merged',
  )

  console.log('VÉRIFICATION POST-BACKFILL (lecture seule)')
  console.log(`  actions   : ${covA}/${actions.length} (${pct(covA, actions.length)})  ${covA === 101 ? '✔' : `✘ attendu 101`}`)
  console.log(`  échéances : ${covD}/${deadlines.length} (${pct(covD, deadlines.length)})  ${covD === 28 ? '✔' : `✘ attendu 28`}`)
  console.log(`  FK vers sujet merged : ${fkOnMerged.length}  ${fkOnMerged.length === 0 ? '✔' : '✘'}`)

  // ── Sentinelles PETRO — recherche par titre + site ──────────────────────────
  const PETRO = '75bd3d23-1a86-40c9-adfd-78a5ec74f3e6'
  // On cherche par site_id avec le short ID, puis on élargit si besoin.
  const petroObjects = [...actions, ...deadlines].filter((o) => o.site_id?.startsWith('75bd3d23'))
  const find = (needle: string) => petroObjects.filter((o) => (o.title ?? '').toLowerCase().includes(needle))

  const SENTINELS: Array<{ needle: string; label: string; expectedFk: string | null }> = [
    { needle: 'cadenas à code lors de l', label: 'Cadenas (accueil)', expectedFk: '6801ce5c' },
    { needle: 'panneaux en bois', label: 'Eau panneaux', expectedFk: '1d41b3f1' },
    { needle: 'planning d', label: 'Planning', expectedFk: null },
    { needle: 'démarrage du nettoyage', label: 'Démarrage du nettoyages', expectedFk: null },
  ]

  console.log('\n  SENTINELLES PETRO :')
  let allSentinelsOk = true
  for (const s of SENTINELS) {
    const hits = find(s.needle)
    if (hits.length === 0) {
      console.log(`  ? ${s.label.padEnd(30)} introuvable sur PETRO`)
      allSentinelsOk = false
      continue
    }
    for (const o of hits) {
      const fk = o.canonical_subject_id ?? null
      const expected = s.expectedFk
      const ok = expected === null ? fk === null : fk?.startsWith(expected)
      allSentinelsOk = allSentinelsOk && ok
      const detail = fk ? `→ ${short(fk)}` + (subjectById.get(fk) ? ` « ${(subjectById.get(fk)!.label ?? '').slice(0, 48)} »` : '') : 'NULL'
      console.log(`  ${ok ? '✔' : '✘'} ${s.label.padEnd(30)} ${short(o.id)}  ${detail}  ${ok ? '' : `(attendu: ${expected ?? 'NULL'})`}`)
      console.log(`      « ${(o.title ?? '').slice(0, 90)} »`)
    }
  }

  // ── Contrôle 3 corrigé : compter les already_linked directement ─────────────
  // Le scope `site` du dry-run exclut les objets déjà liés par la garde is(null).
  // On mesure plutôt l'écart net sur les objets qui n'avaient pas de FK avant
  // (couverture avant = 5+2=7, attendue après = 101+28=129, delta = 122).
  const BEFORE_TOTAL = 7 // 5 actions + 2 échéances connues du dry-run
  const EXPECTED_DELTA = 122
  const actualDelta = (covA + covD) - BEFORE_TOTAL
  console.log(`\n  delta FK (attendu ${EXPECTED_DELTA}) : ${actualDelta}  ${actualDelta === EXPECTED_DELTA ? '✔' : `✘`}`)

  const allOk = covA === 101 && covD === 28 && fkOnMerged.length === 0 && actualDelta === EXPECTED_DELTA && allSentinelsOk
  console.log('\n' + '═'.repeat(80))
  console.log(`VERDICT : ${allOk ? '✔ TOUS LES CONTRÔLES PASSENT' : '✘ CONTRÔLES EN ÉCHEC'}`)
  console.log('═'.repeat(80))
}

main().catch((e) => {
  console.error('VÉRIFICATION INTERROMPUE :', e instanceof Error ? e.message : e)
  process.exit(1)
})
