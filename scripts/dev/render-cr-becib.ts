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
  const buf = await renderToBuffer(CrBecibPdf({ cr: CRAVACHE_FIXTURE }))
  const out = path.join(process.cwd(), 'cr-becib-preview.pdf')
  fs.writeFileSync(out, buf)
  console.log(`✓ ${out} (${buf.length} octets)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
