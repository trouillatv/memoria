/**
 * RECETTE ÉTAPE B — la création réelle dans les quatre familles.
 *
 * Ce que le navigateur ne montre pas : ce qui est VRAIMENT en base, sa
 * provenance, et ce qui se passe au second clic. Ce script déroule le même
 * chemin que la server action — mêmes helpers de création, même règle
 * anti-doublon — sur une visite de démonstration.
 *
 * Il CRÉE de vrais objets dans le tenant de démo, et ne supprime rien : ce qui
 * est créé doit rester visible dans l'interface pour être vérifié à l'œil.
 *
 *   npx tsx scripts/dev/_tmp-recette-etape-b.ts
 */
import 'dotenv/config'
import * as fs from 'fs'

for (const raw of fs.existsSync('.env.local') ? fs.readFileSync('.env.local', 'utf8').split('\n') : []) {
  const m = raw.replace(/\r$/, '').match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!
}

import { createClient } from '@supabase/supabase-js'
import { readOperationalItems, toCreate, signatureOf } from '../../lib/visits/cr-concretisation'
import type { OperationalItem } from '../../lib/visits/cr-concretisation'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

const REPORT = '9d382796-ff73-4d16-89c0-4979a4268f13'
const CREATED_FROM = 'cr_visite'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

/** L'état du chantier pour cette visite — la seule vérité de ce qui existe. */
async function existing(siteId: string): Promise<Set<string>> {
  const [a, d, dec, k] = await Promise.all([
    db.from('site_actions').select('title').eq('report_id', REPORT),
    db.from('site_deadlines').select('title').eq('report_id', REPORT).is('deleted_at', null),
    db.from('site_decisions').select('titre').eq('report_id', REPORT),
    db.from('captured_knowledge').select('title').eq('source_id', REPORT),
  ])
  const set = new Set<string>()
  for (const r of a.data ?? []) set.add(signatureOf({ kind: 'action', label: (r as { title: string }).title }))
  for (const r of d.data ?? []) set.add(signatureOf({ kind: 'echeance', label: (r as { title: string }).title }))
  for (const r of dec.data ?? []) set.add(signatureOf({ kind: 'decision', label: (r as { titre: string }).titre }))
  for (const r of k.data ?? []) set.add(signatureOf({ kind: 'memoire', label: (r as { title: string }).title }))
  return set
}

async function createOne(item: OperationalItem, siteId: string, orgId: string | null, userId: string) {
  if (item.kind === 'action') {
    return db.from('site_actions').insert({
      site_id: siteId, report_id: REPORT, title: item.label, due_date: item.due,
      due_date_status: item.due ? 'explicit' : null, created_by: userId, created_from: CREATED_FROM,
    })
  }
  if (item.kind === 'echeance') {
    return db.from('site_deadlines').insert({
      site_id: siteId, report_id: REPORT, organization_id: orgId, title: item.label,
      constraint_text: item.constraint, due_date: item.due,
      status: item.due ? 'planned' : 'to_plan', created_by: userId, created_from: CREATED_FROM,
    })
  }
  if (item.kind === 'decision') {
    return db.from('site_decisions').insert({
      site_id: siteId, report_id: REPORT, titre: item.label, echeance: item.due, confiance: 'à confirmer',
    })
  }
  return db.from('captured_knowledge').insert({
    organization_id: orgId, site_id: siteId, source_type: 'visit', source_id: REPORT,
    kind: 'a_savoir', title: item.label, created_by: userId,
  })
}

/** Un passage complet de concrétisation, comme le fait la server action. */
async function run(items: OperationalItem[], siteId: string, orgId: string | null, userId: string) {
  const deja = await existing(siteId)
  const { create, skipped } = toCreate(items, deja)
  const byKind: Record<string, number> = {}
  const failed: string[] = []
  for (const item of create) {
    const { error } = await createOne(item, siteId, orgId, userId)
    if (error) failed.push(`${item.label} (${error.message.slice(0, 40)})`)
    else byKind[item.kind] = (byKind[item.kind] ?? 0) + 1
  }
  const total = Object.values(byKind).reduce((n, v) => n + v, 0)
  return { byKind, total, skipped: skipped.length, failed }
}

