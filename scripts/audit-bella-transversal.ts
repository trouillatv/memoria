/** READ-ONLY — (a) 21 business_subject Bella (dédup/fragment ? les 12 vs 9) ; (b) transversalité OCEF/PETRO :
 *  noms de chantier / titres de doc / faits ponctuels / acteurs mal typés devenus business_subject. Aucune écriture. */
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const TWELVE = new Set(['8815498b-3100-43b9-9038-bf479c658a29','0bcc588c-37a5-4eaf-8ac9-960b5e16994b','1de36dcb-fea7-4179-a57e-a7df3c6c8513','e76e4cf9-2747-4afa-86bd-b4b5bdea8459','e8929f5e-4c20-4c1c-bdd8-2b65a7433389','4fd7b99f-4fd6-4fb9-8124-7338bb3b78f5','c7b3a0c4-9d62-402d-9106-afb8fdcc4592','c33683c7-a2a1-4bf1-bfe6-1c30b0cd8322','ffa39d5a-4d02-448f-84d4-a09e8c2bedbd','aaec7f76-9084-4679-b030-7962160f376f','f27e3439-4523-497a-b68b-ae68c4b8f180','cc12fce6-8780-4f93-88a1-21905a37325b'])
const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'

async function occCount(id: string): Promise<number> {
  const { count } = await sb.from('canonical_subject_occurrence').select('id', { count: 'exact', head: true }).eq('canonical_subject_id', id)
  return count ?? 0
}

async function dumpSite(siteId: string, name: string) {
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const siteWords = norm(name).split(/[^a-z0-9]+/).filter((w) => w.length >= 4)
  const { data: subs } = await sb.from('canonical_subject').select('id, label, kind, creation_source').eq('site_id', siteId).eq('kind', 'business_subject')
  const rows = (subs ?? []) as Array<{ id: string; label: string; kind: string; creation_source: string | null }>
  console.log(`\n════════ ${name} — ${rows.length} business_subject ════════`)
  const suspects: string[] = []
  for (const r of rows) {
    const l = norm(r.label)
    const isSiteName = siteWords.some((w) => l.includes(w))
    const isDocTitle = /(proc[eè]s.?verbal|compte.?rendu|^pv\b|rapport de visite|ordre du jour|^cr\b|page \d)/i.test(r.label)
    const isContext = /^(bella napoli|ocef|petro|lyc[eé]e|coll[eè]ge|chantier|site)\b/i.test(r.label.trim())
    if (isSiteName || isDocTitle || isContext) suspects.push(`⚠️ ${r.label}  (site=${isSiteName} doc=${isDocTitle} ctx=${isContext})`)
  }
  if (suspects.length === 0) console.log('  aucun label suspect (nom de chantier / titre de doc / contexte)')
  else suspects.forEach((s) => console.log('  ' + s))
  // acteurs mal typés : business_subject dont le label ressemble à une entreprise/personne (heuristique légère)
  const actorish = rows.filter((r) => /\b(SARL|SAS|EURL|SA|Bureau Veritas|V[eé]ritas|M\.|Mme|Monsieur|Madame)\b/i.test(r.label))
  if (actorish.length) { console.log('  acteurs possibles en business_subject :'); actorish.forEach((r) => console.log(`    ⚠️ ${r.label}`)) }
}

async function main() {
  // (a) 21 Bella business_subject : occurrences + statut nouveau/pré-existant
  const { data: subs } = await sb.from('canonical_subject').select('id, label, kind').eq('site_id', BELLA).eq('kind', 'business_subject')
  const rows = (subs ?? []) as Array<{ id: string; label: string }>
  console.log(`════════ BELLA — ${rows.length} business_subject (12 « nouveaux » marqués) ════════`)
  for (const r of rows) {
    const n = await occCount(r.id)
    console.log(`  ${TWELVE.has(r.id) ? 'NOUVEAU' : 'préexist'}  occ=${n}  ${r.id.slice(0, 8)}  « ${r.label} »`)
  }

  // (b) transversalité
  const { data: sites } = await sb.from('sites').select('id, name')
  const all = (sites ?? []) as Array<{ id: string; name: string }>
  for (const s of all.filter((x) => /ocef compostage|petro atiti|lyc[eé]e petro/i.test(x.name))) {
    await dumpSite(s.id, s.name)
  }
  await dumpSite(BELLA, 'BELLA NAPOLI')
}
main().catch((e) => { console.error(e); process.exit(1) })
