'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserRoleById } from '@/lib/db/users'
import { getTender, getLatestTenderAnalysis, getTenderDocument } from '@/lib/db/tenders'
import { listChatMessages, insertChatMessage, insertChatAttachment } from '@/lib/db/atelier-ia'
import { upsertAgentAnalysis } from '@/lib/db/agent-analyses'
import { buildLibraryContext } from '@/services/ai/library-context'
import { extractPdfText } from '@/services/pdf/extract'
import { chatWithAgent } from '@/services/ai/chat'
import { runInitialAnalysisAgent } from '@/services/ai/initial-analysis'
import type { ChatAgentName } from '@/types/db'

const CHAT_AGENTS = [
  'general', 'lecteur_ao', 'memoire_technique',
  'contradicteur', 'financier', 'terrain', 'conformite',
] as const satisfies readonly ChatAgentName[]

const schema = z.object({
  tender_id: z.string().uuid(),
  agent_name: z.enum(CHAT_AGENTS),
  message: z.string().min(1).max(4000),
})

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024 // 5 MB

async function requireManagerOrAdmin() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const role = await getUserRoleById(user.id)
  if (role !== 'manager' && role !== 'admin') throw new Error('Forbidden')
  return user.id
}

function buildTenderContext(tender: { title: string; client_name: string | null; status: string; opportunity_score: number | null }, doc: { extracted_text: string | null } | null, analysis: { summary: string | null; constraints: unknown; risks: unknown; technical_memo: string | null } | null): string {
  const lines: string[] = []
  lines.push(`Titre : ${tender.title}`)
  if (tender.client_name) lines.push(`Donneur d'ordre : ${tender.client_name}`)
  lines.push(`Statut : ${tender.status}, score : ${tender.opportunity_score ?? 'n/a'}`)
  if (analysis?.summary) lines.push(`\nRésumé exécutif :\n${analysis.summary}`)
  if (analysis?.constraints) lines.push(`\nContraintes :\n${JSON.stringify(analysis.constraints, null, 2).slice(0, 2000)}`)
  if (analysis?.risks) lines.push(`\nRisques :\n${JSON.stringify(analysis.risks, null, 2).slice(0, 2000)}`)
  if (analysis?.technical_memo) lines.push(`\nMémoire technique :\n${analysis.technical_memo.slice(0, 4000)}`)
  if (!analysis && doc?.extracted_text) lines.push(`\nTexte AO (extrait) :\n${doc.extracted_text.slice(0, 6000)}`)
  return lines.join('\n')
}

