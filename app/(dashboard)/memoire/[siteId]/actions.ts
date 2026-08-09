'use server'

// Atelier mémoire — agent de Q&A scopé À CE CHANTIER.
//
// Lot 4C : routage d'intention déterministe (A/B/C) + mémoire structurée comme
// contexte primaire pour les routes A et B. Le retrieval documentaire est réservé
// à la route C ou déclenché en fallback si la mémoire structurée est vide.
//
// getSiteMemoryDigest() et searchSiteMemory() sont conservés :
//   - digest : non utilisé pour A/B (remplacé par buildSiteIntelligenceContext)
//   - searchSiteMemory : toujours utilisé pour C ; fallback pour A/B si données vides

import { z } from 'zod'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getAIProvider } from '@/services/ai/factory'
import { withAITracking } from '@/services/ai/tracking'
import { getSiteMemoryDigest } from '@/lib/db/site-memory-digest'
import { askSiteMemoryAction as searchSiteMemory, type SiteMemoryHit } from '@/app/(dashboard)/sites/[id]/memory-query-actions'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSubjectTimeline } from '@/lib/db/subjects'
import { buildSiteIntelligenceContext, type SiteIntelligenceContext } from '@/lib/knowledge/build-site-intelligence-context'
import { classifyIntent, type IntentRoute } from '@/lib/knowledge/intent-router'

const answerSchema = z.object({
  answer: z.string().default(''),
  retiens: z.array(z.string()).default([]),
  next: z.array(z.string()).default([]),
  concepts: z.array(z.string()).default([]),
})
export type SiteMemoryAnswer = z.infer<typeof answerSchema>

export interface SiteMemorySource {
  type: string
  title: string
  snippet: string
  occurredAt: string
  href?: string
}

// ── Prompt système ────────────────────────────────────────────────────────────

const SYSTEM_STRUCTURED = [
  "Tu es le copilote mémoire de CE chantier (et de lui seul). Le contexte fourni est la mémoire structurée du chantier — données 100 % déterministes, zéro LLM dans leur construction.",
  "",
  "HIÉRARCHIE DE CONFIANCE :",
  "• urgency=critical / high dans [ATTENTION] : fait avéré, formuler directement.",
  "• urgency=medium / low : fait réel, moindre urgence.",
  "• isStagnant=true : stagnation datée, formuler sobrement.",
  "• relations confirmées : liens validés par un humain, fiables.",
  "• observed : signal non confirmé, formuler avec prudence (« semble », « indique »).",
  "• rejected : absent du contexte (jamais inclus).",
  "",
  "DISTINCTIONS SÉMANTIQUES OBLIGATOIRES :",
  "• stagnant ≠ bloquant : un sujet stagnant ralentit ; n'employer 'bloquant' que si [BLOCAGES ACTIFS] contient des entrées.",
  "• Si [BLOCAGES ACTIFS : 0], répondre explicitement qu'il n'y a pas de blocage enregistré ; ne pas inférer de blocage depuis la stagnation ou les réserves.",
  "• signalé ≠ urgent : urgency=medium ou low ne justifie pas le mot « urgent » ni « critique ».",
  "• participant ≠ responsable : un intervenant n'est « responsable » que si cela est explicite dans [INTERVENANTS] ; ne pas déduire une responsabilité d'une simple présence.",
  "• cooccurrence ≠ dépendance : deux sujets ne sont « dépendants » que si [RELATIONS CONFIRMÉES] l'indique ; ne pas inférer de lien depuis une simple proximité thématique.",
  "• conclusion supplémentaire interdite : n'ajouter « nécessite une action rapide » ou équivalent que si une action en retard ou une urgence explicite figure dans le contexte.",
  "",
  "INTERDITS :",
  "• inventer un fait absent du contexte.",
  "• transformer une responsabilité en 'blocage' sans preuve.",
  "• présenter une inférence comme une certitude.",
  "• préférer 'je n'ai pas assez d'éléments' à toute invention.",
  "• ne pas transformer un signalement isolé en tendance générale.",
  "",
  "Tu remplis :",
  "- answer : réponse COURTE et concrète. Cite les IDs entre parenthèses quand utile (ex : sujet cs-xxx, action act-xxx).",
  "- retiens : 0–4 points à surveiller.",
  "- next : 0–3 suggestions prudentes, JAMAIS des ordres.",
  "- concepts : 2–4 noms concrets (sujets métier, entreprises, ouvrages).",
  "",
  "Réponds STRICTEMENT en JSON : {\"answer\":\"…\",\"retiens\":[\"…\"],\"next\":[\"…\"],\"concepts\":[\"…\"]}.",
].join('\n')

