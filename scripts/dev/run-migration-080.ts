// Applique la migration 080 — intervention_anomalies.resolved_by.
// Vincent 2026-05-22 — Sprint D mémoire qui vieillit.

import { applyMigration } from './_migrate-runner'

applyMigration('080')
  .then((r) => {
    if (!r.ok) process.exit(1)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
