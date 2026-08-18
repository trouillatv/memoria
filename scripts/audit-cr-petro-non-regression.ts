// Corpus de non-régression CR — PETRO ATTITI 17/08/2026 (Vincent, 2026-08-18, étape 1/3).
// Rejoue tests/fixtures/cr-non-regression/petro-580403c8-baseline.json contre l'état
// LIVE de report_documents (doc validé) et site_reports.debrief_analysis pour ce report.
// LECTURE SEULE. Sert de témoin avant l'audit documentaire (étape 2) et le correctif
// de génération (étape 3) — ne doit jamais casser sur une reformulation du LLM, seulement
// sur la disparition/réapparition d'un fait, d'une correction humaine ou d'une règle de section.
import { config } from 'dotenv'
config({ path: '.env.local' })
import { readFileSync } from 'fs'
import { join } from 'path'
import { createAdminClient } from '../lib/supabase/admin'

type Rule =
  | { kind: 'must_appear'; scope: string; allOf?: string[]; anyOf?: string[] }
  | { kind: 'forbidden_substring'; scope: string; anyOf: string[] }
  | { kind: 'section_exclusive'; scope: string; keyword: string; allowedSections: string[] }

interface Invariant {
  id: string
  description: string
  rule: Rule
}

interface Fixture {
  reportId: string
  siteId: string
  sourceFingerprint: { captureCount: number }
  invariants: Invariant[]
}

function norm(s: string): string {
  return s.toLowerCase()
}

async function main() {
  const fixturePath = join(__dirname, '..', 'tests', 'fixtures', 'cr-non-regression', 'petro-580403c8-baseline.json')
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as Fixture

  const db = createAdminClient()

  const { data: report, error: reportErr } = await db
    .from('site_reports')
    .select('id, debrief_analysis')
    .eq('id', fixture.reportId)
    .single()
  if (reportErr || !report) throw new Error(`report introuvable: ${reportErr?.message ?? fixture.reportId}`)

  const { count: captureCount } = await db
    .from('visit_capture')
    .select('id', { count: 'exact', head: true })
    .eq('report_id', fixture.reportId)
  if (captureCount != null && captureCount !== fixture.sourceFingerprint.captureCount) {
    console.warn(
      `[WARN] captureCount live=${captureCount} ≠ fixture=${fixture.sourceFingerprint.captureCount} — la matière source a changé depuis le gel du corpus.`
    )
  }

  const { data: docs, error: docsErr } = await db
    .from('report_documents')
    .select('id, status, sections')
    .eq('report_id', fixture.reportId)
    .eq('status', 'validated')
    .order('created_at', { ascending: false })
    .limit(1)
  if (docsErr) throw new Error(docsErr.message)
  const validatedDoc = docs?.[0]
  if (!validatedDoc) throw new Error(`aucun report_document status=validated pour ${fixture.reportId}`)

  const sections = (validatedDoc.sections ?? []) as Array<{ key: string; content: string }>
  const sectionText = new Map<string, string>()
  for (const s of sections) sectionText.set(s.key, s.content ?? '')

  const analysis = report.debrief_analysis as any
  const debriefActionsText = JSON.stringify(analysis?.actions ?? [])
  const debriefAllText = analysis ? JSON.stringify(analysis) : ''

  const validatedDocText = sections.map((s) => s.content ?? '').join('\n')

  function scopeText(scope: string): string {
    if (scope === 'validated_doc') return validatedDocText
    if (scope === 'all') return `${validatedDocText}\n${debriefAllText}`
    if (scope === 'debrief_actions') return debriefActionsText
    // P0-I.2 : sortie brute du débrief IA (Agent 1/2), INDÉPENDANTE du document
    // validé — utile pour tester une régénération sans dépendre d'un validated_doc
    // figé avant le correctif (cf. task #82/#83).
    if (scope === 'debrief_analysis') return debriefAllText
    return sectionText.get(scope) ?? ''
  }

  let failures = 0

  for (const inv of fixture.invariants) {
    const { rule } = inv
    let pass = true
    let detail = ''

    if (rule.kind === 'must_appear') {
      const text = norm(scopeText(rule.scope))
      const allOfOk = (rule.allOf ?? []).every((kw) => text.includes(norm(kw)))
      const anyOfOk = !rule.anyOf || rule.anyOf.some((kw) => text.includes(norm(kw)))
      pass = allOfOk && anyOfOk
      if (!pass) {
        detail = `allOf=${JSON.stringify(rule.allOf ?? [])} anyOf=${JSON.stringify(rule.anyOf ?? [])} absent du scope "${rule.scope}"`
      }
    } else if (rule.kind === 'forbidden_substring') {
      const text = norm(scopeText(rule.scope))
      const hit = rule.anyOf.find((kw) => text.includes(norm(kw)))
      pass = !hit
      if (!pass) detail = `substring interdite trouvée: "${hit}" dans le scope "${rule.scope}"`
    } else if (rule.kind === 'section_exclusive') {
      const kw = norm(rule.keyword)
      const offenders = sections
        .filter((s) => !rule.allowedSections.includes(s.key))
        .filter((s) => norm(s.content ?? '').includes(kw))
        .map((s) => s.key)
      pass = offenders.length === 0
      if (!pass) detail = `"${rule.keyword}" trouvé hors sections autorisées (${rule.allowedSections.join(', ')}) dans: ${offenders.join(', ')}`
    }

    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${inv.id}${pass ? '' : ` — ${detail}`}`)
    if (!pass) failures++
  }

  console.log(`\n${fixture.invariants.length - failures}/${fixture.invariants.length} invariants OK`)
  if (failures > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
