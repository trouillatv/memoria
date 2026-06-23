# Architecture technique

## Stack

| Couche | Technologie | Version |
|---|---|---|
| Framework | Next.js App Router | 16.2.6 |
| Bundler | Turbopack | (next dev --turbopack) |
| Runtime | React | 19.2.4 |
| Base de données | Supabase PostgreSQL | — |
| Auth | Supabase Auth | — |
| Storage | Supabase Storage | — |
| RLS | Row Level Security Supabase | — |
| Styles | Tailwind CSS v4 | — |
| Composants | shadcn/ui + Radix Base UI | — |
| Toasts | sonner | 2.x |
| DnD | @dnd-kit/core | 6.x |
| PDF (gabarit client) | docxtemplater + LibreOffice (DOCX→PDF) | — |
| PDF (composants) | @react-pdf/renderer | 4.x |
| Extraction PDF (AO) | unpdf | — |
| Export Word / Excel | docx · docxtemplater · exceljs | — |
| Météo | Open-Meteo (sans clé) | — |
| Vecteurs | pgvector (Supabase) | — |
| Formulaires | react-hook-form + zod | — |
| Tests | Vitest + @testing-library/react | — |
| TypeScript | strict | 5.x |

---

## Routing Next.js App Router

Groupes de routes :

```
app/
  (auth)/          — pages publiques (login, accept-invite, change-password)
  (dashboard)/     — app principale (manager/admin) : tenders, contracts, sites,
                     meetings (réunions/CR/PV), actions, preuves, glossaire, manuel…
  (field)/m/       — interface mobile chef d'équipe (interventions, site terrain)
  admin/           — backoffice admin (users, usage, personnes, dépenses IA)
  api/             — route handlers REST (ex. analyse AO maxDuration=300)
  a/[token]/       — déclaration externe d'entreprise sur un lot (sans auth)
  i/[token]/       — preuve d'exécution externe (sans auth)
  h/[token]/       — passation publique (sans auth)
  qr/[token]/      — journal de chantier via QR (sans auth)
  p/[token]/       — partage public preuve (sans auth)
```

Multi-tenant : toutes les données sont scopées par `organization_id` (mig 089).
Le rôle JWT (`admin | manager | chef_equipe`) gouverne la nav et les gardes.

---

## Supabase — deux clients

| Client | Fichier | Usage |
|---|---|---|
| Server client | `lib/supabase/server.ts` | Composants serveur, server actions, RLS respecté |
| Admin client | `lib/supabase/admin.ts` | Server actions admin uniquement, bypass RLS, `SUPABASE_SERVICE_ROLE_KEY` |

**Règle** : le client admin ne s'utilise que dans `app/admin/` ou pour des opérations système (création user, reset password). Toutes les requêtes utilisateur passent par le server client avec RLS.

---

## Server Actions

Pattern principal de mutation. Chaque dossier de page a son fichier `actions.ts` :
- Validation Zod systématique
- Vérification du rôle en tête de fonction (`requireManagerOrAdmin()`, `requireAdmin()`)
- `revalidatePath()` après mutation
- Retour `{ ok: true }` ou `{ error: string }` — jamais d'exception à la surface UI

---

## Couche DB (`lib/db/`)

~104 fichiers, un par domaine. Chaque fonction crée son client Supabase
(`createAdminClient()` côté serveur, scope `organization_id` appliqué). Voir
`07_CARTOGRAPHIE_CODE.md` pour l'inventaire complet. Grands domaines :
- **AO** : `tenders.ts`, `engagements.ts`, `tenders/*`, `ao-experience.ts`
- **Terrain** : `missions.ts`, `interventions.ts`, `intervention-*.ts`, `teams.ts`
- **Réunions / CR** : `site-reports.ts`, `report-*.ts`, `points-examines.ts`, `meeting-*.ts`
- **Objets métier** : `site-actions.ts`, `site-reserve.ts`, `site-delivery.ts`,
  `site-decisions.ts`, `site-blocages.ts`, `subjects.ts`, `site-obligations.ts`
- **Mémoire du lieu** : `site-memory.ts`, `site-journal.ts`, `site-narrative.ts`,
  `site-day-log.ts`, `site-memory-signals.ts`, `site-cockpit.ts`
