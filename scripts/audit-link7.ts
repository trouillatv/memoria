import { createClient } from '@supabase/supabase-js'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

const SITE_ID = '2c939e67-e986-4635-86a0-638cda870480'
const CS_A = '20c990b9-639e-42b2-adb1-7363ca025a7e'  // Essais sur les bétons à faire
const CS_B = 'd920a6bf-60dd-41c3-868b-87f763457c39'  // Essais bétons regards et bétons coulés

async function main() {
  const { data: stiA } = await sb.from('subject_thread_identity').select('subject_thread_id').eq('canonical_subject_id', CS_A)
  const { data: stiB } = await sb.from('subject_thread_identity').select('subject_thread_id').eq('canonical_subject_id', CS_B)
  const threadA = stiA?.[0]?.subject_thread_id
  const threadB = stiB?.[0]?.subject_thread_id
  console.log('threadA:', threadA)
  console.log('threadB:', threadB)

  const { data: allLinks, error } = await sb.from('subject_thread_links')
    .select('id,from_thread_id,to_thread_id,link_type,status,source,confidence,justification,evidence_run_id,evidence_proposal_id,created_at,created_by')
    .eq('site_id', SITE_ID)
  if (error) { console.error(error.message); return }

  console.log('\nTous les liens du site (' + allLinks.length + ') :')
  for (const l of allLinks) {
    const isTarget = (l.from_thread_id === threadA && l.to_thread_id === threadB) ||
                     (l.from_thread_id === threadB && l.to_thread_id === threadA)
    const marker = isTarget ? ' ◀ [7]' : ''
    console.log('  ' + l.link_type.padEnd(12) + l.status.padEnd(10) + (l.source ?? '').padEnd(14) +
      'from=' + l.from_thread_id.slice(0,8) + ' to=' + l.to_thread_id.slice(0,8) + '  ' + l.created_at?.slice(0,10) + marker)
    if (isTarget) {
      console.log('    confidence  :', l.confidence)
      console.log('    justification:', l.justification ?? '(aucune)')
      console.log('    created_by  :', l.created_by ?? '(null — service role)')
      console.log('    evidence_run:', l.evidence_run_id ?? '(null)')
      console.log('    evidence_prop:', l.evidence_proposal_id ?? '(null)')

      if (l.evidence_run_id) {
        const { data: run } = await sb.from('document_extraction_run')
          .select('id,status,is_canonical,created_at').eq('id', l.evidence_run_id).single()
        console.log('    run.status      :', run?.status)
        console.log('    run.is_canonical:', run?.is_canonical)
        console.log('    run.created_at  :', run?.created_at?.slice(0,19))
      }
      if (l.evidence_proposal_id) {
        const { data: prop } = await sb.from('document_extraction_proposal')
          .select('id,proposal_family,review_status,source_excerpt,thematic_category').eq('id', l.evidence_proposal_id).single()
        console.log('    prop.family  :', prop?.proposal_family)
        console.log('    prop.status  :', prop?.review_status)
        console.log('    prop.category:', prop?.thematic_category)
        console.log('    prop.excerpt :', prop?.source_excerpt?.slice(0, 400))
      }
    }
  }
}
main().catch(e => { console.error(e); process.exit(1) })
