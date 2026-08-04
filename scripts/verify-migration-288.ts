import { createAdminClient } from '../lib/supabase/admin'

const sb = createAdminClient()
const SITE_ID = '2c939e67-e986-4635-86a0-638cda870480'

async function main() {
  const { data } = await sb
    .from('site_actions')
    .select('id, report_id, subject_thread_id')
    .eq('site_id', SITE_ID)

  const total = data?.length ?? 0
  const withReport = (data ?? []).filter(a => a.report_id).length
  const withThread = (data ?? []).filter(a => a.subject_thread_id).length
  const distinctThreads = new Set((data ?? []).map(a => a.subject_thread_id).filter(Boolean)).size

  console.log(`Total actions       : ${total}`)
  console.log(`report_id renseigné : ${withReport} / ${total}`)
  console.log(`subject_thread_id   : ${withThread} / ${total}`)
  console.log(`Threads distincts   : ${distinctThreads}`)
}

main().catch(console.error)
