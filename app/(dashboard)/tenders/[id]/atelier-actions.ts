'use server'

import { randomUUID } from 'crypto'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserRoleById } from '@/lib/db/users'
import { getTender, getLatestTenderAnalysis, getTenderDocument } from '@/lib/db/tenders'
import { listChatMessages, insertChatMessage, insertChatAttachment, listConversations, createConversation, renameConversation } from '@/lib/db/atelier-ia'
import { upsertAgentAnalysis } from '@/lib/db/agent-analyses'
import { buildLibraryContext } from '@/services/ai/library-context'
import { extractPdfText } from '@/services/pdf/extract'
import { chatWithAgent } from '@/services/ai/chat'
import { runInitialAnalysisAgent } from '@/services/ai/initial-analysis'
import { validateSources } from '@/services/ai/source-validation'
import { listKnowledgeItems } from '@/lib/db/knowledge'
import { matchAoToTerrain, type TerrainMatchBySite } from '@/lib/ai/match-ao-terrain'
import { matchAoToKnowledge, type KnowledgeMatchBySource } from '@/lib/ai/match-ao-knowledge'
import { getActiveProvider } from '@/lib/ai/embeddings'
import { buildDocumentContext } from '@/lib/ai/document-context'
import type { ChatAgentName, Source, UserRole } from '@/types/db'

// ---------------------------------------------------------------------------
// Terrain context helpers
// ---------------------------------------------------------------------------

const SOURCE_LABEL_FR: Record<string, string> = {
  anomaly: 'Anomalie',
  site_note: 'Consigne',
  intervention_note: 'Note terrain',
}

function formatTerrainContext(matches: TerrainMatchBySite[]): string {
  if (matches.length === 0) return ''
  const lines: string[] = [
    '\n=== Preuves terrain reliées à cet AO ===',
    'Ces traces proviennent de la mémoire opérationnelle réelle d\'AGP.',
    'Utilisez-les comme matériaux de réponse — jamais comme conclusions.',
  ]
  // Cap : 5 sites, 4 traces par site — ne pas noyer le contexte
  for (const site of matches.slice(0, 5)) {
    lines.push(`\n${site.siteName} (${site.traces.length} trace${site.traces.length > 1 ? 's' : ''})`)
    for (const trace of site.traces.slice(0, 4)) {
      const label = SOURCE_LABEL_FR[trace.sourceType] ?? trace.sourceType
      const excerpt = trace.textExcerpt.length > 100
        ? trace.textExcerpt.slice(0, 100).trimEnd() + '…'
        : trace.textExcerpt
      lines.push(`• ${label} — ${excerpt}`)
    }
    if (site.traces.length > 4) {
      lines.push(`  (+ ${site.traces.length - 4} autre${site.traces.length - 4 > 1 ? 's' : ''})`)
    }
  }
  if (matches.length > 5) {
    lines.push(`\n(+ ${matches.length - 5} autre${matches.length - 5 > 1 ? 's' : ''} site${matches.length - 5 > 1 ? 's' : ''} avec traces terrain)`)
  }
  return lines.join('\n')
}

