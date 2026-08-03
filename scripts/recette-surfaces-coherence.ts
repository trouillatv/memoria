// Recette transversale — cohérence des surfaces sur 4 cas d'attribution
// Usage : npx tsx scripts/recette-surfaces-coherence.ts
//
// Crée (idempotent) 4 actions de test sur le chantier OCEF Recette Chemin B,
// puis simule exactement la logique de chaque read-model pour vérifier que
// les trois surfaces racontent la même chose.
//
// Cas couverts :
//   1. DUMEZ seul               (assigned_company_id, pas de contact)
//   2. DUMEZ + Jean Dupont      (assigned_company_id + assigned_contact_id)
//   3. Fallback texte ancien    (assigned_to = "BECIB", pas de FK)
//   4. Sans responsable         (rien)

import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'

function loadEnv() {
  if (!existsSync('.env.local')) return
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const l = line.trim(); if (!l || l.startsWith('#')) continue
    const eq = l.indexOf('='); if (eq < 0) continue
    const k = l.slice(0, eq).trim(); let v = l.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!(k in process.env)) process.env[k] = v
  }
}
loadEnv()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[FATAL] NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis')
  process.exit(1)
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

// ── Constantes du chantier de recette (créé lors de la recette Chemin B) ──────
const ORG_ID       = '95df55b5-11cf-4ace-b2ca-18b000ba9b25'
const SITE_ID      = 'fae6149d-f490-4b8e-b1fa-34f0ce8a32b4' // OCEF — Recette Chemin B
const ADMIN_USER   = 'c16d2984-74d8-4f8b-9f8e-0efadc342f0d'

function pass(msg: string) { console.log(`  ✓  ${msg}`) }
function fail(msg: string) { console.log(`  ✗  ${msg}`) }
function info(msg: string) { console.log(`  —  ${msg}`) }

