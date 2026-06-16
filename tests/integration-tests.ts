// Liste SOURCE UNIQUE des tests d'INTÉGRATION (ils touchent une vraie Supabase :
// chargent `.env.local`, appellent `lib/db` / `createAdminClient` sans les mocker).
//
// → Le CI GitHub ne les lance PAS (le runner n'a ni `.env.local` ni base). Ils
//   tournent en LOCAL (`npm test`) et pourront être joués dans un job dédié qui
//   provisionne Supabase.
//
// CONVENTION : tout nouveau test qui interroge une vraie base DOIT être ajouté
// ici. Sinon il tournera dans le projet `unit` en CI et échouera faute de DB
// (échec bruyant et auto-correcteur : on l'ajoute alors à cette liste).
//
// Liste obtenue par heuristique : fichiers utilisant createAdminClient /
// @/lib/supabase/(admin|server) / `from '@/lib/db/...'` SANS `vi.mock(...)` du
// client Supabase ou de lib/db.

export const INTEGRATION_TESTS: string[] = [
  'tests/components/at-risk-engagements-widget.test.tsx',
  'tests/components/chef-equipe-card.test.tsx',
  'tests/components/dashboard-cockpit.test.tsx',
  'tests/components/dashboard-widgets.test.tsx',
  'tests/components/monthly-report-editor.test.tsx',
  'tests/components/proof-photo-grid.test.tsx',
  'tests/components/team-week-grid.test.tsx',
  'tests/components/tender-memory-entry.test.tsx',
  'tests/components/tender-memory-panel.test.tsx',
  'tests/components/week-grid.test.tsx',
  'tests/components/welcome-card.test.tsx',
  'tests/doctrine/document-b2-matchers-guard.test.ts',
  'tests/doctrine/site-documents-guard.test.ts',
  'tests/doctrine/v67-brief-reprise.test.ts',
  'tests/lib/access-events.test.ts',
  'tests/lib/admin-monitoring.test.ts',
  'tests/lib/atelier-export.test.ts',
  'tests/lib/chef-equipe-preparation.test.ts',
  'tests/lib/contract-continuity.test.ts',
  'tests/lib/contract-entity.test.ts',
  'tests/lib/dashboard.test.ts',
  'tests/lib/engagements.test.ts',
  'tests/lib/ensure-today.test.ts',
  'tests/lib/insert-evidence.test.ts',
  'tests/lib/intervenants-scope.test.ts',
  'tests/lib/intervention-templates-generation.test.ts',
  'tests/lib/intervention-templates.test.ts',
  'tests/lib/missions.test.ts',
  'tests/lib/monthly-report-share.test.ts',
  'tests/lib/monthly-report.test.ts',
  'tests/lib/proof-detail.test.ts',
  'tests/lib/proof-share-closure.test.ts',
  'tests/lib/proof-share.test.ts',
  'tests/lib/proofs.test.ts',
  'tests/lib/public-proof-access.test.ts',
  'tests/lib/site-day-log.test.ts',
  'tests/lib/site-delivery.test.ts',
  'tests/lib/site-memory-anomalies-dedup.test.ts',
  'tests/lib/site-reserve.test.ts',
  'tests/lib/sites.test.ts',
  'tests/lib/teams-db.test.ts',
  'tests/lib/teams.test.ts',
  'tests/lib/template-stats.test.ts',
  'tests/lib/tender-memory-list.test.ts',
  'tests/lib/tender-memory.test.ts',
  'tests/lib/tender-outcome.test.ts',
  'tests/lib/tender-voice-note.test.ts',
  'tests/lib/week-planning.test.ts',
]
