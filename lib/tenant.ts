// Slice S1 — Doctrine V5 Pilier 6 « Infrastructure invisible »
//
// Le héros visible des documents (PDF + page publique /p/[token]) doit être
// le **prestataire** (l'entreprise de nettoyage) — pas MemorIA.
//
// Pour le pilote AGP, single-tenant : on lit le nom du prestataire depuis
// `NEXT_PUBLIC_TENANT_NAME` (env var). Future multi-tenant : remplacer par
// une table `tenant_settings` + résolution via user.tenant_id.

export function getTenantName(): string {
  const fromEnv = (process.env.NEXT_PUBLIC_TENANT_NAME ?? '').trim()
  if (fromEnv.length > 0) return fromEnv
  return 'Votre entreprise'
}
