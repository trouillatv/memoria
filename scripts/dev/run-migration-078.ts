// Applique la migration 078 — teams.specialties + CHECK + index GIN.
// Vincent 2026-05-22 — Sprint Équipes B.

import { applyMigration } from './_migrate-runner'

applyMigration('078')
  .then((r) => {
    if (!r.ok) process.exit(1)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
