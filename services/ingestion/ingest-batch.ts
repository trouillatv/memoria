import 'server-only'

// Moteur d'ingestion — le CŒUR (mig 184). Un lot d'éléments bruts (venu de
// N'IMPORTE QUELLE porte) → une ou plusieurs visites structurées, prêtes pour le
// tri EXISTANT (écran 2). Étapes :
//   1. dédup  — client_uuid = hash du contenu (ré-import idempotent, zéro doublon)
//   2. chrono — tri par instant réel (captured_at)
//   3. session — découpe déterministe en visites (splitByGap)
//   4. matière — upload storage + pièce + capture (réutilise addVisitCapture)
// Le vocal repart en transcription de fond comme en direct. RIEN d'IA ici.
// Cf. docs/ingestion-engine.md.

import { createHash, randomUUID } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { createVisit } from '@/lib/db/visits'
import { addReportAttachment } from '@/lib/db/site-reports'
import {
  addVisitCapture,
  findVisitCaptureIdByClientUuid,
  type VisitCaptureKind,
} from '@/lib/db/visit-captures'
import type { SiteReportAttachmentKind } from '@/types/db'
import { splitByGap } from './visit-session'
import type { IngestContext, IngestItem, IngestResult, IngestKind } from './types'

const BUCKET = 'site-reports'

const CAPTURE_KIND: Record<IngestKind, VisitCaptureKind> = {
  photo: 'photo', video: 'video', vocal: 'vocal', pdf: 'note', note: 'note',
}
const ATTACHMENT_KIND: Record<IngestKind, SiteReportAttachmentKind | null> = {
  photo: 'photo', video: 'video', vocal: 'audio', pdf: 'file', note: null,
}

/**
 * Ingère un lot. Idempotent : deux imports du même contenu ne créent jamais deux
 * fois la même capture (dédup par hash), et un lot entièrement déjà connu ne crée
 * aucune visite fantôme.
 */
export async function ingestBatch(items: IngestItem[], ctx: IngestContext): Promise<IngestResult> {
  const empty: IngestResult = { sessions: [], created: 0, skippedDuplicates: 0 }
  if (items.length === 0) return empty

  const supabase = createAdminClient()

  // Tenant du site (chemin de stockage + garde). Une seule requête pour tout le lot.
  const { data: site } = await supabase.from('sites').select('tenant_id').eq('id', ctx.siteId).maybeSingle()
  const tenantId = (site as { tenant_id: string } | null)?.tenant_id
  if (!tenantId) throw new Error('Site introuvable ou sans tenant')

  // 1. Identité idempotente + 2. tri chronologique (instants réels d'abord ; les
  // éléments sans horodatage viennent après, dans l'ordre reçu).
  const enriched = items.map((it, i) => ({
    it,
    clientUuid: contentUuid(it),
    ms: it.capturedAt ? Date.parse(it.capturedAt) : null,
    order: i,
  }))
  enriched.sort((a, b) => {
    if (a.ms === null && b.ms === null) return a.order - b.order
    if (a.ms === null) return 1
    if (b.ms === null) return -1
    return a.ms - b.ms
  })

  // 3. Découpe en sessions (déterministe) — SAUF si l'utilisateur a désigné la
  //    visite : dans ce cas le lot est UN seul groupe, qui rejoint cette visite.
  const groups = ctx.reportId
    ? enriched.map(() => 0)
    : splitByGap(enriched.map((e) => e.ms))

  const sessions: IngestResult['sessions'] = []
  let created = 0
  let skippedDuplicates = 0

  // Indices par session, dans l'ordre.
  const bySession = new Map<number, typeof enriched>()
  enriched.forEach((e, i) => {
    const g = groups[i]
    const arr = bySession.get(g) ?? []
    arr.push(e)
    bySession.set(g, arr)
  })

  for (const [, groupItems] of [...bySession.entries()].sort((a, b) => a[0] - b[0])) {
    // Ne garder que le NOUVEAU (ré-import : on saute ce qui existe déjà).
    const fresh: typeof groupItems = []
    for (const e of groupItems) {
      const existing = await findVisitCaptureIdByClientUuid(e.clientUuid).catch(() => null)
      if (existing) skippedDuplicates += 1
      else fresh.push(e)
    }
    if (fresh.length === 0) continue // aucune visite fantôme

    // La visite démarre au 1ᵉʳ instant réel du groupe (sinon maintenant).
    const startedAt = fresh.find((e) => e.ms !== null)?.it.capturedAt ?? new Date().toISOString()
    // Visite désignée → on l'ENRICHIT. Sinon → on en ouvre une.
    const reportId =
      ctx.reportId ??
      (await createVisit({
        siteId: ctx.siteId,
        origin: 'import',
        source: ctx.source,
        startedAt,
        createdBy: ctx.createdBy,
      }))

    let count = 0
    for (const e of fresh) {
      const ok = await ingestOne(e.it, e.clientUuid, { reportId, siteId: ctx.siteId, tenantId, createdBy: ctx.createdBy })
      if (ok) count += 1
    }
    created += count
    sessions.push({ reportId, startedAt, captureCount: count })
  }

  return { sessions, created, skippedDuplicates }
}

