import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { mimeToExt, transcribeAudioForCopilot } from '@/lib/ai/transcribe'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const form = await req.formData()
    const audioFile = form.get('audio') as File | null
    const siteId = form.get('siteId') as string | null

    if (!audioFile) return NextResponse.json({ error: 'Audio manquant' }, { status: 400 })

    const rawBuffer = await audioFile.arrayBuffer()
    const mimeType = audioFile.type || 'audio/webm'
    const ext = mimeToExt(mimeType)

    const lexicalPrompt = siteId ? await buildLexicalPrompt(siteId) : undefined

    const result = await transcribeAudioForCopilot(rawBuffer, mimeType, ext, lexicalPrompt || undefined)

    return NextResponse.json({
      text: result.text,
      model: result.model,
      tokensAudio: result.tokensAudio ?? null,
      tokensOutput: result.tokensOutput ?? null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur de transcription'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function buildLexicalPrompt(siteId: string): Promise<string> {
  try {
    const admin = createAdminClient()

    const [siteRes, subjectsRes] = await Promise.all([
      admin.from('sites').select('name').eq('id', siteId).single(),
      admin
        .from('canonical_subject')
        .select('label')
        .eq('site_id', siteId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(20),
    ])

    const parts: string[] = []
    if (siteRes.data?.name) parts.push(siteRes.data.name)
    if (subjectsRes.data?.length) {
      parts.push(subjectsRes.data.map((s) => s.label).join(', '))
    }

    return parts.join('. ')
  } catch {
    return ''
  }
}