export async function sendChatMessageAction(formData: FormData) {
  const userId = await requireManagerOrAdmin()

  const parsed = schema.safeParse({
    tender_id: formData.get('tender_id'),
    agent_name: formData.get('agent_name'),
    message: formData.get('message'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const tender = await getTender(parsed.data.tender_id)
  if (!tender) return { error: 'AO introuvable' }

  // Build context for the agent — history fetched BEFORE inserting the current
  // user message, so that history contains only previous turns (le message
  // courant est passé séparément comme userMessage à chatWithAgent).
  const [doc, analysis, lib, history] = await Promise.all([
    getTenderDocument(parsed.data.tender_id),
    getLatestTenderAnalysis(parsed.data.tender_id),
    buildLibraryContext(),
    listChatMessages(parsed.data.tender_id),
  ])
  const tenderContext = buildTenderContext(tender, doc, analysis)

  // Insert user message (after history fetched)
  const userMessageId = await insertChatMessage({
    tender_id: parsed.data.tender_id,
    user_id: userId,
    agent_name: null,
    role: 'user',
    content: parsed.data.message,
  })

  // Optional attachment
  const file = formData.get('attachment')
  let attachmentText: string | undefined
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      // Don't fail the whole flow — just skip the attachment
      console.warn('[atelier] attachment too large, skipping')
    } else {
      const supabase = createAdminClient()
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
      const storagePath = `${parsed.data.tender_id}/chat/${userMessageId}-${safeName}`
      const buffer = Buffer.from(await file.arrayBuffer())
      const { error: upErr } = await supabase.storage
        .from('tender-documents')
        .upload(storagePath, buffer, { contentType: file.type, upsert: false })
      if (!upErr) {
        // If PDF, extract text for prompt context
        let extracted: string | null = null
        if (file.type === 'application/pdf') {
          try {
            const r = await extractPdfText(buffer)
            extracted = r.isLikelyScanned ? null : r.text
          } catch {
            extracted = null
          }
        } else if (file.type.startsWith('text/')) {
          extracted = buffer.toString('utf-8').slice(0, 8000)
        }
        await insertChatAttachment({
          message_id: userMessageId,
          storage_path: storagePath,
          filename: file.name,
          size_bytes: file.size,
          extracted_text: extracted,
        })
        if (extracted) attachmentText = extracted
      }
    }
  }

  // Call agent
  let agentResponse: string
  let metadata: Record<string, unknown> = {}
  try {
    const r = await chatWithAgent({
      agentName: parsed.data.agent_name,
      userMessage: parsed.data.message,
      attachmentText,
      tenderContext,
      libraryContext: lib.markdown,
      history,
      userId,
    })
    agentResponse = r.content
    metadata = {
      provider: r.provider,
      model: r.model,
      prompt_version: r.promptVersion,
      input_tokens: r.inputTokens,
      output_tokens: r.outputTokens,
      duration_ms: r.durationMs,
    }
  } catch (e) {
    agentResponse = `_Erreur agent : ${e instanceof Error ? e.message : 'unknown'}_`
    metadata = { error: true }
  }

  // Insert agent message
  const agentMessageId = await insertChatMessage({
    tender_id: parsed.data.tender_id,
    user_id: null,
    agent_name: parsed.data.agent_name,
    role: 'agent',
    content: agentResponse,
    metadata,
  })

  revalidatePath(`/tenders/${parsed.data.tender_id}`)

  // Return both messages so the client can append in-place (avoids full page
  // reload which would reset the active tab back to "Synthèse").
  const now = new Date().toISOString()
  return {
    ok: true as const,
    userMessage: {
      id: userMessageId,
      tender_id: parsed.data.tender_id,
      user_id: userId,
      agent_name: null,
      role: 'user' as const,
      content: parsed.data.message,
      metadata: null,
      created_at: now,
    },
    agentMessage: {
      id: agentMessageId,
      tender_id: parsed.data.tender_id,
      user_id: null,
      agent_name: parsed.data.agent_name,
      role: 'agent' as const,
      content: agentResponse,
      metadata,
      created_at: now,
    },
  }
}

// ---------------------------------------------------------------------------
// runAgentInitialAnalysisAction
// ---------------------------------------------------------------------------

const runAnalysisSchema = z.object({
  tender_id: z.string().uuid(),
  agent_name: z.enum(CHAT_AGENTS),
})

export async function runAgentInitialAnalysisAction(formData: FormData) {
  const userId = await requireManagerOrAdmin()

  const parsed = runAnalysisSchema.safeParse({
    tender_id: formData.get('tender_id'),
    agent_name: formData.get('agent_name'),
  })
  if (!parsed.success) return { error: 'Invalid input' }

  // Lock optimiste : passer en 'running' avant de rendre la main
  await upsertAgentAnalysis({
    tender_id: parsed.data.tender_id,
    agent_name: parsed.data.agent_name,
    status: 'running',
  })

  // Schedule l'analyse via after() — s'exécute après la réponse HTTP
  after(async () => {
    try {
      const tender = await getTender(parsed.data.tender_id)
      if (!tender) throw new Error('Tender introuvable')
      const doc = await getTenderDocument(parsed.data.tender_id)
      if (!doc?.extracted_text) throw new Error('Pas de texte extrait')
      const lib = await buildLibraryContext()

      const result = await runInitialAnalysisAgent({
        agentName: parsed.data.agent_name,
        rawText: doc.extracted_text,
        libraryContext: lib.markdown,
        userId,
      })

      await upsertAgentAnalysis({
        tender_id: parsed.data.tender_id,
        agent_name: parsed.data.agent_name,
        status: 'ready',
        summary: result.summary,
        key_points: result.keyPoints as Record<string, unknown>,
        raw_content: result.rawContent,
        metadata: result.metadata,
      })
    } catch (e) {
      console.error('[runAgentInitialAnalysis] failed:', e)
      await upsertAgentAnalysis({
        tender_id: parsed.data.tender_id,
        agent_name: parsed.data.agent_name,
        status: 'failed',
        error_msg: e instanceof Error ? e.message : 'unknown',
      })
    }
  })

  revalidatePath(`/tenders/${parsed.data.tender_id}`)
  return { ok: true }
}
