/**
 * P3-B — inventaire du vocabulaire fermé disponible pour normaliser un transcript.
 *
 * Un normaliseur déterministe ne peut corriger un terme que s'il existe une
 * cible autorisée. Ce script mesure la MATIÈRE PREMIÈRE, pas l'algorithme :
 * combien de termes, de quelle source, et surtout deux termes du vocabulaire
 * sont-ils assez proches pour qu'une correction automatique puisse se tromper
 * de cible (le seul cas qui doit interdire la correction).
 *
 * Recette reproductible : à relancer avant d'activer la normalisation sur un
 * nouveau chantier. Lecture seule, aucun appel de modèle.
 *
 *   npx tsx scripts/audit-stt-vocabulary.ts <siteId>
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const PETRO_SITE_ID = '75bd3d23-d515-46bd-8de8-254495a5bade'

type Source = 'site' | 'knowledge' | 'alias' | 'organization' | 'contact' | 'subject'

async function main() {
  const siteId = process.argv[2] ?? PETRO_SITE_ID
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) { console.error('Variables Supabase absentes de .env.local'); process.exit(1) }
  const admin = createClient(url, key, { auth: { persistSession: false } })

  const site = await admin.from('sites').select('name, organization_id').eq('id', siteId).single()
  if (site.error) { console.error(`site introuvable : ${site.error.message}`); process.exit(1) }
  const orgId = site.data.organization_id as string
  console.log(`Chantier « ${site.data.name} » · organisation ${orgId}\n`)

  const terms: Array<{ label: string; source: Source; detail?: string }> = []
  terms.push({ label: site.data.name as string, source: 'site' })

  // 1. Mémoire sémantique — la source PRÉVUE pour ça (migrations 248-249).
  const ents = await admin
    .from('site_knowledge_entities')
    .select('id, canonical_label, entity_type, is_active, site_id, user_id')
    .eq('organization_id', orgId)
  if (ents.error) {
    console.error(`site_knowledge_entities : ERREUR ${ents.error.message}`)
  } else {
    const visible = (ents.data ?? []).filter(
      (e) => e.is_active !== false && (e.site_id === null || e.site_id === siteId),
    )
    console.log(`site_knowledge_entities : ${ents.data?.length ?? 0} dans l'org, ${visible.length} visibles ici`)
    for (const e of visible) {
      terms.push({ label: e.canonical_label as string, source: 'knowledge', detail: e.entity_type as string })
    }
    if (visible.length) {
      const aliases = await admin
        .from('site_knowledge_entity_aliases')
        .select('alias, entity_id')
        .in('entity_id', visible.map((e) => e.id))
      if (aliases.error) console.error(`aliases : ERREUR ${aliases.error.message}`)
      else {
        console.log(`site_knowledge_entity_aliases : ${aliases.data?.length ?? 0} alias`)
        for (const a of aliases.data ?? []) terms.push({ label: a.alias as string, source: 'alias' })
      }
    }
  }

  // 2. Acteurs — vrai vocabulaire fermé, aujourd'hui NON branché au STT.
  const orgs = await admin.from('organizations').select('name').eq('id', orgId)
  for (const o of orgs.data ?? []) terms.push({ label: o.name as string, source: 'organization' })

  const inter = await admin.from('site_intervenants').select('*').eq('site_id', siteId)
  if (inter.error) {
    console.error(`site_intervenants : ERREUR ${inter.error.message}`)
  } else {
    const actifs = (inter.data ?? []).filter((r) => !(r as Record<string, unknown>).effective_to)
    console.log(`site_intervenants : ${inter.data?.length ?? 0} lignes, ${actifs.length} actives`)
    const companyIds = actifs.map((r) => (r as Record<string, unknown>).company_id).filter(Boolean) as string[]
    const contactIds = actifs.map((r) => (r as Record<string, unknown>).main_contact_id).filter(Boolean) as string[]
    // `company_id` pointe vers `companies` (entreprises du chantier), PAS vers
    // `organizations` (le locataire). Confondre les deux ferait passer le nom de
    // l'organisation de Vincent pour un acteur du chantier.
    if (companyIds.length) {
      const cos = await admin.from('companies').select('name, short_name').in('id', companyIds)
      if (cos.error) console.error(`companies : ERREUR ${cos.error.message}`)
      for (const c of cos.data ?? []) {
        if (c.name) terms.push({ label: c.name as string, source: 'organization' })
        if (c.short_name) terms.push({ label: c.short_name as string, source: 'organization' })
      }
    }
    if (contactIds.length) {
      const cts = await admin.from('company_contacts').select('full_name').in('id', contactIds)
      if (cts.error) console.error(`company_contacts : ERREUR ${cts.error.message}`)
      else for (const c of cts.data ?? []) {
        if (c.full_name) terms.push({ label: (c.full_name as string).trim(), source: 'contact' })
      }
    }
  }

  // 3. Sujets canoniques — pour mémoire : ce sont des phrases, pas des termes.
  const subs = await admin
    .from('canonical_subject').select('label').eq('site_id', siteId).eq('status', 'active')
  const courts = (subs.data ?? []).map((s) => (s.label as string).trim())
    .filter((l) => l.length <= 40 && l.split(/\s+/).length <= 4)
  console.log(`canonical_subject : ${subs.data?.length ?? 0} actifs, ${courts.length} assez courts pour un terme`)
  for (const l of courts) terms.push({ label: l, source: 'subject' })

  // ── Inventaire ─────────────────────────────────────────────────────────────
  const uniq = new Map<string, { label: string; sources: Set<string> }>()
  for (const t of terms) {
    const k = t.label.toLowerCase()
    const e = uniq.get(k) ?? { label: t.label, sources: new Set<string>() }
    e.sources.add(t.detail ? `${t.source}:${t.detail}` : t.source)
    uniq.set(k, e)
  }
  console.log(`\n=== Vocabulaire fermé : ${uniq.size} terme(s) distinct(s) ===`)
  for (const e of uniq.values()) console.log(`  ${e.label.padEnd(38)} [${[...e.sources].join(', ')}]`)

  // ── Le seul risque qui compte : deux cibles également plausibles ───────────
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
  const lev = (a: string, b: string): number => {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
    for (let i = 1; i <= a.length; i++) {
      const cur = [i]
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      }
      prev = cur
    }
    return prev[b.length]
  }
  console.log('\n=== Paires trop proches (une correction pourrait viser la mauvaise cible) ===')
  const list = [...uniq.values()]
  let risques = 0
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = norm(list[i].label); const b = norm(list[j].label)
      if (!a || !b) continue
      const d = lev(a, b)
      if (d <= 2 && d < Math.max(a.length, b.length) * 0.5) {
        risques++
        console.log(`  ⚠ « ${list[i].label} » ↔ « ${list[j].label} » — distance ${d}`)
      }
    }
  }
  if (!risques) console.log('  aucune — toute correction retenue aura une cible unique')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