// ── Types internes ────────────────────────────────────────────────────────────
interface ActionRow { id: string; title: string; assigned_company_id: string | null; assigned_contact_id: string | null; assigned_to: string | null }
interface CaseVerdict { db: 'OK' | 'FAIL'; ficheEntreprise: string; ficheContact: string; vieduSujet: string; verdict: 'PASS' | 'FAIL' }

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════╗')
  console.log('║  Recette Surfaces — Cohérence transversale (4 cas)     ║')
  console.log('╚════════════════════════════════════════════════════════╝\n')

  // ── [1/6] Trouver DUMEZ dans l'org ────────────────────────────────────────
  console.log('[1/6] Localisation de DUMEZ')
  const { data: dumezRows, error: e1 } = await db.from('companies')
    .select('id, name, short_name')
    .eq('organization_id', ORG_ID)
    .ilike('name', '%DUMEZ%')
    .is('deleted_at', null)
  if (e1 || !dumezRows?.length) { console.error('[FATAL] DUMEZ introuvable :', e1?.message ?? 'aucune ligne') ; process.exit(1) }
  const dumez = dumezRows[0] as { id: string; name: string; short_name: string | null }
  const dumezLabel = dumez.short_name || dumez.name
  info(`${dumezLabel} → ${dumez.id}`)

  // ── [2/6] Contact Jean Dupont pour DUMEZ ──────────────────────────────────
  console.log('\n[2/6] Contact Jean Dupont')
  const { data: jdRows } = await db.from('company_contacts')
    .select('id, full_name')
    .eq('company_id', dumez.id)
    .ilike('full_name', '%Jean Dupont%')
    .is('deleted_at', null)
  let jeanDupont = (jdRows?.[0] as { id: string; full_name: string } | undefined)
  if (!jeanDupont) {
    const { data: created, error: e2 } = await db.from('company_contacts').insert({
      company_id: dumez.id,
      organization_id: ORG_ID,
      full_name: 'Jean Dupont',
      function: 'Conducteur de travaux (recette)',
    }).select('id, full_name').single()
    if (e2 || !created) { console.error('[FATAL] Création Jean Dupont :', e2?.message) ; process.exit(1) }
    jeanDupont = created as { id: string; full_name: string }
    info(`Créé → ${jeanDupont.id}`)
  } else {
    info(`Existant → ${jeanDupont.id}`)
  }

  // ── [3/6] Sujets de test ───────────────────────────────────────────────────
  console.log('\n[3/6] Sujets de recette')
  const SUBJECT_DEFS = [
    'Recette — Regard R4',
    'Recette — Rapport G3',
    'Recette — Récolement',
    'Recette — Plan de gestion des eaux',
  ]
  const subjectIds: string[] = []
  for (const name of SUBJECT_DEFS) {
    const { data: ex } = await db.from('subjects').select('id').eq('site_id', SITE_ID).eq('name', name).maybeSingle()
    if (ex) {
      subjectIds.push(ex.id as string)
      info(`"${name}" existant`)
    } else {
      const { data: cr, error: e3 } = await db.from('subjects').insert({
        organization_id: ORG_ID, site_id: SITE_ID, name, status: 'open', created_by: ADMIN_USER,
      }).select('id').single()
      if (e3 || !cr) { console.error('[FATAL] Création sujet :', e3?.message) ; process.exit(1) }
      subjectIds.push(cr.id as string)
      info(`"${name}" créé → ${cr.id}`)
    }
  }
  const [subR4, subG3, subReco, subPlan] = subjectIds

  // ── [4/6] Actions de test ─────────────────────────────────────────────────
  console.log('\n[4/6] Actions de test')
  const ACTION_DEFS = [
    { title: 'Recette — Reprendre le réseau au droit du regard R4',     subject: subR4,   companyId: dumez.id, contactId: null as string | null, textFallback: null as string | null },
    { title: 'Recette — Transmettre le rapport G3',                      subject: subG3,   companyId: dumez.id, contactId: jeanDupont.id,           textFallback: null as string | null },
    { title: 'Recette — Vérifier le récolement des canalisations',       subject: subReco, companyId: null,     contactId: null,                     textFallback: 'BECIB' },
    { title: 'Recette — Mettre à jour le plan de gestion des eaux',      subject: subPlan, companyId: null,     contactId: null,                     textFallback: null },
  ]
  const actionIds: string[] = []
  for (const def of ACTION_DEFS) {
    const { data: ex } = await db.from('site_actions').select('id').eq('site_id', SITE_ID).eq('title', def.title).maybeSingle()
    if (ex) {
      // Met à jour les FK pour garantir l'état voulu (idempotent)
      await db.from('site_actions').update({
        subject_id: def.subject,
        assigned_company_id: def.companyId,
        assigned_contact_id: def.contactId,
        assigned_to: def.textFallback,
        status: 'open',
      }).eq('id', ex.id as string)
      actionIds.push(ex.id as string)
      info(`"${def.title.slice(0, 55)}" mis à jour`)
    } else {
      const { data: cr, error: e4 } = await db.from('site_actions').insert({
        site_id: SITE_ID,
        subject_id: def.subject,
        title: def.title,
        status: 'open',
        assigned_company_id: def.companyId,
        assigned_contact_id: def.contactId,
        assigned_to: def.textFallback,
        created_by: ADMIN_USER,
      }).select('id').single()
      if (e4 || !cr) { console.error('[FATAL] Création action :', e4?.message) ; process.exit(1) }
      actionIds.push(cr.id as string)
      info(`"${def.title.slice(0, 55)}" créé → ${cr.id}`)
    }
  }
  const [actR4, actG3, actReco, actPlan] = actionIds

  // ── [5/6] Lecture DB canonique ────────────────────────────────────────────
  console.log('\n[5/6] Lecture DB canonique')
  const { data: dbRows } = await db.from('site_actions')
    .select('id, title, assigned_company_id, assigned_contact_id, assigned_to')
    .in('id', actionIds)
  const actMap = new Map((dbRows ?? []).map((r: unknown) => {
    const a = r as ActionRow
    return [a.id, a]
  }))

  function dbState(id: string, expCompany: string | null, expContact: string | null, expText: string | null): 'OK' | 'FAIL' {
    const a = actMap.get(id)
    if (!a) { fail(`Action ${id.slice(0,8)} introuvable`); return 'FAIL' }
    const ok = a.assigned_company_id === expCompany && a.assigned_contact_id === expContact && a.assigned_to === expText
    if (ok) pass(`company=${expCompany?.slice(0,8) ?? 'NULL'} contact=${expContact?.slice(0,8) ?? 'NULL'} text=${expText ?? 'NULL'}`)
    else fail(`company=${a.assigned_company_id?.slice(0,8) ?? 'NULL'} contact=${a.assigned_contact_id?.slice(0,8) ?? 'NULL'} text=${a.assigned_to ?? 'NULL'}`)
    return ok ? 'OK' : 'FAIL'
  }
  const s1 = dbState(actR4,   dumez.id, null,           null)
  const s2 = dbState(actG3,   dumez.id, jeanDupont.id,  null)
  const s3 = dbState(actReco, null,     null,            'BECIB')
  const s4 = dbState(actPlan, null,     null,            null)

  // ── [6a/6] Fiche entreprise DUMEZ (logique getCompanyFiche simulée) ────────
  console.log('\n[6a/6] Fiche entreprise DUMEZ')
  // Requête équivalente : site_actions WHERE assigned_company_id = DUMEZ AND status = open
  const { data: ficheRows } = await db.from('site_actions')
    .select('id, assigned_contact_id')
    .eq('assigned_company_id', dumez.id)
    .eq('status', 'open')
    .eq('site_id', SITE_ID)
  const ficheSet = new Set((ficheRows ?? []).map((r: unknown) => (r as { id: string }).id))

  // contactNameById : map issue des company_contacts déjà chargés (logique buildCompanyFiche)
  const cnById = new Map([[jeanDupont.id, 'Jean Dupont']])

  function fiche(id: string, expPresent: boolean, expContactName: string | null): string {
    const present = ficheSet.has(id)
    if (!expPresent) {
      if (!present) { pass(`absente (attendu)`); return 'n/a' }
      fail(`présente à tort dans la fiche DUMEZ`); return 'FAIL'
    }
    if (!present) { fail(`absente alors qu'elle doit apparaître`); return 'ABSENT' }
    const row = (ficheRows ?? []).find((r: unknown) => (r as { id: string }).id === id) as { id: string; assigned_contact_id: string | null } | undefined
    const resolvedContact = row?.assigned_contact_id ? (cnById.get(row.assigned_contact_id) ?? null) : null
    if (resolvedContact === expContactName) {
      pass(`présente · contact="${resolvedContact ?? '(aucun)'}"`)
      return resolvedContact ?? '(pas de contact)'
    }
    fail(`contact attendu="${expContactName}" obtenu="${resolvedContact}"`)
    return 'FAIL'
  }
  const fe1 = fiche(actR4,   true,  null)
  const fe2 = fiche(actG3,   true,  'Jean Dupont')
  const fe3 = fiche(actReco, false, null)
  const fe4 = fiche(actPlan, false, null)

  // ── [6b/6] Fiche contact Jean Dupont (isReferent dans fiche DUMEZ) ─────────
  console.log('\n[6b/6] Fiche contact Jean Dupont (isReferent)')
  const referentIds = new Set(
    (ficheRows ?? [])
      .map((r: unknown) => (r as { assigned_contact_id: string | null }).assigned_contact_id)
      .filter((v): v is string => !!v)
  )
  let fc2: string
  if (referentIds.has(jeanDupont.id)) {
    pass('Jean Dupont → isReferent=true (apparaît dans fiche DUMEZ)'); fc2 = 'isReferent=true'
  } else {
    fail('Jean Dupont → isReferent=false (absent de referentContactIds)'); fc2 = 'FAIL'
  }
  // Autres cas : Jean Dupont n'a rien à faire dans les cas 1, 3, 4
  const fc1 = 'n/a'
  const fc3 = 'n/a'
  const fc4 = 'n/a'

  // ── [6c/6] Vie du sujet — actionResponsibleLabel (logique identique page.tsx) ─
  console.log('\n[6c/6] Vie du sujet — actionResponsibleLabel')
  // companyNameById (même logique que la page)
  const coById = new Map([[dumez.id, dumezLabel]])

  function responsibleLabel(id: string): string | null {
    const a = actMap.get(id)
    if (!a) return null
    const co = a.assigned_company_id ? (coById.get(a.assigned_company_id) ?? null) : null
    const ct = a.assigned_contact_id ? (cnById.get(a.assigned_contact_id) ?? null) : null
    return co && ct ? `${co} · ${ct}` : co ?? ct ?? a.assigned_to ?? null
  }

  function vs(id: string, expected: string | null): string {
    const got = responsibleLabel(id)
    if (got === expected) { pass(`"${got ?? '(aucun)'}"`); return got ?? '(aucun)' }
    fail(`attendu="${expected ?? '(aucun)'}" → obtenu="${got ?? '(aucun)'}"`)
    return `FAIL`
  }
  const v1 = vs(actR4,   dumezLabel)
  const v2 = vs(actG3,   `${dumezLabel} · Jean Dupont`)
  const v3 = vs(actReco, 'BECIB')
  const v4 = vs(actPlan, null)

  // ── Tableau récapitulatif ─────────────────────────────────────────────────
  console.log('\n\n══ Tableau récapitulatif ═══════════════════════════════════════════════════\n')

  function verdict(dbOk: string, feOk: string, fcOk: string, vsOk: string): 'PASS' | 'FAIL' {
    return (!dbOk.startsWith('FAIL') && !feOk.startsWith('FAIL') && !fcOk.startsWith('FAIL') && !vsOk.startsWith('FAIL')) ? 'PASS' : 'FAIL'
  }

  const rows: [string, string, string, string, string, string][] = [
    ['DUMEZ seul',        s1, fe1, fc1, v1, verdict(s1, fe1, fc1, v1)],
    ['DUMEZ + Jean',      s2, fe2, fc2, v2, verdict(s2, fe2, fc2, v2)],
    ['Fallback texte',    s3, fe3, fc3, v3, verdict(s3, fe3, fc3, v3)],
    ['Sans responsable',  s4, fe4, fc4, v4, verdict(s4, fe4, fc4, v4)],
  ]
  const header: string[] = ['Cas', 'DB', 'Fiche entreprise', 'Fiche contact', 'Vie du sujet', 'Verdict']
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i as 0]!.length)) + 2)
  const pad = (s: string, w: number) => s.padEnd(w)
  console.log(header.map((h, i) => pad(h, widths[i]!)).join('│'))
  console.log(widths.map((w) => '─'.repeat(w)).join('┼'))
  rows.forEach((r) => console.log(r.map((v, i) => pad(v, widths[i]!)).join('│')))

  const passCount = rows.filter((r) => r[5] === 'PASS').length
  console.log(`\n${passCount}/4 cas PASS`)
  if (passCount < 4) process.exit(1)
}

main().catch((e) => { console.error('[FATAL]', e); process.exit(1) })
