// scripts/dev/test-resonances-on-site.ts
//
// Teste B1 + B2 sur un site EXISTANT (non soft-deleted), avec validation
// d'intégrité de chaque maillon avant compute. Insère une note terrain
// qui CONTIENT GARANTI un bigramme du doc (extrait depuis l'extracted_text),
// puis lance refire-resonances + queries résultats.
//
// Usage :
//   npx tsx scripts/dev/test-resonances-on-site.ts <siteId> <docId1> [docId2 ...]
//
// Garde-fous :
//   - vérif site existe ET non deleted_at
//   - vérif chaque doc : exists, ready, type ∈ B1 allowed, visibility ∈ {operations,field}
//   - vérif document_links target_type='site' pour CHAQUE doc → site
//   - extrait un bigramme actionnable du 1er doc (qui passe chunkSignalsAction)
//   - INSERT 1 note test avec ce bigramme
//   - refire compute sur chaque doc
//   - query final + affichage des fragments produits

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { createAdminClient } from '@/lib/supabase/admin'
import { bigramsOf } from '@/lib/documents/resonance-matchers'
import { chunkSignalsAction } from '@/lib/documents/cross-store-matchers'
import { computeDocResonancesForDocument } from '@/lib/documents/resonances'
import { computeDocCrossStoreResonancesForDocument } from '@/lib/documents/cross-store-resonances'

