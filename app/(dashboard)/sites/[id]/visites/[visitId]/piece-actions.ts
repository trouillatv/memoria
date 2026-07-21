'use server'

// VERSER UNE PIÈCE AU DOSSIER — lot A (Vincent, 2026-07-22).
//
// « Une preuve est une interprétation : elle sert à démontrer quelque chose. Une
//   pièce est simplement un élément versé au dossier. »
//
// D'où le vocabulaire : on verse une PIÈCE, et c'est seulement ensuite, avec
// l'accord de l'humain, que MemorIA peut la lire. Le fait (une pièce entre au
// dossier) et son traitement (une analyse en tire des propositions) restent
// deux gestes distincts — comme partout ailleurs dans ce produit.
//
// Rien n'est réinventé : l'upload direct par URL signée existe pour la vidéo du
// terrain (il contourne la limite de 4,5 Mo des Server Actions), la pièce jointe
// et la capture ont leurs helpers. On les compose, on n'en écrit pas d'autres.

import { z } from 'zod'
import { requireFieldAgent } from '@/lib/auth/require'
import { createAdminClient } from '@/lib/supabase/admin'
import { getVisit } from '@/lib/db/visits'
import { getOrgId } from '@/lib/db/users'
import { addReportAttachment } from '@/lib/db/site-reports'
import { addVisitCapture, findVisitCaptureIdByClientUuid } from '@/lib/db/visit-captures'

const BUCKET = 'site-reports'

/** Lot A : ce que le dossier sait déjà stocker, transcrire et analyser. Le
 *  document (PDF, mail) attend le lot B — il pose une question produit à part :
 *  pièce jointe seulement, ou pièce analysable ? */
const KINDS = ['photo', 'vocal', 'video', 'note'] as const
type PieceKind = (typeof KINDS)[number]

const EXT: Record<PieceKind, string> = { photo: 'jpg', vocal: 'm4a', video: 'mp4', note: '' }

/** Le garde, et l'isolation tenant : le service-role passe outre la RLS. */
async function ouvrir(reportId: string) {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false as const, error: 'Non autorisé' }
  const visit = await getVisit(reportId)
  if (!visit || !visit.site_id) return { ok: false as const, error: 'Visite introuvable' }
  const orgId = await getOrgId()
  if (orgId && visit.organization_id && visit.organization_id !== orgId) {
    return { ok: false as const, error: 'Visite introuvable' }
  }
  return { ok: true as const, userId: auth.userId, visit }
}

const prepSchema = z.object({
  report_id: z.string().uuid(),
  client_uuid: z.string().uuid(),
  kind: z.enum(['photo', 'vocal', 'video']),
})

/**
 * Prépare le dépôt : une URL signée vers laquelle le navigateur envoie le
 * fichier DIRECTEMENT. Le corps d'un Server Action est plafonné bien en dessous
 * d'une vidéo de chantier ou d'un PDF de plan — passer par lui reviendrait à
 * promettre un geste qui échouerait sur les vrais fichiers.
 */
export async function prepareVisitPieceUploadAction(
  input: z.input<typeof prepSchema>,
): Promise<{ ok: true; storagePath: string; token: string } | { ok: false; error: string }> {
  const parsed = prepSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  const ctx = await ouvrir(parsed.data.report_id)
  if (!ctx.ok) return ctx

  const db = createAdminClient()
  const { data: report } = await db
    .from('site_reports')
    .select('tenant_id')
    .eq('id', parsed.data.report_id)
    .maybeSingle()
  const tenant = (report as { tenant_id: string | null } | null)?.tenant_id ?? 'sans-tenant'

  const attId = crypto.randomUUID()
  const path = `${tenant}/${parsed.data.report_id}/${attId}.${EXT[parsed.data.kind]}`
  const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path)
  if (error || !data) return { ok: false, error: 'Préparation du dépôt échouée' }
  return { ok: true, storagePath: data.path, token: data.token }
}

const registerSchema = z.object({
  report_id: z.string().uuid(),
  client_uuid: z.string().uuid(),
  kind: z.enum(KINDS),
  storage_path: z.string().min(1).max(500).optional(),
  filename: z.string().max(255).optional(),
  mime: z.string().max(120).optional(),
  size_bytes: z.coerce.number().int().min(0).max(2_000_000_000).optional(),
  body: z.string().trim().max(5000).optional(),
  /** LA DATE RÉELLE de la pièce — celle du fichier, de la visite, ou choisie.
   *  Sans elle, la chronologie mentirait d'un ou deux jours. */
  captured_at: z.string().datetime().optional(),
})

/**
 * Verse la pièce au dossier. Idempotent par `client_uuid` (mig 177) : rejouer
 * après une réponse perdue ne crée pas de doublon.
 *
 * Ce que cette action ne fait PAS : relancer l'analyse. La pièce entre au
 * dossier, le récit signale qu'elle n'a pas été lue, et l'humain décide.
 */
export async function registerVisitPieceAction(
  input: z.input<typeof registerSchema>,
): Promise<{ ok: true; captureId: string } | { ok: false; error: string }> {
  const parsed = registerSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  const d = parsed.data
  if (d.kind !== 'note' && !d.storage_path) return { ok: false, error: 'Fichier manquant' }
  if (d.kind === 'note' && !d.body) return { ok: false, error: 'Écrivez la note.' }

  const ctx = await ouvrir(d.report_id)
  if (!ctx.ok) return ctx

  try {
    const existing = await findVisitCaptureIdByClientUuid(d.client_uuid)
    if (existing) return { ok: true, captureId: existing }
  } catch { /* on continue : l'anti-doublon n'est pas une condition de dépôt */ }

  try {
    let attachmentId: string | undefined
    if (d.storage_path) {
      attachmentId = await addReportAttachment({
        report_id: d.report_id,
        kind: d.kind === 'photo' ? 'photo' : d.kind === 'video' ? 'video' : 'audio',
        storage_path: d.storage_path,
        filename: d.filename ?? `${d.kind}.${EXT[d.kind]}`,
        mime_type: d.mime ?? null,
        size_bytes: d.size_bytes ?? null,
        client_uuid: d.client_uuid,
      })
    }
    const captureId = await addVisitCapture({
      reportId: d.report_id,
      siteId: ctx.visit.site_id!,
      kind: d.kind,
      body: d.body ?? null,
      attachmentId,
      clientUuid: d.client_uuid,
      // `captured_at` porte l'instant RÉEL ; `created_at` dira, lui, que la
      // pièce est entrée au dossier aujourd'hui. Les deux sont vrais, et c'est
      // leur écart qui fait dire « versée après la visite ».
      capturedAt: d.captured_at ?? null,
      createdBy: ctx.userId,
    })
    return { ok: true, captureId }
  } catch (e) {
    console.error('[verserPiece] échec du dépôt', e)
    return { ok: false, error: e instanceof Error ? e.message : 'Dépôt impossible' }
  }
}
