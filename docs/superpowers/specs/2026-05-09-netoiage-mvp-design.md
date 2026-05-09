# NetoIAge — Design MVP V1

**Date** : 2026-05-09
**Auteur** : Architecte logiciel principal (Claude) + product owner (Aurélie)
**Statut** : Spec validée, prête à être convertie en plan d'implémentation

---

## 1. Contexte produit & objectifs

NetoIAge est un SaaS B2B destiné aux entreprises de nettoyage professionnel. Le MVP V1 vise trois usages concrets :

1. **Répondre aux appels d'offres** plus vite et mieux, grâce à une analyse IA assistée par une bibliothèque interne de l'entreprise.
2. **Suivre les missions terrain** des équipes, avec checklist, photos, incidents et clôture tracée.
3. **Produire des preuves qualité** sous forme de rapports validés exportables.

**Priorités** : simplicité, rapidité, mobile-first pour le terrain, crédibilité SaaS, ROI immédiat.
**Anti-priorités** : sur-engineering, fonctionnalités gadgets, multi-tenant avancé, facturation, RH, comptabilité, CRM.

---

## 2. Décisions structurantes

Toutes les décisions ci-dessous ont été prises par la product owner pendant la phase brainstorming. Elles sont **figées** pour la durée du cycle MVP.

| Sujet | Décision | Motif |
|---|---|---|
| Découpage | Cycle unique complet (1 spec → 1 plan → 1 implémentation) | Choix produit assumé |
| Tenant | **Mono-entreprise** (1 déploiement = 1 client) | Simplicité MVP. Migration multi-tenant si besoin futur ≈ 3-5 j refacto |
| Auth | Pas de signup public. Admin seed via `INITIAL_ADMIN_EMAIL`. Invitations email pour les autres rôles | Mono-entreprise → pas besoin de self-service |
| Rôles | 3 rôles : `admin`, `manager`, `chef_equipe` | Conforme brief |
| IA | **Multi-provider** : `mock` (dev) / `gemini` (staging + dogfooding gratuit) / `anthropic` (prod ready) | Switch via env var, zéro changement de code |
| Multi-agents IA | 3 agents implémentés (`lecteur_ao`, `memoire_technique`, `opportunity_scorer`) + 4 stubs prêts (`conformite`, `contradicteur`, `financier`, `terrain`) | Ouvrir l'extension future sans coder l'orchestration complète maintenant |
| Mobile | **PWA installable** (manifest only, pas de service worker au MVP) | Le service worker apporte peu et coûte cher en complexité |
| Design | shadcn/ui + theming sobre + dark/light + une couleur primaire | "SaaS pro crédible", pas pixel-perfect |
| Tests | Tests ciblés sur la logique critique (~15-25 tests Vitest) | Bon ratio couverture/vitesse |
| Hosting | Vercel (front) + Supabase (DB / Auth / Storage) | Stack standard Next.js 15 |
| Exports MVP | Mémoire technique : markdown + Copier (md/HTML) + export Word simple. Rapport mission : page web imprimable (`@media print`) en priorité, PDF natif en bonus si temps | "Pas surinvestir dans l'export au début" |

---

## 3. Architecture globale

### Principes

- **Séparation stricte** : UI (`/app`, `/components`) ↔ logique métier (`/services`) ↔ accès données (`/lib/db`) ↔ IA (`/services/ai`).
- **Server-first** : les mutations Supabase et tous les appels IA passent par des **Server Actions** ou **Route Handlers** Next.js. Aucune clé API ni opération sensible côté navigateur.
- **Validation** : `zod` sur tous les inputs (formulaires + Server Actions + sorties IA).
- **Pas d'ORM lourd** : client Supabase typé (types générés depuis le schéma).
- **Pas de state global** (Redux / Zustand) : URL + Server Components + `useState` local suffisent.
- **Pas de TanStack Query** : Server Actions + `revalidatePath` couvrent les besoins.

### Arborescence

```
netoiage/
├─ app/                                 # Next.js App Router
│  ├─ (auth)/
│  │  ├─ login/
│  │  └─ accept-invite/                 # tokens Supabase invitation
│  ├─ (dashboard)/                      # routes protégées, layout SaaS
│  │  ├─ tenders/                       # Module 1 : AO IA
│  │  │  ├─ page.tsx                    # liste
│  │  │  ├─ new/page.tsx                # upload PDF
│  │  │  └─ [id]/page.tsx               # vue analyse + onglets
│  │  ├─ missions/                      # Module 2 : Terrain
│  │  │  ├─ page.tsx                    # liste manager / cards chef
│  │  │  └─ [id]/page.tsx               # fiche mission mobile-first
│  │  ├─ reports/                       # Module 3 : Rapports
│  │  │  ├─ page.tsx
│  │  │  └─ [id]/page.tsx
│  │  ├─ library/                       # Module 4 : Bibliothèque AGP
│  │  │  └─ page.tsx                    # CRUD knowledge_items
│  │  └─ settings/                      # admin only
│  ├─ admin/                            # zone admin (layout dédié)
│  │  ├─ layout.tsx
│  │  ├─ page.tsx                       # redirect → /admin/users
│  │  ├─ users/
│  │  └─ monitoring/
│  ├─ api/
│  │  ├─ tenders/[id]/status/route.ts   # polling analyse
│  │  └─ reports/[id]/pdf/route.ts      # export PDF rapport
│  ├─ layout.tsx                        # racine, providers, theme
│  └─ manifest.ts                       # PWA
├─ components/
│  ├─ ui/                               # shadcn/ui
│  ├─ layout/                           # AppSidebar, AppTopbar, MobileBottomNav...
│  ├─ tenders/
│  ├─ missions/
│  ├─ reports/
│  ├─ library/
│  └─ admin/
├─ lib/
│  ├─ supabase/
│  │  ├─ client.ts                      # browser client
│  │  ├─ server.ts                      # server client (cookies)
│  │  └─ admin.ts                       # service role client
│  ├─ db/                               # queries typées par domaine
│  │  ├─ tenders.ts
│  │  ├─ missions.ts
│  │  ├─ reports.ts
│  │  ├─ knowledge.ts
│  │  └─ users.ts
│  └─ utils.ts
├─ services/
│  ├─ ai/
│  │  ├─ index.ts                       # interface AIProvider
│  │  ├─ factory.ts                     # selon AI_PROVIDER
│  │  ├─ providers/
│  │  │  ├─ mock.ts
│  │  │  ├─ gemini.ts
│  │  │  └─ anthropic.ts
│  │  ├─ agents/
│  │  │  ├─ types.ts                    # AIAgent, AgentContext, AgentName
│  │  │  ├─ registry.ts
│  │  │  ├─ lecteur-ao.ts               # ✅ MVP
│  │  │  ├─ memoire-technique.ts        # ✅ MVP
│  │  │  ├─ opportunity-scorer.ts       # ✅ MVP
│  │  │  ├─ conformite.ts               # 🟡 stub
│  │  │  ├─ contradicteur.ts            # 🟡 stub
│  │  │  ├─ financier.ts                # 🟡 stub
│  │  │  └─ terrain.ts                  # 🟡 stub
│  │  ├─ prompts/                       # prompts versionnés
│  │  │  ├─ lecteur-ao.v1.ts
│  │  │  ├─ memoire-technique.v1.ts
│  │  │  ├─ opportunity-scorer.v1.ts
│  │  │  └─ ...                         # stubs draft
│  │  ├─ orchestrator.ts                # coordonne les agents
│  │  ├─ library-context.ts             # injecte la bibliothèque AGP dans les prompts
│  │  └─ tracking.ts                    # logge ai_usage
│  ├─ pdf/
│  │  └─ extract.ts                     # pdf-parse, extraction texte AO
│  └─ reports/
│     ├─ pdf-template.tsx               # @react-pdf/renderer
│     └─ generator.ts
├─ types/                               # types TS partagés + types Supabase générés
├─ hooks/
│  ├─ use-online-status.ts
│  └─ use-tender-status-poll.ts
├─ public/
│  └─ icons/                            # PWA icons 192/512
├─ supabase/
│  ├─ migrations/                       # SQL versionné, ordre numérique
│  └─ seed.sql
├─ docs/
│  └─ superpowers/specs/
├─ middleware.ts                        # protection routes + refresh session
├─ tests/                               # Vitest
└─ .env.example
```

