import 'server-only'

// Adaptateur ZIP WhatsApp — le PREMIER (mig 184). Sa SEULE tâche : transformer un
// export WhatsApp (« Exporter la discussion » → .zip) en IngestItem[]. Il ne
// touche ni au tri, ni au CR, ni à la transcription : il remplit le contrat, le
// moteur fait le reste. Chaque autre source (upload, partage OS, WhatsApp Business)
// sera un adaptateur JUMEAU. Cf. docs/ingestion-engine.md.
//
// Un export contient les médias + `_chat.txt` (horodaté). On date chaque média
// par ordre de priorité : ligne du chat qui le cite → date dans le nom de fichier
// → null (le moteur retombe sur l'ordre de réception). Best-effort et tolérant :
// mieux vaut une visite un peu approximative qu'un import qui refuse de démarrer.

import PizZip from 'pizzip'
import type { IngestItem, IngestKind } from '../types'

const MAX_FILES = 500
const MAX_TOTAL_BYTES = 300 * 1024 * 1024

const EXT_KIND: Record<string, IngestKind> = {
  jpg: 'photo', jpeg: 'photo', png: 'photo', webp: 'photo', heic: 'photo', heif: 'photo', gif: 'photo',
  mp4: 'video', mov: 'video', '3gp': 'video', mkv: 'video', avi: 'video', webm: 'video',
  opus: 'vocal', ogg: 'vocal', m4a: 'vocal', mp3: 'vocal', aac: 'vocal', amr: 'vocal', wav: 'vocal',
  pdf: 'pdf',
}
const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', gif: 'image/gif',
  mp4: 'video/mp4', mov: 'video/quicktime', '3gp': 'video/3gpp', mkv: 'video/x-matroska', avi: 'video/x-msvideo', webm: 'video/webm',
  opus: 'audio/ogg', ogg: 'audio/ogg', m4a: 'audio/mp4', mp3: 'audio/mpeg', aac: 'audio/aac', amr: 'audio/amr', wav: 'audio/wav',
  pdf: 'application/pdf',
}

/** Parse un buffer .zip WhatsApp → items prêts pour ingestBatch. */
export function parseWhatsappZip(buffer: Buffer | Uint8Array): IngestItem[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const zip: any = new (PizZip as any)(buffer)
  const files: Record<string, unknown> = zip.files ?? {}

  // Carte nom de fichier → instant, extraite du _chat.txt (horodatage des lignes).
  const chatMap = buildChatTimestamps(zip, files)

  const items: IngestItem[] = []
  let total = 0
  for (const name of Object.keys(files)) {
    if (items.length >= MAX_FILES) break
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entry = files[name] as any
    if (!entry || entry.dir) continue
    const base = name.split('/').pop() ?? name
    if (base.startsWith('.') || base.toLowerCase().endsWith('.txt')) continue // _chat.txt & co
    const ext = base.split('.').pop()?.toLowerCase() ?? ''
    const kind = EXT_KIND[ext]
    if (!kind) continue

    const bytes: Uint8Array = entry.asUint8Array()
    total += bytes.byteLength
    if (total > MAX_TOTAL_BYTES) break

    items.push({
      bytes,
      filename: base,
      mime: EXT_MIME[ext] ?? 'application/octet-stream',
      kind,
      capturedAt: chatMap.get(base) ?? guessFromFilename(base) ?? null,
    })
  }
  return items
}

/** Lit `_chat.txt` et renvoie nom de fichier → ISO (l'horodatage de la ligne qui le cite). */
function buildChatTimestamps(zip: unknown, files: Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>()
  const chatName = Object.keys(files).find((n) => (n.split('/').pop() ?? '').toLowerCase().endsWith('.txt'))
  if (!chatName) return map
  let text = ''
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    text = (files[chatName] as any).asText() as string
  } catch {
    return map
  }
  // Ligne type : "[JJ/MM/AAAA, HH:MM:SS] Auteur : <pièce jointe : IMG-1234.jpg>"
  // ou Android : "JJ/MM/AAAA à HH:MM - Auteur : IMG-1234.jpg (fichier joint)".
  const tsRe = /^\[?(\d{1,2})[/.](\d{1,2})[/.](\d{2,4}),?(?:\s+à)?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/
  // Tout token ressemblant à un nom de fichier média sur la ligne.
  const fileRe = /([\w-]+\.(?:jpe?g|png|webp|heic|heif|gif|mp4|mov|3gp|mkv|avi|webm|opus|ogg|m4a|mp3|aac|amr|wav|pdf))/gi
  for (const line of text.split(/\r?\n/)) {
    const ts = tsRe.exec(line)
    if (!ts) continue
    const iso = toIso(ts)
    if (!iso) continue
    let m: RegExpExecArray | null
    fileRe.lastIndex = 0
    while ((m = fileRe.exec(line)) !== null) {
      if (!map.has(m[1])) map.set(m[1], iso)
    }
  }
  return map
}

/** Date encodée dans un nom de fichier WhatsApp (Android : IMG-AAAAMMJJ-WA… ;
 *  iOS : PHOTO-AAAA-MM-JJ-HH-MM-SS). Renvoie un ISO (à midi UTC si l'heure manque). */
function guessFromFilename(name: string): string | null {
  const wa = /-(\d{4})(\d{2})(\d{2})-WA/i.exec(name) // IMG-20231225-WA0001
  if (wa) return isoUtc(+wa[1], +wa[2], +wa[3], 12, 0, 0)
  const ios = /(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/.exec(name) // 2023-12-25-14-05-32
  if (ios) return isoUtc(+ios[1], +ios[2], +ios[3], +ios[4], +ios[5], +ios[6])
  return null
}

function toIso(m: RegExpExecArray): string | null {
  const day = +m[1], month = +m[2]
  let year = +m[3]
  if (year < 100) year += 2000
  const hour = +m[4], min = +m[5], sec = m[6] ? +m[6] : 0
  return isoUtc(year, month, day, hour, min, sec)
}

function isoUtc(y: number, mo: number, d: number, h: number, mi: number, s: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null
  const t = Date.UTC(y, mo - 1, d, h, mi, s)
  if (Number.isNaN(t)) return null
  return new Date(t).toISOString()
}
