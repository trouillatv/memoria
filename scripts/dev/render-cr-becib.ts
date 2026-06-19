/**
 * scripts/dev/render-cr-becib.ts
 *
 * Rendu LOCAL rapide du gabarit CR BECIB (fixture La Cravache) vers un fichier
 * PDF sur disque, pour itérer sans deploy Vercel ni cache d'export.
 *
 * Usage : npx tsx scripts/dev/render-cr-becib.ts
 * Sortie : cr-becib-preview.pdf à la racine du projet (ouvrir + rafraîchir).
 */
import * as fs from 'fs'
import * as path from 'path'
import { renderToBuffer } from '@react-pdf/renderer'
import { CrBecibPdf } from '@/lib/pdf/cr-becib'
import { CRAVACHE_FIXTURE } from '@/lib/documents/fixtures/cravache'

async function main() {
  const d = new Date()
  const hms = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  const buf = await renderToBuffer(CrBecibPdf({ cr: CRAVACHE_FIXTURE, previewStamp: hms }))
  const dir = path.join(process.cwd(), '.preview')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir)
  // Nom horodaté → l'URL change à chaque rendu → jamais servi depuis le cache.
  const stamp = `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`
  const out = path.join(dir, `cr-becib-${stamp}.pdf`)
  fs.writeFileSync(out, buf)
  // Purge best-effort : on IGNORE les fichiers verrouillés (ouverts dans un
  // lecteur) — ne JAMAIS faire planter le rendu là-dessus (cause du « toujours
  // le même » : la purge crashait avant d'imprimer le nouveau lien).
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.pdf') && path.join(dir, f) !== out) {
      try { fs.unlinkSync(path.join(dir, f)) } catch { /* fichier ouvert : on laisse */ }
    }
  }
  const url = 'file:///' + out.replace(/\\/g, '/')
  console.log(`✓ ${buf.length} octets`)
  console.log(`OUVRE CE LIEN (neuf, sans cache) :\n${url}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