async function main() {
  const { data: visit } = await db
    .from('site_reports').select('id, site_id, organization_id, created_by').eq('id', REPORT).single()
  const v = visit as { site_id: string; organization_id: string | null; created_by: string }
  const { data: doc } = await db
    .from('report_documents').select('sections').eq('report_id', REPORT).eq('template_key', 'cr_visite.v1').single()

  const items = readOperationalItems((doc as { sections: never[] }).sections).filter((i) => i.kind !== 'intervenant')
  console.log(`Visite ${REPORT} · ${items.length} éléments créables\n`)

  // ── PASSAGE 1 — la création réelle ────────────────────────────────────────
  console.log('— Passage 1 : création —')
  const r1 = await run(items, v.site_id, v.organization_id, v.created_by)
  console.log('  résumé :', JSON.stringify(r1.byKind), `total=${r1.total} déjà=${r1.skipped} échecs=${r1.failed.length}`)
  check('des objets ont été créés', r1.total > 0, `${r1.total}`)
  check('aucun échec', r1.failed.length === 0, r1.failed.join(' | '))

  // ── PROVENANCE ────────────────────────────────────────────────────────────
  const { data: acts } = await db.from('site_actions')
    .select('title, report_id, created_from').eq('report_id', REPORT).eq('created_from', CREATED_FROM)
  const rows = (acts ?? []) as Array<{ report_id: string; created_from: string | null }>
  check('les actions nées du CR portent report_id', rows.length > 0 && rows.every((r) => r.report_id === REPORT),
    `${rows.length} action(s)`)
  check("elles portent created_from = 'cr_visite'", rows.every((r) => r.created_from === CREATED_FROM))

  const { count: dl } = await db.from('site_deadlines')
    .select('id', { count: 'exact', head: true }).eq('report_id', REPORT).eq('created_from', CREATED_FROM)
  check('les échéances portent aussi la provenance', (dl ?? 0) > 0, `${dl}`)

  // ── PASSAGE 2 — exactement la même sélection ──────────────────────────────
  console.log('\n— Passage 2 : la MÊME sélection —')
  const r2 = await run(items, v.site_id, v.organization_id, v.created_by)
  console.log('  résumé :', JSON.stringify(r2.byKind), `total=${r2.total} déjà=${r2.skipped}`)
  check('rien n’est recréé au second clic', r2.total === 0, `total=${r2.total}`)
  check('tout est reconnu comme déjà là', r2.skipped === items.length, `${r2.skipped}/${items.length}`)

  // ── PASSAGE 3 — un élément neuf, lui seul doit naître ─────────────────────
  console.log('\n— Passage 3 : un élément neuf ajouté à la sélection —')
  const neuf: OperationalItem = {
    key: 'action:neuf', kind: 'action', label: `Contrôle recette ${Date.now().toString().slice(-6)}`,
    owner: null, due: null, constraint: null, sourceSection: 'actions',
  }
  const r3 = await run([...items, neuf], v.site_id, v.organization_id, v.created_by)
  check('seul l’élément neuf est créé', r3.total === 1, `total=${r3.total}`)
  check('les anciens sont ignorés', r3.skipped === items.length, `${r3.skipped}`)

  // ── PASSAGE 4 — échec partiel provoqué ────────────────────────────────────
  console.log('\n— Passage 4 : échec partiel provoqué (site_id invalide sur un élément) —')
  const bon: OperationalItem = { ...neuf, key: 'a:ok', label: `Recette OK ${Date.now().toString().slice(-5)}` }
  const mauvais: OperationalItem = { ...neuf, key: 'a:ko', label: `Recette KO ${Date.now().toString().slice(-5)}` }
  const deja4 = await existing(v.site_id)
  const { create: c4 } = toCreate([bon, mauvais], deja4)
  let ok4 = 0
  const failed4: string[] = []
  for (const item of c4) {
    // Le mauvais part sur un site inexistant : la FK le refuse.
    const site = item.label.includes('KO') ? '00000000-0000-0000-0000-000000000000' : v.site_id
    const { error } = await createOne(item, site, v.organization_id, v.created_by)
    if (error) failed4.push(item.label)
    else ok4++
  }
  check('le bon élément est créé malgré l’échec du second', ok4 === 1, `${ok4}`)
  check('l’échec est nommé, pas masqué', failed4.length === 1, failed4.join(','))

  console.log('\n— Relance après échec partiel —')
  const deja5 = await existing(v.site_id)
  const { create: c5, skipped: s5 } = toCreate([bon, mauvais], deja5)
  check('seul l’élément manquant est reproposé', c5.length === 1 && c5[0]!.label.includes('KO'), `${c5.length}`)
  check('celui qui avait réussi est ignoré', s5.length === 1)

  console.log(`\n${failures === 0 ? 'RECETTE ÉTAPE B VERTE' : `ROUGE — ${failures} échec(s)`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
