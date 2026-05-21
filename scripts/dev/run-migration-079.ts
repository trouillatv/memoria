// Applique la migration 079 — handover_briefs (passages de témoin).
// Vincent 2026-05-22 — Sprint Équipes C.

import { applyMigration } from './_migrate-runner'

applyMigration('079')
  .then((r) => {
    if (!r.ok) process.exit(1)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
