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
| PDF | @react-pdf/renderer | 4.x |
| Export Word | docx | 9.x |
| Export Excel | exceljs | 4.x |
| Formulaires | react-hook-form + zod | — |
| Tests | Vitest + @testing-library/react | — |
| TypeScript | strict | 5.x |

---

## Routing Next.js App Router

Trois groupes de routes :

```
app/
  (auth)/          — pages publiques (login, accept-invite, change-password)
  (dashboard)/     — app principale, nécessite session
  (field)/m/       — interface mobile chef d'équipe
  admin/           — backoffice admin uniquement
  api/             — route handlers REST
  p/[token]/       — partage public preuve (sans auth)
  v/[token]/       — vérification publique preuve
```

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
- Vérification du rôle en tête de fonction (`requireAdmin()`, `requireAdminOrManager()`)
- `revalidatePath()` après mutation
- Retour `{ ok: true }` ou `{ error: string }` — jamais d'exception à la surface UI

---

## Couche DB (`lib/db/`)

Chaque entité a son fichier. Fonctions pures qui prennent le client Supabase en paramètre implicite (créé au sein de la fonction).

Fichiers principaux :
- `users.ts` — getCurrentUserWithProfile, getUserRoleById, updateUserProfileAsAdmin
- `tenders.ts` — CRUD AO, analyses, documents
- `engagements.ts` — cycle de vie complet (extract→curate→archive)
- `missions.ts` — missions + templates de récurrence
- `interventions.ts` — CRUD interventions
- `proofs.ts` — agrégation preuves, dossier
- `teams.ts` — équipes + membres
- `dashboard.ts` — toutes les requêtes du cockpit manager
- `evening-briefing.ts` — données briefing du soir avec couverture par site

---

## Service IA (`services/ai/`)

Architecture factory multi-provider :

```
services/ai/
  factory.ts          — sélection provider selon env (mock/anthropic/gemini)
  index.ts            — export principal
  orchestrator.ts     — orchestration agents parallèles
  chat.ts             — chat Atelier IA
  initial-analysis.ts — analyse AO initiale
  engagement-extraction.ts — extraction engagements
  source-validation.ts
  agents/             — logique par agent (lecteur_ao, terrain, financier…)
  prompts/            — prompts versionnés
  providers/          — implémentation Anthropic, Gemini, mock
  tracking.ts         — usage tokens / coût
```

**Providers disponibles** : `mock` (tests), `anthropic` (Claude), `gemini` (Google)
Sélection via `AI_PROVIDER` env var.

---

## PDF

Deux approches selon le contexte :
- **@react-pdf/renderer** : composants React rendus côté serveur dans une route handler (`route.ts`). Utilisé pour : dossier preuve, atelier export, litige dossier.
- **docx** : export Word pour rapport mensuel.

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
- RLS sur toutes les tables — aucune table n'est accessible sans auth sauf les routes `/p/` et `/v/`
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
