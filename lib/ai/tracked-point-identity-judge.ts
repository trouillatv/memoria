// P6 — juge d'identité Q1/Q2 pour le rail V2 du Point de suivi.
//
// Porté depuis scripts/_p5b6-v1v2-engine.ts (V2_JUDGE_SYSTEM, dry-run jamais branché en
// production). Appelé UNIQUEMENT pour les paires que la comparaison de signature déterministe
// (lib/knowledge/tracked-point-condition-signature.ts) laisse AMBIGUOUS — jamais pour trancher
// un cas déjà déterministe. Style d'appel Gemini identique à qualify-link-candidates.ts
// (fetch brut, responseSchema + zod, thinkingBudget: 0, retourne null sur tout échec sans jamais
// lancer — l'appelant retombe alors sur UNCERTAIN, jamais sur une fusion par défaut).

import { z } from 'zod'
import type { CandidateThreadInput, TrackedPointCandidate, MembershipDecision } from '@/lib/knowledge/tracked-point-membership-candidates'
import type { ConditionSignature } from '@/lib/knowledge/tracked-point-condition-signature'
import type { IdentityJudge } from '@/lib/knowledge/tracked-point-identity-widening'

const V2_JUDGE_SYSTEM = `Tu es un juge d'identité pour le modèle "Point de suivi" d'une application de suivi de chantier BTP.

On te présente la signature métier d'un Point déjà constitué et celle d'un thread candidat (ancre, périmètre, condition suivie, critère de résolution — extraites par ailleurs, tu ne les recalcules pas).

Réponds à deux questions séparément :
- Q1 : le Point et le thread candidat suivent-ils EXACTEMENT la même condition métier (même ancre + même périmètre), même si le libellé ou le sujet canonique diffère ?
- Q2 : une seule et même preuve documentaire (même attestation, même contrôle, même transmission) pourrait-elle clore À LA FOIS le Point et le thread candidat ?

decision = SAME_POINT si et seulement si Q1=true ET Q2=true. Si l'une des deux est false → DISTINCT_POINT. En cas de doute réel sur Q1 ou Q2 → UNCERTAIN (ne fusionne jamais par défaut).

Réponds UNIQUEMENT en JSON : { "q1": bool, "q2": bool, "decision": "SAME_POINT|DISTINCT_POINT|UNCERTAIN", "reasoning": "..." } (reasoning ≤ 60 mots).`

const V2_JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    q1: { type: 'boolean' },
    q2: { type: 'boolean' },
    decision: { type: 'string', enum: ['SAME_POINT', 'DISTINCT_POINT', 'UNCERTAIN'] },
    reasoning: { type: 'string' },
  },
  required: ['q1', 'q2', 'decision', 'reasoning'],
}

const V2JudgeSchema = z.object({
  q1: z.boolean(),
  q2: z.boolean(),
  decision: z.enum(['SAME_POINT', 'DISTINCT_POINT', 'UNCERTAIN']),
  reasoning: z.string().min(1),
})

async function callIdentityJudge(
  pointSig: ConditionSignature,
  candidateSig: ConditionSignature,
): Promise<{ decision: MembershipDecision; reasoning: string } | null> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey) {
    console.error('[tracked-point-identity-judge] GOOGLE_GENAI_API_KEY manquante')
    return null
  }

  const model = process.env.AI_MODEL_LIGHT ?? 'gemini-2.5-flash'
  const userMsg = JSON.stringify({ point_signature: pointSig, candidat_signature: candidateSig }, null, 2)

  try {
    const body = {
      systemInstruction: { parts: [{ text: V2_JUDGE_SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: userMsg }] }],
      generationConfig: {
        maxOutputTokens: 512,
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: V2_JUDGE_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    )
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      console.error(`[tracked-point-identity-judge] HTTP ${resp.status}:`, text.slice(0, 200))
      return null
    }
    const json = await resp.json()
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) {
      console.error('[tracked-point-identity-judge] Réponse vide')
      return null
    }
    const parsed = V2JudgeSchema.safeParse(JSON.parse(text))
    if (!parsed.success) {
      console.error('[tracked-point-identity-judge] Parse error:', parsed.error.issues[0]?.message)
      return null
    }
    return { decision: parsed.data.decision, reasoning: parsed.data.reasoning }
  } catch (e) {
    console.error('[tracked-point-identity-judge] Exception:', e)
    return null
  }
}

/** Adapte `callIdentityJudge` à la signature `IdentityJudge` attendue par l'orchestrateur. */
export const trackedPointIdentityJudge: IdentityJudge = async (
  _candidate: CandidateThreadInput,
  _point: TrackedPointCandidate,
  candidateSig: ConditionSignature,
  pointSig: ConditionSignature,
) => callIdentityJudge(pointSig, candidateSig)
