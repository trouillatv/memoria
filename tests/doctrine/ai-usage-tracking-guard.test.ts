// Tripwires structurels — tracking IA ne fuite jamais de PII ni de
// contenu sensible dans la table ai_usage. Couverture des call-sites
// critiques (embeddings, OCR, agents).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')

describe('AI usage tracking — anti-PII', () => {
  const tracking = read('services/ai/tracking.ts')
  const codeOnly = tracking.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

  it('AIUsageEntry n\'expose AUCUN champ texte de contenu (anti-fuite)', () => {
    // L'interface ne doit PAS contenir : chunk_text, prompt, response,
    // body, content, extracted_text, fragment, output_text.
    const forbidden = ['chunk_text', 'prompt:', 'response:', 'body:', 'content:', 'extracted_text', 'fragment:', 'output_text']
    const interfaceBlock = codeOnly.match(/interface AIUsageEntry \{[\s\S]*?\}/)?.[0] ?? ''
    for (const f of forbidden) {
      expect(interfaceBlock.includes(f), `AIUsageEntry ne doit pas contenir le champ '${f}'`).toBe(false)
    }
  })

  it('logAIUsageDirect n\'a pas de paramètre texte de contenu', () => {
    const fn = codeOnly.match(/logAIUsageDirect\(params:[\s\S]*?\}\):\s*Promise/)?.[0] ?? ''
    expect(fn).toBeTruthy()
    const forbidden = ['chunkText', 'promptText', 'responseText', 'outputText', 'fragment:', 'content:']
    for (const f of forbidden) {
      expect(fn.includes(f), `logAIUsageDirect ne doit pas exposer '${f}'`).toBe(false)
    }
  })

  it('table de prix présente et déterministe (pas de live pricing)', () => {
    expect(/AI_MODEL_PRICING/.test(codeOnly)).toBe(true)
    expect(/gemini-embedding-001/.test(codeOnly)).toBe(true)
    expect(/gemini-2\.5-flash/.test(codeOnly)).toBe(true)
    // Pas d'appel réseau pour récupérer les prix (live pricing interdit)
    expect(/fetch\(['"][^'"]*pricing/.test(codeOnly)).toBe(false)
  })

  it('estimateCostUsd retourne null pour modèle inconnu (pas de mensonge par 0)', () => {
    expect(/if \(!pricing\) return null/.test(codeOnly)).toBe(true)
  })
})

describe('AI tracking — couverture des call-sites critiques', () => {
  it('embedChunksInBatches tracé (1 entrée par batch, jamais par chunk)', () => {
    const src = read('lib/ai/embed-knowledge-chunks.ts').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(/logAIUsageDirect\(/.test(src)).toBe(true)
    // L'appel doit être DANS embedChunksInBatches, pas dans la boucle d'upsert
    const batchFn = src.match(/embedChunksInBatches\([\s\S]*?\n\}/)?.[0] ?? ''
    expect(/logAIUsageDirect\(/.test(batchFn)).toBe(true)
  })

  it('feature passée à embedChunksInBatches par TOUS les callers', () => {
    const src = read('lib/ai/embed-knowledge-chunks.ts')
    expect(/embedChunksInBatches\(chunks,\s*['"]embed_chunks_document['"]\)/.test(src)).toBe(true)
    expect(/embedChunksInBatches\(chunks,\s*['"]embed_chunks_library['"]\)/.test(src)).toBe(true)
    expect(/embedChunksInBatches\(chunks,\s*['"]embed_chunks_tender_history['"]\)/.test(src)).toBe(true)
  })

  it('embedAndStoreTrace tracé (feature dynamique selon source_type)', () => {
    const src = read('lib/ai/embed-trace.ts').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(/logAIUsageDirect\(/.test(src)).toBe(true)
    expect(/embed_trace_\$\{params\.sourceType\}/.test(src)).toBe(true)
  })

  it('OCR Gemini Vision tracé (feature ocr_pdf)', () => {
    const src = read('services/pdf/extract.ts').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(/logAIUsageDirect/.test(src)).toBe(true)
    expect(/feature:\s*['"]ocr_pdf['"]/.test(src)).toBe(true)
  })

  it('tracking embeddings stocke input_tokens, jamais le texte brut', () => {
    const knowledgeChunks = read('lib/ai/embed-knowledge-chunks.ts')
    const trace = read('lib/ai/embed-trace.ts')
    const ocr = read('services/pdf/extract.ts')
    for (const [name, src] of [['embed-knowledge-chunks', knowledgeChunks], ['embed-trace', trace], ['pdf/extract', ocr]] as const) {
      // Aucun appel à logAIUsageDirect ne doit passer un champ texte
      const calls = src.match(/logAIUsageDirect\([\s\S]*?\}\)/g) ?? []
      for (const call of calls) {
        expect(call.includes('chunk_text'), `${name}: logAIUsageDirect ne doit jamais passer chunk_text`).toBe(false)
        expect(call.includes('extracted_text:'), `${name}: pas de extracted_text en payload`).toBe(false)
        expect(/prompt:\s*['"`]/.test(call), `${name}: pas de prompt en payload`).toBe(false)
      }
    }
  })
})

describe('AI usage rollup — pas d\'appel IA pour observer l\'IA', () => {
  const src = read('lib/db/ai-usage-rollup.ts')

  it('aucun import IA / LLM / orchestrateur', () => {
    expect(/@anthropic-ai|@google\/genai|generateText|services\/ai\/orchestrator/.test(src)).toBe(false)
  })

  it('aucun appel embedding / RPC vectoriel', () => {
    expect(/getEmbedding|findSimilar|embedDocumentChunks/.test(src)).toBe(false)
  })

  it('helpers exportés : agrégat par feature + appels récents + production', () => {
    expect(/export async function getAIUsageByFeature/.test(src)).toBe(true)
    expect(/export async function getRecentAICalls/.test(src)).toBe(true)
    expect(/export async function getAIProductionSummary/.test(src)).toBe(true)
  })
})