const SYSTEM_DOCUMENTARY = [
  "Tu es le copilote mémoire de CE chantier. Tu réponds à la question à partir des traces retrouvées (réunions, visites, actions, réserves, décisions, PV, documents).",
  "",
  "INTERDITS :",
  "• inventer un fait absent des traces fournies.",
  "• paraphraser de mémoire sans s'appuyer sur un extrait cité.",
  "• si l'information n'est pas dans les traces : le dire franchement.",
  "",
  "Tu remplis :",
  "- answer : réponse COURTE et factuelle. Cite la source entre crochets (ex : [Source 2]).",
  "- retiens : 0–4 points notables tirés des documents.",
  "- next : 0–3 actions prudentes suggérées.",
  "- concepts : 2–4 noms concrets.",
  "",
  "Réponds STRICTEMENT en JSON : {\"answer\":\"…\",\"retiens\":[\"…\"],\"next\":[\"…\"],\"concepts\":[\"…\"]}.",
].join('\n')

// ── Rendu lisible du contexte structuré ────────────────────────────────────────

function renderContextForLLM(ctx: SiteIntelligenceContext, route: IntentRoute): string {
  const lines: string[] = []
  const siteName = ctx.siteName ?? ctx.siteId

  lines.push(`=== Mémoire structurée — ${siteName} (${ctx.asOf}) | Route : ${route} ===`)

  if (ctx.attention) {
    const { criticalCount, highCount, items, total, truncated } = ctx.attention
    lines.push(`\n[ATTENTION : ${criticalCount} critique(s), ${highCount} haut(s) — total ${total}]`)
    for (const item of items) {
      const ids = item.metadata
        ? Object.entries(item.metadata)
            .filter(([k]) => k.toLowerCase().endsWith('id'))
            .map(([k, v]) => `${k}:${v}`)
            .join(', ')
        : ''
      const idStr = ids ? ` (${ids})` : ''
      lines.push(`• [${item.urgency}] ${item.title}${idStr}`)
      if (item.reason) lines.push(`  → ${item.reason}`)
    }
    if (truncated) lines.push(`  … (${total - items.length} autres items)`)
  }

  if (ctx.subjects) {
    const { items, total, stagnantCount, truncated } = ctx.subjects
    lines.push(`\n[SUJETS : ${total} total, ${stagnantCount} stagnant(s)]`)
    for (const s of items) {
      const stag = s.isStagnant ? ` | stagnant ${s.stagnationDays}j` : ''
      const objs = s.activeObjects.total > 0
        ? ` | ${s.activeObjects.actionsOpen}A ${s.activeObjects.reservesOpen}R ${s.activeObjects.deadlinesActive}E`
        : ''
      lines.push(`• ${s.title} (${s.canonicalSubjectId}) : ${s.currentStatus ?? '?'}${stag}${objs}`)
    }
    if (truncated) lines.push(`  … (${total - items.length} autres sujets)`)
  }

  if (ctx.activeObjects) {
    const { counts, actionsEnRetard, reservesOuvertes, echeancesDepassees, blocagesActifs } = ctx.activeObjects
    lines.push(`\n[OBJETS ACTIFS]`)

    if (counts.actionsEnRetard > 0) {
      lines.push(`• Actions en retard : ${counts.actionsEnRetard}`)
      for (const a of actionsEnRetard.slice(0, 5)) {
        const cs = a.canonicalSubjectId ? ` | ${a.canonicalSubjectId}` : ''
        const who = a.assignedTo ? ` | ${a.assignedTo}` : ''
        lines.push(`  - ${a.title} (${a.actionId})${cs} : éch. ${a.dueDate}${who}`)
      }
      if (actionsEnRetard.length > 5) lines.push(`  … (${actionsEnRetard.length - 5} autres)`)
    } else {
      lines.push(`• Actions en retard : 0`)
    }

    lines.push(`• Réserves ouvertes : ${counts.reservesOuvertes}`)
    if (reservesOuvertes.length > 0) {
      for (const r of reservesOuvertes.slice(0, 3)) {
        lines.push(`  - ${r.label} (${r.reserveId})${r.issuedOn ? ` depuis ${r.issuedOn}` : ''}`)
      }
      if (reservesOuvertes.length > 3) lines.push(`  … (${reservesOuvertes.length - 3} autres)`)
    }

    if (counts.echeancesDepassees > 0) {
      lines.push(`• Échéances dépassées : ${counts.echeancesDepassees}`)
      for (const d of echeancesDepassees) {
        lines.push(`  - ${d.title} (${d.deadlineId}) : éch. ${d.dueDate}`)
      }
    }

    if (counts.blocagesActifs > 0) {
      lines.push(`• Blocages actifs : ${counts.blocagesActifs}`)
      for (const b of blocagesActifs) {
        lines.push(`  - ${b.title} (${b.blocageId}) depuis ${b.dateStart} — ${b.type}`)
      }
    } else {
      lines.push(`• Blocages actifs : 0`)
    }
  }

  if (ctx.relations && ctx.relations.items.length > 0) {
    lines.push(`\n[RELATIONS CONFIRMÉES : ${ctx.relations.total}]`)
    for (const r of ctx.relations.items) {
      const just = r.justification ? ` — "${r.justification.slice(0, 80)}"` : ''
      lines.push(`• ${r.fromLabel} (${r.fromCanonicalSubjectId}) [${r.linkType}] ${r.toLabel} (${r.toCanonicalSubjectId ?? '?'}) (${r.linkId})${just}`)
    }
    if (ctx.relations.truncated) lines.push(`  … (${ctx.relations.total - ctx.relations.items.length} autres)`)
  }

  if (ctx.actors && ctx.actors.items.length > 0) {
    lines.push(`\n[INTERVENANTS : ${ctx.actors.total} confirmé(s)]`)
    for (const a of ctx.actors.items) {
      const acts = a.assignedActionsCount > 0 ? ` | ${a.assignedActionsCount} action(s)` : ''
      const decs = a.decisionsCount > 0 ? ` | ${a.decisionsCount} décision(s)` : ''
      const ids = `iv:${a.intervenantId}${a.contactId ? `/ct:${a.contactId}` : ''}`
      lines.push(`• ${a.name} (${a.companyName}, ${a.role}, ${ids})${acts}${decs}`)
    }
    if (ctx.actors.truncated) lines.push(`  … (${ctx.actors.total - ctx.actors.items.length} autres)`)
  }

  if (ctx.timeline) {
    const lastVisit = ctx.timeline.lastVisitAt
      ? `${ctx.timeline.lastVisitAt} (il y a ${ctx.timeline.lastVisitDaysAgo}j)`
      : 'aucune visite terrain enregistrée'
    lines.push(`\n[DERNIER PASSAGE] ${lastVisit}`)
  }

  if (ctx.blockages) {
    if (ctx.blockages.active.length > 0) {
      lines.push(`\n[BLOCAGES ACTIFS : ${ctx.blockages.activeCount}]`)
      for (const b of ctx.blockages.active) {
        lines.push(`• ${b.title} (${b.blocageId}) depuis ${b.dateStart} — ${b.type}`)
      }
    } else {
      lines.push(`\n[BLOCAGES ACTIFS : 0 — aucun blocage enregistré sur ce chantier]`)
    }
  }

  if (ctx.meta.dataGaps.length > 0) {
    lines.push(`\n[LIMITES DU CONTEXTE] ${ctx.meta.dataGaps.join(' ; ')}`)
  }

  return lines.join('\n')
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hrefFor(h: SiteMemoryHit, siteId: string): string {
  if (h.href) return h.href
  switch (h.type) {
    case 'intervention':     return `/interventions/${h.id}`
    case 'site_reserve':     return `/sites/${siteId}/reserves`
    case 'meeting_decision': return `/sites/${siteId}/subjects`
    case 'photo':
    case 'anomaly':
    case 'site_note':        return `/sites/${siteId}/journal`
    default:                 return `/sites/${siteId}`
  }
}

function isContextEmpty(ctx: SiteIntelligenceContext): boolean {
  return (ctx.attention?.items.length ?? 0) === 0
    && (ctx.subjects?.items.length ?? 0) === 0
    && (ctx.activeObjects?.counts.actionsEnRetard ?? 0) === 0
}

function mockAnswer(siteName: string, q: string, digestText: string): SiteMemoryAnswer {
  const retiens = digestText.split('\n').filter((l) => l.trim().startsWith('•')).slice(0, 3).map((l) => l.replace(/^\s*•\s*/, ''))
  const concepts = Array.from(new Set(q.split(/[\s,.?!]+/).filter((w) => w.length >= 5))).slice(0, 3)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
  return {
    answer: `(démo locale) Voici ce que je trouve dans la mémoire de ${siteName} au sujet de « ${q} ». Configurez une clé IA (Gemini/Anthropic) pour une vraie synthèse.`,
    retiens,
    next: [],
    concepts,
  }
}

// ── Cran 5 — Timeline d'un concept ────────────────────────────────────────────

export interface SiteMemoryTimelineItem { date: string; kind: string; label: string; meta: string | null }

export async function getSubjectMemoryTimelineAction(
  siteId: string,
  concept: string,
): Promise<{ ok: true; subjectName: string | null; items: SiteMemoryTimelineItem[] } | { ok: false; error: string }> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false, error: 'Non authentifié' }
  if (user.role !== 'admin' && user.role !== 'manager') return { ok: false, error: 'Accès refusé' }
  if (!z.string().uuid().safeParse(siteId).success) return { ok: false, error: 'Site invalide' }
  const term = (concept ?? '').trim().slice(0, 120)
  if (term.length < 2) return { ok: true, subjectName: null, items: [] }

  const sb = createAdminClient()
  const { data: subjects } = await sb.from('subjects').select('id, name').eq('site_id', siteId).neq('status', 'closed').ilike('name', `%${term}%`).limit(10)
  const rows = (subjects ?? []) as Array<{ id: string; name: string }>
  const match = rows.find((r) => r.name.toLowerCase() === term.toLowerCase()) ?? rows[0]
  if (match) {
    const events = await getSubjectTimeline(match.id).catch(() => [])
    const items: SiteMemoryTimelineItem[] = events
      .map((e) => ({ date: e.date, kind: e.kind, label: e.label, meta: e.reportLabel ?? e.meta }))
      .filter((i) => i.date)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
    return { ok: true, subjectName: match.name, items }
  }

  const search = await searchSiteMemory(siteId, term).catch(() => ({ ok: false as const, error: 'search' }))
  if (!search.ok) return { ok: true, subjectName: null, items: [] }
  const items: SiteMemoryTimelineItem[] = search.hits
    .map((h) => ({ date: h.occurredAt, kind: h.type, label: h.title, meta: h.snippet ? h.snippet.slice(0, 90) : null }))
    .filter((i) => i.date)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
  return { ok: true, subjectName: null, items }
}

