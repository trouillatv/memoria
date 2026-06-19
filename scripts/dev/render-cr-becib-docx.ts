/**
 * scripts/dev/render-cr-becib-docx.ts
 *
 * Génère le CR BECIB en Word ÉDITABLE (.docx) depuis la fixture, pour ouverture
 * dans Word. Même source (JSON CrBecib) que le PDF.
 *
 * Usage : npx tsx scripts/dev/render-cr-becib-docx.ts
 * Sortie : .preview/cr-becib-<heure>.docx
 */
import * as fs from 'fs'
import * as path from 'path'
import { Packer } from 'docx'
import { buildCrBecibDocx } from '@/lib/documents/cr-becib-docx'
import { CRAVACHE_FIXTURE } from '@/lib/documents/fixtures/cravache'

async function main() {
  const doc = buildCrBecibDocx(CRAVACHE_FIXTURE)
  const buf = await Packer.toBuffer(doc)
  const dir = path.join(process.cwd(), '.preview')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir)
  const d = new Date()
  const stamp = `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`
  const out = path.join(dir, `cr-becib-${stamp}.docx`)
  fs.writeFileSync(out, buf)
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.docx') && path.join(dir, f) !== out) {
      try { fs.unlinkSync(path.join(dir, f)) } catch { /* ouvert dans Word : on laisse */ }
    }
  }
  console.log(`✓ ${buf.length} octets`)
  console.log(`OUVRE CE FICHIER WORD :\n${out}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
