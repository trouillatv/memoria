import 'server-only'

type NarrativeProposal = {
  family: string
  label: string
  description: string | null
  statusAtDocumentDate: string | null
}

export async function generateHistoricalVisitNarrative(
  proposals: NarrativeProposal[],
): Promise<string | null> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey || proposals.length === 0) return null

  const realise   = proposals.filter((p) => p.family === 'knowledge_fact' && p.statusAtDocumentDate === 'réalisé')
  const enCours   = proposals.filter((p) => p.family === 'knowledge_fact' && p.statusAtDocumentDate === 'en cours')
  const autreKf   = proposals.filter((p) => p.family === 'knowledge_fact' && !['réalisé', 'en cours'].includes(p.statusAtDocumentDate ?? ''))
  const actions   = proposals.filter((p) => p.family === 'action')
  const deadlines = proposals.filter((p) => p.family === 'deadline')
  const decisions = proposals.filter((p) => p.family === 'decision')
  const reserves  = proposals.filter((p) => p.family === 'reservation')
  const obs       = proposals.filter((p) => p.family === 'observation')

  const fmt = (items: NarrativeProposal[]) =>
    items.map((p) => `- ${p.label}${p.description ? ` : ${p.description}` : ''}`).join('\n')

  let input = ''
  if (realise.length)   input += `\n## Travaux terminés / réalisés :\n${fmt(realise)}`
  if (enCours.length)   input += `\n## En cours :\n${fmt(enCours)}`
  if (autreKf.length)   input += `\n## État du chantier :\n${fmt(autreKf)}`
  if (decisions.length) input += `\n## Décisions :\n${fmt(decisions)}`
  if (reserves.length)  input += `\n## Réserves :\n${fmt(reserves)}`
  if (actions.length)   input += `\n## Actions à réaliser :\n${fmt(actions)}`
  if (deadlines.length) input += `\n## Échéances :\n${fmt(deadlines)}`
  if (obs.length)       input += `\n## Points de vigilance :\n${fmt(obs)}`

  const prompt = `Tu es rédacteur technique pour un conducteur de travaux. Tu rédiges le résumé d'une visite de chantier.

ORDRE ABSOLU — ne jamais déroger :
1. PREMIÈRE PHRASE : travaux terminés ou réalisés (section "Travaux terminés / réalisés" et "En cours"). C'est obligatoire même si la liste est longue.
2. DEUXIÈME ET TROISIÈME PHRASES (si nécessaire) : état courant du chantier, observations, décisions.
3. DERNIÈRE PHRASE SEULEMENT : ce qui reste à faire (actions, réserves, échéances). Une seule phrase suffit, n'énumère pas.

Ce que tu décris, c'est l'avancement physique du chantier, pas les échanges administratifs.
"Transmettre le plan X" ou "Faire parvenir la fiche Y" ne sont pas des avancées de chantier : ne les mets pas en avant.

Règles strictes :
- N'utilise que les informations fournies — ne déduis rien.
- Interdiction d'affirmer une conformité au planning, une cause ou un avancement global non explicitement mentionnés.
- Si deux éléments décrivent le même état, fusionne-les en une seule phrase.
- Commence directement par les faits : pas d'introduction générique.
- Phrases courtes et directes.
- 4 à 6 phrases au total.
${input}`

  try {
    const model = process.env.AI_MODEL ?? 'gemini-2.5-flash'
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 512 },
        }),
      },
    )
    if (!res.ok) return null
    const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null
  } catch {
    return null
  }
}
