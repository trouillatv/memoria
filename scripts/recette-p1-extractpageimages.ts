/** Recette LOT 1 — exécute la VRAIE fonction de production extractPageImages()
 *  (services/pdf/extract-images.ts, filtre corrigé) sur des PDF réels. Aucune
 *  écriture, aucun appel LLM, aucune matérialisation. */
import { config } from 'dotenv'
config({ path: '.env.local' })
import { readFileSync } from 'node:fs'

async function run(label: string, path: string, nPages: number) {
  const { extractPageImages } = await import('../services/pdf/extract-images')
  const buffer = readFileSync(path)
  console.log(`\n=== ${label} (${path.split(/[\\/]/).pop()}) ===`)
  let total = 0
  for (let p = 0; p < nPages; p++) {
    const { images } = await extractPageImages(buffer, p)
    total += images.length
    if (images.length > 0) {
      const dims = images.map((i) => `${i.nativeWidth}x${i.nativeHeight}`).join(', ')
      console.log(`  page ${p + 1} → ${images.length} image(s) gardée(s) [${dims}]`)
    } else {
      console.log(`  page ${p + 1} → 0 image native gardée (→ branche fallback page_snapshot)`)
    }
  }
  console.log(`  TOTAL ${label} = ${total} image(s) native(s) gardée(s)`)
  return total
}

async function main() {
  const BELLA = process.argv[2]
  if (!BELLA) { console.error('usage: recette-p1-extractpageimages.ts <bella.pdf>'); process.exit(1) }

  // 1. BELLA CR26-U103 — critère principal : 16 photos natives récupérées
  //    individuellement (page 2), 0 sur page 1 (logo rejeté → fallback).
  const bella = await run('BELLA CR26-U103', BELLA, 2)

  // 2. Non-régression « photo normale » : PV avec vraies photos pleine largeur.
  await run('NON-RÉGRESSION photo normale (JARNAC CR_01)',
    'docs/corpus-pv/LONGITUDINAL/CHANTIER_004_JARNAC_RUE_PASTEUR/CR_01.pdf', 12)

  console.log(`\n────────────────────────────────`)
  console.log(`BELLA : ${bella} photos natives gardées (attendu 16).`)
  console.log(`Page 1 BELLA (logo seul) → 0 gardée : la branche fallback page_snapshot reste atteignable.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