### Trois choix techniques verrouillés

1. **Pas de Redux / Zustand global** : URL + Server Components + `useState` local + Radix internals via shadcn.
2. **Pas de TanStack Query** : Server Actions + `revalidatePath` + 1 hook polling pour le seul cas async (analyse AO).
3. **Validation** : `zod` partout (Server Actions, route handlers, sorties IA, formulaires via `react-hook-form` + `@hookform/resolvers/zod`).

---

## 4. Authentification & rôles

### Modèle de rôles

| Rôle | Capacités |
|---|---|
| `admin` | Tout : inviter, gérer users, settings, modules métier, bibliothèque AGP, monitoring |
| `manager` | Tous modules métier (AO, missions, rapports, bibliothèque). Pas d'accès users/settings/monitoring |
| `chef_equipe` | Voit **uniquement** ses missions assignées. Cocher checklist, photographier, déclarer incidents, clôturer. Aucun accès AO / bibliothèque / settings |

### Flow d'authentification

**Initialisation (one-shot premier déploiement)** :
- Variable d'environnement `INITIAL_ADMIN_EMAIL` + `INITIAL_ADMIN_PASSWORD`.
- Migration `009_seed_admin.sql` crée l'admin si absent. Le mot de passe est temporaire avec `must_change_password = true`.
- **Pas d'écran de signup public**, jamais.

**Cycle de vie utilisateur** :
1. Admin se rend sur `/admin/users`, clique « Inviter », saisit email + nom + rôle.
2. Server Action appelle `supabase.auth.admin.inviteUserByEmail()` avec metadata role.
3. L'invité reçoit un email Supabase, clique le lien, atterrit sur `/accept-invite`, définit son mot de passe.
4. Premier login : si rôle = `chef_equipe`, redirect direct vers `/missions` ; sinon `/dashboard`.

**Login standard** :
- Email + mot de passe via `signInWithPassword`.
- Session via cookies HTTP-only (`@supabase/ssr`).
- Si `must_change_password = true`, redirect vers `/auth/change-password`.

### Protection des routes

- **`middleware.ts`** : intercepte tout `(dashboard)/*` et `/admin/*`, refresh la session, redirige vers `/login` si non authentifié.
- **Server Components** : refetch `user` + `role` à chaque requête, redirige si rôle inadéquat.
- **RLS Supabase** : seconde ligne de défense ; chaque table a au minimum `auth.role() = 'authenticated'` pour SELECT, et des policies plus fines pour INSERT/UPDATE/DELETE.

### Stockage du rôle dans le JWT

Trigger `on_user_role_change` synchronise `users.role` dans `auth.users.raw_app_meta_data.role`. Permet aux RLS de filtrer via `auth.jwt()->'app_metadata'->>'role'` sans jointure SQL.

### Patterns réutilisés d'EquiPass (zone `/admin`)

- Layout admin distinct (header sombre, badge logo, sous-titre métier, lien « ← Retour app »).
- Index admin redirige vers la page la plus utilisée (`/admin/users`).
- Server Components Supabase pour fetch direct.
- Tableau users avec rôle inline-éditable (badge coloré + select), force password reset, delete.
- Bouton `ForcePasswordResetButton` désactivé pour les autres comptes admin (protection).
- Carte info ambre expliquant la procédure de reset (mot de passe temporaire `netoiage2026` par défaut).
- Badge compteur dans la nav (ex : incidents non résolus).

### Différences avec EquiPass

- **Pas de `CompanyManager`** ni `UserCompanySelect` (mono-entreprise).
- 3 rôles au lieu de 4.

---

## 5. Schéma de base de données

### Enums

```sql
create type user_role         as enum ('admin', 'manager', 'chef_equipe');
create type mission_status    as enum ('pending', 'in_progress', 'completed', 'issue');
create type tender_status     as enum ('draft', 'extracting', 'analyzing', 'ready', 'failed', 'submitted', 'archived');
create type incident_severity as enum ('low', 'medium', 'high', 'critical');
create type ai_provider       as enum ('mock', 'gemini', 'anthropic', 'openai');
create type knowledge_category as enum (
  'references_clients',
  'moyens_humains',
  'materiel',
  'procedures',
  'qualite',
  'anciens_memoires'
);
```

### Tables

