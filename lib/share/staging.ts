import 'server-only'

// LE SAS DU PARTAGE — où les photos attendent que Guillaume choisisse le chantier.
//
// Android POSTe les fichiers d'un coup. Le chantier, lui, n'est connu qu'après,
// à l'écran suivant. Les octets doivent donc survivre entre les deux — sans
// qu'aucune visite ne soit créée « au cas où » : tant qu'il n'a pas choisi,
// RIEN n'existe dans la mémoire du chantier.
//
// Le sas vit dans le Storage, pas en base : aucune table, aucune migration, et
// rien à nettoyer si un lot est abandonné (un préfixe orphelin ne coûte rien et
// ne pollue aucune lecture métier).
//
//     partage/<userId>/<lotId>/<index>__<instantRéel>__<nom>

import { createAdminClient } from '@/lib/supabase/admin'

const BUCKET = 'site-reports' // le même bucket que tout le reste : une seule maison
const ROOT = 'partage'

export interface StagedFile {
  /** Chemin complet dans le bucket. */
  path: string
  /** Le nom d'origine, tel que WhatsApp l'a donné. */
  filename: string
  mime: string
  sizeBytes: number
  /** L'instant RÉEL de la photo, s'il a survécu au partage. */
  lastModifiedMs: number | null
}

export const stagingPrefix = (userId: string, lotId: string): string =>
  `${ROOT}/${userId}/${lotId}`

/** Un nom de fichier qui ne peut pas casser un chemin de stockage. */
function safeName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? name).slice(-120)
  return base.replace(/[^\w.\-]/g, '_') || 'fichier'
}

/**
 * Encode ce qu'il faut retrouver plus tard DANS le nom : l'ordre, l'instant réel
 * et le nom d'origine. Pas de table, pas de jointure — le chemin porte tout.
 */
function encodeName(index: number, lastModifiedMs: number | null, filename: string): string {
  return `${String(index).padStart(3, '0')}__${lastModifiedMs ?? 0}__${safeName(filename)}`
}

function decodeName(stored: string): { lastModifiedMs: number | null; filename: string } {
  const m = /^\d+__(\d+)__(.+)$/.exec(stored)
  if (!m) return { lastModifiedMs: null, filename: stored }
  const ms = Number(m[1])
  return { lastModifiedMs: ms > 0 ? ms : null, filename: m[2] }
}

/** Met un fichier de côté. Ne crée AUCUNE visite. */
export async function stageFile(params: {
  userId: string
  lotId: string
  index: number
  file: File
}): Promise<void> {
  const { userId, lotId, index, file } = params
  const bytes = new Uint8Array(await file.arrayBuffer())

  const { error } = await createAdminClient()
    .storage.from(BUCKET)
    .upload(
      `${stagingPrefix(userId, lotId)}/${encodeName(index, file.lastModified || null, file.name)}`,
      bytes,
      { contentType: file.type || 'application/octet-stream', upsert: false },
    )
  if (error) throw new Error(error.message)
}

/** Ce qui attend dans le sas, dans l'ordre où Android l'a envoyé. */
export async function listStaged(userId: string, lotId: string): Promise<StagedFile[]> {
  const prefix = stagingPrefix(userId, lotId)
  const { data, error } = await createAdminClient()
    .storage.from(BUCKET)
    .list(prefix, { limit: 100, sortBy: { column: 'name', order: 'asc' } })
  if (error) return []

  return (data ?? [])
    .filter((o) => o.name && o.id) // les dossiers n'ont pas d'id
    .map((o) => {
      const meta = (o.metadata ?? {}) as { size?: number; mimetype?: string }
      const { lastModifiedMs, filename } = decodeName(o.name)
      return {
        path: `${prefix}/${o.name}`,
        filename,
        mime: meta.mimetype ?? 'application/octet-stream',
        sizeBytes: meta.size ?? 0,
        lastModifiedMs,
      }
    })
}

/** Des URLs de vignettes, valables le temps que l'écran soit ouvert. */
export async function signStaged(paths: string[], expiresInSec = 900): Promise<Record<string, string>> {
  if (paths.length === 0) return {}
  const { data } = await createAdminClient()
    .storage.from(BUCKET)
    .createSignedUrls(paths, expiresInSec)

  const out: Record<string, string> = {}
  for (const row of data ?? []) {
    if (row.path && row.signedUrl) out[row.path] = row.signedUrl
  }
  return out
}

/** Relit les octets pour les confier au moteur d'ingestion. */
export async function readStaged(path: string): Promise<Uint8Array | null> {
  const { data, error } = await createAdminClient().storage.from(BUCKET).download(path)
  if (error || !data) return null
  return new Uint8Array(await data.arrayBuffer())
}

/** Vide le sas : le lot est ingéré (ou abandonné). */
export async function clearStaged(userId: string, lotId: string): Promise<void> {
  const staged = await listStaged(userId, lotId)
  if (staged.length === 0) return
  await createAdminClient()
    .storage.from(BUCKET)
    .remove(staged.map((f) => f.path))
}