async function main() {
  const [siteId, ...docIds] = process.argv.slice(2)
  if (!siteId || docIds.length === 0) {
    console.error('Usage: npx tsx scripts/dev/test-resonances-on-site.ts <siteId> <docId1> [docId2 ...]')
    process.exit(1)
  }

  const supabase = createAdminClient()

  // 1. Vérif site
  console.log(`\n[1] Vérif site ${siteId}…`)
  const { data: site } = await supabase
    .from('sites')
    .select('id, name, tenant_id, deleted_at')
    .eq('id', siteId)
    .maybeSingle()
  if (!site) {
    console.error(`✗ Site introuvable : ${siteId}`)
    process.exit(1)
  }
  const s = site as { id: string; name: string; tenant_id: string; deleted_at: string | null }
  if (s.deleted_at) {
    console.error(`✗ Site soft-deleted (deleted_at=${s.deleted_at}). Choisir un site vivant.`)
    process.exit(1)
  }
  console.log(`  ✓ ${s.name}`)

  // 2. Vérif chaque doc + document_links
  console.log(`\n[2] Vérif ${docIds.length} doc(s)…`)
  const docs: Array<{
    id: string
    document_type: string
    visibility_level: string
    extracted_text: string
  }> = []
  for (const docId of docIds) {
    const { data: doc } = await supabase
      .from('documents')
      .select('id, document_type, visibility_level, analysis_status, extracted_text, deleted_at')
      .eq('id', docId)
      .maybeSingle()
    if (!doc) {
      console.error(`  ✗ Doc introuvable : ${docId}`)
      process.exit(1)
    }
    const d = doc as {
      id: string; document_type: string; visibility_level: string;
      analysis_status: string; extracted_text: string | null; deleted_at: string | null
    }
    if (d.deleted_at) { console.error(`  ✗ Doc soft-deleted : ${docId}`); process.exit(1) }
    if (d.analysis_status !== 'ready') { console.error(`  ✗ Doc pas ready (${d.analysis_status}) : ${docId}`); process.exit(1) }
    const ALLOWED_TYPES = ['plan_acces', 'securite', 'procedure', 'protocole']
    if (!ALLOWED_TYPES.includes(d.document_type)) {
      console.error(`  ✗ Doc type non supporté B1/B2 (${d.document_type}) : ${docId}`); process.exit(1)
    }
    const ALLOWED_VIS = ['operations', 'field']
    if (!ALLOWED_VIS.includes(d.visibility_level)) {
      console.error(`  ✗ Doc visibility insuffisante (${d.visibility_level}) — doit être operations/field : ${docId}`); process.exit(1)
    }
    if (!d.extracted_text || d.extracted_text.length < 50) {
      console.error(`  ✗ Doc extracted_text trop court (${d.extracted_text?.length ?? 0} chars) : ${docId}`); process.exit(1)
    }

    // document_link vers le site ?
    const { data: link } = await supabase
      .from('document_links')
      .select('document_id')
      .eq('document_id', docId)
      .eq('target_type', 'site')
      .eq('target_id', siteId)
      .maybeSingle()
    if (!link) {
      console.error(`  ✗ Doc ${docId} pas lié au site ${siteId}. INSERT manquant.`); process.exit(1)
    }

    docs.push({
      id: d.id,
      document_type: d.document_type,
      visibility_level: d.visibility_level,
      extracted_text: d.extracted_text,
    })
    console.log(`  ✓ ${d.id} (${d.document_type}, ${d.visibility_level}, ${d.extracted_text.length} chars)`)
  }

  // 3. Pick bigramme actionnable du 1er doc
  console.log(`\n[3] Extraction d'un bigramme actionnable du 1er doc…`)
  const firstDoc = docs[0]
  const bigrams = Array.from(bigramsOf(firstDoc.extracted_text))
  if (bigrams.length === 0) {
    console.error(`  ✗ Aucun bigramme trouvé dans le doc. Texte trop court ou que des stopwords.`); process.exit(1)
  }
  const actionable = bigrams.find((bg) => chunkSignalsAction(bg))
  const bigram = actionable ?? bigrams[Math.floor(bigrams.length / 2)]
  console.log(`  ✓ Bigramme choisi : « ${bigram} »${actionable ? ' (actionnable)' : ' (médian, non actionnable)'}`)
  console.log(`  ℹ Total bigrammes uniques dans le doc : ${bigrams.length}`)

  // 4. Insert note test
  console.log(`\n[4] Insert note test sur le site…`)
  const noteBody = `Test B1 — ${bigram} signalé hier soir, à vérifier.`
  const { data: adminUser } = await supabase
    .from('users').select('id').eq('role', 'admin').limit(1).maybeSingle()
  const adminId = (adminUser as { id?: string } | null)?.id ?? null
  const { data: noteInserted, error: noteErr } = await supabase
    .from('site_notes')
    .insert({
      site_id: siteId,
      body: noteBody,
      kind: 'note',
      created_by: adminId,
    })
    .select('id')
    .single()
  if (noteErr) {
    console.error(`  ✗ Insert note échoué :`, noteErr.message); process.exit(1)
  }
  const noteId = (noteInserted as { id: string }).id
  console.log(`  ✓ Note ${noteId} insérée : "${noteBody}"`)

  // 5. Refire B1+B2 sur tous les docs
  console.log(`\n[5] Refire B1+B2 sur ${docs.length} doc(s)…`)
  for (const d of docs) {
    console.log(`  · ${d.id} — B1…`)
    await computeDocResonancesForDocument(d.id)
    console.log(`  · ${d.id} — B2…`)
    await computeDocCrossStoreResonancesForDocument(d.id)
  }
  console.log(`  ✓ Refire terminé`)

  // 6. Query résultats
  console.log(`\n[6] Résonances produites sur ce site (status='active', algo b%_doc_%) :`)
  const { data: results } = await supabase
    .from('site_reading_candidates')
    .select('id, algorithm_version, fragment, source_ids, generated_at')
    .eq('site_id', siteId)
    .like('algorithm_version', 'b%_doc_%')
    .eq('status', 'active')
    .order('generated_at', { ascending: false })

  const rows = results ?? []
  if (rows.length === 0) {
    console.log(`\n  ✗ Aucune résonance produite. Causes possibles :`)
    console.log(`    - cosine < 0.80 (pour B2)`)
    console.log(`    - chunk doc ne passe pas chunkSignalsAction (pour B2)`)
    console.log(`    - bigramme inséré pas réellement présent dans le doc (B1)`)
    return
  }

  for (const r of rows) {
    const row = r as { id: string; algorithm_version: string; fragment: string; source_ids: unknown; generated_at: string }
    console.log(`\n  [${row.algorithm_version}]`)
    console.log(`    ${row.fragment}`)
    console.log(`    sources: ${JSON.stringify(row.source_ids)}`)
  }
  console.log(`\n  ✓ ${rows.length} résonance(s) produite(s) sur ce site.`)
  console.log(`\n→ Vérifier UI : http://localhost:3000/sites/${siteId}`)
}

main().catch((e) => {
  console.error('[test-resonances-on-site] erreur:', e)
  process.exit(1)
})
