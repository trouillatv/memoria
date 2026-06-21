import { getAIProvider } from './factory'
import { buildLibraryContext } from './library-context'
import { getUserRoleById } from '@/lib/db/users'
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
  /** A6 — sources [doc:id] du recall A3 (réf. seules, dédupé). [] en mock. */
  documentSources: { id: string; type?: string }[]
  provider: string
  model: string
}

export async function analyzeTender(
  rawText: string,
  userId: string | null,
  /** Org pour scoper la bibliothèque SANS cookies (route/after/script). Si
   *  undefined → fallback RLS via cookies (contexte requête uniquement). */
  orgId?: string | null,
): Promise<AnalyzeTenderResult> {
  const provider = getAIProvider()
  const lib = await buildLibraryContext(orgId)

  // A3 — recall documentaire BORNÉ calculé UNE SEULE FOIS par analyse AO,
  // hors de toute boucle agent (jamais un recall par agent). Rôle dérivé
  // du userId initiateur → visibility_level respecté (canViewDocument dans
  // buildDocumentContext) ; userId null → role null → aucun document.
  // Plafonné MAX_RETRIEVED_CHUNKS + MAX_CONTEXT_TOKENS. Silencieux si pas
  // de provider/match → l'analyse continue sans erreur.
  // Hors mock uniquement : une analyse mock ne déclenche aucun vrai recall
  // (zéro appel embedding/RPC réel en test ; discipline coût IA). Import
  // DYNAMIQUE : document-context est `server-only` — le garder hors du
  // graphe statique de l'orchestrator (sinon casse les tests à l'import) ;
  // chargé uniquement au runtime serveur quand on recall réellement.
  let docCtx: {
    promptBlock: string
    chunks: { sourceId: string; documentType?: string }[]
  } = { promptBlock: '', chunks: [] }
  if (provider.name !== 'mock') {
    const role = userId ? await getUserRoleById(userId) : null
    const { buildDocumentContext } = await import('@/lib/ai/document-context')
    docCtx = await buildDocumentContext({ query: rawText, role })
  }

  // A6 — sources [doc:id] RÉELLEMENT utilisées, dérivées du docCtx A3 DÉJÀ
  // calculé (aucun nouveau recall/embedding/RPC). Références seules
  // { id, type }, dédupliquées par id. Mock → docCtx.chunks vide → [].
  const documentSources: { id: string; type?: string }[] = []
  const seenDocIds = new Set<string>()
  for (const c of docCtx.chunks) {
    if (seenDocIds.has(c.sourceId)) continue
    seenDocIds.add(c.sourceId)
    documentSources.push({ id: c.sourceId, type: c.documentType })
  }

  const ctx: AgentContext = {
    provider,
    userId,
    libraryContext: lib.markdown,
    documentContext: docCtx.promptBlock,
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
    documentSources,
    provider: provider.name,
    model: provider.name === 'mock' ? 'mock-1' : 'unknown',
  }
}

// Marquer agents non utilisé pour ESLint (registry exporté pour usage futur)
void agents
