// CLI générique pour appliquer plusieurs migrations en chaîne.
//
//   node --import tsx scripts/dev/migrate.ts 077 078 079
//
// Vincent 2026-05-22 — Sprint Équipes.

import { applyMigration } from './_migrate-runner'

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error('Usage : node --import tsx scripts/dev/migrate.ts <numero1> [<numero2> ...]')
    console.error('Exemple : node --import tsx scripts/dev/migrate.ts 077 078 079')
    process.exit(1)
  }
  let failed = 0
  for (const n of args) {
    const r = await applyMigration(n)
    if (!r.ok) failed += 1
  }
  if (failed > 0) {
    console.error(`\n${failed}/${args.length} migration(s) en échec.`)
    process.exit(1)
  }
  console.log(`\n${args.length} migration(s) appliquée(s) avec succès.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
