// Applique la migration 081 — users.contract_end_date.
// Vincent 2026-05-22 — Sprint E continuité anticipée.

import { applyMigration } from './_migrate-runner'

applyMigration('081')
  .then((r) => {
    if (!r.ok) process.exit(1)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
