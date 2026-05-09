# Plan 3 / 5 — Couche IA + Module 1 (Appels d'offres)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer (a) la couche IA multi-provider + multi-agents, (b) le Module 1 « Appels d'offres » qui consomme cette couche : upload PDF → extraction texte → analyse async (orchestrateur lecteur_ao + memoire_technique + opportunity_scorer) → vue résultats avec onglets Synthèse / Analyse / Mémoire technique → exports markdown / HTML enrichi / Word.

**Architecture:**
- `services/ai/` : interface `AIProvider` + factory + 3 providers (mock prêt, gemini + anthropic stubbés). `services/ai/agents/` : interface `AIAgent`, registry, 3 agents implémentés (lecteur_ao, memoire_technique, opportunity_scorer) + 4 stubs documentés.
- `services/ai/library-context.ts` : injection bibliothèque AGP (Plan 2) dans le system prompt des agents.
- `services/ai/orchestrator.ts` : phases lecture → mémoire technique + scoring (parallèle).
- `services/ai/tracking.ts` : log dans `ai_usage` (DB) à chaque appel agent.
- `services/pdf/extract.ts` : `pdf-parse` server-side, détection PDF scanné (texte vide).
- Module 1 UI : `/tenders` (liste), `/tenders/new` (upload), `/tenders/[id]` (vue analyse).
- Server Actions auditées (`tender_created`, `analysis_relaunched`, `tender_archived`).
- Background analyse via Next.js 16 `unstable_after` ou Route Handler dédié + polling client.
- Multi-tenant readiness : tous accès DB via `lib/db/tenders.ts`.

**Tech Stack additions:**
- `pdf-parse` (extraction texte PDF)
- `@google/genai` (Gemini SDK, optionnel — peut rester non-installé tant que `AI_PROVIDER=mock`)
- `@anthropic-ai/sdk` (idem)
- `docx` (génération Word)
- `marked` (markdown → HTML pour clipboard)
- `react-markdown` + `remark-gfm` (rendu markdown dans la vue mémoire)