async function ingestOne(
  it: IngestItem,
  clientUuid: string,
  ctx: { reportId: string; siteId: string; tenantId: string; createdBy: string | null },
): Promise<boolean> {
  const captureKind = CAPTURE_KIND[it.kind]
  const attachmentKind = ATTACHMENT_KIND[it.kind]

  let attachmentId: string | null = null
  if (attachmentKind && it.bytes && it.bytes.byteLength > 0) {
    const supabase = createAdminClient()
    const ext = extFor(it)
    const attId = randomUUID()
    const storagePath = `${ctx.tenantId}/${ctx.reportId}/${attId}.${ext}`
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, it.bytes, { contentType: it.mime, upsert: false })
    if (upErr) return false
    attachmentId = await addReportAttachment({
      report_id: ctx.reportId,
      kind: attachmentKind,
      storage_path: storagePath,
      filename: it.filename.slice(0, 200),
      mime_type: it.mime,
      size_bytes: it.bytes.byteLength,
      client_uuid: clientUuid,
    })
  }

  // Le body : transcription à venir pour le vocal (null → 'pending'), texte de la
  // note, ou nom de fichier pour un PDF (repère lisible au tri).
  const body =
    it.kind === 'vocal' ? null
    : it.kind === 'note' ? (it.text ?? null)
    : it.kind === 'pdf' ? (it.text ?? it.filename)
    : (it.text ?? null)

  await addVisitCapture({
    reportId: ctx.reportId,
    siteId: ctx.siteId,
    kind: captureKind,
    body,
    attachmentId,
    // Le vocal déclenche la transcription de fond, exactement comme en direct.
    transcriptStatus: it.kind === 'vocal' ? 'pending' : null,
    clientUuid,
    capturedAt: it.capturedAt,
    lat: it.lat ?? null,
    lng: it.lng ?? null,
    createdBy: ctx.createdBy,
  })
  return true
}

/** UUID DÉTERMINISTE dérivé du contenu → ré-import idempotent (même octets =
 *  même identité). Pour une note sans octets : hash du texte + filename + instant. */
function contentUuid(it: IngestItem): string {
  const h = createHash('sha256')
  if (it.bytes && it.bytes.byteLength > 0) h.update(it.bytes)
  else h.update(`${it.kind}|${it.filename}|${it.text ?? ''}|${it.capturedAt ?? ''}`)
  const hex = h.digest('hex')
  // Format UUID (colonne uuid). Déterministe, pas un vrai v4 — l'unicité vient du hash.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

function extFor(it: IngestItem): string {
  const fromName = it.filename.split('.').pop()?.toLowerCase() ?? ''
  if (/^[a-z0-9]{1,5}$/.test(fromName)) return fromName
  if (it.mime.startsWith('image/')) return it.mime.slice(6) || 'jpg'
  if (it.mime.startsWith('video/')) return 'mp4'
  if (it.mime.startsWith('audio/')) return 'ogg'
  if (it.mime === 'application/pdf') return 'pdf'
  return 'bin'
}
