// Vérifie (lecture seule) que le SELECT étendu de listVisitCaptures est valide
// côté PostgREST et que annotated_original_id revient — sur la visite PETRO de
// recette (14 photos). Rejoue le SELECT exact du lib (feedback mémoire : un
// champ ajouté à l'interface mais absent du select échoue EN SILENCE).
import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const REPORT = '0286d6a8-beae-4561-864f-49635f4a5a20'

async function main() {
  const { data, error } = await sb
    .from('visit_capture')
    .select('id, report_id, site_id, kind, status, body, transcript_status, attachment_id, subject_id, triage_intent, suite_status, starred, client_uuid, lat, lng, captured_at, is_viewpoint, viewpoint_of, annotated_original_id, created_at')
    .eq('report_id', REPORT)
    .is('hidden_at', null)
    .order('captured_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true })
  if (error) { console.error('SELECT ERROR:', error.message); process.exit(1) }
  const media = (data ?? []).filter((c) => (c.kind === 'photo' || c.kind === 'video') && c.status !== 'discarded')
  console.log(`captures totales: ${data?.length} | photos/vidéos galerie: ${media.length}`)
  console.log('annotated_original_id présent dans la réponse:', media.length > 0 && 'annotated_original_id' in media[0])
  console.log('avec légende:', media.filter((c) => c.body).length, '| starred:', media.filter((c) => c.starred).length)
}
main()