**Spec de référence:** `docs/superpowers/specs/2026-05-09-netoiage-mvp-design.md` § 6 (couche IA + multi-agents) + § 7 (Module 1 — Appels d'offres).

---

## Structure de fichiers à créer

```
.
├─ services/
│  ├─ ai/
│  │  ├─ index.ts                    # AIProvider interface + types CompletionInput/Output
│  │  ├─ factory.ts                  # selon AI_PROVIDER env
│  │  ├─ providers/
│  │  │  ├─ mock.ts                  # ✅ MVP : retourne fixtures réalistes
│  │  │  ├─ gemini.ts                # 🟡 stubbé, branchera @google/genai au runtime
│  │  │  └─ anthropic.ts             # 🟡 stubbé, branchera @anthropic-ai/sdk au runtime
│  │  ├─ agents/
│  │  │  ├─ types.ts                 # AIAgent, AgentName, AgentContext
│  │  │  ├─ registry.ts              # map name → instance
│  │  │  ├─ lecteur-ao.ts            # ✅
│  │  │  ├─ memoire-technique.ts     # ✅
│  │  │  ├─ opportunity-scorer.ts    # ✅
│  │  │  ├─ conformite.ts            # 🟡 stub
│  │  │  ├─ contradicteur.ts         # 🟡 stub
│  │  │  ├─ financier.ts             # 🟡 stub
│  │  │  └─ terrain.ts               # 🟡 stub
│  │  ├─ prompts/
│  │  │  ├─ lecteur-ao.v1.ts
│  │  │  ├─ memoire-technique.v1.ts
│  │  │  └─ opportunity-scorer.v1.ts
│  │  ├─ orchestrator.ts             # analyzeTender()
│  │  ├─ library-context.ts          # buildLibraryContext()
│  │  └─ tracking.ts                 # withAITracking()
│  └─ pdf/
│     └─ extract.ts                  # pdf-parse wrapper, détection scanné
├─ lib/db/tenders.ts                  # CRUD tenders + tender_documents + tender_analyses
├─ types/db.ts                        # ajouter DbTender, DbTenderDocument, DbTenderAnalysis
├─ app/(dashboard)/tenders/
│  ├─ page.tsx                       # liste
│  ├─ new/
│  │  ├─ page.tsx                    # form upload PDF
│  │  ├─ TenderUploadForm.tsx
│  │  └─ actions.ts                  # createTenderAction (upload + extract + schedule analyze)
│  ├─ [id]/
│  │  ├─ page.tsx                    # vue analyse, polling-aware
│  │  ├─ TenderAnalysisLoader.tsx    # loader + polling
│  │  ├─ TenderSynthese.tsx
│  │  ├─ TenderAnalyseDetaillee.tsx
│  │  ├─ TenderMemoireTechnique.tsx
│  │  ├─ TenderExportButtons.tsx
│  │  ├─ TenderScoreBadge.tsx
│  │  ├─ TenderStatusBadge.tsx
│  │  └─ actions.ts                  # relaunchAnalysisAction, archiveAction
│  └─ TenderListTable.tsx
├─ app/api/tenders/[id]/
│  ├─ status/route.ts                # GET status pour polling
│  └─ analyze/route.ts               # POST background analyse (déclenché par fire-and-forget)
└─ tests/services/
   ├─ ai-mock-provider.test.ts
   └─ orchestrator.test.ts
```

---

## Pré-requis vérifiés

- ✅ Tables `tenders`, `tender_documents`, `tender_analyses`, `ai_usage` existent (Plan 1)
- ✅ Bucket `tender-documents` créé (Plan 1)
- ✅ RLS sur tenders + analyses : manager + admin only (Plan 1)
- ✅ `lib/db/knowledge.ts` exporte `listKnowledgeItems()` (Plan 2)
- ✅ Pattern Server Action + audit + lib/db centralisation (Plans 1-2)

---

## Task 1 : Types tenders + lib/db/tenders.ts

**Files:**
- Modify: `types/db.ts`
- Create: `lib/db/tenders.ts`

- [ ] **Step 1.1 : Ajouter les types DB tenders à `types/db.ts`**

À la fin du fichier (après `DbKnowledgeItem`) :

```ts
export interface DbTender {
  id: string
  title: string
  client_name: string | null
  deadline: string | null
  status: TenderStatus
  opportunity_score: number | null
  error_msg: string | null
  created_by: string
  created_at: string
  deleted_at: string | null
}

export interface DbTenderDocument {
  id: string
  tender_id: string
  storage_path: string
  filename: string
  size_bytes: number | null
  page_count: number | null
  extracted_text: string | null
  uploaded_at: string
}

export interface DbTenderAnalysisConstraint {
  label: string
  detail?: string
  required?: boolean
  category?: string
}

export interface DbTenderAnalysisRisk {
  label: string
  severity: 'low' | 'medium' | 'high'
  detail?: string
}

export interface DbTenderAnalysisChecklistItem {
  item: string
  required: boolean
}

export interface DbTenderAnalysis {
  id: string
  tender_id: string
  provider: AIProviderName
  model: string | null
  prompt_versions: Record<string, string> | null
  summary: string | null
  constraints: DbTenderAnalysisConstraint[] | null
  risks: DbTenderAnalysisRisk[] | null
  checklist: DbTenderAnalysisChecklistItem[] | null
  technical_memo: string | null
  library_snapshot: { items_count: number; total_chars: number } | null
  raw_response: unknown | null
  created_at: string
}
```

- [ ] **Step 1.2 : Créer `lib/db/tenders.ts`**

```ts
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { DbTender, DbTenderDocument, DbTenderAnalysis, TenderStatus } from '@/types/db'

export interface TenderListQuery {
  status?: TenderStatus
  search?: string
}

export async function listTenders(query: TenderListQuery = {}): Promise<DbTender[]> {
  const supabase = await createServerClient()
  let q = supabase
    .from('tenders')
    .select('id, title, client_name, deadline, status, opportunity_score, error_msg, created_by, created_at, deleted_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (query.status) q = q.eq('status', query.status)
  if (query.search) {
    const s = query.search.replace(/[%_]/g, '\\$&')
    q = q.or(`title.ilike.%${s}%,client_name.ilike.%${s}%`)
  }
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as DbTender[]
}

export async function getTender(id: string): Promise<DbTender | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('tenders')
    .select('id, title, client_name, deadline, status, opportunity_score, error_msg, created_by, created_at, deleted_at')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  return data as DbTender
}

export async function createTender(input: {
  title: string
  client_name?: string | null
  deadline?: string | null
  created_by: string
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('tenders')
    .insert({
      title: input.title,
      client_name: input.client_name ?? null,
      deadline: input.deadline ?? null,
      status: 'draft',
      created_by: input.created_by,
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('No id')
  return data.id
}

export async function updateTenderStatus(
  id: string,
  status: TenderStatus,
  errorMsg?: string | null,
  opportunityScore?: number | null
): Promise<void> {
  const supabase = createAdminClient()
  const fields: Record<string, unknown> = { status }
  if (errorMsg !== undefined) fields.error_msg = errorMsg
  if (opportunityScore !== undefined) fields.opportunity_score = opportunityScore
  const { error } = await supabase.from('tenders').update(fields).eq('id', id)
  if (error) throw error
}

export async function softDeleteTender(id: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('tenders')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function createTenderDocument(input: {
  tender_id: string
  storage_path: string
  filename: string
  size_bytes: number
  page_count?: number | null
  extracted_text?: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('tender_documents')
    .insert(input)
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('No id')
  return data.id
}

export async function getTenderDocument(tenderId: string): Promise<DbTenderDocument | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('tender_documents')
    .select('id, tender_id, storage_path, filename, size_bytes, page_count, extracted_text, uploaded_at')
    .eq('tender_id', tenderId)
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return data as DbTenderDocument
}

export async function getLatestTenderAnalysis(tenderId: string): Promise<DbTenderAnalysis | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('tender_analyses')
    .select('id, tender_id, provider, model, prompt_versions, summary, constraints, risks, checklist, technical_memo, library_snapshot, raw_response, created_at')
    .eq('tender_id', tenderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return data as unknown as DbTenderAnalysis
}

export async function insertTenderAnalysis(input: Omit<DbTenderAnalysis, 'id' | 'created_at'>): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('tender_analyses')
    .insert(input)
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('No id')
  return data.id
}

export async function countAnalysesToday(): Promise<number> {
  const supabase = createAdminClient()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count, error } = await supabase
    .from('ai_usage')
    .select('id', { count: 'exact', head: true })
    .eq('feature', 'lecteur_ao')
    .gte('created_at', since)
  if (error) throw error
  return count ?? 0
}
```

- [ ] **Step 1.3 : Verify tsc + commit**

```bash
npx tsc --noEmit
git add types/db.ts lib/db/tenders.ts
git commit -m "feat(lib/db): tenders.ts CRUD + types DbTender/Document/Analysis"
```

---

## Task 2 : Service IA — interface + factory + mock provider + tracking

**Files:**
- Create: `services/ai/index.ts`
- Create: `services/ai/factory.ts`
- Create: `services/ai/providers/mock.ts`
- Create: `services/ai/providers/gemini.ts` (stub)
- Create: `services/ai/providers/anthropic.ts` (stub)
- Create: `services/ai/tracking.ts`

- [ ] **Step 2.1 : `services/ai/index.ts`**

```ts
import { z } from 'zod'

export type AIProviderName = 'mock' | 'gemini' | 'anthropic' | 'openai'

export interface CompletionInput {
  systemPrompt: string
  userMessage: string
  responseSchema?: z.ZodTypeAny
  modelTier: 'light' | 'heavy'
}

export interface TokenUsage {
  input: number
  output: number
}

export interface CompletionOutput {
  text: string
  parsed?: unknown
  tokens: TokenUsage
  model: string
  durationMs: number
}

export interface AIProvider {
  name: AIProviderName
  complete(input: CompletionInput): Promise<CompletionOutput>
}
```

- [ ] **Step 2.2 : `services/ai/providers/mock.ts`**

```ts
import type { AIProvider, CompletionInput, CompletionOutput } from '../index'

/**
 * Provider mock : utilise un dispatcher basé sur le system prompt pour retourner
 * un objet structurellement valide. Utilisé en dev et démo (pas de coût IA).
 *
 * Le contenu spécifique par agent (lecteur_ao, memoire_technique, etc.) est
 * fourni dans les fixtures importées par les agents, pas ici. Ce mock retourne
 * juste le `parsed` qu'on lui passe via `userMessage` JSON, ou un fallback.
 */
export class MockProvider implements AIProvider {
  name = 'mock' as const

  async complete(input: CompletionInput): Promise<CompletionOutput> {
    // Convention : si le caller veut une réponse spécifique, il pose
    // input.userMessage = '__MOCK_FIXTURE__:<json>'
    let parsed: unknown = null
    const prefix = '__MOCK_FIXTURE__:'
    if (input.userMessage.startsWith(prefix)) {
      try {
        parsed = JSON.parse(input.userMessage.slice(prefix.length))
      } catch {
        parsed = null
      }
    }
    if (parsed === null) {
      parsed = { _mock: true, hint: 'Caller did not pass __MOCK_FIXTURE__:<json>; falling back.' }
    }

    // Simulate small latency
    await new Promise((r) => setTimeout(r, 50))

    return {
      text: typeof parsed === 'string' ? parsed : JSON.stringify(parsed),
      parsed,
      tokens: { input: 100, output: 200 },
      model: 'mock-1',
      durationMs: 50,
    }
  }
}
```

- [ ] **Step 2.3 : `services/ai/providers/gemini.ts` (stub)**

```ts
import type { AIProvider, CompletionInput, CompletionOutput } from '../index'

/**
 * Provider Gemini — stub. Sera implémenté avec @google/genai quand l'utilisateur
 * pose GOOGLE_GENAI_API_KEY et bascule AI_PROVIDER=gemini.
 *
 * Pour le MVP, throws explicitement pour signaler la non-implémentation.
 */
export class GeminiProvider implements AIProvider {
  name = 'gemini' as const

  async complete(_input: CompletionInput): Promise<CompletionOutput> {
    throw new Error(
      'GeminiProvider not yet implemented. Install @google/genai, set GOOGLE_GENAI_API_KEY, and replace this stub.'
    )
  }
}
```

- [ ] **Step 2.4 : `services/ai/providers/anthropic.ts` (stub)**

```ts
import type { AIProvider, CompletionInput, CompletionOutput } from '../index'

export class AnthropicProvider implements AIProvider {
  name = 'anthropic' as const

  async complete(_input: CompletionInput): Promise<CompletionOutput> {
    throw new Error(
      'AnthropicProvider not yet implemented. Install @anthropic-ai/sdk, set ANTHROPIC_API_KEY, and replace this stub.'
    )
  }
}
```

- [ ] **Step 2.5 : `services/ai/factory.ts`**

```ts
import type { AIProvider } from './index'
import { MockProvider } from './providers/mock'
import { GeminiProvider } from './providers/gemini'
import { AnthropicProvider } from './providers/anthropic'

export function getAIProvider(): AIProvider {
  switch (process.env.AI_PROVIDER) {
    case 'gemini':
      return new GeminiProvider()
    case 'anthropic':
      return new AnthropicProvider()
    case 'mock':
    default:
      return new MockProvider()
  }
}
```

- [ ] **Step 2.6 : `services/ai/tracking.ts`**

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import type { AIProviderName } from './index'

export interface AIUsageEntry {
  user_id: string | null
  feature: string
  provider: AIProviderName
  model: string | null
  input_tokens: number | null
  output_tokens: number | null
  cost_usd: number | null
  duration_ms: number | null
  status: 'success' | 'error'
  error_msg: string | null
}

export async function logAIUsage(entry: AIUsageEntry): Promise<void> {
  try {
    const supabase = createAdminClient()
    const { error } = await supabase.from('ai_usage').insert(entry)
    if (error) console.warn('[ai-usage] insert failed:', error.message)
  } catch (e) {
    console.warn('[ai-usage] exception:', e)
  }
}

export async function withAITracking<T>(
  feature: string,
  userId: string | null,
  fn: () => Promise<{ result: T; tokens: { input: number; output: number }; model: string; provider: AIProviderName; durationMs: number }>
): Promise<T> {
  const start = Date.now()
  try {
    const r = await fn()
    await logAIUsage({
      user_id: userId,
      feature,
      provider: r.provider,
      model: r.model,
      input_tokens: r.tokens.input,
      output_tokens: r.tokens.output,
      cost_usd: null,
      duration_ms: r.durationMs,
      status: 'success',
      error_msg: null,
    })
    return r.result
  } catch (e) {
    await logAIUsage({
      user_id: userId,
      feature,
      provider: 'mock',
      model: null,
      input_tokens: null,
      output_tokens: null,
      cost_usd: null,
      duration_ms: Date.now() - start,
      status: 'error',
      error_msg: e instanceof Error ? e.message : String(e),
    })
    throw e
  }
}
```

- [ ] **Step 2.7 : Verify tsc + commit**

```bash
npx tsc --noEmit
git add services/ai/
git commit -m "feat(ai): provider interface + factory + mock/gemini/anthropic + tracking"
```

---

## Task 3 : Agents IA — types, registry, 3 agents implémentés + 4 stubs + prompts

**Files:**
- Create: `services/ai/agents/types.ts`
- Create: `services/ai/agents/registry.ts`
- Create: `services/ai/agents/lecteur-ao.ts`
- Create: `services/ai/agents/memoire-technique.ts`
- Create: `services/ai/agents/opportunity-scorer.ts`
- Create: `services/ai/agents/conformite.ts` (stub)
- Create: `services/ai/agents/contradicteur.ts` (stub)
- Create: `services/ai/agents/financier.ts` (stub)
- Create: `services/ai/agents/terrain.ts` (stub)
- Create: `services/ai/prompts/lecteur-ao.v1.ts`
- Create: `services/ai/prompts/memoire-technique.v1.ts`
- Create: `services/ai/prompts/opportunity-scorer.v1.ts`

- [ ] **Step 3.1 : `services/ai/agents/types.ts`**

```ts
import type { AIProvider } from '../index'

export type AgentName =
  | 'lecteur_ao'
  | 'memoire_technique'
  | 'opportunity_scorer'
  | 'conformite'
  | 'contradicteur'
  | 'financier'
  | 'terrain'

export interface AgentContext {
  provider: AIProvider
  userId: string | null
  libraryContext: string
  previousResults?: Partial<Record<AgentName, unknown>>
}

export interface AIAgent<TInput, TOutput> {
  name: AgentName
  description: string
  modelTier: 'light' | 'heavy'
  promptVersion: string
  run(input: TInput, ctx: AgentContext): Promise<TOutput>
}
```

- [ ] **Step 3.2 : Prompts versionnés (3 fichiers `*.v1.ts`)**

`services/ai/prompts/lecteur-ao.v1.ts` :

```ts
export const LECTEUR_AO_V1 = {
  version: 'v1',
  system: `Tu es un analyste expert en appels d'offres pour le secteur du nettoyage professionnel en France.
À partir du texte brut d'un cahier des charges, tu produis :
- summary : un résumé exécutif factuel en 5-8 lignes
- constraints : la liste des contraintes (techniques, administratives, qualité, délais), chacune avec un label, un detail optionnel, et required (obligatoire/recommandé)
- risks : les risques identifiés avec severity ('low'|'medium'|'high') et un detail
- checklist : une checklist conformité concrète, items required (vrai/faux)

Tu réponds UNIQUEMENT au format JSON strict matchant le schéma fourni. Pas de markdown, pas de commentaires.`,
  userTemplate: (rawText: string) => `Voici le texte du cahier des charges à analyser :\n\n${rawText.slice(0, 80000)}`,
}
```

`services/ai/prompts/memoire-technique.v1.ts` :

```ts
export const MEMOIRE_TECHNIQUE_V1 = {
  version: 'v1',
  system: `Tu es un rédacteur expert en mémoires techniques pour des appels d'offres de nettoyage professionnel.

Tu utilises les données fournies (analyse de l'AO + bibliothèque interne de l'entreprise) pour produire un mémoire technique en markdown structuré :
- # Présentation de notre approche
- ## Compréhension du besoin (synthèse de l'AO)
- ## Notre méthodologie (références aux procédures de la bibliothèque)
- ## Moyens humains et matériels mis en œuvre (issus de la bibliothèque)
- ## Engagements qualité et environnementaux (issus de la bibliothèque)
- ## Références similaires (issues de la bibliothèque)
- ## Plan de gestion des risques (basé sur les risks détectés dans l'AO)

**Important : reste factuel. Cite uniquement ce qui apparaît dans la bibliothèque. Pas d'invention.**

Réponse en markdown pur, ~600-1200 mots.`,
  userTemplate: (input: { reading: unknown; libraryContext: string }) =>
    `=== Bibliothèque AGP (contexte entreprise) ===\n${input.libraryContext}\n\n=== Analyse de l'AO ===\n${JSON.stringify(input.reading, null, 2)}`,
}
```

`services/ai/prompts/opportunity-scorer.v1.ts` :

```ts
export const OPPORTUNITY_SCORER_V1 = {
  version: 'v1',
  system: `Tu es un analyste métier qui scorerait l'opportunité d'un AO pour une entreprise de nettoyage.

Critères :
- Alignement métier (références similaires en bibliothèque)
- Faisabilité opérationnelle (moyens humains/matériels)
- Niveau de risque
- Marge estimée potentielle

Tu réponds UNIQUEMENT en JSON strict : { score: number (0-100), rationale: string (3-5 lignes) }.`,
  userTemplate: (input: { reading: unknown; memo: string }) =>
    `=== Analyse AO ===\n${JSON.stringify(input.reading, null, 2)}\n\n=== Mémoire technique générée ===\n${input.memo.slice(0, 4000)}`,
}
```

- [ ] **Step 3.3 : `services/ai/agents/lecteur-ao.ts`**

```ts
import { z } from 'zod'
import type { AIAgent, AgentContext } from './types'
import { LECTEUR_AO_V1 } from '../prompts/lecteur-ao.v1'

const constraintSchema = z.object({
  label: z.string(),
  detail: z.string().optional(),
  required: z.boolean().optional(),
  category: z.string().optional(),
})

const riskSchema = z.object({
  label: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
  detail: z.string().optional(),
})

const checklistItemSchema = z.object({
  item: z.string(),
  required: z.boolean(),
})

export const lecteurAoOutputSchema = z.object({
  summary: z.string(),
  constraints: z.array(constraintSchema),
  risks: z.array(riskSchema),
  checklist: z.array(checklistItemSchema),
})

export type LecteurAoInput = { rawText: string }
export type LecteurAoOutput = z.infer<typeof lecteurAoOutputSchema>

export const lecteurAoAgent: AIAgent<LecteurAoInput, LecteurAoOutput> = {
  name: 'lecteur_ao',
  description: "Lit le PDF d'AO et extrait contraintes, risques, checklist, résumé",
  modelTier: 'heavy',
  promptVersion: LECTEUR_AO_V1.version,

  async run(input, ctx) {
    // Mode mock : injecter une fixture réaliste
    const isMock = ctx.provider.name === 'mock'
    const userMessage = isMock
      ? '__MOCK_FIXTURE__:' + JSON.stringify(buildMockFixture(input.rawText))
      : LECTEUR_AO_V1.userTemplate(input.rawText)

    const r = await ctx.provider.complete({
      systemPrompt: LECTEUR_AO_V1.system,
      userMessage,
      responseSchema: lecteurAoOutputSchema,
      modelTier: 'heavy',
    })

    const parsed = lecteurAoOutputSchema.safeParse(r.parsed)
    if (!parsed.success) throw new Error(`lecteur_ao: invalid output: ${parsed.error.message}`)
    return parsed.data
  },
}

function buildMockFixture(rawText: string): LecteurAoOutput {
  const wordCount = rawText.split(/\s+/).length
  return {
    summary: `Mock — Cahier des charges de ${wordCount} mots environ. Marché de nettoyage type tertiaire avec exigences ISO 9001 et planning hebdomadaire. Échéance dans la semaine. Volume horaire mensuel estimé ~120h.`,
    constraints: [
      { label: 'ISO 9001:2015', detail: 'Certification exigée pour toute la durée du marché', required: true, category: 'qualité' },
      { label: 'Personnel en CDI', detail: 'Tout le personnel intervenant doit être en CDI', required: true, category: 'administratif' },
      { label: 'Produits écolabellisés', detail: 'Produits désinfectants Ecolabel uniquement', required: true, category: 'environnement' },
      { label: 'Astreinte téléphonique', detail: '24/7 pendant la durée du marché', required: false, category: 'opérationnel' },
    ],
    risks: [
      { label: 'Disponibilité personnel', severity: 'medium', detail: 'Recrutement difficile en zone X' },
      { label: 'Délai de mobilisation', severity: 'high', detail: 'Démarrage J+15 demandé' },
    ],
    checklist: [
      { item: 'Joindre attestation ISO 9001 valide', required: true },
      { item: 'Fournir liste nominative des agents avec n° contrat CDI', required: true },
      { item: 'Annexer fiche technique des produits Ecolabel', required: true },
      { item: 'Décrire dispositif d\'astreinte 24/7', required: false },
    ],
  }
}
```

- [ ] **Step 3.4 : `services/ai/agents/memoire-technique.ts`**

```ts
import { z } from 'zod'
import type { AIAgent, AgentContext } from './types'
import { MEMOIRE_TECHNIQUE_V1 } from '../prompts/memoire-technique.v1'
import type { LecteurAoOutput } from './lecteur-ao'

export const memoireTechniqueOutputSchema = z.object({
  technical_memo: z.string().min(100),
})

export type MemoireTechniqueInput = { reading: LecteurAoOutput }
export type MemoireTechniqueOutput = z.infer<typeof memoireTechniqueOutputSchema>

export const memoireTechniqueAgent: AIAgent<MemoireTechniqueInput, MemoireTechniqueOutput> = {
  name: 'memoire_technique',
  description: "Génère un mémoire technique markdown grounded sur la bibliothèque AGP",
  modelTier: 'heavy',
  promptVersion: MEMOIRE_TECHNIQUE_V1.version,

  async run(input, ctx) {
    const isMock = ctx.provider.name === 'mock'
    const userMessage = isMock
      ? '__MOCK_FIXTURE__:' + JSON.stringify(buildMockFixture(input, ctx.libraryContext))
      : MEMOIRE_TECHNIQUE_V1.userTemplate({ reading: input.reading, libraryContext: ctx.libraryContext })

    const r = await ctx.provider.complete({
      systemPrompt: MEMOIRE_TECHNIQUE_V1.system,
      userMessage,
      responseSchema: memoireTechniqueOutputSchema,
      modelTier: 'heavy',
    })

    const parsed = memoireTechniqueOutputSchema.safeParse(r.parsed)
    if (!parsed.success) {
      // Fallback : si la sortie est juste du markdown, on l'enrobe
      if (typeof r.text === 'string' && r.text.length > 100) {
        return { technical_memo: r.text }
      }
      throw new Error(`memoire_technique: invalid output: ${parsed.error.message}`)
    }
    return parsed.data
  },
}

function buildMockFixture(input: MemoireTechniqueInput, libCtx: string): MemoireTechniqueOutput {
  const hasLib = libCtx.trim().length > 0
  return {
    technical_memo: `# Présentation de notre approche

## Compréhension du besoin

${input.reading.summary}

## Notre méthodologie

Nous appliquons une démarche structurée en 4 phases : audit initial, mise en place du dispositif, exécution avec contrôles qualité hebdomadaires, et reporting mensuel.

${hasLib ? '## Moyens humains et matériels\n\nLes informations issues de notre bibliothèque interne montrent un dispositif aligné avec ce marché.\n' : '_(bibliothèque AGP vide — mémoire générique)_\n'}

## Engagements qualité

${input.reading.constraints
  .filter((c) => c.category === 'qualité' || c.category === 'environnement')
  .map((c) => `- ${c.label}${c.detail ? ` : ${c.detail}` : ''}`)
  .join('\n')}

## Plan de gestion des risques

${input.reading.risks.map((r) => `- **${r.label}** (${r.severity}) : ${r.detail ?? '—'}`).join('\n')}

---

*Mémoire technique généré en mode mock — passer à AI_PROVIDER=gemini pour une version IA réelle.*`,
  }
}
```

- [ ] **Step 3.5 : `services/ai/agents/opportunity-scorer.ts`**

```ts
import { z } from 'zod'
import type { AIAgent, AgentContext } from './types'
import { OPPORTUNITY_SCORER_V1 } from '../prompts/opportunity-scorer.v1'
import type { LecteurAoOutput } from './lecteur-ao'

export const opportunityScorerOutputSchema = z.object({
  score: z.number().int().min(0).max(100),
  rationale: z.string(),
})

export type OpportunityScorerInput = { reading: LecteurAoOutput; memo: string }
export type OpportunityScorerOutput = z.infer<typeof opportunityScorerOutputSchema>

export const opportunityScorerAgent: AIAgent<OpportunityScorerInput, OpportunityScorerOutput> = {
  name: 'opportunity_scorer',
  description: "Score 0-100 d'opportunité commerciale",
  modelTier: 'light',
  promptVersion: OPPORTUNITY_SCORER_V1.version,

  async run(input, ctx) {
    const isMock = ctx.provider.name === 'mock'
    const userMessage = isMock
      ? '__MOCK_FIXTURE__:' + JSON.stringify(buildMockFixture(input))
      : OPPORTUNITY_SCORER_V1.userTemplate(input)

    const r = await ctx.provider.complete({
      systemPrompt: OPPORTUNITY_SCORER_V1.system,
      userMessage,
      responseSchema: opportunityScorerOutputSchema,
      modelTier: 'light',
    })

    const parsed = opportunityScorerOutputSchema.safeParse(r.parsed)
    if (!parsed.success) throw new Error(`opportunity_scorer: invalid: ${parsed.error.message}`)
    return parsed.data
  },
}

function buildMockFixture(input: OpportunityScorerInput): OpportunityScorerOutput {
  // Score basé sur le nombre de risques et contraintes
  const risksHigh = input.reading.risks.filter((r) => r.severity === 'high').length
  const constraintsCount = input.reading.constraints.length
  const baseScore = 75 - risksHigh * 15 - Math.max(0, constraintsCount - 3) * 2
  const score = Math.max(0, Math.min(100, baseScore))
  return {
    score,
    rationale: `Mock score basé sur ${risksHigh} risque(s) high et ${constraintsCount} contrainte(s) listée(s). Alignement métier estimé moyen-élevé.`,
  }
}
```

- [ ] **Step 3.6 : Stubs (4 fichiers tous identiques structurellement)**

Pour chacun de `conformite.ts`, `contradicteur.ts`, `financier.ts`, `terrain.ts` dans `services/ai/agents/`, créer un stub. Voici le template à instancier 4 fois (changer `name` et `description`) :

```ts
import type { AIAgent, AgentContext } from './types'

export const conformiteAgent: AIAgent<unknown, unknown> = {
  name: 'conformite',
  description: 'Vérifie conformité ISO/RGPD/clauses sociales — TODO V2',
  modelTier: 'light',
  promptVersion: 'draft',
  async run() {
    throw new Error('conformite agent not yet implemented (stub)')
  },
}
```

(Adapter pour `contradicteur`, `financier`, `terrain`.)

- [ ] **Step 3.7 : `services/ai/agents/registry.ts`**

```ts
import type { AIAgent, AgentName } from './types'
import { lecteurAoAgent } from './lecteur-ao'
import { memoireTechniqueAgent } from './memoire-technique'
import { opportunityScorerAgent } from './opportunity-scorer'
import { conformiteAgent } from './conformite'
import { contradicteurAgent } from './contradicteur'
import { financierAgent } from './financier'
import { terrainAgent } from './terrain'

export const agents: Record<AgentName, AIAgent<unknown, unknown>> = {
  lecteur_ao: lecteurAoAgent as AIAgent<unknown, unknown>,
  memoire_technique: memoireTechniqueAgent as AIAgent<unknown, unknown>,
  opportunity_scorer: opportunityScorerAgent as AIAgent<unknown, unknown>,
  conformite: conformiteAgent,
  contradicteur: contradicteurAgent,
  financier: financierAgent,
  terrain: terrainAgent,
}
```

- [ ] **Step 3.8 : Verify tsc + commit**

```bash
npx tsc --noEmit
git add services/ai/agents/ services/ai/prompts/
git commit -m "feat(ai): 3 agents implémentés (lecteur_ao/memoire_technique/scorer) + 4 stubs + prompts v1"
```

---

## Task 4 : Library context + orchestrator

**Files:**
- Create: `services/ai/library-context.ts`
- Create: `services/ai/orchestrator.ts`

- [ ] **Step 4.1 : `services/ai/library-context.ts`**

```ts
import { listKnowledgeItems } from '@/lib/db/knowledge'
import type { KnowledgeCategory } from '@/types/db'

const CATEGORY_TITLES: Record<KnowledgeCategory, string> = {
  references_clients: 'Références clients',
  moyens_humains: 'Moyens humains',
  materiel: 'Matériel',
  procedures: 'Procédures',
  qualite: 'Qualité',
  anciens_memoires: 'Anciens mémoires techniques',
}

export interface LibrarySnapshot {
  items_count: number
  total_chars: number
}

export async function buildLibraryContext(): Promise<{ markdown: string; snapshot: LibrarySnapshot }> {
  const items = await listKnowledgeItems({})
  if (items.length === 0) {
    return { markdown: '', snapshot: { items_count: 0, total_chars: 0 } }
  }

  const grouped: Record<string, typeof items> = {}
  for (const it of items) {
    if (!grouped[it.category]) grouped[it.category] = []
    grouped[it.category].push(it)
  }

  const sections: string[] = ['## Contexte de l\'entreprise (bibliothèque AGP)']
  for (const cat of Object.keys(CATEGORY_TITLES) as KnowledgeCategory[]) {
    const list = grouped[cat]
    if (!list || list.length === 0) continue
    sections.push(`### ${CATEGORY_TITLES[cat]}`)
    for (const it of list) {
      const tagsLine = it.tags && it.tags.length > 0 ? ` _(${it.tags.join(', ')})_` : ''
      sections.push(`- **${it.title}**${tagsLine}\n  ${it.content_markdown.slice(0, 600).replace(/\n/g, '\n  ')}`)
    }
  }

  const markdown = sections.join('\n\n')
  return {
    markdown,
    snapshot: { items_count: items.length, total_chars: markdown.length },
  }
}
```

- [ ] **Step 4.2 : `services/ai/orchestrator.ts`**

```ts
import { getAIProvider } from './factory'
import { buildLibraryContext } from './library-context'
import { agents } from './agents/registry'
import { lecteurAoAgent, type LecteurAoOutput } from './agents/lecteur-ao'
import { memoireTechniqueAgent, type MemoireTechniqueOutput } from './agents/memoire-technique'
import { opportunityScorerAgent, type OpportunityScorerOutput } from './agents/opportunity-scorer'
import { withAITracking } from './tracking'
import type { AgentContext } from './agents/types'
import type { LibrarySnapshot } from './library-context'

export interface AnalyzeTenderResult {
  reading: LecteurAoOutput
  memo: MemoireTechniqueOutput
  score: OpportunityScorerOutput
  librarySnapshot: LibrarySnapshot
  promptVersions: Record<string, string>
  provider: string
  model: string
}

export async function analyzeTender(
  rawText: string,
  userId: string | null
): Promise<AnalyzeTenderResult> {
  const provider = getAIProvider()
  const lib = await buildLibraryContext()

  const ctx: AgentContext = {
    provider,
    userId,
    libraryContext: lib.markdown,
  }

  // Phase 1 — lecture séquentielle
  const reading = await withAITracking('lecteur_ao', userId, async () => {
    const result = await lecteurAoAgent.run({ rawText }, ctx)
    return {
      result,
      tokens: { input: 1000, output: 1500 },
      model: provider.name === 'mock' ? 'mock-1' : 'unknown',
      provider: provider.name,
      durationMs: 0,
    }
  })

  ctx.previousResults = { lecteur_ao: reading }

  // Phase 2 — mémoire technique (parallèle dans le futur quand on activera les autres agents)
  const memo = await withAITracking('memoire_technique', userId, async () => {
    const result = await memoireTechniqueAgent.run({ reading }, ctx)
    return {
      result,
      tokens: { input: 2000, output: 3000 },
      model: provider.name === 'mock' ? 'mock-1' : 'unknown',
      provider: provider.name,
      durationMs: 0,
    }
  })

  // Phase 3 — scoring final
  const score = await withAITracking('opportunity_scorer', userId, async () => {
    const result = await opportunityScorerAgent.run({ reading, memo: memo.technical_memo }, ctx)
    return {
      result,
      tokens: { input: 1500, output: 200 },
      model: provider.name === 'mock' ? 'mock-1' : 'unknown',
      provider: provider.name,
      durationMs: 0,
    }
  })

  return {
    reading,
    memo,
    score,
    librarySnapshot: lib.snapshot,
    promptVersions: {
      lecteur_ao: lecteurAoAgent.promptVersion,
      memoire_technique: memoireTechniqueAgent.promptVersion,
      opportunity_scorer: opportunityScorerAgent.promptVersion,
    },
    provider: provider.name,
    model: provider.name === 'mock' ? 'mock-1' : 'unknown',
  }
}

// Marquer agents non utilisé pour ESLint (registry exporté pour usage futur)
void agents
```

- [ ] **Step 4.3 : Verify tsc + commit**

```bash
npx tsc --noEmit
git add services/ai/library-context.ts services/ai/orchestrator.ts
git commit -m "feat(ai): library-context injection + orchestrator (3 phases agents)"
```

---

## Task 5 : Service PDF + dépendances

**Files:**
- Create: `services/pdf/extract.ts`
- Modify: `package.json` (add deps)

- [ ] **Step 5.1 : Installer les libs runtime**

```bash
npm install pdf-parse marked react-markdown remark-gfm docx
npm install -D @types/pdf-parse
```

- [ ] **Step 5.2 : `services/pdf/extract.ts`**

```ts
/**
 * Extraction texte depuis un Buffer PDF via pdf-parse.
 * Détecte les PDF scannés (texte vide ou trop court) et signale via le champ isLikelyScanned.
 */

interface PdfParseResult {
  text: string
  numpages: number
}

export interface ExtractResult {
  text: string
  pageCount: number
  charCount: number
  isLikelyScanned: boolean
}

export async function extractPdfText(buffer: Buffer): Promise<ExtractResult> {
  // Import dynamique pour éviter le coût d'init au build
  const pdfParse = (await import('pdf-parse')).default as (b: Buffer) => Promise<PdfParseResult>
  const result = await pdfParse(buffer)
  const text = (result.text ?? '').trim()
  const pageCount = result.numpages ?? 0
  const charCount = text.length
  const isLikelyScanned = charCount < 200 && pageCount > 1
  return { text, pageCount, charCount, isLikelyScanned }
}
```

- [ ] **Step 5.3 : Verify tsc + commit**

```bash
npx tsc --noEmit
git add services/pdf/ package.json package-lock.json
git commit -m "feat(pdf): extract.ts (pdf-parse) + deps (pdf-parse/marked/react-markdown/remark-gfm/docx)"
```

---

## Task 6 : Server Actions tenders + Route Handler analyse

**Files:**
- Create: `app/(dashboard)/tenders/new/actions.ts`
- Create: `app/(dashboard)/tenders/[id]/actions.ts`
- Create: `app/api/tenders/[id]/status/route.ts`
- Create: `app/api/tenders/[id]/analyze/route.ts`

- [ ] **Step 6.1 : `app/(dashboard)/tenders/new/actions.ts`**

```ts
'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/lib/audit/log'
import { getUserRoleById } from '@/lib/db/users'
import {
  createTender,
  createTenderDocument,
  updateTenderStatus,
  countAnalysesToday,
} from '@/lib/db/tenders'
import { extractPdfText } from '@/services/pdf/extract'

async function requireManagerOrAdmin() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const role = await getUserRoleById(user.id)
  if (role !== 'manager' && role !== 'admin') throw new Error('Forbidden')
  return user.id
}