```sql
-- 1. Utilisateurs (extension de auth.users)
create table public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  full_name     text,
  role          user_role not null default 'chef_equipe',
  must_change_password boolean default false,
  created_at    timestamptz default now(),
  deleted_at    timestamptz
);

-- 2. Clients (entreprises clientes du nettoyeur)
create table public.clients (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  contact_name  text,
  contact_email text,
  contact_phone text,
  address       text,
  notes         text,
  created_at    timestamptz default now(),
  deleted_at    timestamptz
);

-- 3. Sites (lieux d'intervention d'un client)
create table public.sites (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  name          text not null,
  address       text,
  notes         text,
  created_at    timestamptz default now(),
  deleted_at    timestamptz
);

-- 4. Missions
create table public.missions (
  id              uuid primary key default gen_random_uuid(),
  site_id         uuid not null references sites(id) on delete restrict,
  scheduled_date  date not null,
  scheduled_start time,
  scheduled_end   time,
  assigned_to     uuid references users(id) on delete set null,
  status          mission_status not null default 'pending',
  notes           text,
  completion_notes text,                       -- motif de l'écart à la clôture
  closed_with_deviation boolean default false, -- true si écart constaté
  started_at      timestamptz,
  completed_at    timestamptz,
  created_by      uuid not null references users(id),
  created_at      timestamptz default now(),
  deleted_at      timestamptz
);
create index missions_assigned_to_idx       on missions(assigned_to);
create index missions_status_idx            on missions(status);
create index missions_scheduled_date_idx    on missions(scheduled_date);

-- 5. Items de checklist d'une mission (libres au MVP, templates en V2)
create table public.mission_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  mission_id  uuid not null references missions(id) on delete cascade,
  label       text not null,
  position    int not null,
  is_done     boolean default false,
  done_at     timestamptz,
  done_by     uuid references users(id) on delete set null
);
create index mission_checklist_items_mission_idx on mission_checklist_items(mission_id);

-- 6. Photos avant/après
create table public.mission_photos (
  id           uuid primary key default gen_random_uuid(),
  mission_id   uuid not null references missions(id) on delete cascade,
  storage_path text not null,
  kind         text not null check (kind in ('before', 'after', 'incident', 'other')),
  caption      text,
  taken_at     timestamptz default now(),
  taken_by     uuid references users(id) on delete set null
);
create index mission_photos_mission_idx on mission_photos(mission_id);

-- 7. Incidents
create table public.incidents (
  id          uuid primary key default gen_random_uuid(),
  mission_id  uuid not null references missions(id) on delete cascade,
  severity    incident_severity not null default 'medium',
  description text not null,
  resolved_at timestamptz,
  reported_by uuid references users(id) on delete set null,
  created_at  timestamptz default now()
);
create index incidents_mission_idx on incidents(mission_id);

-- 8. Appels d'offres
create table public.tenders (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  client_name       text,                  -- donneur d'ordre AO (texte libre)
  deadline          date,
  status            tender_status not null default 'draft',
  opportunity_score int,                    -- 0-100, calculé par IA
  error_msg         text,                   -- si status='failed'
  created_by        uuid not null references users(id),
  created_at        timestamptz default now(),
  deleted_at        timestamptz
);
create index tenders_status_idx on tenders(status);

-- 9. Documents PDF d'un AO
create table public.tender_documents (
  id             uuid primary key default gen_random_uuid(),
  tender_id      uuid not null references tenders(id) on delete cascade,
  storage_path   text not null,
  filename       text not null,
  size_bytes     int,
  page_count     int,
  extracted_text text,
  uploaded_at    timestamptz default now()
);
create index tender_documents_tender_idx on tender_documents(tender_id);

-- 10. Analyses IA d'un AO (versionnées, multi-agents)
create table public.tender_analyses (
  id                uuid primary key default gen_random_uuid(),
  tender_id         uuid not null references tenders(id) on delete cascade,
  provider          ai_provider not null,
  model             text,
  prompt_versions   jsonb,                  -- { lecteur_ao: 'v1', memoire_technique: 'v1', ... }
  summary           text,
  constraints       jsonb,
  risks             jsonb,
  checklist         jsonb,
  technical_memo    text,                   -- markdown
  library_snapshot  jsonb,                  -- ce qui a été injecté dans le prompt (reproductibilité)
  raw_response      jsonb,                  -- debug
  created_at        timestamptz default now()
);
create index tender_analyses_tender_idx on tender_analyses(tender_id);

-- 11. Rapports de mission (1 mission ↔ 1 rapport)
create table public.reports (
  id               uuid primary key default gen_random_uuid(),
  mission_id       uuid not null unique references missions(id) on delete cascade,
  validated_by     uuid references users(id) on delete set null,
  validated_at     timestamptz,
  pdf_storage_path text,
  notes            text,
  created_at       timestamptz default now()
);

-- 12. Bibliothèque AGP — table unifiée minimale
create table public.knowledge_items (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  category         knowledge_category not null,
  content_markdown text not null,
  file_path        text,                    -- nullable, PDF/doc dans bucket library-documents
  tags             text[],                  -- libres : "environnement", "rgpd", "iso9001", etc.
  created_at       timestamptz default now(),
  deleted_at       timestamptz
);
create index knowledge_items_category_idx on knowledge_items(category) where deleted_at is null;
create index knowledge_items_tags_idx on knowledge_items using gin(tags) where deleted_at is null;

-- 13. Logs d'usage IA (contrôle des coûts)
create table public.ai_usage (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references users(id) on delete set null,
  feature       text not null,              -- 'lecteur_ao', 'memoire_technique', 'opportunity_scorer', ...
  provider      ai_provider not null,
  model         text,
  input_tokens  int,
  output_tokens int,
  cost_usd      numeric(10, 6),
  duration_ms   int,
  status        text not null,              -- 'success' | 'error'
  error_msg     text,
  created_at    timestamptz default now()
);
create index ai_usage_user_idx       on ai_usage(user_id);
create index ai_usage_created_at_idx on ai_usage(created_at);
```

### Buckets Supabase Storage

| Bucket | Privé | Contenu |
|---|---|---|
| `tender-documents` | Oui | PDF d'AO uploadés |
| `mission-photos` | Oui | Photos terrain (avant/après/incident) |
| `report-pdfs` | Oui | PDFs générés des rapports validés |
| `library-documents` | Oui | PDFs de procédures, certificats qualité |

Accès via signed URLs (1h par défaut) côté client.

### RLS — patterns clés

- **Toutes les tables** : RLS activé, SELECT minimum `auth.role() = 'authenticated'`.
- **`missions`** : `chef_equipe` voit `assigned_to = auth.uid()` ; `manager` / `admin` voient tout (via JWT role).
- **`incidents`, `mission_photos`, `mission_checklist_items`** : visibilité dérivée de la mission parente (subquery RLS).
- **Mutations** sur `tenders`, `clients`, `sites`, `knowledge_items` : réservées à `manager` + `admin`.
- **`ai_usage`** : SELECT réservé à `admin`. INSERT uniquement par Server Actions (service role).
- **Soft delete** : filtré côté requête (`deleted_at is null`), pas via RLS — laisse l'admin restaurer.