async function fetchTerrainContext(tenderId: string): Promise<string> {
  if (getActiveProvider() === null) return ''
  try {
    const matches = await matchAoToTerrain(tenderId)
    return formatTerrainContext(matches)
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// Knowledge context helpers (bibliothèque + historique AO)
// ---------------------------------------------------------------------------

const DOMAIN_LABEL_FR: Record<string, string> = {
  library: 'Bibliothèque',
  tender_history: 'AO passé',
}

function formatKnowledgeContext(matches: KnowledgeMatchBySource[]): string {
  if (matches.length === 0) return ''
  const lines: string[] = [
    '\n=== Mémoire documentaire AGP reliée à cet AO ===',
    'Ces fragments proviennent de la bibliothèque AGP et des AO passés (gagnés/perdus).',
    'Citez la source précise — jamais de généralisation sans preuve documentaire.',
  ]
  for (const source of matches.slice(0, 6)) {
    const domainLabel = DOMAIN_LABEL_FR[source.sourceDomain] ?? source.sourceDomain
    lines.push(`\n[${domainLabel}] ${source.label}`)
    for (const chunk of source.chunks.slice(0, 2)) {
      const excerpt = chunk.chunkText.length > 150
        ? chunk.chunkText.slice(0, 150).trimEnd() + '…'
        : chunk.chunkText
      lines.push(`• ${excerpt}`)
    }
    if (source.chunks.length > 2) {
      lines.push(`  (+ ${source.chunks.length - 2} autre${source.chunks.length - 2 > 1 ? 's' : ''} fragment${source.chunks.length - 2 > 1 ? 's' : ''})`)
    }
  }
  if (matches.length > 6) {
    lines.push(`\n(+ ${matches.length - 6} autre${matches.length - 6 > 1 ? 's' : ''} source${matches.length - 6 > 1 ? 's' : ''} documentaire${matches.length - 6 > 1 ? 's' : ''})`)
  }
  return lines.join('\n')
}

async function fetchKnowledgeContext(tenderId: string): Promise<string> {
  if (getActiveProvider() === null) return ''
  try {
    const matches = await matchAoToKnowledge(tenderId)
    return formatKnowledgeContext(matches)
  } catch {
    return ''
  }
}

// Recall documentaire CIBLÉ et BORNÉ pour la question courante (phase 4b).
// 1 embedding + 1 RPC plafonnée, filtré visibility_level. Jamais un dump.
async function fetchDocumentContext(
  query: string,
  role: UserRole | null,
): Promise<string> {
  if (getActiveProvider() === null) return ''
  try {
    const r = await buildDocumentContext({ query, role })
    return r.promptBlock
  } catch {
    return ''
  }
}

const CHAT_AGENTS = [
  'general', 'lecteur_ao', 'memoire_technique',
  'contradicteur', 'financier', 'terrain', 'conformite',
] as const satisfies readonly ChatAgentName[]

const multiAgentSchema = z.object({
  tender_id: z.string().uuid(),
  agent_names: z.array(z.enum(CHAT_AGENTS)).min(1).max(3),
  message: z.string().min(1).max(4000),
  conversation_id: z.string().uuid().nullable().optional(),
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
  if (doc?.extracted_text) {
    lines.push(`\n=== Texte du PDF (pour citations verbatim) ===\n${doc.extracted_text.slice(0, 8000)}`)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Conversations (onglets nommés)
// ---------------------------------------------------------------------------

const conversationCreateSchema = z.object({
  tender_id: z.string().uuid(),
  name: z.string().min(1).max(80),
  position: z.number().int().min(0),
})

const conversationRenameSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80),
})

export async function createConversationAction(formData: FormData) {
  await requireManagerOrAdmin()
  const parsed = conversationCreateSchema.safeParse({
    tender_id: formData.get('tender_id'),
    name: formData.get('name'),
    position: parseInt(String(formData.get('position') ?? '0'), 10),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const conv = await createConversation(parsed.data.tender_id, parsed.data.name, parsed.data.position)
  revalidatePath(`/tenders/${parsed.data.tender_id}`)
  return { ok: true as const, conversation: conv }
}

export async function renameConversationAction(formData: FormData) {
  await requireManagerOrAdmin()
  const parsed = conversationRenameSchema.safeParse({
    id: formData.get('id'),
    name: formData.get('name'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  await renameConversation(parsed.data.id, parsed.data.name)
  return { ok: true as const }
}

export async function listConversationsAction(tenderId: string) {
  return listConversations(tenderId)
}

export async function getAgentAnalysesStatusAction(tenderId: string) {
  const supabase = await createServerClient()
  const { data } = await supabase
    .from('tender_agent_analyses')
    .select('agent_name, status, updated_at')
    .eq('tender_id', tenderId)
  return (data ?? []) as { agent_name: string; status: string; updated_at: string }[]
}

export async function sendChatMessageAction(formData: FormData) {
  const userId = await requireManagerOrAdmin()

  // agent_names is sent as a JSON-encoded array by the client
  let agentNamesRaw: unknown
  try {
    agentNamesRaw = JSON.parse(formData.get('agent_names') as string)
  } catch {
    return { error: 'agent_names invalide' }
  }

  const conversationIdRaw = formData.get('conversation_id')
  const parsed = multiAgentSchema.safeParse({
    tender_id: formData.get('tender_id'),
    agent_names: agentNamesRaw,
    message: formData.get('message'),
    conversation_id: conversationIdRaw ? String(conversationIdRaw) : null,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const tender = await getTender(parsed.data.tender_id)
  if (!tender) return { error: 'AO introuvable' }

  // Rôle appelant : filtre le recall documentaire par visibility_level.
  const role = await getUserRoleById(userId)

  // Build context for the agent — history fetched BEFORE inserting the current
  // user message, so that history contains only previous turns (le message
  // courant est passé séparément comme userMessage à chatWithAgent).
  // fetchTerrainContext tourne en parallèle : ~150ms, jamais bloquant.
  const [doc, analysis, lib, history, knowledgeItems, terrainCtx, knowledgeCtx, documentCtx] =
    await Promise.all([
      getTenderDocument(parsed.data.tender_id),
      getLatestTenderAnalysis(parsed.data.tender_id),
      buildLibraryContext(),
      listChatMessages(parsed.data.tender_id),
      listKnowledgeItems({}),
      fetchTerrainContext(parsed.data.tender_id),
      fetchKnowledgeContext(parsed.data.tender_id),
      fetchDocumentContext(parsed.data.message, role),
    ])
  const tenderContext = buildTenderContext(tender, doc, analysis) + terrainCtx + knowledgeCtx

  // Common turn_id — groups the user message and all agent responses
  const turnId = randomUUID()

  // Insert user message (after history fetched), includes turn_id in metadata
  const userMessageId = await insertChatMessage({
    tender_id: parsed.data.tender_id,
    conversation_id: parsed.data.conversation_id ?? null,
    user_id: userId,
    agent_name: null,
    role: 'user',
    content: parsed.data.message,
    metadata: { turn_id: turnId },
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

  // Call all agents in parallel — a failure in one does not cancel the others
  const agentResults = await Promise.all(
    parsed.data.agent_names.map(async (agentName) => {
      try {
        const r = await chatWithAgent({
          agentName,
          userMessage: parsed.data.message,
          attachmentText,
          tenderContext,
          libraryContext: lib.markdown,
          documentContext: documentCtx,
          history,
          userId,
        })
        let validatedSources: Source[] = []
        if (r.sources && r.sources.length > 0) {
          validatedSources = validateSources(r.sources, {
            extractedText: doc?.extracted_text ?? null,
            knowledgeItems,
          })
        }
        return {
          agentName,
          content: r.content,
          metadata: {
            provider: r.provider,
            model: r.model,
            prompt_version: r.promptVersion,
            input_tokens: r.inputTokens,
            output_tokens: r.outputTokens,
            duration_ms: r.durationMs,
            turn_id: turnId,
            challenge_round: 0,
            sources: validatedSources.length > 0 ? validatedSources : undefined,
          },
        }
      } catch (e) {
        return {
          agentName,
          content: `_Erreur agent ${agentName} : ${e instanceof Error ? e.message : 'unknown'}_`,
          metadata: { error: true, turn_id: turnId, challenge_round: 0 },
        }
      }
    })
  )

  // Insert all agent messages in parallel
  const agentMessageIds = await Promise.all(
    agentResults.map((r) =>
      insertChatMessage({
        tender_id: parsed.data.tender_id,
        conversation_id: parsed.data.conversation_id ?? null,
        user_id: null,
        agent_name: r.agentName,
        role: 'agent',
        content: r.content,
        metadata: r.metadata,
      })
    )
  )

  revalidatePath(`/tenders/${parsed.data.tender_id}`)

  // Return all messages so the client can append in-place (avoids full page
  // reload which would reset the active tab back to "Synthèse").
  const now = new Date().toISOString()
  return {
    ok: true as const,
    userMessage: {
      id: userMessageId,
      tender_id: parsed.data.tender_id,
      conversation_id: parsed.data.conversation_id ?? null,
      user_id: userId,
      agent_name: null,
      role: 'user' as const,
      content: parsed.data.message,
      metadata: { turn_id: turnId },
      created_at: now,
    },
    agentMessages: agentResults.map((r, idx) => ({
      id: agentMessageIds[idx],
      tender_id: parsed.data.tender_id,
      conversation_id: parsed.data.conversation_id ?? null,
      user_id: null,
      agent_name: r.agentName,
      role: 'agent' as const,
      content: r.content,
      metadata: r.metadata,
      created_at: now,
    })),
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
    } finally {
      revalidatePath(`/tenders/${parsed.data.tender_id}`)
    }
  })

  revalidatePath(`/tenders/${parsed.data.tender_id}`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// runChallengeRoundAction
// ---------------------------------------------------------------------------

const challengeSchema = z.object({
  tender_id: z.string().uuid(),
  turn_id: z.string().uuid(),
  current_round: z.number().int().min(0).max(0),  // 1 round max ; current=0 → next=1
})

export async function runChallengeRoundAction(formData: FormData) {
  const userId = await requireManagerOrAdmin()
  const parsed = challengeSchema.safeParse({
    tender_id: formData.get('tender_id'),
    turn_id: formData.get('turn_id'),
    current_round: parseInt(String(formData.get('current_round') ?? '0'), 10),
  })
  if (!parsed.success) return { error: 'Invalid input' }

  const nextRound = parsed.data.current_round + 1
  if (nextRound > 1) return { error: 'Une seule confrontation par tour' }

  // Récupérer toutes les bulles agent du turn courant + round actuel
  const allMessages = await listChatMessages(parsed.data.tender_id)
  const sameTurnAgentMessages = allMessages.filter((m) =>
    m.role === 'agent'
    && m.metadata
    && (m.metadata as Record<string, unknown>).turn_id === parsed.data.turn_id
    && ((m.metadata as Record<string, unknown>).challenge_round ?? 0) === parsed.data.current_round
  )

  if (sameTurnAgentMessages.length < 2) {
    return { error: 'Au moins 2 agents requis pour un challenge' }
  }

  const tender = await getTender(parsed.data.tender_id)
  if (!tender) return { error: 'Tender introuvable' }

  const [doc, analysis, lib, history, terrainCtx, knowledgeCtx] = await Promise.all([
    getTenderDocument(parsed.data.tender_id),
    getLatestTenderAnalysis(parsed.data.tender_id),
    buildLibraryContext(),
    listChatMessages(parsed.data.tender_id),
    fetchTerrainContext(parsed.data.tender_id),
    fetchKnowledgeContext(parsed.data.tender_id),
  ])
  const tenderContext = buildTenderContext(tender, doc, analysis) + terrainCtx + knowledgeCtx

  // Récupérer le user message original du turn (pour passer le contexte de la question initiale)
  const originalUserMessage = allMessages.find((m) =>
    m.role === 'user'
    && m.metadata
    && (m.metadata as Record<string, unknown>).turn_id === parsed.data.turn_id
  )
  const originalQuestion = originalUserMessage?.content ?? '(question initiale non retrouvée)'

  // Pour chaque agent du round précédent, lancer un challenge en parallèle
  const challengeResults = await Promise.all(
    sameTurnAgentMessages.map(async (myMessage) => {
      const myAgent = myMessage.agent_name as ChatAgentName | null
      if (!myAgent) return null  // skip si pas d'agent_name (ne devrait pas arriver)

      const otherAgents = sameTurnAgentMessages
        .filter((m) => m.id !== myMessage.id)
        .map((m) => ({
          agent: m.agent_name as ChatAgentName,
          content: m.content,
        }))
      try {
        const r = await chatWithAgent({
          agentName: myAgent,
          userMessage: originalQuestion,
          tenderContext,
          libraryContext: lib.markdown,
          history,
          userId,
          challengeContext: { otherAgents },
        })
        return {
          agentName: myAgent,
          content: r.content,
          metadata: {
            provider: r.provider,
            model: r.model,
            prompt_version: r.promptVersion,
            input_tokens: r.inputTokens,
            output_tokens: r.outputTokens,
            duration_ms: r.durationMs,
            turn_id: parsed.data.turn_id,
            challenge_round: nextRound,
          },
        }
      } catch (e) {
        return {
          agentName: myAgent,
          content: `_Erreur agent ${myAgent} (challenge round ${nextRound}) : ${e instanceof Error ? e.message : 'unknown'}_`,
          metadata: { error: true, turn_id: parsed.data.turn_id, challenge_round: nextRound },
        }
      }
    })
  )

  const validResults = challengeResults.filter((r): r is NonNullable<typeof r> => r !== null)

  // Insert N agent messages en parallèle
  const insertedIds = await Promise.all(
    validResults.map((r) =>
      insertChatMessage({
        tender_id: parsed.data.tender_id,
        user_id: null,
        agent_name: r.agentName,
        role: 'agent',
        content: r.content,
        metadata: r.metadata,
      })
    )
  )

  revalidatePath(`/tenders/${parsed.data.tender_id}`)

  const now = new Date().toISOString()
  return {
    ok: true as const,
    agentMessages: validResults.map((r, idx) => ({
      id: insertedIds[idx],
      tender_id: parsed.data.tender_id,
      conversation_id: null,
      user_id: null,
      agent_name: r.agentName,
      role: 'agent' as const,
      content: r.content,
      metadata: r.metadata,
      created_at: now,
    })),
  }
}