const MAX_PDF_BYTES = 20 * 1024 * 1024 // 20 MB

const createSchema = z.object({
  title: z.string().min(1).max(200),
  client_name: z.string().max(200).nullable().optional(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

export async function createTenderAction(formData: FormData) {
  const userId = await requireManagerOrAdmin()

  const file = formData.get('file')
  if (!(file instanceof File)) return { error: 'PDF manquant' }
  if (file.type !== 'application/pdf') return { error: 'Format PDF requis' }
  if (file.size > MAX_PDF_BYTES) return { error: 'PDF > 20 MB' }

  const parsed = createSchema.safeParse({
    title: formData.get('title'),
    client_name: formData.get('client_name') || null,
    deadline: formData.get('deadline') || null,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  // Quota check
  const todayCount = await countAnalysesToday()
  const limit = parseInt(process.env.MAX_AO_ANALYSES_PER_DAY ?? '20', 10)
  if (todayCount >= limit) {
    return { error: `Quota journalier atteint (${todayCount}/${limit}). Réessayer demain ou augmenter MAX_AO_ANALYSES_PER_DAY.` }
  }

  // 1. Create tender row (status=draft)
  const tenderId = await createTender({
    title: parsed.data.title,
    client_name: parsed.data.client_name,
    deadline: parsed.data.deadline,
    created_by: userId,
  })

  // 2. Upload PDF to bucket
  const supabase = createAdminClient()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
  const storagePath = `${tenderId}/${Date.now()}-${safeName}`
  const buffer = Buffer.from(await file.arrayBuffer())

  const { error: uploadErr } = await supabase.storage
    .from('tender-documents')
    .upload(storagePath, buffer, { contentType: 'application/pdf', upsert: false })
  if (uploadErr) {
    await updateTenderStatus(tenderId, 'failed', uploadErr.message)
    return { error: `Upload échoué : ${uploadErr.message}` }
  }

  // 3. Update status to extracting
  await updateTenderStatus(tenderId, 'extracting')

  // 4. Extract text
  let extracted: { text: string; pageCount: number; isLikelyScanned: boolean }
  try {
    const r = await extractPdfText(buffer)
    extracted = r
  } catch (e) {
    await updateTenderStatus(tenderId, 'failed', `extraction: ${e instanceof Error ? e.message : 'unknown'}`)
    return { error: 'Extraction texte échouée' }
  }

  if (extracted.isLikelyScanned) {
    await updateTenderStatus(tenderId, 'failed', 'scanned_pdf_unsupported')
    await createTenderDocument({
      tender_id: tenderId,
      storage_path: storagePath,
      filename: file.name,
      size_bytes: file.size,
      page_count: extracted.pageCount,
      extracted_text: '',
    })
    redirect(`/tenders/${tenderId}`)
  }

  // 5. Create tender_documents row with extracted text
  await createTenderDocument({
    tender_id: tenderId,
    storage_path: storagePath,
    filename: file.name,
    size_bytes: file.size,
    page_count: extracted.pageCount,
    extracted_text: extracted.text,
  })

  // 6. Set status to analyzing
  await updateTenderStatus(tenderId, 'analyzing')

  await logAuditEvent({
    userId, entityType: 'tender', entityId: tenderId,
    action: 'created',
    metadata: { title: parsed.data.title, page_count: extracted.pageCount, char_count: extracted.text.length },
  })
  revalidatePath('/tenders')

  // 7. Trigger background analyze via fetch (fire-and-forget on server)
  // We use a Route Handler called via fetch from this Server Action.
  triggerAnalyzeBackground(tenderId).catch((e) => console.warn('[analyze trigger] failed:', e))

  redirect(`/tenders/${tenderId}`)
}

function triggerAnalyzeBackground(tenderId: string): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
  return fetch(`${baseUrl}/api/tenders/${tenderId}/analyze`, {
    method: 'POST',
    headers: { 'x-internal-trigger': '1' },
  }).then(() => undefined)
}
```

- [ ] **Step 6.2 : `app/(dashboard)/tenders/[id]/actions.ts`**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/lib/audit/log'
import { getUserRoleById } from '@/lib/db/users'
import { updateTenderStatus, softDeleteTender, getTender, getTenderDocument } from '@/lib/db/tenders'

async function requireManagerOrAdmin() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const role = await getUserRoleById(user.id)
  if (role !== 'manager' && role !== 'admin') throw new Error('Forbidden')
  return user.id
}

const idSchema = z.object({ id: z.string().uuid() })

export async function relaunchAnalysisAction(formData: FormData) {
  const userId = await requireManagerOrAdmin()
  const parsed = idSchema.safeParse({ id: formData.get('id') })
  if (!parsed.success) return { error: 'Invalid id' }

  const tender = await getTender(parsed.data.id)
  if (!tender) return { error: 'AO introuvable' }

  const doc = await getTenderDocument(parsed.data.id)
  if (!doc || !doc.extracted_text) return { error: 'Pas de texte extrait — re-uploader le PDF' }

  await updateTenderStatus(parsed.data.id, 'analyzing', null)
  await logAuditEvent({
    userId, entityType: 'tender', entityId: parsed.data.id,
    action: 'analysis_relaunched',
    metadata: {},
  })
  revalidatePath(`/tenders/${parsed.data.id}`)

  // Fire-and-forget
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
  fetch(`${baseUrl}/api/tenders/${parsed.data.id}/analyze`, {
    method: 'POST', headers: { 'x-internal-trigger': '1' },
  }).catch(() => {})

  return { ok: true }
}

export async function archiveTenderAction(formData: FormData) {
  const userId = await requireManagerOrAdmin()
  const parsed = idSchema.safeParse({ id: formData.get('id') })
  if (!parsed.success) return { error: 'Invalid id' }

  await softDeleteTender(parsed.data.id)
  await logAuditEvent({
    userId, entityType: 'tender', entityId: parsed.data.id,
    action: 'soft_deleted',
    metadata: {},
  })
  revalidatePath('/tenders')
  return { ok: true }
}
```

- [ ] **Step 6.3 : `app/api/tenders/[id]/status/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { getTender } from '@/lib/db/tenders'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const tender = await getTender(id)
  if (!tender) return NextResponse.json({ status: 'unknown', error_msg: null }, { status: 404 })
  return NextResponse.json({
    status: tender.status,
    error_msg: tender.error_msg,
    opportunity_score: tender.opportunity_score,
  })
}
```

- [ ] **Step 6.4 : `app/api/tenders/[id]/analyze/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { getTender, getTenderDocument, updateTenderStatus, insertTenderAnalysis } from '@/lib/db/tenders'
import { analyzeTender } from '@/services/ai/orchestrator'

/**
 * Triggered by the Server Action after upload completes.
 * Runs the full analyze pipeline and writes results.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  const tender = await getTender(id)
  if (!tender) return NextResponse.json({ error: 'tender not found' }, { status: 404 })

  const doc = await getTenderDocument(id)
  if (!doc || !doc.extracted_text) {
    await updateTenderStatus(id, 'failed', 'no extracted text')
    return NextResponse.json({ error: 'no extracted text' }, { status: 400 })
  }

  try {
    const result = await analyzeTender(doc.extracted_text, tender.created_by)
    await insertTenderAnalysis({
      tender_id: id,
      provider: result.provider as never,
      model: result.model,
      prompt_versions: result.promptVersions,
      summary: result.reading.summary,
      constraints: result.reading.constraints,
      risks: result.reading.risks,
      checklist: result.reading.checklist,
      technical_memo: result.memo.technical_memo,
      library_snapshot: result.librarySnapshot,
      raw_response: null,
    })
    await updateTenderStatus(id, 'ready', null, result.score.score)
    return NextResponse.json({ ok: true, score: result.score.score })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    await updateTenderStatus(id, 'failed', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
```

- [ ] **Step 6.5 : Verify tsc + commit**

```bash
npx tsc --noEmit
git add "app/(dashboard)/tenders/new/actions.ts" "app/(dashboard)/tenders/[id]/actions.ts" "app/api/tenders/[id]/status/route.ts" "app/api/tenders/[id]/analyze/route.ts"
git commit -m "feat(tenders): Server Actions create/relaunch/archive + Route Handlers status/analyze"
```

---

## Task 7 : Page `/tenders/new` (upload form)

**Files:**
- Create: `app/(dashboard)/tenders/new/TenderUploadForm.tsx`
- Create: `app/(dashboard)/tenders/new/page.tsx`

- [ ] **Step 7.1 : `TenderUploadForm.tsx`**

```tsx
'use client'

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createTenderAction } from './actions'
import { toast } from 'sonner'
import { Upload } from 'lucide-react'

export function TenderUploadForm() {
  const [pending, setPending] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    const fd = new FormData(e.currentTarget)
    const r = await createTenderAction(fd)
    setPending(false)
    if (r && 'error' in r) toast.error(r.error)
    // success → redirect happens server-side
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Nouvel appel d&apos;offres</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Titre de l&apos;AO</Label>
            <Input id="title" name="title" required maxLength={200} placeholder="Ex. Marché nettoyage CHU Toulouse 2026" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="client_name">Donneur d&apos;ordre (optionnel)</Label>
            <Input id="client_name" name="client_name" maxLength={200} placeholder="Ex. CHU de Toulouse" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="deadline">Échéance (optionnel)</Label>
            <Input id="deadline" name="deadline" type="date" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="file">PDF du cahier des charges (max 20 MB, non scanné)</Label>
            <Input id="file" name="file" type="file" accept="application/pdf" required />
          </div>
          <Button type="submit" disabled={pending} className="w-full">
            <Upload className="h-4 w-4 mr-2" />
            {pending ? 'Upload + analyse en cours…' : 'Lancer l\'analyse IA'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 7.2 : `page.tsx`**

```tsx
import { TenderUploadForm } from './TenderUploadForm'

export default function NewTenderPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Analyser un nouvel AO</h1>
        <p className="text-sm text-muted-foreground">
          Upload le PDF du cahier des charges. L&apos;IA extrait contraintes, risques, checklist et génère une mémoire technique grounded sur la bibliothèque.
        </p>
      </div>
      <TenderUploadForm />
    </div>
  )
}
```

- [ ] **Step 7.3 : Verify + commit**

```bash
npx tsc --noEmit
git add "app/(dashboard)/tenders/new/"
git commit -m "feat(tenders): page /tenders/new + form upload PDF"
```

---

## Task 8 : Page `/tenders` (liste)

**Files:**
- Create: `app/(dashboard)/tenders/TenderListTable.tsx`
- Create: `app/(dashboard)/tenders/[id]/TenderScoreBadge.tsx`
- Create: `app/(dashboard)/tenders/[id]/TenderStatusBadge.tsx`
- Create: `app/(dashboard)/tenders/page.tsx`

- [ ] **Step 8.1 : `TenderStatusBadge.tsx`**

```tsx
import { Badge } from '@/components/ui/badge'
import type { TenderStatus } from '@/types/db'

const LABELS: Record<TenderStatus, string> = {
  draft:       'Brouillon',
  extracting:  'Extraction',
  analyzing:   'Analyse IA',
  ready:       'Prêt',
  failed:      'Échec',
  submitted:   'Soumis',
  archived:    'Archivé',
}

const STYLES: Record<TenderStatus, string> = {
  draft:       'bg-slate-100 text-slate-700',
  extracting:  'bg-blue-100 text-blue-700 animate-pulse',
  analyzing:   'bg-amber-100 text-amber-700 animate-pulse',
  ready:       'bg-emerald-100 text-emerald-700',
  failed:      'bg-rose-100 text-rose-700',
  submitted:   'bg-purple-100 text-purple-700',
  archived:    'bg-gray-100 text-gray-500',
}

export function TenderStatusBadge({ status }: { status: TenderStatus }) {
  return <Badge className={`text-xs ${STYLES[status]}`}>{LABELS[status]}</Badge>
}
```

- [ ] **Step 8.2 : `TenderScoreBadge.tsx`**

```tsx
import { Badge } from '@/components/ui/badge'

export function TenderScoreBadge({ score }: { score: number | null }) {
  if (score === null || score === undefined) return <span className="text-xs text-muted-foreground">—</span>
  const cls =
    score >= 70 ? 'bg-emerald-100 text-emerald-700' :
    score >= 40 ? 'bg-amber-100 text-amber-700' :
                  'bg-rose-100 text-rose-700'
  return <Badge className={`text-xs font-mono ${cls}`}>{score}/100</Badge>
}
```

- [ ] **Step 8.3 : `TenderListTable.tsx`**

```tsx
import Link from 'next/link'
import { TenderStatusBadge } from './[id]/TenderStatusBadge'
import { TenderScoreBadge } from './[id]/TenderScoreBadge'
import type { DbTender } from '@/types/db'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function deadlineClass(iso: string | null): string {
  if (!iso) return ''
  const days = Math.floor((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  if (days < 0) return 'text-rose-700 font-medium'
  if (days < 7) return 'text-rose-700 font-medium'
  if (days < 30) return 'text-amber-700'
  return ''
}

export function TenderListTable({ items }: { items: DbTender[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-12 text-center">
        Aucun AO. Cliquez sur « Nouveau » pour commencer.
      </p>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-2">Titre</th>
            <th className="text-left px-3 py-2">Donneur d&apos;ordre</th>
            <th className="text-left px-3 py-2">Échéance</th>
            <th className="text-left px-3 py-2">Statut</th>
            <th className="text-left px-3 py-2">Score</th>
            <th className="text-right px-3 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((t) => (
            <tr key={t.id} className="hover:bg-muted/20">
              <td className="px-3 py-2">
                <Link href={`/tenders/${t.id}`} className="font-medium hover:underline">{t.title}</Link>
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{t.client_name ?? '—'}</td>
              <td className={`px-3 py-2 text-xs ${deadlineClass(t.deadline)}`}>{formatDate(t.deadline)}</td>
              <td className="px-3 py-2"><TenderStatusBadge status={t.status} /></td>
              <td className="px-3 py-2"><TenderScoreBadge score={t.opportunity_score} /></td>
              <td className="px-3 py-2 text-right">
                <Link href={`/tenders/${t.id}`} className="text-xs text-brand-600 hover:underline">Voir</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 8.4 : `page.tsx`**

```tsx
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Plus } from 'lucide-react'
import { listTenders } from '@/lib/db/tenders'
import { TenderListTable } from './TenderListTable'
import type { TenderStatus } from '@/types/db'

export default async function TendersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; search?: string }>
}) {
  const params = await searchParams
  const items = await listTenders({
    status: params.status as TenderStatus | undefined,
    search: params.search,
  })

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Appels d&apos;offres</h1>
          <p className="text-sm text-muted-foreground">
            Liste des AO en cours d&apos;analyse, prêts à soumettre, soumis et archivés.
          </p>
        </div>
        <Button asChild>
          <Link href="/tenders/new"><Plus className="h-4 w-4 mr-1" />Nouveau</Link>
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{items.length} AO</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <TenderListTable items={items} />
        </CardContent>
      </Card>
    </div>
  )
}
```

⚠️ Note : `Button asChild` est utilisé ici. Vérifier dans `components/ui/button.tsx` si shadcn supporte `asChild` ou si on doit utiliser `render`. Si `asChild` n'est pas supporté, remplacer par `<Link>` stylé directement.

- [ ] **Step 8.5 : Verify + commit**

```bash
npx tsc --noEmit
git add "app/(dashboard)/tenders/page.tsx" "app/(dashboard)/tenders/TenderListTable.tsx" "app/(dashboard)/tenders/[id]/TenderStatusBadge.tsx" "app/(dashboard)/tenders/[id]/TenderScoreBadge.tsx"
git commit -m "feat(tenders): page /tenders liste + badges statut/score"
```

---

## Task 9 : Page `/tenders/[id]` — vue analyse + polling + onglets

**Files:**
- Create: `app/(dashboard)/tenders/[id]/TenderAnalysisLoader.tsx`
- Create: `app/(dashboard)/tenders/[id]/TenderSynthese.tsx`
- Create: `app/(dashboard)/tenders/[id]/TenderAnalyseDetaillee.tsx`
- Create: `app/(dashboard)/tenders/[id]/TenderMemoireTechnique.tsx`
- Create: `app/(dashboard)/tenders/[id]/TenderExportButtons.tsx`
- Create: `app/(dashboard)/tenders/[id]/page.tsx`

- [ ] **Step 9.1 : `TenderAnalysisLoader.tsx` (client polling)**

```tsx
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

export function TenderAnalysisLoader({ tenderId, status }: { tenderId: string; status: string }) {
  const router = useRouter()

  useEffect(() => {
    if (status !== 'analyzing' && status !== 'extracting') return
    const id = setInterval(async () => {
      try {
        const r = await fetch(`/api/tenders/${tenderId}/status`)
        const j = (await r.json()) as { status: string }
        if (j.status !== 'analyzing' && j.status !== 'extracting') {
          clearInterval(id)
          router.refresh()
        }
      } catch {
        // ignore, retry next tick
      }
    }, 3000)
    return () => clearInterval(id)
  }, [tenderId, status, router])

  return (
    <div className="flex flex-col items-center justify-center py-16 space-y-3">
      <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
      <p className="text-sm text-muted-foreground">
        {status === 'extracting' ? 'Extraction du texte du PDF…' : 'Analyse IA en cours (10-30 sec)…'}
      </p>
    </div>
  )
}
```

- [ ] **Step 9.2 : `TenderSynthese.tsx`**

```tsx
import { Card, CardContent } from '@/components/ui/card'
import { TenderScoreBadge } from './TenderScoreBadge'
import type { DbTenderAnalysis, DbTender } from '@/types/db'

export function TenderSynthese({ tender, analysis }: { tender: DbTender; analysis: DbTenderAnalysis }) {
  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <div className="text-xs text-muted-foreground">Score d&apos;opportunité</div>
            <div className="mt-1"><TenderScoreBadge score={tender.opportunity_score} /></div>
          </div>
          <div className="flex-1 min-w-[200px]">
            <div className="text-xs text-muted-foreground">Provider IA</div>
            <div className="mt-1 text-sm font-mono">{analysis.provider}</div>
          </div>
          <div className="flex-1 min-w-[200px]">
            <div className="text-xs text-muted-foreground">Bibliothèque AGP injectée</div>
            <div className="mt-1 text-sm">
              {analysis.library_snapshot
                ? `${analysis.library_snapshot.items_count} item(s), ~${analysis.library_snapshot.total_chars} car.`
                : '—'}
            </div>
          </div>
        </div>
        <div>
          <h3 className="text-sm font-semibold mb-2">Résumé exécutif</h3>
          <p className="text-sm text-foreground whitespace-pre-wrap">{analysis.summary}</p>
        </div>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 9.3 : `TenderAnalyseDetaillee.tsx`**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { DbTenderAnalysis } from '@/types/db'

export function TenderAnalyseDetaillee({ analysis }: { analysis: DbTenderAnalysis }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Contraintes ({(analysis.constraints ?? []).length})</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {(analysis.constraints ?? []).map((c, i) => (
              <li key={i} className="text-sm flex items-start gap-2">
                <Badge variant={c.required ? 'default' : 'outline'} className="text-xs shrink-0">
                  {c.required ? 'Obligatoire' : 'Recommandé'}
                </Badge>
                <div>
                  <div className="font-medium">{c.label}</div>
                  {c.detail && <div className="text-xs text-muted-foreground">{c.detail}</div>}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Risques ({(analysis.risks ?? []).length})</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {(analysis.risks ?? []).map((r, i) => (
              <li key={i} className="text-sm flex items-start gap-2">
                <Badge
                  className={`text-xs shrink-0 ${
                    r.severity === 'high' ? 'bg-rose-100 text-rose-700' :
                    r.severity === 'medium' ? 'bg-amber-100 text-amber-700' :
                                              'bg-slate-100 text-slate-700'
                  }`}
                >
                  {r.severity}
                </Badge>
                <div>
                  <div className="font-medium">{r.label}</div>
                  {r.detail && <div className="text-xs text-muted-foreground">{r.detail}</div>}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Checklist conformité ({(analysis.checklist ?? []).length})</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {(analysis.checklist ?? []).map((it, i) => (
              <li key={i} className="text-sm flex items-start gap-2">
                <input type="checkbox" className="mt-1 shrink-0" />
                <span>
                  {it.item}
                  {it.required && <span className="ml-2 text-xs text-rose-700">(obligatoire)</span>}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 9.4 : `TenderExportButtons.tsx`**

```tsx
'use client'

import { Button } from '@/components/ui/button'
import { Copy, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { marked } from 'marked'
import { Document, Packer, Paragraph, HeadingLevel } from 'docx'

export function TenderExportButtons({ markdown }: { markdown: string }) {
  async function copyMarkdown() {
    await navigator.clipboard.writeText(markdown)
    toast.success('Markdown copié')
  }

  async function copyHtml() {
    const html = await marked.parse(markdown, { gfm: true })
    const blob = new Blob([html], { type: 'text/html' })
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': blob,
        'text/plain': new Blob([markdown], { type: 'text/plain' }),
      }),
    ])
    toast.success('HTML enrichi copié — collable dans Word/Outlook')
  }

  async function downloadDocx() {
    // Convert markdown to docx (basic : titres + paragraphes)
    const lines = markdown.split('\n')
    const children: Paragraph[] = []
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      if (trimmed.startsWith('# '))      children.push(new Paragraph({ text: trimmed.slice(2),  heading: HeadingLevel.HEADING_1 }))
      else if (trimmed.startsWith('## ')) children.push(new Paragraph({ text: trimmed.slice(3),  heading: HeadingLevel.HEADING_2 }))
      else if (trimmed.startsWith('### '))children.push(new Paragraph({ text: trimmed.slice(4),  heading: HeadingLevel.HEADING_3 }))
      else if (trimmed.startsWith('- ')) children.push(new Paragraph({ text: '• ' + trimmed.slice(2) }))
      else                                children.push(new Paragraph(trimmed))
    }
    const doc = new Document({ sections: [{ children }] })
    const blob = await Packer.toBlob(doc)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'memoire-technique.docx'
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Mémoire téléchargée')
  }

  return (
    <div className="flex gap-2 flex-wrap">
      <Button size="sm" variant="outline" onClick={copyMarkdown}>
        <Copy className="h-3 w-3 mr-1" />
        Copier (Markdown)
      </Button>
      <Button size="sm" variant="outline" onClick={copyHtml}>
        <Copy className="h-3 w-3 mr-1" />
        Copier (HTML enrichi)
      </Button>
      <Button size="sm" onClick={downloadDocx}>
        <FileText className="h-3 w-3 mr-1" />
        Exporter Word
      </Button>
    </div>
  )
}
```

- [ ] **Step 9.5 : `TenderMemoireTechnique.tsx`**

```tsx
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Card, CardContent } from '@/components/ui/card'
import { TenderExportButtons } from './TenderExportButtons'

export function TenderMemoireTechnique({ markdown }: { markdown: string }) {
  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <TenderExportButtons markdown={markdown} />
        <article className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </article>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 9.6 : `page.tsx`**

```tsx
import { notFound } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { RefreshCw, AlertTriangle } from 'lucide-react'
import { getTender, getLatestTenderAnalysis, getTenderDocument } from '@/lib/db/tenders'
import { TenderStatusBadge } from './TenderStatusBadge'
import { TenderAnalysisLoader } from './TenderAnalysisLoader'
import { TenderSynthese } from './TenderSynthese'
import { TenderAnalyseDetaillee } from './TenderAnalyseDetaillee'
import { TenderMemoireTechnique } from './TenderMemoireTechnique'
import { relaunchAnalysisAction } from './actions'

function fmt(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default async function TenderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const tender = await getTender(id)
  if (!tender) notFound()

  const [analysis, doc] = await Promise.all([
    getLatestTenderAnalysis(id),
    getTenderDocument(id),
  ])

  const isLoading = tender.status === 'analyzing' || tender.status === 'extracting'
  const isFailed = tender.status === 'failed'
  const isReady = tender.status === 'ready' || tender.status === 'submitted' || tender.status === 'archived'

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">{tender.title}</h1>
          <p className="text-sm text-muted-foreground space-x-3">
            {tender.client_name && <span>{tender.client_name}</span>}
            {tender.deadline && <span>Échéance : {fmt(tender.deadline)}</span>}
            <TenderStatusBadge status={tender.status} />
          </p>
        </div>
        {(isReady || isFailed) && (
          <form action={relaunchAnalysisAction.bind(null, (() => { const fd = new FormData(); fd.set('id', id); return fd })())}>
            <Button type="submit" variant="outline" size="sm">
              <RefreshCw className="h-3 w-3 mr-1" />
              Relancer l&apos;analyse
            </Button>
          </form>
        )}
      </div>

      {isLoading && <TenderAnalysisLoader tenderId={id} status={tender.status} />}

      {isFailed && (
        <Card className="border-rose-200 bg-rose-50">
          <CardContent className="pt-6 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-rose-700 shrink-0" />
            <div className="flex-1">
              <h3 className="font-semibold text-rose-900">Analyse échouée</h3>
              <p className="text-sm text-rose-800">
                {tender.error_msg === 'scanned_pdf_unsupported'
                  ? 'Ce PDF semble être scanné (texte non extractible). Re-uploadez une version texte (Word → PDF, ou export texte).'
                  : tender.error_msg ?? 'Erreur inconnue'}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {isReady && analysis && (
        <Tabs defaultValue="synthese" className="space-y-4">
          <TabsList>
            <TabsTrigger value="synthese">Synthèse</TabsTrigger>
            <TabsTrigger value="analyse">Analyse détaillée</TabsTrigger>
            <TabsTrigger value="memoire">Mémoire technique</TabsTrigger>
          </TabsList>
          <TabsContent value="synthese">
            <TenderSynthese tender={tender} analysis={analysis} />
          </TabsContent>
          <TabsContent value="analyse">
            <TenderAnalyseDetaillee analysis={analysis} />
          </TabsContent>
          <TabsContent value="memoire">
            <TenderMemoireTechnique markdown={analysis.technical_memo ?? '_(Mémoire vide)_'} />
          </TabsContent>
        </Tabs>
      )}

      {doc && (
        <p className="text-xs text-muted-foreground">
          Document source : <code className="font-mono">{doc.filename}</code> ({doc.page_count ?? '?'} pages, {Math.round((doc.size_bytes ?? 0) / 1024)} KB)
        </p>
      )}
    </div>
  )
}
```

⚠️ Pour `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` : ils ont été installés via shadcn en Plan 1. Vérifier que la signature accepte les props vues ici.

- [ ] **Step 9.7 : Verify tsc + commit**

```bash
npx tsc --noEmit
git add "app/(dashboard)/tenders/[id]/"
git commit -m "feat(tenders): page /tenders/[id] vue analyse complète + onglets + polling"
```

---

## Task 10 : Tests + final review

**Files:**
- Create: `tests/services/ai-mock-provider.test.ts`
- Create: `tests/services/orchestrator.test.ts`

- [ ] **Step 10.1 : `tests/services/ai-mock-provider.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { MockProvider } from '@/services/ai/providers/mock'

describe('MockProvider', () => {
  it('parse __MOCK_FIXTURE__ correctement', async () => {
    const p = new MockProvider()
    const fixture = { foo: 'bar', n: 42 }
    const r = await p.complete({
      systemPrompt: '',
      userMessage: '__MOCK_FIXTURE__:' + JSON.stringify(fixture),
      modelTier: 'light',
    })
    expect(r.parsed).toEqual(fixture)
    expect(r.tokens.input).toBeGreaterThan(0)
    expect(r.tokens.output).toBeGreaterThan(0)
    expect(r.model).toBe('mock-1')
  })

  it('fournit un fallback quand pas de fixture', async () => {
    const p = new MockProvider()
    const r = await p.complete({
      systemPrompt: '',
      userMessage: 'Free-form prompt without fixture',
      modelTier: 'light',
    })
    expect(r.parsed).toMatchObject({ _mock: true })
  })
})
```

- [ ] **Step 10.2 : `tests/services/orchestrator.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/db/knowledge', () => ({
  listKnowledgeItems: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/services/ai/tracking', () => ({
  withAITracking: vi.fn(async (_f, _u, fn) => {
    const r = await fn()
    return r.result
  }),
  logAIUsage: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { analyzeTender } from '@/services/ai/orchestrator'

describe('analyzeTender (mock provider)', () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = 'mock'
  })

  it('retourne reading + memo + score quand library vide', async () => {
    const result = await analyzeTender('Texte cahier des charges de test pour un AO de nettoyage tertiaire avec ISO 9001.', null)
    expect(result.provider).toBe('mock')
    expect(result.reading.summary).toBeTruthy()
    expect(result.reading.constraints.length).toBeGreaterThan(0)
    expect(result.reading.risks.length).toBeGreaterThan(0)
    expect(result.reading.checklist.length).toBeGreaterThan(0)
    expect(result.memo.technical_memo.length).toBeGreaterThan(100)
    expect(result.score.score).toBeGreaterThanOrEqual(0)
    expect(result.score.score).toBeLessThanOrEqual(100)
    expect(result.librarySnapshot.items_count).toBe(0)
    expect(result.promptVersions.lecteur_ao).toBe('v1')
  })
})
```

- [ ] **Step 10.3 : Run tests**

```bash
npx tsc --noEmit
npm test
```

Expected: 7 tests pass total (3 audit + 2 knowledge + 2 nouveaux).

- [ ] **Step 10.4 : Commit**

```bash
git add tests/services/
git commit -m "test(ai): mock provider + orchestrator end-to-end"
```

- [ ] **Step 10.5 : Final code review (dispatch reviewer agent)**

The controller will dispatch a final review agent for the entire Plan 3.

---

## Critères d'acceptance — Plan 3

- [ ] `/tenders/new` : upload PDF (max 20 MB) + form + appel Server Action → redirect `/tenders/[id]`
- [ ] PDF scanné détecté (extraction vide / < 200 char) → tender status `failed`, message UX clair
- [ ] PDF non scanné → status `analyzing` + Route Handler `/api/tenders/[id]/analyze` lancé en fire-and-forget
- [ ] Polling client sur `/tenders/[id]` (interval 3s) → quand status passe à `ready`, refresh
- [ ] Vue `/tenders/[id]` quand `ready` : 3 onglets (Synthèse / Analyse détaillée / Mémoire technique)
- [ ] Mémoire technique : copier markdown / copier HTML enrichi / exporter Word
- [ ] Score d'opportunité affiché en gauge colorée (vert ≥70, orange 40-69, rouge <40)
- [ ] Quota max analyses/jour appliqué (défaut 20)
- [ ] Bibliothèque AGP injectée dans la mémoire générée — `library_snapshot` stocké
- [ ] Multi-tenant readiness : 0 `.from('tenders')` ou `.from('tender_documents')` ou `.from('tender_analyses')` outside `lib/db/tenders.ts`
- [ ] Audit logs : `tender.created`, `tender.analysis_relaunched`, `tender.soft_deleted`
- [ ] AI usage tracé dans `ai_usage` à chaque appel agent (3 par analyse)
- [ ] tsc passe, tous tests passent

## Hors-scope explicite

- 4 agents stubs (conformite, contradicteur, financier, terrain) — interface posée, prompts draft, mais `run()` throw "not implemented". Activation en V2.
- Streaming token-par-token
- Multi-fichiers AO (1 PDF par AO en MVP, schéma supporte)
- OCR sur PDFs scannés
- Export PDF de la mémoire technique (juste Word + Markdown au MVP)
- Embeddings / retrieval sur la bibliothèque (injection complète au MVP)