### Trigger important

```sql
create function public.sync_user_role_to_jwt()
  returns trigger as $$
begin
  update auth.users
    set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', new.role)
    where id = new.id;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_user_role_change
  after insert or update of role on public.users
  for each row execute function public.sync_user_role_to_jwt();
```

### Ordre des migrations

1. `001_enums.sql`
2. `002_users.sql`
3. `003_clients_sites.sql`
4. `004_missions.sql` (incl. checklist + photos + incidents)
5. `005_tenders.sql` (incl. documents + analyses)
6. `006_reports.sql`
7. `007_knowledge_items.sql`
8. `008_ai_usage.sql`
9. `009_buckets.sql`
10. `010_rls_policies.sql`
11. `011_triggers.sql`
12. `012_seed_admin.sql`

---

## 6. Couche IA & multi-agents

### Interface AIProvider

```ts
// services/ai/index.ts
export interface AIProvider {
  name: 'mock' | 'gemini' | 'anthropic' | 'openai'
  complete(input: CompletionInput): Promise<CompletionOutput>
}

export interface CompletionInput {
  systemPrompt: string
  userMessage: string
  responseSchema?: z.ZodSchema     // si fourni → mode JSON structuré
  modelTier: 'light' | 'heavy'
}

export interface CompletionOutput {
  text: string
  parsed?: unknown                 // si responseSchema fourni
  tokens: { input: number; output: number }
  model: string
  durationMs: number
}
```

### Factory et sélection de provider

```ts
// services/ai/factory.ts
export function getAIProvider(): AIProvider {
  switch (process.env.AI_PROVIDER) {
    case 'gemini':    return new GeminiProvider()
    case 'anthropic': return new AnthropicProvider()
    default:          return new MockProvider()
  }
}
```

Modèles par défaut :

| Tier | Gemini | Anthropic |
|---|---|---|
| `light` | `gemini-2.5-flash` | `claude-haiku-4-5-20251001` |
| `heavy` | `gemini-2.5-pro` | `claude-sonnet-4-6` |

Override possible via `AI_MODEL_LIGHT` et `AI_MODEL_HEAVY`.

### Architecture multi-agents

```ts
// services/ai/agents/types.ts
export type AgentName =
  | 'lecteur_ao'
  | 'memoire_technique'
  | 'opportunity_scorer'
  | 'conformite'           // stub
  | 'contradicteur'        // stub
  | 'financier'            // stub
  | 'terrain'              // stub

export interface AIAgent<TInput, TOutput> {
  name: AgentName
  description: string
  modelTier: 'light' | 'heavy'
  promptVersion: string
  inputSchema: z.ZodSchema<TInput>
  outputSchema: z.ZodSchema<TOutput>
  run(input: TInput, ctx: AgentContext): Promise<TOutput>
}

export interface AgentContext {
  provider: AIProvider
  userId: string
  libraryContext: string                       // markdown sérialisé de la bibliothèque AGP
  previousResults?: Partial<Record<AgentName, unknown>>
}
```

### Agents — statut MVP

| Agent | Rôle | Statut |
|---|---|---|
| `lecteur_ao` | Extrait contraintes, risques, checklist du PDF | ✅ implémenté |
| `memoire_technique` | Génère mémoire technique markdown grounded sur la bibliothèque | ✅ implémenté |
| `opportunity_scorer` | Score 0-100 (alignement, risque, marge estimée) | ✅ implémenté |
| `conformite` | Vérifie ISO/RGPD/clauses sociales | 🟡 stub avec interface + prompt draft |
| `contradicteur` | Avocat du diable : faiblesses de la proposition | 🟡 stub |
| `financier` | Estime coûts, marge, faisabilité économique | 🟡 stub |
| `terrain` | Évalue faisabilité opérationnelle | 🟡 stub |

### Orchestrateur

```ts
// services/ai/orchestrator.ts
export async function analyzeTender(tenderId: string, rawText: string, userId: string) {
  const ctx: AgentContext = {
    provider: getAIProvider(),
    userId,
    libraryContext: await buildLibraryContext(),  // injection bibliothèque AGP
  }

  // Phase 1 — lecture (séquentielle, bloquante)
  const reading = await agents.lecteur_ao.run({ rawText }, ctx)

  // Phase 2 — agents qui consomment la lecture, en parallèle
  ctx.previousResults = { lecteur_ao: reading }
  const [memo /*, conformite, contradicteur, financier, terrain*/] = await Promise.all([
    agents.memoire_technique.run({ reading }, ctx),
    // futurs agents : décommenter pour activer
  ])

  // Phase 3 — scoring final
  ctx.previousResults = { ...ctx.previousResults, memoire_technique: memo }
  const score = await agents.opportunity_scorer.run({ reading, memo }, ctx)

  return { reading, memo, score, librarySnapshot: ctx.libraryContext }
}
```

### Injection de la bibliothèque AGP

```ts
// services/ai/library-context.ts
export async function buildLibraryContext(): Promise<string> {
  const items = await fetchKnowledgeItems()        // SELECT ... WHERE deleted_at IS NULL
  const grouped = groupBy(items, 'category')

  return Object.entries(grouped)
    .map(([category, items]) => formatCategoryAsMarkdown(category, items))
    .join('\n\n')
}
```

Produit un markdown structuré ~10-20k tokens max, injecté dans le `system prompt` des agents qui le consomment (en priorité `memoire_technique`, puis les agents stubs futurs).

Si la bibliothèque dépasse ~25k tokens : message d'avertissement à l'admin, pas de retrieval/embeddings au MVP. Évolution V2 si nécessaire.

### Tracking des coûts

Wrapper `withAITracking()` autour de chaque appel agent → log dans `ai_usage` (feature, provider, model, tokens, coût estimé, durée, statut).

### Sortie structurée garantie

Pour Gemini (responseMimeType + responseSchema) et Anthropic (tool use), on force le JSON structuré matchant le schéma `zod` de chaque agent. Validation côté serveur avant insertion DB. Si invalide → log erreur + retry une fois.

### Pas de streaming au MVP

Les analyses prennent 10-30 sec. UI : loader + polling, pas de stream token-par-token. À ajouter en V2 si demande UX.

### Quota anti-explosion de coût

Variable `MAX_AO_ANALYSES_PER_DAY=20` (défaut). Vérification avant lancement d'une analyse via `count(*) from ai_usage where feature='lecteur_ao' and created_at >= now() - interval '1 day'`. Si dépassé : message « Quota journalier atteint, contactez l'admin ».