// ── Suggestions contextuelles ─────────────────────────────────────────────────
// Génère 3 questions depuis les items d'attention réels du chantier.
// Utilisé par SiteMemoryChat pour personnaliser les chips d'accueil.

export async function getSiteContextualSuggestionsAction(siteId: string): Promise<string[]> {
  const user = await getCurrentUserWithProfile()
  if (!user || (user.role !== 'admin' && user.role !== 'manager')) return []
  if (!z.string().uuid().safeParse(siteId).success) return []

  try {
    const ctx = await buildSiteIntelligenceContext(siteId, {
      attention: true,
      maxAttentionItems: 5,
    })
    const topItems = (ctx.attention?.items ?? []).slice(0, 3)
    if (topItems.length === 0) return []

    return topItems.map((item) => {
      const label = item.title.length > 55 ? item.title.slice(0, 55) + '…' : item.title
      return `Où en est "${label}" ?`
    })
  } catch {
    return []
  }
}

// ── Action principale ─────────────────────────────────────────────────────────

export async function askSiteMemoryAgentAction(
  siteId: string,
  question: string,
): Promise<
  | { ok: true; answer: SiteMemoryAnswer; sources: SiteMemorySource[]; confidence: 'forte' | 'moyenne' | 'faible' | null; mock: boolean }
  | { ok: false; error: string }
> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false, error: 'Non authentifié' }
  if (user.role !== 'admin' && user.role !== 'manager') return { ok: false, error: 'Accès refusé' }
  if (!z.string().uuid().safeParse(siteId).success) return { ok: false, error: 'Site invalide' }

  const q = (question ?? '').trim().slice(0, 300)
  if (q.length < 3) return { ok: false, error: 'Question trop courte' }

  const t0 = Date.now()

  // ── Routage d'intention ─────────────────────────────────────────────────────
  const classification = classifyIntent(q)
  const { route, routeLabel, ctxOptions, useRetrieval } = classification

  // ── Récupération parallèle ──────────────────────────────────────────────────
  // Route C : retrieval + contexte minimal en parallèle
  // Route A/B : contexte structuré complet, retrieval lancé en parallèle uniquement pour C
  const [ctx, searchResult] = await Promise.all([
    buildSiteIntelligenceContext(siteId, ctxOptions).catch(() => null),
    useRetrieval
      ? searchSiteMemory(siteId, q).catch(() => ({ ok: false as const, error: 'search' }))
      : Promise.resolve({ ok: true as const, hits: [] as SiteMemoryHit[], summary: null }),
  ])

  if (!ctx || ctx.siteName === null) return { ok: false, error: 'Chantier introuvable' }

  // ── Fallback retrieval pour A/B si mémoire structurée vide ─────────────────
  let actualSearch = searchResult
  if (!useRetrieval && isContextEmpty(ctx)) {
    actualSearch = await searchSiteMemory(siteId, q).catch(() => ({ ok: false as const, error: 'search' }))
  }

  const hits = actualSearch.ok ? actualSearch.hits.slice(0, 8) : []
  const confidence = actualSearch.ok ? ((actualSearch as { ok: true; hits: SiteMemoryHit[]; summary: { confidence: string } | null }).summary?.confidence ?? null) : null
  const retrievalUsed = hits.length > 0
  const sources: SiteMemorySource[] = hits.map((h) => ({
    type: h.type, title: h.title, snippet: h.snippet, occurredAt: h.occurredAt, href: hrefFor(h, siteId),
  }))

  // ── Instrumentation ─────────────────────────────────────────────────────────
  const ctxBytes = JSON.stringify(ctx).length
  console.log('[memory-qa]', JSON.stringify({
    route,
    routeLabel,
    dimensions: ctx.meta.dimensionsLoaded,
    ctxBytes,
    retrievalUsed,
    sourceCount: hits.length,
    dataGaps: ctx.meta.dataGaps.length,
    question: q.slice(0, 60),
  }))

  // ── Construction du message utilisateur ────────────────────────────────────
  const provider = getAIProvider()
  try {
    const answer = await withAITracking('site_memory_qa', user.id, async () => {
      let systemPrompt: string
      let userMessage: string

      if (provider.name === 'mock') {
        const digest = await getSiteMemoryDigest(siteId)
        userMessage = `__MOCK_FIXTURE__:${JSON.stringify(mockAnswer(ctx.siteName ?? siteId, q, digest?.text ?? ''))}`
        systemPrompt = SYSTEM_STRUCTURED
      } else if (route === 'C') {
        // Route C : priorité au retrieval documentaire
        systemPrompt = SYSTEM_DOCUMENTARY
        const sourceLines = hits.length > 0
          ? hits.map((h, i) => `[${i + 1}] (${h.type}) ${h.title}${h.snippet ? ' — ' + h.snippet : ''}`.slice(0, 240)).join('\n')
          : '(aucune trace retrouvée)'
        const ctxSummary = ctx.attention && ctx.attention.items.length > 0
          ? `\n\n[Contexte chantier — ${ctx.siteName}]\n${ctx.attention.items.slice(0, 3).map(i => `• [${i.urgency}] ${i.title}`).join('\n')}`
          : ''
        userMessage = [
          `Question : ${q}`,
          ctxSummary,
          '',
          '=== Traces retrouvées (sources affichées à l\'utilisateur) ===',
          sourceLines,
        ].join('\n')
      } else {
        // Routes A et B : mémoire structurée comme contexte primaire
        systemPrompt = SYSTEM_STRUCTURED
        const contextText = renderContextForLLM(ctx, route)

        const sourceSection = hits.length > 0
          ? '\n\n=== Traces documentaires complémentaires ===\n' +
            hits.map((h, i) => `[${i + 1}] (${h.type}) ${h.title}${h.snippet ? ' — ' + h.snippet : ''}`.slice(0, 200)).join('\n')
          : ''

        userMessage = [
          `Question : ${q}`,
          '',
          contextText,
          sourceSection,
        ].join('\n')
      }

      const r = await provider.complete({ systemPrompt, userMessage, responseSchema: answerSchema, modelTier: 'light', maxOutputTokens: 700 })
      const parsed = answerSchema.safeParse(r.parsed)
      const result: SiteMemoryAnswer = parsed.success ? parsed.data : { answer: '', retiens: [], next: [], concepts: [] }

      // Log final avec latence
      console.log('[memory-qa:done]', JSON.stringify({
        route,
        latencyMs: Date.now() - t0,
        inputTokens: r.tokens?.input,
        outputTokens: r.tokens?.output,
        model: r.model,
      }))

      return { result, tokens: r.tokens, model: r.model, provider: provider.name, durationMs: r.durationMs }
    })
    return { ok: true, answer, sources, confidence: confidence as 'forte' | 'moyenne' | 'faible' | null, mock: provider.name === 'mock' }
  } catch {
    return { ok: false, error: 'Synthèse indisponible' }
  }
}
