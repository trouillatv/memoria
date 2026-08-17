// lib/db/copilot-decompose-shadow-read.ts
// Lecture admin de copilot_decompose_shadow (mig 339, P6-A2).
// Capacité d'audit demandée par Vincent avant toute décision P6-B : compter
// les tours observés, isoler les cas 2+ segments (les seuls qui justifieraient
// un jour une segmentation visible), et vérifier la stabilité du modèle sur
// une même phrase répétée. Lecture seule, jamais utilisée par le pipeline réel.

import { createAdminClient } from '@/lib/supabase/admin'

type ShadowSegment = {
  start: number
  end: number
  text: string
  dependsOn: number | null
  intent: string
  confidence: string
  signals: string[]
}

type ShadowRow = {
  id: string
  created_at: string
  question: string
  segment_count: number
  ambiguous: boolean
  used_fallback: boolean
  segments: ShadowSegment[]
  latency_ms: number | null
  error: string | null
}

export type MultiSegmentCase = {
  id: string
  createdAt: string
  question: string
  segmentCount: number
  segments: ShadowSegment[]
}

export type ShadowErrorSample = {
  createdAt: string
  question: string
  error: string
}

export type ShadowStabilityCase = {
  question: string
  occurrences: number
  segmentCounts: number[]
  ambiguousValues: boolean[]
  stable: boolean // même segment_count et même ambiguous à chaque occurrence
}

export type DecomposeShadowAudit = {
  turnsObserved: number
  oneSegmentAmbiguous: number      // repli (mono-segment déclaré ambiguous:true)
  oneSegmentNotAmbiguous: number   // 1 segment mais décision délibérée (ambiguous:false)
  multiSegment: number             // segment_count >= 2
  multiSegmentCases: MultiSegmentCase[]
  errorCount: number
  errorSamples: ShadowErrorSample[]
  latency: {
    medianMs: number | null
    p95Ms: number | null
    maxMs: number | null
  }
  stability: ShadowStabilityCase[] // phrases observées ≥2 fois, avec écart éventuel
}

function fromIso(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString()
}

const EMPTY_AUDIT: DecomposeShadowAudit = {
  turnsObserved: 0,
  oneSegmentAmbiguous: 0,
  oneSegmentNotAmbiguous: 0,
  multiSegment: 0,
  multiSegmentCases: [],
  errorCount: 0,
  errorSamples: [],
  latency: { medianMs: null, p95Ms: null, maxMs: null },
  stability: [],
}

export async function getDecomposeShadowAudit(days = 30): Promise<DecomposeShadowAudit> {
  const supabase = createAdminClient()
  const since = fromIso(days)

  const { data, error } = await supabase
    .from('copilot_decompose_shadow')
    .select('id, created_at, question, segment_count, ambiguous, used_fallback, segments, latency_ms, error')
    .gte('created_at', since)
    .order('created_at', { ascending: false })

  if (error || !data) return EMPTY_AUDIT

  const rows = data as unknown as ShadowRow[]
  const n = rows.length
  if (n === 0) return EMPTY_AUDIT

  const oneSegAmbiguous    = rows.filter((r) => r.segment_count === 1 && r.ambiguous).length
  const oneSegNotAmbiguous = rows.filter((r) => r.segment_count === 1 && !r.ambiguous).length
  const multi              = rows.filter((r) => r.segment_count >= 2)

  const errored = rows.filter((r) => !!r.error)

  const latencies = rows
    .map((r) => r.latency_ms)
    .filter((v): v is number => typeof v === 'number' && v > 0)
    .sort((a, b) => a - b)
  const medianMs = latencies.length ? latencies[Math.floor(latencies.length / 2)] : null
  const p95Ms    = latencies.length ? latencies[Math.floor(latencies.length * 0.95)] : null
  const maxMs    = latencies.length ? latencies[latencies.length - 1] : null

  // Stabilité : même phrase (normalisée) observée ≥2 fois → le découpage
  // doit être identique à chaque fois, sinon le modèle est instable.
  const byQuestion = new Map<string, ShadowRow[]>()
  for (const r of rows) {
    const key = r.question.trim().toLowerCase()
    const list = byQuestion.get(key) ?? []
    list.push(r)
    byQuestion.set(key, list)
  }
  const stability: ShadowStabilityCase[] = [...byQuestion.entries()]
    .filter(([, list]) => list.length >= 2)
    .map(([question, list]) => {
      const segmentCounts = list.map((r) => r.segment_count)
      const ambiguousValues = list.map((r) => r.ambiguous)
      const stable =
        new Set(segmentCounts).size === 1 && new Set(ambiguousValues).size === 1
      return { question, occurrences: list.length, segmentCounts, ambiguousValues, stable }
    })
    .sort((a, b) => b.occurrences - a.occurrences)

  return {
    turnsObserved: n,
    oneSegmentAmbiguous: oneSegAmbiguous,
    oneSegmentNotAmbiguous: oneSegNotAmbiguous,
    multiSegment: multi.length,
    multiSegmentCases: multi.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      question: r.question,
      segmentCount: r.segment_count,
      segments: r.segments,
    })),
    errorCount: errored.length,
    errorSamples: errored.slice(0, 20).map((r) => ({
      createdAt: r.created_at,
      question: r.question,
      error: r.error as string,
    })),
    latency: { medianMs, p95Ms, maxMs },
    stability,
  }
}
