// Persiste la transcription corrigée du vocal PETRO 6487ff04 (report=580403c8,
// l'AUDIT CR du 17/08 qui a déclenché tout le lot STT). Utilise le pipeline
// transcribeAudio (Gemini + continuation + fallback Whisper + garde
// anti-hallucination + normalisation lexicale commune, désormais câblés) puis
// écrit via setCaptureTranscript — le chemin canonique, qui ne touche ni
// status ni triage_intent.
//
// Réparation CONTRÔLÉE (décision Vincent 2026-08-18) : supersède l'écriture
// faite plus tôt dans le même lot, qui datait d'avant le câblage du
// normaliseur — celle-ci contenait la troncature corrigée mais pas encore
// « PETRO ATTITI » / « nos agents ».
import { config } from 'dotenv'
config({ path: '.env.local' })
import { createAdminClient } from '../lib/supabase/admin'
import { transcribeAudio } from '../lib/ai/transcribe'
import { setCaptureTranscript } from '../lib/db/visit-captures'

const BUCKET = 'site-reports'

async function main() {
  const db = createAdminClient()
  const { data, error } = await db
    .from('visit_capture')
    .select('id, report_id, site_id, body, attachment_id')
    .eq('kind', 'vocal')
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) throw error
  const rows = (data ?? []) as Array<{ id: string; report_id: string; site_id: string; body: string | null; attachment_id: string | null }>
  const cap = rows.find((r) => r.id.startsWith('6487ff04'))
  if (!cap) throw new Error('capture introuvable')
  console.log('capture:', cap.id, 'report:', cap.report_id, 'site:', cap.site_id)
  console.log('body avant (', cap.body?.length, 'car.):', cap.body)

  if (!cap.attachment_id) throw new Error('pas de pièce jointe')
  const { data: att, error: attErr } = await db
    .from('site_report_attachments')
    .select('storage_path, mime_type')
    .eq('id', cap.attachment_id)
    .single()
  if (attErr || !att) throw attErr ?? new Error('attachment introuvable')

  const { data: blob, error: dlErr } = await db.storage.from(BUCKET).download(att.storage_path)
  if (dlErr || !blob) throw dlErr ?? new Error('téléchargement échoué')
  const ab = await blob.arrayBuffer()

  const after = (await transcribeAudio(ab, att.mime_type, 'webm', cap.site_id)).trim()
  console.log('\nbody après (', after.length, 'car.):', after)

  await setCaptureTranscript(cap.id, { text: after, status: 'done' })
  console.log('\n[OK] transcript mis à jour en base pour', cap.id)
}
main().catch((e) => { console.error(e); process.exit(1) })