- **Casting** : `companies.ts`, `company-contacts.ts`, `site-intervenants.ts`
- **Transverse** : `glossary.ts`, `notifications.ts`, `documents.ts`, `proofs.ts`,
  `user-journey.ts`, `usage-events.ts`, `memory-corrections.ts`

---

## Service IA (`services/ai/`)

Architecture factory multi-provider :

```
services/ai/
  factory.ts            — sélection provider selon env (mock/anthropic/gemini)
  orchestrator.ts       — agents parallèles Atelier IA (lecteur_ao, mémoire, scoreur)
  initial-analysis.ts   — analyse AO initiale
  engagement-extraction.ts — extraction engagements typés
  site-report-analysis.ts — analyse d'une réunion → propositions (actions/risques…)
  document-generation.ts — génération de CR/PV (gabarit)
  agents/ · prompts/ · providers/ · tracking.ts
services/weather/
  open-meteo.ts         — géocodage + météo journalière (mapping WMO → enum, PUR)
```

**Providers IA** : `mock` (tests), `anthropic` (Claude), `gemini` — via `AI_PROVIDER`.

**Déterministe vs LLM (principe)** : retards, causes, santé d'obligation, sujet
canonique, détecteurs de réunion, synthèse « récit », corrections glossaire,
météo = **calculés** (aucun LLM). Résumés, extraction, suggestions = **LLM, à
vérifier par l'humain**. L'IA rédige, elle ne valide jamais seule.

---

## Pipeline réunion → Compte-rendu / PV

Le geste central du produit (voir aussi `README.md`) :
`audio multi-sources → transcription → correction glossaire → analyse IA
(site-report-analysis) → propositions (site_report_proposals) → écran de
validation humaine typé (lib/documents/pv-validation) → gabarit Word/Excel du
client (docxtemplater + LibreOffice) → PDF + archivage + mémoire du site`.

---

## PDF

Trois approches selon le contexte :
- **Gabarit client (CR/PV)** : `docxtemplater` remplit un modèle Word/Excel fourni
  par le client (BECIB…), puis **LibreOffice** convertit DOCX→PDF. C'est la SOURCE
  DE VÉRITÉ du livrable « je pose mon tél, j'ai mon CR ».
- **@react-pdf/renderer** : composants React rendus en route handler (`route.ts`).
  Dossier preuve, journal de chantier, export Atelier, gabarit CR de secours.
- **docx / exceljs** : exports Word/Excel directs (réserves, rapports).

Pattern route handler PDF :
```ts
// app/.../dossier/route.ts
export async function GET(req: Request) {
  const pdf = await renderToBuffer(<MonDocument data={data} />)
  return new Response(pdf, { headers: { 'Content-Type': 'application/pdf' } })
}
```

---

## Tests

```
tests/
  setup.ts          — mocks globaux (supabase, next/navigation, etc.)
  teardown.ts       — globalTeardown : supprime toutes les données __test de la DB
  components/       — tests UI avec @testing-library/react
  lib/              — tests fonctions DB (hit vraie DB de test)
  services/         — tests services IA (provider mock)
  doctrine/         — tests de conformité doctrine (symboles interdits, whitelist export)
```

**Convention données de test** : préfixe `__test` sur tous les noms/titres. Le teardown global nettoie automatiquement après chaque run.

---

## Audit / sécurité

- Toutes les mutations admin sont loggées dans `audit_log` via `lib/audit/log.ts`
- RLS sur toutes les tables, scopée par `organization_id` — accès sans auth uniquement via jetons signés (`/a`, `/i`, `/h`, `/qr`, `/p`)
- Vues sensibles (observation d'usage `/admin/usage`, page personne) : admin only, **auditées** (tripwire), descriptives — jamais de score RH
- Validation Zod côté serveur sur tous les inputs
- Pas de secret dans le code — tout dans `.env.local` (non committé)

---

## Variables d'environnement clés

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY     — admin client uniquement
AI_PROVIDER                   — mock | anthropic | gemini
ANTHROPIC_API_KEY
GOOGLE_AI_API_KEY
INITIAL_ADMIN_PASSWORD        — mot de passe temporaire (reset forcé)
```

Météo : Open-Meteo ne nécessite **aucune clé**. Conversion DOCX→PDF : LibreOffice
doit être installé sur l'environnement (binaire `soffice`).
