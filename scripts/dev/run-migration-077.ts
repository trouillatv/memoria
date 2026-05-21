// Applique la migration 077 — teams.icon + CHECK couleur/icon.
// Vincent 2026-05-22 — Sprint Équipes A.
//
// Stratégies (cascade) : Management API → RPC exec_sql → fallback manuel.
// Cf. scripts/dev/_migrate-runner.ts.

import { applyMigration } from './_migrate-runner'

applyMigration('077')
  .then((r) => {
    if (!r.ok) process.exit(1)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
