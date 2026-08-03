import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
  const ocefSites = ['2c939e67-e986-4635-86a0-638cda870480', '655edb00-032d-4379-b76d-d598c2c7c254']

  const { data: ocef } = await sb.from('subjects').select('id, name, status, created_at').in('site_id', ocefSites).order('created_at')
  console.log('OCEF subjects:', ocef?.length ?? 0)
  for (const r of (ocef ?? []) as any[]) console.log(' ', r.status, r.name)

  const { count: total } = await sb.from('subjects').select('id', { count: 'exact', head: true })
  console.log('\nTotal subjects global:', total)

  const { data: sample } = await sb.from('subjects').select('name, status, created_at').order('created_at', { ascending: false }).limit(5)
  console.log('5 derniers créés:')
  for (const r of (sample ?? []) as any[]) console.log(' ', r.status, r.name, (r.created_at as string)?.slice(0, 10))
}

main().catch(console.error)
