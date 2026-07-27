import 'server-only'

// ── LA CHAÎNE DE COMPRÉHENSION ───────────────────────────────────────────────
// « Pourquoi MemorIA a créé cette action ? » — la réponse, rendue visible :
//
//   Capture (photo / vocal + transcription)
//     → Ce que MemorIA a compris (proposition : action, réserve, décision…)
//       → Ce que c'est devenu (objet promu, ou en attente, ou écarté)
//
// Assemblage PUR à partir des données existantes (aucune nouvelle colonne) :
//   visit_capture.source_capture_ids relie chaque proposition à ses captures ;
//   site_knowledge_proposals.promoted_object_{type,id} dit ce qu'elle est devenue.
// Le read model NE décide de rien : il relie ce que la base sait déjà.

import { listProposalsByReport, type ProposalKind, type ProposalStatus } from '@/lib/db/knowledge-proposals'
import {
  listVisitCaptures, getVisitCapturePreviewUrls,
  type VisitCaptureKind,
} from '@/lib/db/visit-captures'

/** Une capture d'entrée : la matière brute (photo affichable, vocal transcrit). */
export interface ChainCapture {
  id: string
  kind: VisitCaptureKind
  /** Transcription d'un vocal / texte d'une note — la parole devenue lisible. */
  text: string | null
  previewUrl: string | null
  mime: string | null
}

/** Ce que MemorIA a compris d'une (ou plusieurs) capture(s), et son devenir. */
export interface ChainUnderstanding {
  id: string
  kind: ProposalKind
  title: string
  confidence: string | null
  status: ProposalStatus
  /** L'objet réel né de la proposition, quand un humain l'a promue. */
  became: { type: string; id: string } | null
  /** Les captures qui ont nourri cette compréhension (sous-ensemble de captures). */
  sourceCaptureIds: string[]
}

export interface VisitUnderstandingChain {
  /** Toutes les captures retenues de la visite (photos + vocaux + notes). */
  captures: ChainCapture[]
  /** Ce que MemorIA a compris, dans l'ordre du récit. */
  understood: ChainUnderstanding[]
  /** Captures reliées à au moins une compréhension — le reste est trace pure. */
  linkedCaptureIds: string[]
}

/**
 * Reconstitue la chaîne de compréhension d'UNE visite. Le caller (page) garantit
 * l'accès au chantier ; ce read model se contente de relier captures, propositions
 * et objets promus. Résilient : une brique absente ne rend pas tout muet.
 */
export async function buildVisitUnderstandingChain(reportId: string): Promise<VisitUnderstandingChain> {
  const [rawCaptures, proposals] = await Promise.all([
    listVisitCaptures(reportId).catch(() => []),
    listProposalsByReport(reportId).catch(() => []),
  ])

  // On raconte la matière retenue : les photos (affichables), les vocaux et notes
  // (leur texte est la compréhension première). On écarte le tri « discarded ».
  const captures = rawCaptures.filter(
    (c) => c.status !== 'discarded' && (c.kind === 'photo' || c.kind === 'vocal' || c.kind === 'note' || c.kind === 'video'),
  )
  const previews = await getVisitCapturePreviewUrls(captures).catch(() => ({} as Record<string, { url: string; mime: string | null }>))

  const chainCaptures: ChainCapture[] = captures.map((c) => ({
    id: c.id,
    kind: c.kind,
    text: c.body?.trim() || null,
    previewUrl: previews[c.id]?.url ?? null,
    mime: previews[c.id]?.mime ?? null,
  }))

  const understood: ChainUnderstanding[] = proposals.map((p) => ({
    id: p.id,
    kind: p.kind,
    title: p.title,
    confidence: p.confidence,
    status: p.status,
    became: p.promoted_object_type && p.promoted_object_id
      ? { type: p.promoted_object_type, id: p.promoted_object_id }
      : null,
    sourceCaptureIds: p.source_capture_ids ?? [],
  }))

  const linked = new Set<string>()
  for (const u of understood) for (const id of u.sourceCaptureIds) linked.add(id)

  return { captures: chainCaptures, understood, linkedCaptureIds: [...linked] }
}
