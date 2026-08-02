// Vérification du backfill migration 272
// Charge une visite historique existante et vérifie :
// 1. document_links backfillé
// 2. titre mis à jour si générique
// 3. document conserve son lien au chantier

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function main() {
  const supabase = createClient(supabaseUrl, supabaseKey)

  console.log('🔍 Recherche d\'une visite historique existante...\n')

  // 1. Charger une visite historique avec document source
  const { data: visit } = await supabase
    .from('site_reports')
    .select('id, text_input, source_document_id, created_at, site_id')
    .eq('origin', 'import')
    .not('source_document_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!visit) {
    console.log('❌ Aucune visite historique trouvée')
    return
  }

  console.log('✅ Visite trouvée:')
  console.log(`   ID: ${visit.id}`)
  console.log(`   Titre: ${visit.text_input}`)
  console.log(`   Document source: ${visit.source_document_id}`)
  console.log(`   Site: ${visit.site_id}\n`)

  // 2. Vérifier le document
  const { data: doc } = await supabase
    .from('documents')
    .select('id, filename, size_bytes, page_count, effective_date')
    .eq('id', visit.source_document_id)
    .single()

  if (!doc) {
    console.log('❌ Document source introuvable')
    return
  }

  console.log('📄 Document source:')
  console.log(`   Filename: ${doc.filename}`)
  console.log(`   Taille: ${Math.round((doc.size_bytes || 0) / 1024 / 1024 * 10) / 10} Mo`)
  if (doc.page_count) console.log(`   Pages: ${doc.page_count}`)
  if (doc.effective_date) console.log(`   Date effective: ${doc.effective_date}\n`)

  // 3. Vérifier les liens bidirectionnels
  const { data: links } = await supabase
    .from('document_links')
    .select('target_type, target_id')
    .eq('document_id', visit.source_document_id)

  if (!links || links.length === 0) {
    console.log('❌ Aucun document_links trouvé')
    return
  }

  console.log(`✅ ${links.length} lien(s) document_links:`)
  const hasSiteLink = links.some(l => l.target_type === 'site' && l.target_id === visit.site_id)
  const hasReportLink = links.some(l => l.target_type === 'site_report' && l.target_id === visit.id)

  console.log(`   - Lien au chantier (site): ${hasSiteLink ? '✅' : '❌'}`)
  console.log(`   - Lien à la visite (site_report): ${hasReportLink ? '✅' : '❌'}\n`)

  // 4. Vérifier le titre
  const filenameWithoutPdf = doc.filename.replace(/\.pdf$/i, '')
  const titleMatchesFilename = visit.text_input === filenameWithoutPdf
  const titleIsGeneric = visit.text_input.startsWith('Visite importée') || visit.text_input.startsWith('Visite historique')

  console.log('📝 Titre de la visite:')
  console.log(`   Actuel: "${visit.text_input}"`)
  console.log(`   Filename (sans .pdf): "${filenameWithoutPdf}"`)
  console.log(`   Correspond au filename: ${titleMatchesFilename ? '✅' : '⚠️  (peut être personnalisé)'}`)
  console.log(`   Est générique: ${titleIsGeneric ? '⚠️  (devrait être remplacé)' : '✅'}\n`)

  // 5. Résumé
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('RÉSUMÉ BACKFILL')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`Lien chantier:  ${hasSiteLink ? '✅ OK' : '❌ MANQUANT'}`)
  console.log(`Lien visite:    ${hasReportLink ? '✅ OK (backfillé)' : '❌ MANQUANT'}`)
  console.log(`Titre mis à jour: ${!titleIsGeneric ? '✅ OK' : '❌ Reste générique'}`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  console.log(`🔗 Visite: https://memorianc.vercel.app/sites/${visit.site_id}/visites/${visit.id}`)
}

main().catch(console.error)