---

## 7. Module 1 — Appels d'offres (`/tenders`)

### Accès

`admin` + `manager` complet. `chef_equipe` : item caché de la sidebar.

### Pages

#### `/tenders` — Liste

Server Component. Filtres URL (`?status=ready&search=...`). Table desktop / cards mobile.

| Colonne | Source |
|---|---|
| Titre | `tenders.title` |
| Donneur d'ordre | `tenders.client_name` |
| Échéance | `tenders.deadline` (badge rouge si <7j) |
| Statut | badge coloré |
| Score | `tenders.opportunity_score` (badge vert ≥70 / orange 40-69 / rouge <40) |
| Actions | « Voir » / « Archiver » |

#### `/tenders/new` — Upload

Form 1 étape : `title`, `client_name`, `deadline`, dropzone PDF unique (max 20 MB, type `application/pdf` strict).

Server Action :
1. Crée `tenders` (status `draft`).
2. Upload PDF → bucket `tender-documents/{tender_id}/{filename}`.
3. Crée `tender_documents`.
4. Extrait texte (`pdf-parse`, sync, ~1s).
5. Si extraction vide ou < 200 caractères → status `failed`, `error_msg='scanned_pdf_unsupported'`, message UX clair (pas d'OCR au MVP).
6. Sinon : status `analyzing`.
7. Schedule analyse via `next/server` `after()` → orchestrateur IA en background.
8. Redirect immédiat vers `/tenders/[id]`.

#### `/tenders/[id]` — Vue analyse

**Si status `analyzing`** : loader full-screen + polling 3s sur `/api/tenders/[id]/status`. Stops sur `ready` ou `failed` → `router.refresh()`.

**Si status `failed`** : message d'erreur + bouton « Réessayer » qui re-déclenche l'orchestrateur.

**Si status `ready`** : bandeau (titre, client, échéance, statut, score gauge) + 3 onglets (desktop) / accordéons (mobile) :

1. **Synthèse** : résumé exécutif markdown + lien « Voir le PDF source » (signed URL).
2. **Analyse détaillée** :
   - Contraintes catégorisées (techniques / administratives / délais / qualité), badge `obligatoire`/`recommandé`.
   - Risques avec sévérité + mitigation.
   - Checklist conformité (cochable, state local au MVP).
3. **Mémoire technique** :
   - Markdown rendu (`react-markdown` + `remark-gfm`).
   - Bouton **Copier (Markdown)** — clipboard plain.
   - Bouton **Copier (HTML enrichi)** — `marked` → HTML → `clipboard-write` blob, collable directement dans Word/Outlook avec mise en forme.
   - Bouton **Exporter Word** — lib `docx`, template basique non branded (titre, paragraphes, listes, tableaux). Pas de logo, pas de styles complexes.
   - Bouton **Relancer l'analyse** (admin/manager) — crée nouvelle ligne `tender_analyses` (versions historisées).

### Composants

```
components/tenders/
├─ TenderListTable.tsx
├─ TenderListCards.tsx
├─ TenderUploadDropzone.tsx
├─ TenderAnalysisLoader.tsx
├─ TenderSynthese.tsx
├─ TenderAnalyseDetaillee.tsx
├─ TenderMemoireTechnique.tsx
├─ TenderScoreBadge.tsx
├─ TenderStatusBadge.tsx
└─ TenderExportButtons.tsx          # Markdown / HTML clipboard / Word
```

### Edge cases

| Cas | Réponse |
|---|---|
| PDF scanné | Refus avant IA, message UX |
| Analyse échoue (timeout, JSON invalide) | Status `failed`, bouton « Réessayer » |
| Fichier > 20 MB | Refus client + serveur |
| AO doublon (même titre + même client) | Avertissement non-bloquant |
| Quota IA quotidien dépassé | Message clair, blocage |

---

## 8. Module 2 — Terrain (`/missions`) + PWA

### Accès

| Rôle | Comportement |
|---|---|
| `admin` / `manager` | Crée missions, voit toutes les missions, dashboard global |
| `chef_equipe` | Voit ses missions, exécute (cocher / photo / clôturer / incident) |

À la connexion, `chef_equipe` redirect direct vers `/missions`.

### Pages

#### `/missions` — Liste

**Vue manager/admin (desktop)** :
- Table simple + filtres URL (`?status=in_progress&date=...`).
- Colonnes : date · client · site · chef · statut · incidents (badge si >0).
- Bouton « Nouvelle mission » → drawer création (date, site, chef, notes).
- Stat-cards : `Aujourd'hui`, `En cours`, `Avec incidents`, `Cette semaine`.

**Vue chef_equipe (mobile)** :
- Cards verticales chronologiques.
- Affiche : heure · site · client · adresse (lien `tel:` / Maps) · badge statut.
- Onglets : `Aujourd'hui` (défaut), `Cette semaine`, `Toutes`.

#### `/missions/[id]` — Fiche mission (mobile-first)

Layout vertical, gros tap targets, scroll naturel.

**Section 1 — En-tête**
Client · site · adresse (lien Maps) · date+horaires · gros badge statut.
Bouton primaire contextuel :
- `pending` → **« Démarrer la mission »** (status → `in_progress`, set `started_at`).
- `in_progress` → **« Terminer »** (toujours actionnable, voir clôture).
- `completed` / `issue` → bouton désactivé, date affichée.

**Section 2 — Checklist**
Items cochables. **Tap = persistance immédiate optimistic UI** (pas de bouton « Enregistrer »). Compteur `7/12 terminés`. Seul l'assigné (ou manager/admin) peut cocher.

**Section 3 — Photos**
Deux gros boutons distincts **« Avant »** et **« Après »**. Tap → `<input type="file" accept="image/*" capture="environment">`. Compression client (`browser-image-compression`, max 1600px, qualité 0.7). Upload vers `mission-photos/{mission_id}/{timestamp}-{kind}.jpg`. Galerie 3-cols + lightbox. Suppression possible avant clôture (longpress + confirm).

**Section 4 — Incidents**
Bouton **« Déclarer un incident »** (rouge, secondaire visuellement). Form : sévérité (segmented control), description, photo optionnelle (réutilise composant photo, `kind='incident'`). Liste incidents existants en dessous avec statut résolu/ouvert.

**Section 5 — Notes (collapsible)**
Champ texte libre, autosave au blur.

### Clôture de mission — règle "ne pas bloquer le terrain"

Bouton **« Terminer »** **toujours actionnable**, même checklist 0/12 ou 0 photo après.

**Modale de confirmation conditionnelle** :
- Si checklist incomplète **OU** pas de photos après : modale liste les manquements + champ **« Motif de l'écart »** (recommandé, pas bloquant).
- Si tout est complet : confirmation simple, pas de commentaire demandé.

**Persistance** :
- `missions.completed_at = now()`.
- Si commentaire saisi : `missions.completion_notes = <texte>`.
- Si écart : `missions.closed_with_deviation = true`, status = `issue` (sinon `completed`).
- Si écart : insertion automatique dans `incidents` avec `severity='low'`, `description='Clôture avec écart : <résumé manquements>'`.

→ Permet aux managers de filtrer les missions en écart sur `/admin/monitoring` et de coacher sans punir.

### Composants

```
components/missions/
├─ MissionListTable.tsx
├─ MissionListCards.tsx
├─ MissionStatusBadge.tsx
├─ MissionHeader.tsx
├─ MissionChecklist.tsx
├─ MissionPhotoCapture.tsx
├─ MissionPhotoGallery.tsx
├─ IncidentForm.tsx
├─ IncidentList.tsx
├─ MissionStartButton.tsx
└─ MissionCompleteButton.tsx        # avec modale conditionnelle
```

### PWA — minimale

**Inclus au MVP** :
- `app/manifest.ts` avec icônes 192 et 512 (1 design, pas de variantes maskable / iOS).
- 4 méta tags `apple-mobile-web-app-*` dans `app/layout.tsx`.
- L'app est installable iOS via "Ajouter à l'écran d'accueil".

**Exclu MVP** :
- Service worker (zéro `next-pwa`).
- Cache statique offline.
- Stratégie offline-first sur les missions.
- Icônes maskable / Android adaptive / iOS splash screens custom.

**Détection offline** :
- Hook `useOnlineStatus()`. Si offline → toast persistant « Hors ligne — vos modifications ne seront pas enregistrées tant que la connexion ne reviendra pas. »
- Boutons de mutation désactivés en offline → évite la perte silencieuse de données (pas de queue offline au MVP).

V2 : queue IndexedDB + replay au retour en ligne.

### Edge cases

| Cas | Réponse |
|---|---|
| Connexion lente pendant upload photo | Loader % par photo, retry 1x automatique |
| Coche puis perd réseau | Optimistic UI affiche coché ; si Server Action échoue, toast + rollback visuel |
| Clôture sans photo après | Modale d'avertissement listant manquements, commentaire recommandé |
| Clôture checklist incomplète | Idem |

---

## 9. Module 3 — Rapports (`/reports`)

### Concept

1 mission terminée (`completed` ou `issue`) ↔ 1 rapport (1-to-1). Le rapport ne se génère **pas automatiquement** : un manager le valide et l'exporte à la demande.

### Stratégie de livraison priorisée

| Livrable | Priorité MVP | Implémentation |
|---|---|---|
| **Vue web lecture seule** (`/reports/[id]`) | ✅ obligatoire | HTML standard avec dark/light, lecture-seule |
| **Page imprimable** (`@media print` CSS) | ✅ obligatoire | CSS print rules + bouton « Imprimer » qui déclenche `window.print()` → l'utilisateur peut "Imprimer en PDF" via le navigateur (macOS / Windows / iOS). Suffisant pour 80 % des usages. |
| **Export PDF natif** (`@react-pdf/renderer`) | 🟡 bonus, lot final | Si le temps le permet en fin de cycle. Sinon → V1.1 |

**Justification** : la chaîne `HTML imprimable → "Imprimer en PDF" navigateur` produit un PDF correct sans coût de dev, identique à ce que ferait `@react-pdf/renderer` à 90 %. On ne sacrifie rien d'essentiel en repoussant le PDF natif.

### Pages

**`/reports` — Liste**
Table : date mission · client · site · chef · statut · « Validé par » · actions. Filtres URL (client, période, validé/non).

**`/reports/[id]` — Détail**
Vue lecture seule, agrégation mission, layout pensé **print-friendly dès le départ** :
- Bandeau : client, site, date, chef, statut.
- Section checklist (effectués/non).
- Section photos (grille avant/après, 2-3 cols écran, 2 cols print).
- Section incidents (liste avec sévérité).
- Si clôture en écart : encart visible avec le commentaire.
- Bouton **« Valider le rapport »** (admin/manager) → set `validated_by` + `validated_at`.
- Bouton **« Imprimer / Exporter PDF »** → `window.print()`. CSS `@media print` masque sidebar, topbar, boutons, force fond blanc, paginatione.
- (Bonus si lot final) Bouton **« Télécharger PDF »** → version `@react-pdf/renderer` stockée dans `report-pdfs/`.

### CSS print

Règles minimales :
- `@page { size: A4; margin: 1.5cm; }`
- `@media print { .no-print { display: none; } body { background: white; color: black; } }`
- `.page-break-before` sur les sections > 1 page.
- Photos : `max-height: 8cm` pour rester en pages digestes.

### Génération PDF natif (si livré)

Si on entre dans le scope final :
- Lib `@react-pdf/renderer`. Template `services/reports/pdf-template.tsx`.
- Sections identiques à la vue web.
- Stockage `report-pdfs/{report_id}/{ts}.pdf`. Régénérable.

### Composants

```
components/reports/
├─ ReportListTable.tsx
├─ ReportDetailView.tsx              # avec @media print
├─ ReportValidateButton.tsx
├─ ReportPrintButton.tsx             # window.print()
└─ ReportExportPdfButton.tsx         # bonus, lot final
```

---

## 10. Module 4 — Bibliothèque AGP (`/library`)

### Pourquoi

Sans bibliothèque, l'IA produit du générique creux. Avec bibliothèque, l'IA produit des mémoires techniques **grounded** sur les vraies capacités de l'entreprise (références, effectifs, matériel, certifications). C'est le module qui rend l'IA crédible.

### Accès

`admin` + `manager` complet. `chef_equipe` : aucun accès.

### Modèle de données

**Une seule table `knowledge_items`**, colonnes minimales, pas de sous-tables, pas de 6 CRUD séparés. Schéma défini en §5 :

```sql
knowledge_items (
  id, title, category, content_markdown, file_path, tags,
  created_at, deleted_at
)
```

Le champ `tags text[]` permet de sous-catégoriser librement (ex. `["environnement", "ecolabel"]` sur un item de catégorie `materiel`) sans créer de nouvelles tables. Si plus tard une catégorie justifie sa propre structure, on normalise — pas avant.

### Catégories (6)

| Enum | Libellé UI | Exemple |
|---|---|---|
| `references_clients` | Références clients | "CHU de Toulouse, hospitalier, 12 000 m², 2021-aujourd'hui" |
| `moyens_humains` | Moyens humains | "14 agents CQP APH, 3 chefs d'équipe ISO 9001" |
| `materiel` | Matériel | "Monobrosses Numatic NUC244 (×4, Ecolabel)" |
| `procedures` | Procédures | "Procédure désinfection bloc opératoire — fichier PDF joint" |
| `qualite` | Qualité | "ISO 9001:2015 valide 2027-03-15 ; engagement zéro phyto" |
| `anciens_memoires` | Anciens mémoires techniques | "Mémoire AO 2024 ville de X — gagné" |

Les anciennes catégories que j'avais ajoutées (`engagements_environnementaux`, `arguments_differenciants`, `certifications`) sont **représentables via `tags`** sur la catégorie `qualite` ou `anciens_memoires`. On évite la prolifération d'enums.

### Page `/library` (une seule page)

Layout simple, **pas de sous-pages** :
- Bandeau titre + bouton « + Ajouter un élément ».
- Filtre par catégorie (chips ou select, 6 valeurs) + barre de recherche full-text sur `title` + `content_markdown`.
- Filtre additionnel par tag (chips dynamiques, listés depuis l'agrégation des `tags` existants).
- Tableau : titre · catégorie (badge) · tags (chips) · fichier joint (icône) · créé le · actions (éditer / supprimer).
- Drawer/Modal create/edit avec form `react-hook-form` + `zod` :
  - `title` (text, required)
  - `category` (select, required, 6 options)
  - `content_markdown` (textarea avec preview markdown live, required)
  - `file` (upload optionnel → bucket `library-documents`, type libre PDF / DOCX / image)
  - `tags` (input multi-tags type chips, libre)

Suppression soft (admin peut restaurer via une vue archive future, pas au MVP).

### Comment l'IA consomme la bibliothèque

Service `services/ai/library-context.ts` (cf. §6) :
1. `SELECT * FROM knowledge_items WHERE deleted_at IS NULL`.
2. Groupage par catégorie.
3. Sérialisation markdown structurée :
   ```md
   ## Contexte de l'entreprise

   ### Références clients
   - **CHU de Toulouse** — Hospitalier, 12 000 m², 2021-aujourd'hui...

   ### Moyens humains
   - 14 agents (8 CQP APH, 3 ATQS)...
   ...
   ```
4. Injecté dans le `system prompt` des agents qui en ont besoin (`memoire_technique` au MVP, agents stubs futurs).

**Limite** : ~25k tokens. Au-delà, avertissement admin. Évolution V2 : embeddings + retrieval (Supabase `pgvector`).

### Reproductibilité

`tender_analyses.library_snapshot` stocke le markdown injecté lors de chaque analyse. Permet de comparer les versions d'une même analyse en sachant ce que l'IA avait sous les yeux.

### Composants

```
components/library/
├─ KnowledgeItemTable.tsx           # liste + filtres
├─ KnowledgeItemDrawer.tsx          # create/edit form
├─ KnowledgeItemFileUpload.tsx
├─ KnowledgeCategoryFilter.tsx      # chips de filtre
├─ KnowledgeTagsInput.tsx           # multi-tags chips dans le form
└─ KnowledgeTagsFilter.tsx          # chips dynamiques basés sur les tags existants
```

---

## 11. Design system

### Palette

```ts
// tailwind.config.ts
colors: {
  brand: {
    50:  '#eff6ff',
    600: '#2563eb',   // primary - bleu SaaS
    700: '#1d4ed8',
    900: '#0f172a',
  },
  // sémantique statuts
  pending:     'amber',
  in_progress: 'blue',
  completed:   'emerald',
  issue:       'rose',
}
```

Une seule couleur primaire. Palette neutre + sémantique. Pas de palette arc-en-ciel.

### Typo

- **`Inter`** variable (via `next/font/google`) en sans-serif principal.
- Tailles via Tailwind defaults.
- Police display optionnelle (`Manrope`) pour les gros titres dashboard — décision à l'implémentation.

### Dark mode

`next-themes` + class strategy Tailwind. Toggle dans le topbar. Persistance localStorage. Toutes les couleurs ont leur variante `dark:` dès le départ.

### shadcn/ui — composants utilisés

```
button, card, dialog, drawer, dropdown-menu, input, label,
select, separator, sheet, sonner (toast), table, tabs,
textarea, badge, avatar, skeleton, progress, switch, tooltip
```

~20 composants installés `npx shadcn@latest add <name>` au fil du dev.

### Layout dashboard SaaS

| Zone | Comportement |
|---|---|
| Sidebar gauche desktop | Logo, nav verticale, badge user en bas avec menu déconnexion |
| Topbar | Breadcrumb + theme toggle + actions contextuelles |
| Mobile (manager) | Sidebar masquée, hamburger ouvre `Sheet` shadcn |
| Mobile (chef_equipe) | Bottom nav 3 icônes (Missions, Photos, Profil) |
| `/admin` | Header sombre dédié (pattern EquiPass), pas de sidebar |

### Composants layout

```
components/layout/
├─ AppSidebar.tsx
├─ AppTopbar.tsx
├─ MobileBottomNav.tsx
├─ MobileSheetMenu.tsx
└─ RoleGuard.tsx                    # hide selon rôle
```

---

## 12. Déploiement & dev environment

### Hosting

| Concerne | Choix |
|---|---|
| Frontend Next.js | Vercel (fluid compute pour `after()`) |
| Base + Auth + Storage | Supabase (cloud-hosted, plan gratuit pour démarrer) |
| Migrations DB | Supabase CLI local + push cloud |
| Domain | À configurer plus tard |

### Variables d'environnement

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# AI
AI_PROVIDER=mock                    # mock | gemini | anthropic
GOOGLE_GENAI_API_KEY=
ANTHROPIC_API_KEY=
AI_MODEL_LIGHT=gemini-2.5-flash
AI_MODEL_HEAVY=gemini-2.5-pro

# Bootstrap
INITIAL_ADMIN_EMAIL=
INITIAL_ADMIN_PASSWORD=

# Limites coûts
MAX_AO_ANALYSES_PER_DAY=20
```

### Workflow dev local

```bash
git clone <repo>
npm install
npx supabase start                  # Postgres + Auth + Storage Docker
npx supabase db reset               # applique migrations + seed
cp .env.example .env.local          # remplir
npm run dev                         # http://localhost:3000
```

### Tests CI (GitHub Actions)

- `eslint` + `tsc --noEmit`
- `vitest run` (~15-25 tests ciblés)
- `next build`

Pas de E2E Playwright au MVP.

---

## 13. Stack & libs

### Production

```
next@15
react@19
typescript@5
tailwindcss@4
@supabase/supabase-js
@supabase/ssr
zod
react-hook-form
@hookform/resolvers
next-themes
@react-pdf/renderer            # PDF rapport mission — installé seulement si livré en lot final, sinon V1.1
docx                           # export Word mémoire technique simple
pdf-parse                      # extraction texte PDF AO
browser-image-compression
@google/genai                  # Gemini SDK
@anthropic-ai/sdk              # Anthropic SDK
react-markdown
remark-gfm
marked                         # markdown → HTML pour clipboard enrichi
sonner                         # toasts
```

### Dev / build

```
vitest
@vitejs/plugin-react
@testing-library/react
eslint
eslint-config-next
prettier
```

### Libs explicitement écartées du MVP

| Lib | Raison |
|---|---|
| `next-pwa` | Pas de service worker au MVP |
| `@tanstack/react-query` | Server Actions + revalidatePath suffisent |
| `redux` / `zustand` | URL + Server Components + useState local suffisent |
| `puppeteer-core` | `@react-pdf/renderer` plus simple |
| `inngest` / `trigger.dev` | `next/server` `after()` suffit |

---

## 14. Tests ciblés

~15-25 tests Vitest sur la logique critique. Suggestions de couverture :

| Zone | Tests |
|---|---|
| `services/ai/providers/mock.ts` | Forme du retour, schéma valide |
| `services/ai/orchestrator.ts` | Flow phase 1 → 2 → 3, gestion d'erreur |
| `services/ai/library-context.ts` | Sérialisation markdown groupée par catégorie, exclusion `deleted_at` |
| `services/pdf/extract.ts` | PDF texte OK, PDF scanné détecté |
| `services/reports/generator.ts` | PDF généré avec sections présentes |
| `lib/db/missions.ts` | Clôture avec écart insère un incident |
| RLS policies | Tests d'intégration : chef_equipe ne voit pas les missions d'un autre |
| Server Actions tenders | Refus PDF > 20MB, refus PDF scanné, quota dépassé |

---

## 15. Hors-scope MVP / V2+

Repoussé volontairement :

- **Multi-tenant** (companies, RLS company_id, sous-domaines).
- **OCR** sur PDFs scannés.
- **Streaming token-par-token** sur les analyses.
- **Templates de checklist** réutilisables.
- **Multi-fichiers AO** (UI verrouillée à 1 PDF, schéma supporte).
- **Service worker / offline-first** (queue IndexedDB + replay).
- **Export PDF mémoire technique** branded.
- **Embeddings + retrieval** sur la bibliothèque AGP.
- **Activation des 4 agents stubs** (`conformite`, `contradicteur`, `financier`, `terrain`).
- **Notifications** (email, push, in-app).
- **Analytics / monitoring** au-delà de `/admin/monitoring` basique.
- **Signature numérique** sur les rapports.
- **Multi-fichiers AO upload simultané**.
- **Tests E2E Playwright**.

Toutes ces évolutions sont **architecturalement compatibles** avec le MVP — pas de refacto bloquante anticipée.

---

## 16. Acceptance criteria du MVP

Le MVP est livré quand :

- [ ] Un admin peut s'authentifier via `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD`.
- [ ] Un admin peut inviter un manager et un chef_equipe par email, ils reçoivent un mail Supabase, définissent leur mot de passe, et arrivent dans l'app avec leurs droits.
- [ ] Un manager peut créer un client, un site, une mission, l'assigner à un chef d'équipe.
- [ ] Le chef d'équipe voit sa mission sur mobile, démarre, coche la checklist en optimistic UI, prend des photos avant/après, déclare un incident, clôture en écart avec commentaire, et l'incident "écart" est tracé.
- [ ] Un manager voit la mission clôturée en écart sur `/missions` et `/admin/monitoring`.
- [ ] Un manager peut voir le rapport HTML de la mission terminée, le valider, et l'imprimer / l'exporter en PDF via le navigateur (CSS `@media print`). Export PDF natif via `@react-pdf/renderer` en bonus si temps disponible en lot final.
- [ ] Un manager peut créer/éditer/supprimer des éléments dans `/library` (CRUD knowledge_items).
- [ ] Un manager peut uploader un PDF d'AO non scanné, l'analyse IA tourne (en mode `mock` ou `gemini`), produit un résumé, des contraintes, des risques, une checklist, un score d'opportunité, une mémoire technique grounded sur la bibliothèque.
- [ ] Le manager peut copier la mémoire en markdown ou HTML enrichi (collable Word/Outlook), et l'exporter en .docx simple.
- [ ] L'app est installable comme PWA sur iOS et Android (manifest only).
- [ ] Le mode `mock` permet de faire tourner toute l'app sans aucune clé IA.
- [ ] Le switch vers `gemini` se fait par changement d'env var, sans recompilation.
- [ ] Les RLS Supabase empêchent un chef_equipe de voir les missions d'un autre.
- [ ] Lint + tests Vitest + build passent en CI.

---

## 17. Notes pour le plan d'implémentation

Ordre suggéré (à finaliser dans le plan d'implémentation) :

1. Setup projet (Next.js, Tailwind, shadcn, Supabase, env, scripts).
2. Migrations DB + seed admin + RLS.
3. Auth + middleware + layout SaaS + zone admin (réutilise patterns EquiPass).
4. Module 4 — Bibliothèque AGP (CRUD simple, prérequis pour le module 1 utile).
5. Couche IA — provider mock + interface + orchestrateur + 3 agents.
6. Module 1 — AO (upload, polling, vue analyse, exports markdown/HTML/Word).
7. Module 2 — Missions (liste, fiche, photos, checklist, incidents, clôture en écart) + PWA manifest.
8. Module 3 — Rapports : vue HTML lecture seule + validation + page imprimable (`@media print`). PDF natif via `@react-pdf/renderer` **uniquement** si on a le temps en lot final.
9. Tests Vitest ciblés + CI.
10. Polish, dark mode, edge cases.

**Règle de priorité scope** : si on doit couper, on coupe d'abord le PDF natif rapport (Module 3), puis les éléments « lot final » du Module 1 (Word export, on garde Copier markdown/HTML), puis les composants UI cosmétiques. **Jamais** la bibliothèque, jamais l'orchestrateur IA, jamais la clôture mission avec écart.

Le découpage exact (étapes implémentables en isolation, agents en parallèle, points de checkpoint) est l'objet du plan d'implémentation, à écrire en suivant.
