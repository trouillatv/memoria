# Plan 1 / 5 — Fondations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mettre en place l'infrastructure complète sur laquelle les modules métier (Bibliothèque, IA+AO, Terrain, Rapports) viendront se brancher : projet Next.js initialisé, base Supabase migrée avec toutes les tables et RLS, authentification fonctionnelle (login + invitation), layout SaaS responsive, zone admin opérationnelle (gestion utilisateurs + monitoring audit logs), PWA installable. Pas de logique métier dans ce plan.

**Architecture:** Next.js 15 (App Router) + Server Actions, Supabase (DB Postgres + Auth + Storage), Tailwind v4 + shadcn/ui. Tous les accès DB passent par `lib/db/*.ts` (multi-tenant readiness). Tous les événements sensibles passent par `lib/audit/log.ts`. Pas de state global, validation `zod` partout.

**Tech Stack:** `next@15`, `react@19`, `typescript@5`, `tailwindcss@4`, `@supabase/supabase-js`, `@supabase/ssr`, `zod`, `react-hook-form`, `next-themes`, `sonner`, `vitest`, shadcn/ui (~20 composants).

**Spec de référence:** `docs/superpowers/specs/2026-05-09-memoria-mvp-design.md` (sections 3, 4, 5, 11, 12).

---

## Structure de fichiers à créer

```
.
├─ app/
│  ├─ (auth)/
│  │  ├─ layout.tsx
│  │  ├─ login/page.tsx
│  │  ├─ accept-invite/page.tsx
│  │  └─ change-password/page.tsx
│  ├─ (dashboard)/
│  │  └─ layout.tsx
│  ├─ admin/
│  │  ├─ layout.tsx
│  │  ├─ page.tsx                  # redirect → /admin/users
│  │  ├─ users/
│  │  │  ├─ page.tsx
│  │  │  ├─ CreateUserForm.tsx
│  │  │  ├─ UserRoleSelect.tsx
│  │  │  ├─ ForcePasswordResetButton.tsx
│  │  │  └─ DeleteUserButton.tsx
│  │  └─ monitoring/page.tsx
│  ├─ layout.tsx
│  ├─ globals.css
│  └─ manifest.ts
├─ components/
│  ├─ ui/                          # shadcn install destinations
│  ├─ layout/
│  │  ├─ AppSidebar.tsx
│  │  ├─ AppTopbar.tsx
│  │  ├─ LogoutButton.tsx
│  │  ├─ MobileBottomNav.tsx
│  │  ├─ MobileSheetMenu.tsx
│  │  ├─ RoleGuard.tsx
│  │  └─ ThemeToggle.tsx
│  └─ providers/
│     └─ ThemeProvider.tsx
├─ lib/
│  ├─ supabase/
│  │  ├─ client.ts
│  │  ├─ server.ts
│  │  └─ admin.ts
│  ├─ db/
│  │  ├─ users.ts
│  │  └─ activity-logs.ts
│  ├─ audit/
│  │  └─ log.ts
│  └─ utils.ts
├─ types/
│  └─ db.ts                        # types Supabase générés ou hand-typed
├─ middleware.ts
├─ supabase/
│  ├─ config.toml                  # généré par supabase init
│  └─ migrations/
│     ├─ 001_enums.sql
│     ├─ 002_users.sql
│     ├─ 003_clients_sites.sql
│     ├─ 004_missions.sql
│     ├─ 005_tenders.sql
│     ├─ 006_reports.sql
│     ├─ 007_knowledge_items.sql
│     ├─ 008_ai_usage.sql
│     ├─ 009_activity_logs.sql
│     ├─ 010_buckets.sql
│     ├─ 011_rls_policies.sql
│     ├─ 012_triggers.sql
│     └─ 013_seed_admin.sql
├─ tests/
│  ├─ setup.ts
│  └─ smoke/
│     └─ middleware.test.ts
├─ .github/workflows/ci.yml
├─ .env.example
├─ .gitignore
├─ next.config.ts
├─ tailwind.config.ts
├─ tsconfig.json
├─ vitest.config.ts
└─ package.json
```

---

## Task 1 : Bootstrap projet Next.js 15

**Files:**
- Create: `package.json` (et tous les fichiers config Next.js générés)
- Create: `.gitignore`
- Create: `.env.example`
- Create: `tsconfig.json`
- Create: `next.config.ts`

- [ ] **Step 1.1 : Créer le projet Next.js**

Run depuis le dossier parent (`/Users/Aurelie/Documents/MemorIA` est déjà le répertoire de travail, mais comme `create-next-app` veut un nom de dossier, on va passer par `--ts` direct dans le dossier courant) :

```bash
npx create-next-app@latest . \
  --typescript \
  --tailwind \
  --app \
  --no-src-dir \
  --import-alias "@/*" \
  --use-npm \
  --eslint
```

Réponses attendues : « Yes » à tout. Confirmer écraser les fichiers existants si demandé (le dossier `docs/` doit être préservé — vérifier après).

Si la CLI insiste pour un dossier vide, utiliser `npx create-next-app@latest memoria-tmp ...` puis `cp -r memoria-tmp/* . && cp -r memoria-tmp/.* . 2>/dev/null ; rm -rf memoria-tmp`. Vérifier que `docs/` et `.git/` sont intacts.

- [ ] **Step 1.2 : Vérifier le résultat**

Run :
```bash
ls -la
ls docs/superpowers/specs/
```

Attendu : `package.json`, `next.config.ts` ou `.js`, `app/`, `tsconfig.json`, `tailwind.config.ts` (ou `postcss.config.mjs` selon Tailwind v4 setup) présents. Le doc spec et le dossier `docs/` doivent être intacts. `.git` toujours présent.

- [ ] **Step 1.3 : Installer les libs runtime du Plan 1**

Run :
```bash
npm install @supabase/supabase-js @supabase/ssr zod react-hook-form @hookform/resolvers next-themes sonner
npm install -D @types/node tsx
```

- [ ] **Step 1.4 : Créer `.env.example`**

Créer le fichier `.env.example` avec ce contenu exact :

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# AI providers (vides au Plan 1, remplis aux plans suivants)
AI_PROVIDER=mock
GOOGLE_GENAI_API_KEY=
ANTHROPIC_API_KEY=
AI_MODEL_LIGHT=gemini-2.5-flash
AI_MODEL_HEAVY=gemini-2.5-pro

# Bootstrap admin
INITIAL_ADMIN_EMAIL=admin@memoria.nc
INITIAL_ADMIN_PASSWORD=memoria2026

# Quotas
MAX_AO_ANALYSES_PER_DAY=20
```

Et copier vers `.env.local` :

```bash
cp .env.example .env.local
```

- [ ] **Step 1.5 : Compléter `.gitignore`**

Vérifier que `.env.local`, `.env*.local`, `node_modules`, `.next`, `coverage`, `supabase/.branches`, `supabase/.temp` sont dans `.gitignore`. Si manquant, ajouter :

```
# Local env files
.env
.env.local
.env.*.local

# Supabase local
supabase/.branches
supabase/.temp
```

- [ ] **Step 1.6 : Vérifier que le dev server démarre**

Run :
```bash
npm run dev
```

Attendu : démarre sans erreur sur `http://localhost:3000`. Stopper avec Ctrl+C une fois confirmé.

- [ ] **Step 1.7 : Commit**

```bash
git add -A
git commit -m "chore: bootstrap Next.js 15 + TypeScript + Tailwind + libs runtime"
```

---

## Task 2 : Tailwind v4 + shadcn/ui + thème SaaS

**Files:**
- Modify: `app/globals.css`
- Create: `components/providers/ThemeProvider.tsx`
- Modify: `app/layout.tsx`
- Create: `lib/utils.ts`
- Create: `components.json` (généré par shadcn)
- Create (via shadcn): `components/ui/button.tsx`, `components/ui/card.tsx`, etc.

- [ ] **Step 2.1 : Configurer la palette dans `app/globals.css`**

Tailwind v4 utilise une config CSS-first. Ouvrir `app/globals.css` et remplacer son contenu par :

```css
@import "tailwindcss";

@theme {
  --color-brand-50:  #eff6ff;
  --color-brand-100: #dbeafe;
  --color-brand-500: #3b82f6;
  --color-brand-600: #2563eb;
  --color-brand-700: #1d4ed8;
  --color-brand-900: #0f172a;

  --color-pending-bg:     #fef3c7;
  --color-pending-fg:     #92400e;
  --color-in_progress-bg: #dbeafe;
  --color-in_progress-fg: #1e40af;
  --color-completed-bg:   #d1fae5;
  --color-completed-fg:   #065f46;
  --color-issue-bg:       #ffe4e6;
  --color-issue-fg:       #9f1239;
}

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 47.4% 11.2%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 47.4% 11.2%;
    --popover: 0 0% 100%;
    --popover-foreground: 222.2 47.4% 11.2%;
    --primary: 221.2 83.2% 53.3%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 221.2 83.2% 53.3%;
    --radius: 0.5rem;
  }

  .dark {
    --background: 222.2 47.4% 11.2%;
    --foreground: 210 40% 98%;
    --card: 222.2 47.4% 11.2%;
    --card-foreground: 210 40% 98%;
    --popover: 222.2 47.4% 11.2%;
    --popover-foreground: 210 40% 98%;
    --primary: 217.2 91.2% 59.8%;
    --primary-foreground: 222.2 47.4% 11.2%;
    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
    --accent: 217.2 32.6% 17.5%;
    --accent-foreground: 210 40% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;
    --border: 217.2 32.6% 17.5%;
    --input: 217.2 32.6% 17.5%;
    --ring: 224.3 76.3% 48%;
  }

  * {
    border-color: hsl(var(--border));
  }
  body {
    background-color: hsl(var(--background));
    color: hsl(var(--foreground));
  }
}
```

- [ ] **Step 2.2 : Initialiser shadcn/ui**

Run :
```bash
npx shadcn@latest init -y --base-color slate
```

Si questions interactives : New York / Slate / yes CSS variables / `app/globals.css` / OK aliases défaut.

- [ ] **Step 2.3 : Installer les composants shadcn nécessaires au Plan 1**

Run :
```bash
npx shadcn@latest add button card input label dialog drawer dropdown-menu select separator sheet sonner table tabs textarea badge avatar skeleton progress switch tooltip
```

(Si certains composants posent question — ex. `sonner` veut installer la lib — répondre yes.)

Vérifier : `ls components/ui/` doit lister ~20 fichiers `.tsx`.

- [ ] **Step 2.4 : Créer `components/providers/ThemeProvider.tsx`**

```tsx
"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"

export function ThemeProvider({ children, ...props }: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}
```

- [ ] **Step 2.5 : Configurer `app/layout.tsx`**

Remplacer son contenu par :

```tsx
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import { Toaster } from "@/components/ui/sonner"
import { ThemeProvider } from "@/components/providers/ThemeProvider"
import "./globals.css"

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })

export const metadata: Metadata = {
  title: "MemorIA",
  description: "Gestion terrain & appels d'offres pour entreprises de nettoyage",
  appleWebApp: {
    capable: true,
    title: "MemorIA",
    statusBarStyle: "black-translucent",
  },
}

export const viewport = {
  themeColor: "#0f172a",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
```

- [ ] **Step 2.6 : Vérifier que ça build et tourne**

Run :
```bash
npm run dev
```

Ouvrir `http://localhost:3000` — page par défaut Next.js doit s'afficher. Pas d'erreur console. Stop.

Run aussi :
```bash
npx tsc --noEmit
```

Attendu : aucune erreur TS.

- [ ] **Step 2.7 : Commit**

```bash
git add -A
git commit -m "feat: setup Tailwind v4 theme + shadcn/ui (~20 composants) + dark/light mode"
```

---

## Task 3 : Supabase local + scripts package.json

**Files:**
- Create: `supabase/config.toml` (généré par `supabase init`)
- Modify: `package.json` (scripts)

- [ ] **Step 3.1 : Vérifier que Supabase CLI est installé**

Run :
```bash
npx supabase --version
```

Attendu : version >= 1.150. Si non installé, npx s'en charge automatiquement à la première commande.

- [ ] **Step 3.2 : Initialiser Supabase**

Run :
```bash
npx supabase init
```

Répondre par défaut à toutes les questions (oui à `Generate VS Code settings` si proposé, oui à `Generate IntelliJ Settings` si proposé — peu importe).

Vérifier : `ls supabase/` montre `config.toml`, `migrations/` (peut être vide), `seed.sql` peut-être présent.

- [ ] **Step 3.3 : Démarrer Supabase local**

Run :
```bash
npx supabase start
```

Patient, première fois : pull les images Docker (~5 min). À la fin, affiche les URLs locales : API URL, DB URL, Studio URL, JWT secret, anon key, service_role key.

**Important** : copier les valeurs `API URL`, `anon key`, `service_role key` dans `.env.local` :
```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key affichée>
SUPABASE_SERVICE_ROLE_KEY=<service_role key affichée>
```

- [ ] **Step 3.4 : Ajouter les scripts au `package.json`**

Ouvrir `package.json` et ajouter dans `scripts` :

```json
{
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:start":  "supabase start",
    "db:stop":   "supabase stop",
    "db:reset":  "supabase db reset",
    "db:types":  "supabase gen types typescript --local > types/db.generated.ts"
  }
}
```

- [ ] **Step 3.5 : Vérifier que la DB locale répond**

Run :
```bash
npm run db:reset
```

Attendu : applique les migrations (vides pour l'instant), aucune erreur. La DB est prête à recevoir nos migrations.

- [ ] **Step 3.6 : Commit**

```bash
git add supabase/ package.json
git commit -m "chore: init Supabase local + scripts npm"
```

---

## Task 4 : Migrations DB — schéma complet

**Files:**
- Create: `supabase/migrations/001_enums.sql`
- Create: `supabase/migrations/002_users.sql`
- Create: `supabase/migrations/003_clients_sites.sql`
- Create: `supabase/migrations/004_missions.sql`
- Create: `supabase/migrations/005_tenders.sql`
- Create: `supabase/migrations/006_reports.sql`
- Create: `supabase/migrations/007_knowledge_items.sql`
- Create: `supabase/migrations/008_ai_usage.sql`
- Create: `supabase/migrations/009_activity_logs.sql`

- [ ] **Step 4.1 : Créer `001_enums.sql`**

```sql
-- Tous les enums du domaine MemorIA

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

- [ ] **Step 4.2 : Créer `002_users.sql`**

```sql
-- Extension de auth.users avec rôle métier et statut MdP

create table public.users (
  id                   uuid primary key references auth.users(id) on delete cascade,
  email                text not null,
  full_name            text,
  role                 user_role not null default 'chef_equipe',
  must_change_password boolean default false,
  created_at           timestamptz default now(),
  deleted_at           timestamptz
);

create index users_role_idx on public.users(role) where deleted_at is null;
```

- [ ] **Step 4.3 : Créer `003_clients_sites.sql`**

```sql
-- Clients (donneurs d'ordre du nettoyeur) et leurs sites d'intervention

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

create index clients_name_idx on public.clients(name) where deleted_at is null;

create table public.sites (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  name       text not null,
  address    text,
  notes      text,
  created_at timestamptz default now(),
  deleted_at timestamptz
);

create index sites_client_idx on public.sites(client_id) where deleted_at is null;
```

- [ ] **Step 4.4 : Créer `004_missions.sql`**

```sql
-- Missions terrain + checklist + photos + incidents

create table public.missions (
  id                    uuid primary key default gen_random_uuid(),
  site_id               uuid not null references sites(id) on delete restrict,
  scheduled_date        date not null,
  scheduled_start       time,
  scheduled_end         time,
  assigned_to           uuid references public.users(id) on delete set null,
  status                mission_status not null default 'pending',
  notes                 text,
  completion_notes      text,
  closed_with_deviation boolean default false,
  started_at            timestamptz,
  completed_at          timestamptz,
  created_by            uuid not null references public.users(id),
  created_at            timestamptz default now(),
  deleted_at            timestamptz
);

create index missions_assigned_to_idx    on public.missions(assigned_to) where deleted_at is null;
create index missions_status_idx         on public.missions(status)      where deleted_at is null;
create index missions_scheduled_date_idx on public.missions(scheduled_date) where deleted_at is null;

create table public.mission_checklist_items (
  id         uuid primary key default gen_random_uuid(),
  mission_id uuid not null references missions(id) on delete cascade,
  label      text not null,
  position   int  not null,
  is_done    boolean default false,
  done_at    timestamptz,
  done_by    uuid references public.users(id) on delete set null
);

create index mission_checklist_items_mission_idx on public.mission_checklist_items(mission_id);

create table public.mission_photos (
  id           uuid primary key default gen_random_uuid(),
  mission_id   uuid not null references missions(id) on delete cascade,
  storage_path text not null,
  kind         text not null check (kind in ('before', 'after', 'incident', 'other')),
  caption      text,
  taken_at     timestamptz default now(),
  taken_by     uuid references public.users(id) on delete set null
);

create index mission_photos_mission_idx on public.mission_photos(mission_id);

create table public.incidents (
  id          uuid primary key default gen_random_uuid(),
  mission_id  uuid not null references missions(id) on delete cascade,
  severity    incident_severity not null default 'medium',
  description text not null,
  resolved_at timestamptz,
  reported_by uuid references public.users(id) on delete set null,
  created_at  timestamptz default now()
);

create index incidents_mission_idx on public.incidents(mission_id);
```

- [ ] **Step 4.5 : Créer `005_tenders.sql`**

```sql
-- Appels d'offres + documents + analyses IA versionnées

create table public.tenders (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  client_name       text,
  deadline          date,
  status            tender_status not null default 'draft',
  opportunity_score int,
  error_msg         text,
  created_by        uuid not null references public.users(id),
  created_at        timestamptz default now(),
  deleted_at        timestamptz
);

create index tenders_status_idx on public.tenders(status) where deleted_at is null;

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

create index tender_documents_tender_idx on public.tender_documents(tender_id);

create table public.tender_analyses (
  id               uuid primary key default gen_random_uuid(),
  tender_id        uuid not null references tenders(id) on delete cascade,
  provider         ai_provider not null,
  model            text,
  prompt_versions  jsonb,
  summary          text,
  constraints      jsonb,
  risks            jsonb,
  checklist        jsonb,
  technical_memo   text,
  library_snapshot jsonb,
  raw_response     jsonb,
  created_at       timestamptz default now()
);

create index tender_analyses_tender_idx on public.tender_analyses(tender_id);
```

- [ ] **Step 4.6 : Créer `006_reports.sql`**

```sql
-- Rapports de mission (1 mission ↔ 1 rapport au plus)

create table public.reports (
  id               uuid primary key default gen_random_uuid(),
  mission_id       uuid not null unique references missions(id) on delete cascade,
  validated_by     uuid references public.users(id) on delete set null,
  validated_at     timestamptz,
  pdf_storage_path text,
  notes            text,
  created_at       timestamptz default now()
);
```

- [ ] **Step 4.7 : Créer `007_knowledge_items.sql`**

```sql
-- Bibliothèque AGP — table unifiée minimale

create table public.knowledge_items (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  category         knowledge_category not null,
  content_markdown text not null,
  file_path        text,
  tags             text[],
  created_at       timestamptz default now(),
  deleted_at       timestamptz
);

create index knowledge_items_category_idx on public.knowledge_items(category) where deleted_at is null;
create index knowledge_items_tags_idx     on public.knowledge_items using gin(tags) where deleted_at is null;
```

- [ ] **Step 4.8 : Créer `008_ai_usage.sql`**

```sql
-- Logs d'usage IA (tracking coût par feature/agent)

create table public.ai_usage (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.users(id) on delete set null,
  feature       text not null,
  provider      ai_provider not null,
  model         text,
  input_tokens  int,
  output_tokens int,
  cost_usd      numeric(10, 6),
  duration_ms   int,
  status        text not null,
  error_msg     text,
  created_at    timestamptz default now()
);

create index ai_usage_user_idx       on public.ai_usage(user_id);
create index ai_usage_created_at_idx on public.ai_usage(created_at desc);
create index ai_usage_feature_idx    on public.ai_usage(feature);
```

- [ ] **Step 4.9 : Créer `009_activity_logs.sql`**

```sql
-- Audit trail minimal — 7 événements sensibles

create table public.activity_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.users(id) on delete set null,
  entity_type text not null,
  entity_id   uuid,
  action      text not null,
  metadata    jsonb,
  created_at  timestamptz default now()
);

create index activity_logs_entity_idx     on public.activity_logs(entity_type, entity_id);
create index activity_logs_created_at_idx on public.activity_logs(created_at desc);
create index activity_logs_user_idx       on public.activity_logs(user_id);
```

- [ ] **Step 4.10 : Appliquer les migrations**

Run :
```bash
npm run db:reset
```

Attendu : « Resetting local database… Applying migration 001_enums.sql… 002_users.sql… [...] 009_activity_logs.sql… Finished ». Aucune erreur.

- [ ] **Step 4.11 : Vérifier le schéma via Studio**

Ouvrir `http://127.0.0.1:54323` (Supabase Studio local). Aller dans `Table Editor` → schema `public` → vérifier que les 13 tables apparaissent : users, clients, sites, missions, mission_checklist_items, mission_photos, incidents, tenders, tender_documents, tender_analyses, reports, knowledge_items, ai_usage, activity_logs.

- [ ] **Step 4.12 : Commit**

```bash
git add supabase/migrations/
git commit -m "feat(db): migrations 001-009 — schéma complet (13 tables, 6 enums)"
```

---

## Task 5 : Migrations buckets + RLS + triggers + seed admin

**Files:**
- Create: `supabase/migrations/010_buckets.sql`
- Create: `supabase/migrations/011_rls_policies.sql`
- Create: `supabase/migrations/012_triggers.sql`
- Create: `supabase/migrations/013_seed_admin.sql`

- [ ] **Step 5.1 : Créer `010_buckets.sql`**

```sql
-- Buckets Supabase Storage (privés, signed URLs depuis l'app)

insert into storage.buckets (id, name, public) values
  ('tender-documents',  'tender-documents',  false),
  ('mission-photos',    'mission-photos',    false),
  ('report-pdfs',       'report-pdfs',       false),
  ('library-documents', 'library-documents', false);

-- Storage policies : authenticated users only, par défaut.
-- Les Server Actions utilisant SUPABASE_SERVICE_ROLE_KEY bypassent les RLS.

create policy "tender-documents read for authenticated"
  on storage.objects for select
  using (bucket_id = 'tender-documents' and auth.role() = 'authenticated');

create policy "mission-photos read for authenticated"
  on storage.objects for select
  using (bucket_id = 'mission-photos' and auth.role() = 'authenticated');

create policy "report-pdfs read for authenticated"
  on storage.objects for select
  using (bucket_id = 'report-pdfs' and auth.role() = 'authenticated');

create policy "library-documents read for authenticated"
  on storage.objects for select
  using (bucket_id = 'library-documents' and auth.role() = 'authenticated');
```

- [ ] **Step 5.2 : Créer `011_rls_policies.sql`**

```sql
-- RLS partout, avec patterns adaptés au rôle JWT

-- Helper function : récupère le rôle depuis le JWT
create or replace function public.current_user_role()
  returns user_role
  language sql
  security definer
  stable
as $$
  select coalesce(
    (auth.jwt()->'app_metadata'->>'role')::user_role,
    'chef_equipe'::user_role
  )
$$;

-- ============================================================
-- users
-- ============================================================
alter table public.users enable row level security;

create policy "users self read" on public.users
  for select using (id = auth.uid() or public.current_user_role() in ('admin', 'manager'));

create policy "users admin manage" on public.users
  for all using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- ============================================================
-- clients
-- ============================================================
alter table public.clients enable row level security;

create policy "clients authenticated read" on public.clients
  for select using (auth.role() = 'authenticated');

create policy "clients manager admin write" on public.clients
  for all using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));

-- ============================================================
-- sites
-- ============================================================
alter table public.sites enable row level security;

create policy "sites authenticated read" on public.sites
  for select using (auth.role() = 'authenticated');

create policy "sites manager admin write" on public.sites
  for all using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));

-- ============================================================
-- missions
-- ============================================================
alter table public.missions enable row level security;

-- chef_equipe voit ses missions, manager/admin voient tout
create policy "missions visible by role" on public.missions
  for select using (
    public.current_user_role() in ('admin', 'manager')
    or assigned_to = auth.uid()
  );

create policy "missions manager admin write" on public.missions
  for all using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));

-- chef_equipe peut update sa propre mission (status, completion_notes)
create policy "missions assignee update" on public.missions
  for update using (assigned_to = auth.uid())
  with check (assigned_to = auth.uid());

-- ============================================================
-- mission_checklist_items, mission_photos, incidents
-- (visibilité dérivée de la mission parente)
-- ============================================================
alter table public.mission_checklist_items enable row level security;
alter table public.mission_photos          enable row level security;
alter table public.incidents               enable row level security;

create policy "checklist visible via mission" on public.mission_checklist_items
  for select using (
    exists (
      select 1 from public.missions m
       where m.id = mission_checklist_items.mission_id
         and (public.current_user_role() in ('admin', 'manager') or m.assigned_to = auth.uid())
    )
  );

create policy "checklist write via mission" on public.mission_checklist_items
  for all using (
    exists (
      select 1 from public.missions m
       where m.id = mission_checklist_items.mission_id
         and (public.current_user_role() in ('admin', 'manager') or m.assigned_to = auth.uid())
    )
  );

create policy "photos visible via mission" on public.mission_photos
  for select using (
    exists (
      select 1 from public.missions m
       where m.id = mission_photos.mission_id
         and (public.current_user_role() in ('admin', 'manager') or m.assigned_to = auth.uid())
    )
  );

create policy "photos write via mission" on public.mission_photos
  for all using (
    exists (
      select 1 from public.missions m
       where m.id = mission_photos.mission_id
         and (public.current_user_role() in ('admin', 'manager') or m.assigned_to = auth.uid())
    )
  );

create policy "incidents visible via mission" on public.incidents
  for select using (
    exists (
      select 1 from public.missions m
       where m.id = incidents.mission_id
         and (public.current_user_role() in ('admin', 'manager') or m.assigned_to = auth.uid())
    )
  );

create policy "incidents write via mission" on public.incidents
  for all using (
    exists (
      select 1 from public.missions m
       where m.id = incidents.mission_id
         and (public.current_user_role() in ('admin', 'manager') or m.assigned_to = auth.uid())
    )
  );

-- ============================================================
-- tenders + documents + analyses (manager + admin only)
-- ============================================================
alter table public.tenders          enable row level security;
alter table public.tender_documents enable row level security;
alter table public.tender_analyses  enable row level security;

create policy "tenders manager admin all" on public.tenders
  for all using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));

create policy "tender_documents manager admin all" on public.tender_documents
  for all using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));

create policy "tender_analyses manager admin all" on public.tender_analyses
  for all using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));

-- ============================================================
-- reports (manager + admin write, all read)
-- ============================================================
alter table public.reports enable row level security;

create policy "reports authenticated read" on public.reports
  for select using (auth.role() = 'authenticated');

create policy "reports manager admin write" on public.reports
  for all using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));

-- ============================================================
-- knowledge_items (manager + admin)
-- ============================================================
alter table public.knowledge_items enable row level security;

create policy "knowledge manager admin all" on public.knowledge_items
  for all using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));

-- ============================================================
-- ai_usage (admin read seulement, écriture par service role)
-- ============================================================
alter table public.ai_usage enable row level security;

create policy "ai_usage admin read" on public.ai_usage
  for select using (public.current_user_role() = 'admin');

-- ============================================================
-- activity_logs (admin/manager read, écriture par service role)
-- ============================================================
alter table public.activity_logs enable row level security;

create policy "activity_logs admin manager read" on public.activity_logs
  for select using (public.current_user_role() in ('admin', 'manager'));
```

- [ ] **Step 5.3 : Créer `012_triggers.sql`**

```sql
-- Synchronise users.role → auth.users.app_metadata.role pour usage dans le JWT

create or replace function public.sync_user_role_to_jwt()
  returns trigger
  language plpgsql
  security definer
as $$
begin
  update auth.users
     set raw_app_meta_data =
       coalesce(raw_app_meta_data, '{}'::jsonb)
       || jsonb_build_object('role', new.role::text)
   where id = new.id;
  return new;
end;
$$;

create trigger on_user_role_change
  after insert or update of role on public.users
  for each row
  execute function public.sync_user_role_to_jwt();

-- Trigger pour s'assurer qu'une row public.users existe pour chaque auth.users
create or replace function public.handle_new_auth_user()
  returns trigger
  language plpgsql
  security definer
as $$
begin
  insert into public.users (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'chef_equipe')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_auth_user();
```

- [ ] **Step 5.4 : Créer `013_seed_admin.sql`**

```sql
-- Seed admin initial (idempotent : ne fait rien si admin déjà créé)
-- Le mot de passe lu depuis la variable d'env sera défini via un script Node post-migration

do $$
declare
  admin_email text := current_setting('app.settings.initial_admin_email', true);
begin
  -- En local, on hardcode pour faciliter le démarrage si la variable n'est pas posée
  if admin_email is null or admin_email = '' then
    admin_email := 'admin@memoria.nc';
  end if;

  -- L'insertion réelle de l'utilisateur dans auth.users se fait via un script Node,
  -- car la création d'un user Supabase Auth nécessite l'API admin (hash mdp, etc.).
  -- On laisse cette migration comme placeholder qui documente l'intention.

  raise notice 'Initial admin email: %', admin_email;
end $$;
```

**Note** : la création réelle du user admin se fait via un script Node lancé après `db:reset`. On l'écrit dans une étape suivante (Task 6, lib/supabase/admin.ts + bootstrap script).

- [ ] **Step 5.5 : Appliquer les migrations**

Run :
```bash
npm run db:reset
```

Attendu : applique les migrations 010-013 sans erreur. Le `notice` du seed admin s'affiche.

- [ ] **Step 5.6 : Vérifier la fonction RLS**

Studio → SQL Editor → exécuter :

```sql
select public.current_user_role();
```

Attendu : retourne `chef_equipe` (par défaut quand pas de JWT). Pas d'erreur.

- [ ] **Step 5.7 : Commit**

```bash
git add supabase/migrations/
git commit -m "feat(db): migrations 010-013 — buckets + RLS complet + triggers + seed admin placeholder"
```

---

## Task 6 : Clients Supabase + lib/db/users + audit + script bootstrap admin

**Files:**
- Create: `lib/supabase/client.ts`
- Create: `lib/supabase/server.ts`
- Create: `lib/supabase/admin.ts`
- Create: `lib/db/users.ts`
- Create: `lib/db/activity-logs.ts`
- Create: `lib/audit/log.ts`
- Create: `lib/utils.ts` (peut déjà exister via shadcn — fusionner)
- Create: `types/db.ts`
- Create: `scripts/bootstrap-admin.ts`
- Modify: `package.json` (ajouter script `db:bootstrap-admin`)

- [ ] **Step 6.1 : Créer `types/db.ts` (types métier hand-typed)**

```ts
// Types métier — alignés sur les enums et tables Supabase.
// On peut générer automatiquement avec `npm run db:types` dans le futur,
// pour l'instant on tient les types à la main pour ne pas dépendre de Docker.

export type UserRole = 'admin' | 'manager' | 'chef_equipe'
export type MissionStatus = 'pending' | 'in_progress' | 'completed' | 'issue'
export type TenderStatus =
  | 'draft' | 'extracting' | 'analyzing' | 'ready' | 'failed' | 'submitted' | 'archived'
export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical'
export type AIProviderName = 'mock' | 'gemini' | 'anthropic' | 'openai'
export type KnowledgeCategory =
  | 'references_clients' | 'moyens_humains' | 'materiel'
  | 'procedures' | 'qualite' | 'anciens_memoires'

export interface DbUser {
  id: string
  email: string
  full_name: string | null
  role: UserRole
  must_change_password: boolean
  created_at: string
  deleted_at: string | null
}

export interface DbActivityLog {
  id: string
  user_id: string | null
  entity_type: string
  entity_id: string | null
  action: string
  metadata: Record<string, unknown> | null
  created_at: string
}
```

(D'autres types — DbMission, DbTender, etc. — seront ajoutés dans les plans des modules concernés. On ne pollue pas avec des types non utilisés.)

- [ ] **Step 6.2 : Créer `lib/utils.ts` (ou enrichir l'existant shadcn)**

shadcn a déjà créé `lib/utils.ts` avec `cn()`. Vérifier qu'il existe :

```bash
cat lib/utils.ts
```

Doit contenir :

```ts
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

Si manquant, le créer avec ce contenu.

- [ ] **Step 6.3 : Créer `lib/supabase/client.ts`**

```ts
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

- [ ] **Step 6.4 : Créer `lib/supabase/server.ts`**

```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component — set silently fails, géré par le middleware
          }
        },
      },
    }
  )
}
```

- [ ] **Step 6.5 : Créer `lib/supabase/admin.ts`**

```ts
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Client Supabase avec service role — bypass des RLS.
 * À utiliser UNIQUEMENT côté serveur, dans des Server Actions privilégiées
 * (ex. inviteUser, force password reset, écriture audit logs).
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
```

- [ ] **Step 6.6 : Créer `lib/db/users.ts`**

```ts
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { DbUser, UserRole } from '@/types/db'

/**
 * Récupère le user authentifié courant + son profil métier (role).
 * Renvoie null si pas authentifié.
 *
 * Utilisée partout dans les Server Components / Server Actions —
 * point de centralisation pour l'éventuelle migration multi-tenant
 * (filtre par company_id à ajouter ici plus tard).
 */
export async function getCurrentUserWithProfile(): Promise<DbUser | null> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('users')
    .select('id, email, full_name, role, must_change_password, created_at, deleted_at')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  if (error || !data) return null
  return data as DbUser
}

/**
 * Liste des utilisateurs (admin only).
 * Utilise le service role pour bypass RLS quand l'admin gère les users.
 */
export async function listUsersForAdmin(): Promise<DbUser[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('users')
    .select('id, email, full_name, role, must_change_password, created_at, deleted_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as DbUser[]
}

export async function updateUserRoleAsAdmin(userId: string, role: UserRole): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('users')
    .update({ role })
    .eq('id', userId)
  if (error) throw error
}

export async function softDeleteUserAsAdmin(userId: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('users')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', userId)
  if (error) throw error
}
```

- [ ] **Step 6.7 : Créer `lib/db/activity-logs.ts`**

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'
import type { DbActivityLog } from '@/types/db'

export interface ActivityLogQuery {
  entityType?: string
  action?: string
  userId?: string
  limit?: number
  offset?: number
}

export async function listActivityLogs(query: ActivityLogQuery = {}): Promise<DbActivityLog[]> {
  const supabase = await createServerClient()
  let q = supabase
    .from('activity_logs')
    .select('id, user_id, entity_type, entity_id, action, metadata, created_at')
    .order('created_at', { ascending: false })

  if (query.entityType) q = q.eq('entity_type', query.entityType)
  if (query.action)     q = q.eq('action', query.action)
  if (query.userId)     q = q.eq('user_id', query.userId)
  q = q.range(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 50) - 1)

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as DbActivityLog[]
}

export async function insertActivityLog(input: {
  userId: string | null
  entityType: string
  entityId: string | null
  action: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('activity_logs')
    .insert({
      user_id:     input.userId,
      entity_type: input.entityType,
      entity_id:   input.entityId,
      action:      input.action,
      metadata:    input.metadata ?? {},
    })
  if (error) throw error
}
```

- [ ] **Step 6.8 : Créer `lib/audit/log.ts`**

```ts
import { insertActivityLog } from '@/lib/db/activity-logs'

/**
 * Helper sémantique pour logger un événement sensible.
 * À appeler depuis les Server Actions, après que l'opération métier
 * a réussi. Si le log échoue, on ne casse pas l'opération métier
 * (best-effort), mais on émet un warning.
 *
 * Liste des événements valides :
 * - tender.analysis_relaunched
 * - mission.status_changed
 * - mission.closed
 * - <entity>.soft_deleted
 * - user.role_changed
 * - user.password_reset_forced
 * - report.validated
 */
export type AuditEntityType =
  | 'tender' | 'mission' | 'user' | 'knowledge_item'
  | 'report' | 'client' | 'site'

export type AuditAction =
  | 'analysis_relaunched'
  | 'status_changed'
  | 'closed'
  | 'soft_deleted'
  | 'role_changed'
  | 'password_reset_forced'
  | 'validated'
  | 'created'
  | 'updated'

export interface AuditEvent {
  userId: string | null
  entityType: AuditEntityType
  entityId: string | null
  action: AuditAction
  metadata?: Record<string, unknown>
}

export async function logAuditEvent(event: AuditEvent): Promise<void> {
  try {
    await insertActivityLog({
      userId:     event.userId,
      entityType: event.entityType,
      entityId:   event.entityId,
      action:     event.action,
      metadata:   event.metadata,
    })
  } catch (e) {
    // Log warning mais ne casse pas le flow métier
    console.warn('[audit] failed to insert activity log:', e)
  }
}
```

- [ ] **Step 6.9 : Créer `scripts/bootstrap-admin.ts`**

```ts
/**
 * Script lancé manuellement (ou via npm run db:bootstrap-admin) pour créer
 * l'utilisateur admin initial après un db:reset.
 *
 * Lit INITIAL_ADMIN_EMAIL et INITIAL_ADMIN_PASSWORD depuis l'env.
 * Idempotent : ne fait rien si l'admin existe déjà.
 */
import { createClient } from '@supabase/supabase-js'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const email = process.env.INITIAL_ADMIN_EMAIL
  const password = process.env.INITIAL_ADMIN_PASSWORD

  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  if (!email || !password) {
    throw new Error('Missing INITIAL_ADMIN_EMAIL or INITIAL_ADMIN_PASSWORD')
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Existe déjà ?
  const { data: existing } = await supabase.auth.admin.listUsers()
  const found = existing?.users?.find((u) => u.email === email)
  if (found) {
    console.log(`[bootstrap-admin] Admin ${email} already exists (id=${found.id}). Skipping.`)
    return
  }

  // Créer
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: 'admin' },
    user_metadata: { full_name: 'Admin', role: 'admin' },
  })
  if (error) throw error
  if (!data.user) throw new Error('No user returned')

  // Le trigger on_auth_user_created devrait avoir créé public.users.
  // On force le rôle admin et must_change_password=true.
  const { error: updateError } = await supabase
    .from('users')
    .update({ role: 'admin', must_change_password: true, full_name: 'Admin' })
    .eq('id', data.user.id)
  if (updateError) throw updateError

  console.log(`[bootstrap-admin] Admin created: ${email} (id=${data.user.id})`)
  console.log('Mot de passe temporaire = INITIAL_ADMIN_PASSWORD ; il devra être changé à la première connexion.')
}

main().catch((e) => {
  console.error('[bootstrap-admin] failed:', e)
  process.exit(1)
})
```

- [ ] **Step 6.10 : Ajouter le script à `package.json`**

Dans `scripts` :

```json
{
  "scripts": {
    "db:bootstrap-admin": "tsx scripts/bootstrap-admin.ts"
  }
}
```

- [ ] **Step 6.11 : Lancer le bootstrap admin**

Run :
```bash
npm run db:bootstrap-admin
```

Attendu : `[bootstrap-admin] Admin created: admin@memoria.nc (id=...)`. Le mdp temporaire est `memoria2026`.

- [ ] **Step 6.12 : Vérifier dans Studio**

Studio → Auth → Users : doit lister `admin@memoria.nc`. Studio → Table Editor → public.users : doit lister la même row avec role='admin', must_change_password=true.

- [ ] **Step 6.13 : Commit**

```bash
git add lib/ types/ scripts/ package.json
git commit -m "feat: clients Supabase + lib/db/{users,activity-logs} + audit + bootstrap admin"
```

---

## Task 7 : Middleware + pages auth + protection des routes

**Files:**
- Create: `middleware.ts`
- Create: `app/(auth)/layout.tsx`
- Create: `app/(auth)/login/page.tsx`
- Create: `app/(auth)/login/LoginForm.tsx`
- Create: `app/(auth)/login/actions.ts`
- Create: `app/(auth)/accept-invite/page.tsx`
- Create: `app/(auth)/accept-invite/AcceptInviteForm.tsx`
- Create: `app/(auth)/accept-invite/actions.ts`
- Create: `app/(auth)/change-password/page.tsx`
- Create: `app/(auth)/change-password/ChangePasswordForm.tsx`
- Create: `app/(auth)/change-password/actions.ts`

- [ ] **Step 7.1 : Créer `middleware.ts`**

```ts
import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const url = new URL(request.url)
  const pathname = url.pathname

  const isAuthPage = pathname.startsWith('/login')
                  || pathname.startsWith('/accept-invite')
                  || pathname.startsWith('/change-password')
  const isProtectedPage = !isAuthPage
                       && (pathname.startsWith('/admin')
                        || pathname.startsWith('/dashboard')
                        || pathname.startsWith('/tenders')
                        || pathname.startsWith('/missions')
                        || pathname.startsWith('/reports')
                        || pathname.startsWith('/library')
                        || pathname.startsWith('/settings'))

  if (!user && isProtectedPage) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }
  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/missions', request.url))
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

- [ ] **Step 7.2 : Créer `app/(auth)/layout.tsx`**

```tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md">
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 7.3 : Créer `app/(auth)/login/actions.ts`**

```ts
'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  next: z.string().optional(),
})

export async function loginAction(formData: FormData) {
  const parsed = schema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') ?? undefined,
  })
  if (!parsed.success) {
    return { error: 'Email ou mot de passe invalide.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })

  if (error) {
    return { error: 'Identifiants incorrects.' }
  }

  // Vérifier must_change_password
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const { data: profile } = await supabase
      .from('users')
      .select('must_change_password, role')
      .eq('id', user.id)
      .single()

    if (profile?.must_change_password) {
      redirect('/change-password')
    }

    // Redirect par rôle
    if (profile?.role === 'chef_equipe') {
      redirect(parsed.data.next ?? '/missions')
    }
    redirect(parsed.data.next ?? '/missions') // landing par défaut pour tous au Plan 1
  }

  redirect('/missions')
}
```

- [ ] **Step 7.4 : Créer `app/(auth)/login/LoginForm.tsx`**

```tsx
'use client'

import { useFormStatus } from 'react-dom'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { loginAction } from './actions'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? 'Connexion…' : 'Se connecter'}
    </Button>
  )
}

export function LoginForm({ next }: { next?: string }) {
  const [error, setError] = useState<string | null>(null)

  async function action(formData: FormData) {
    setError(null)
    const res = await loginAction(formData)
    if (res?.error) setError(res.error)
  }

  return (
    <form action={action} className="space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Mot de passe</Label>
        <Input id="password" name="password" type="password" required autoComplete="current-password" />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <SubmitButton />
    </form>
  )
}
```

- [ ] **Step 7.5 : Créer `app/(auth)/login/page.tsx`**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LoginForm } from './LoginForm'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams
  return (
    <Card>
      <CardHeader>
        <CardTitle>Se connecter à MemorIA</CardTitle>
      </CardHeader>
      <CardContent>
        <LoginForm next={params.next} />
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 7.6 : Créer `app/(auth)/accept-invite/actions.ts` + form + page**

`actions.ts` :

```ts
'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

const schema = z.object({
  password: z.string().min(8, 'Mot de passe trop court (min 8 caractères)'),
})

export async function acceptInviteAction(formData: FormData) {
  const parsed = schema.safeParse({ password: formData.get('password') })
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }
  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) return { error: error.message }

  // Marquer must_change_password = false
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    await supabase.from('users').update({ must_change_password: false }).eq('id', user.id)
  }

  redirect('/missions')
}
```

`AcceptInviteForm.tsx` :

```tsx
'use client'

import { useFormStatus } from 'react-dom'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { acceptInviteAction } from './actions'

function SubmitButton() {
  const { pending } = useFormStatus()
  return <Button type="submit" disabled={pending} className="w-full">{pending ? 'Validation…' : 'Définir mon mot de passe'}</Button>
}

export function AcceptInviteForm() {
  const [error, setError] = useState<string | null>(null)
  async function action(fd: FormData) {
    setError(null)
    const r = await acceptInviteAction(fd)
    if (r?.error) setError(r.error)
  }
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="password">Nouveau mot de passe</Label>
        <Input id="password" name="password" type="password" required minLength={8} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <SubmitButton />
    </form>
  )
}
```

`page.tsx` :

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AcceptInviteForm } from './AcceptInviteForm'

export default function AcceptInvitePage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Bienvenue sur MemorIA</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          Définissez votre mot de passe pour accéder à votre compte.
        </p>
        <AcceptInviteForm />
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 7.7 : Créer `app/(auth)/change-password/`**

Mêmes 3 fichiers, mais avec un titre différent et l'audit log :

`actions.ts` :

```ts
'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

const schema = z.object({
  password: z.string().min(8, 'Min 8 caractères'),
})

export async function changePasswordAction(formData: FormData) {
  const parsed = schema.safeParse({ password: formData.get('password') })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) return { error: error.message }

  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    await supabase.from('users').update({ must_change_password: false }).eq('id', user.id)
  }
  redirect('/missions')
}
```

`ChangePasswordForm.tsx` :

```tsx
'use client'

import { useFormStatus } from 'react-dom'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { changePasswordAction } from './actions'

function SubmitButton() {
  const { pending } = useFormStatus()
  return <Button type="submit" disabled={pending} className="w-full">{pending ? 'Validation…' : 'Changer mon mot de passe'}</Button>
}

export function ChangePasswordForm() {
  const [error, setError] = useState<string | null>(null)
  async function action(fd: FormData) {
    setError(null)
    const r = await changePasswordAction(fd)
    if (r?.error) setError(r.error)
  }
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="password">Nouveau mot de passe</Label>
        <Input id="password" name="password" type="password" required minLength={8} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <SubmitButton />
    </form>
  )
}
```

`page.tsx` :

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChangePasswordForm } from './ChangePasswordForm'

export default function ChangePasswordPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Changer le mot de passe</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          Votre mot de passe actuel est temporaire. Choisissez-en un nouveau.
        </p>
        <ChangePasswordForm />
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 7.8 : Tester manuellement**

Run :
```bash
npm run dev
```

- Aller sur `http://localhost:3000` → middleware doit rediriger vers `/login`.
- Se connecter avec `admin@memoria.nc` / `memoria2026`.
- Le `must_change_password` est à `true` → redirect vers `/change-password`.
- Définir un nouveau mdp → redirect vers `/missions` (404 attendu pour l'instant, normal).
- Se déconnecter manuellement (DB studio, supprimer cookies) puis re-login avec le nouveau mdp → redirect direct vers `/missions`.

Stop le serveur.

- [ ] **Step 7.9 : Commit**

```bash
git add middleware.ts app/\(auth\)/
git commit -m "feat(auth): middleware + pages login/accept-invite/change-password + must_change_password flow"
```

---

## Task 8 : Layout dashboard + sidebar + topbar + role guard

**Files:**
- Create: `app/(dashboard)/layout.tsx`
- Create: `components/layout/AppSidebar.tsx`
- Create: `components/layout/AppTopbar.tsx`
- Create: `components/layout/LogoutButton.tsx`
- Create: `components/layout/MobileBottomNav.tsx`
- Create: `components/layout/MobileSheetMenu.tsx`
- Create: `components/layout/RoleGuard.tsx`
- Create: `components/layout/ThemeToggle.tsx`
- Create: `app/(dashboard)/missions/page.tsx` (placeholder)

- [ ] **Step 8.1 : Créer `components/layout/RoleGuard.tsx`**

```tsx
import type { UserRole } from '@/types/db'

interface RoleGuardProps {
  currentRole: UserRole
  allowedRoles: UserRole[]
  children: React.ReactNode
  fallback?: React.ReactNode
}

export function RoleGuard({ currentRole, allowedRoles, children, fallback = null }: RoleGuardProps) {
  if (!allowedRoles.includes(currentRole)) return <>{fallback}</>
  return <>{children}</>
}
```

- [ ] **Step 8.2 : Créer `components/layout/ThemeToggle.tsx`**

```tsx
'use client'

import * as React from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

export function ThemeToggle() {
  const { setTheme } = useTheme()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme('light')}>Clair</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')}>Sombre</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')}>Système</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 8.3 : Créer `components/layout/AppSidebar.tsx`**

```tsx
import Link from 'next/link'
import { LayoutDashboard, FileText, ClipboardList, FileBarChart, BookOpen, Settings, ShieldAlert } from 'lucide-react'
import type { UserRole } from '@/types/db'

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  roles: UserRole[]
}

const NAV: NavItem[] = [
  { href: '/missions', label: 'Missions',  icon: ClipboardList, roles: ['admin', 'manager', 'chef_equipe'] },
  { href: '/tenders',  label: 'Appels d\'offres', icon: FileText, roles: ['admin', 'manager'] },
  { href: '/library',  label: 'Bibliothèque',     icon: BookOpen, roles: ['admin', 'manager'] },
  { href: '/reports',  label: 'Rapports',         icon: FileBarChart, roles: ['admin', 'manager'] },
  { href: '/admin',    label: 'Administration',   icon: ShieldAlert, roles: ['admin'] },
]

export function AppSidebar({ role, fullName }: { role: UserRole; fullName: string }) {
  const visible = NAV.filter((n) => n.roles.includes(role))
  return (
    <aside className="hidden md:flex md:w-60 md:flex-col md:fixed md:inset-y-0 border-r bg-card">
      <div className="flex h-16 items-center border-b px-4">
        <Link href="/missions" className="flex items-center gap-2 font-semibold">
          <LayoutDashboard className="h-5 w-5 text-brand-600" />
          <span>MemorIA</span>
        </Link>
      </div>
      <nav className="flex-1 px-2 py-4 space-y-1">
        {visible.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors"
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </nav>
      <div className="border-t p-4">
        <div className="text-xs text-muted-foreground">{fullName}</div>
        <div className="text-xs">{role}</div>
      </div>
    </aside>
  )
}
```

- [ ] **Step 8.4 : Créer `components/layout/AppTopbar.tsx`**

```tsx
import { ThemeToggle } from './ThemeToggle'
import { LogoutButton } from './LogoutButton'

export function AppTopbar({ fullName }: { fullName: string }) {
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b bg-card px-4 md:pl-64">
      <div className="text-sm text-muted-foreground">{fullName}</div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <LogoutButton />
      </div>
    </header>
  )
}
```

Et créer `components/layout/LogoutButton.tsx` :

```tsx
'use client'

import { Button } from '@/components/ui/button'
import { LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export function LogoutButton() {
  const router = useRouter()
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={async () => {
        const supabase = createClient()
        await supabase.auth.signOut()
        router.push('/login')
      }}
      title="Se déconnecter"
    >
      <LogOut className="h-4 w-4" />
    </Button>
  )
}
```

- [ ] **Step 8.5 : Créer `components/layout/MobileBottomNav.tsx` et `MobileSheetMenu.tsx`**

`MobileBottomNav.tsx` (chef_equipe en mobile) :

```tsx
import Link from 'next/link'
import { ClipboardList, Camera, User } from 'lucide-react'

export function MobileBottomNav() {
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 border-t bg-card flex justify-around py-2 z-10">
      <Link href="/missions" className="flex flex-col items-center text-xs gap-1">
        <ClipboardList className="h-5 w-5" />
        <span>Missions</span>
      </Link>
      <Link href="/missions" className="flex flex-col items-center text-xs gap-1">
        <Camera className="h-5 w-5" />
        <span>Photos</span>
      </Link>
      <Link href="/missions" className="flex flex-col items-center text-xs gap-1">
        <User className="h-5 w-5" />
        <span>Profil</span>
      </Link>
    </nav>
  )
}
```

`MobileSheetMenu.tsx` (manager/admin en mobile, hamburger) :

```tsx
'use client'

import Link from 'next/link'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import type { UserRole } from '@/types/db'

const NAV = [
  { href: '/missions', label: 'Missions',          roles: ['admin', 'manager', 'chef_equipe'] },
  { href: '/tenders',  label: "Appels d'offres",   roles: ['admin', 'manager'] },
  { href: '/library',  label: 'Bibliothèque',      roles: ['admin', 'manager'] },
  { href: '/reports',  label: 'Rapports',          roles: ['admin', 'manager'] },
  { href: '/admin',    label: 'Administration',    roles: ['admin'] },
] as const

export function MobileSheetMenu({ role }: { role: UserRole }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-60">
        <nav className="space-y-1 mt-8">
          {NAV.filter((n) => (n.roles as readonly UserRole[]).includes(role)).map((n) => (
            <Link key={n.href} href={n.href} className="block rounded-md px-3 py-2 text-sm hover:bg-accent">
              {n.label}
            </Link>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 8.6 : Créer `app/(dashboard)/layout.tsx`**

```tsx
import { redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { AppTopbar } from '@/components/layout/AppTopbar'
import { MobileBottomNav } from '@/components/layout/MobileBottomNav'
import { MobileSheetMenu } from '@/components/layout/MobileSheetMenu'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.must_change_password) redirect('/change-password')

  const fullName = user.full_name || user.email
  return (
    <div className="min-h-screen bg-muted/20">
      <AppSidebar role={user.role} fullName={fullName} />
      <div className="md:pl-60">
        <AppTopbar fullName={fullName} />
        <main className="px-4 md:px-8 py-6 pb-24 md:pb-6">{children}</main>
      </div>
      {user.role === 'chef_equipe' && <MobileBottomNav />}
    </div>
  )
}
```

- [ ] **Step 8.7 : Créer un placeholder `app/(dashboard)/missions/page.tsx`**

```tsx
export default function MissionsPlaceholder() {
  return (
    <div>
      <h1 className="text-2xl font-bold">Missions</h1>
      <p className="text-muted-foreground mt-2">
        Module en cours d'implémentation (Plan 4).
      </p>
    </div>
  )
}
```

- [ ] **Step 8.8 : Test manuel**

Run `npm run dev`, login admin → arrive sur `/missions` placeholder, sidebar visible avec les 5 entrées (missions, tenders, library, reports, admin), topbar avec theme toggle + logout, dark/light qui marche.

- [ ] **Step 8.9 : Commit**

```bash
git add app/ components/
git commit -m "feat(layout): dashboard layout + sidebar/topbar + mobile nav + role guard + theme toggle"
```

---

## Task 9 : PWA manifest + icônes

**Files:**
- Create: `app/manifest.ts`
- Create: `public/icons/icon-192.png`
- Create: `public/icons/icon-512.png`
- Create: `public/icons/apple-touch-icon.png`
- Modify: `app/layout.tsx` (ajouter le link manifest)

- [ ] **Step 9.1 : Créer `app/manifest.ts`**

```ts
import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MemorIA',
    short_name: 'MemorIA',
    description: 'Gestion terrain & appels d\'offres pour entreprises de nettoyage',
    start_url: '/missions',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0f172a',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
```

- [ ] **Step 9.2 : Créer les icônes**

Pour le MVP, on utilise des icônes placeholders simples (gradient bleu + lettre N). Créer `scripts/gen-icons.ts` :

```ts
/**
 * Génère les 3 icônes PWA placeholder via @resvg/resvg-js (rendu SVG → PNG côté Node).
 * Si la lib n'est pas dispo, fallback : on imprime un rappel pour les ajouter manuellement.
 */
import fs from 'fs'
import path from 'path'

const SVG_192 = `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#2563eb"/><stop offset="1" stop-color="#0f172a"/>
  </linearGradient></defs>
  <rect width="192" height="192" rx="32" fill="url(#g)"/>
  <text x="96" y="125" text-anchor="middle" font-size="100" font-family="sans-serif" font-weight="bold" fill="white">N</text>
</svg>`

async function main() {
  const dir = path.join(process.cwd(), 'public', 'icons')
  fs.mkdirSync(dir, { recursive: true })

  try {
    const { Resvg } = await import('@resvg/resvg-js')
    for (const [size, name] of [[192, 'icon-192.png'], [512, 'icon-512.png'], [180, 'apple-touch-icon.png']] as const) {
      const svg = SVG_192.replace(/192/g, String(size)).replace('y="125"', `y="${Math.round(size * 0.65)}"`).replace('font-size="100"', `font-size="${Math.round(size * 0.52)}"`)
      const png = new Resvg(svg).render().asPng()
      fs.writeFileSync(path.join(dir, name), png)
      console.log(`Wrote ${name} (${size}×${size})`)
    }
  } catch (e) {
    console.warn('@resvg/resvg-js indisponible — icons non générées.')
    console.warn('Installer : npm i -D @resvg/resvg-js && relancer npm run gen:icons')
  }
}

main()
```

Et `package.json` :

```json
"scripts": {
  "gen:icons": "tsx scripts/gen-icons.ts"
}
```

Installer la lib :

```bash
npm install -D @resvg/resvg-js
npm run gen:icons
```

Vérifier `ls public/icons/` : `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`.

- [ ] **Step 9.3 : Ajouter les meta tags Apple dans `app/layout.tsx`**

Ouvrir `app/layout.tsx`. Le `metadata` export contient déjà `appleWebApp`. Ajouter dans le `<head>` (via `metadata`) :

```ts
export const metadata: Metadata = {
  title: 'MemorIA',
  description: 'Gestion terrain & appels d\'offres pour entreprises de nettoyage',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'MemorIA',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    apple: '/icons/apple-touch-icon.png',
  },
}
```

- [ ] **Step 9.4 : Tester l'install PWA**

Run `npm run dev`, ouvrir `http://localhost:3000` sur **Chrome desktop** :
- DevTools → Application → Manifest : doit afficher le manifest correctement.
- Icône d'install dans la barre d'adresse → cliquer → installer.
- L'app s'ouvre dans une window standalone.

Sur iPhone (si dispo) : ouvrir Safari → partager → "Sur l'écran d'accueil" → vérifier l'icône Apple.

- [ ] **Step 9.5 : Commit**

```bash
git add app/manifest.ts app/layout.tsx public/icons/ scripts/gen-icons.ts package.json
git commit -m "feat(pwa): manifest + icônes 192/512/apple + meta tags iOS standalone"
```

---

## Task 10 : Zone admin — layout + page users complète

**Files:**
- Create: `app/admin/layout.tsx`
- Create: `app/admin/page.tsx`
- Create: `app/admin/users/page.tsx`
- Create: `app/admin/users/CreateUserForm.tsx`
- Create: `app/admin/users/UserRoleSelect.tsx`
- Create: `app/admin/users/ForcePasswordResetButton.tsx`
- Create: `app/admin/users/DeleteUserButton.tsx`
- Create: `app/admin/users/actions.ts`

- [ ] **Step 10.1 : Créer `app/admin/layout.tsx` (header sombre, pattern EquiPass)**

```tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin') redirect('/missions')

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="bg-slate-900 text-white border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-brand-600 flex items-center justify-center font-bold">N</div>
            <div>
              <div className="text-base font-semibold">MemorIA — Admin</div>
              <div className="text-xs text-slate-400">Gestion utilisateurs & monitoring</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/admin/users"      className="text-xs text-slate-300 hover:text-white">Utilisateurs</Link>
            <Link href="/admin/monitoring" className="text-xs text-slate-300 hover:text-white">Monitoring</Link>
            <Link href="/missions"         className="text-xs text-slate-400 hover:text-white">← Retour app</Link>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 md:px-8 py-6 md:py-8">{children}</main>
    </div>
  )
}
```

- [ ] **Step 10.2 : Créer `app/admin/page.tsx`**

```tsx
import { redirect } from 'next/navigation'
export default function AdminIndex() { redirect('/admin/users') }
```

- [ ] **Step 10.3 : Créer `app/admin/users/actions.ts`**

```ts
'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/lib/audit/log'
import { updateUserRoleAsAdmin, softDeleteUserAsAdmin } from '@/lib/db/users'
import type { UserRole } from '@/types/db'

async function requireAdmin() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') throw new Error('Forbidden')
  return user.id
}

const createSchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(1),
  role: z.enum(['admin', 'manager', 'chef_equipe']),
  mode: z.enum(['invite', 'temp_password']),
})

export async function createUserAction(formData: FormData) {
  const adminId = await requireAdmin()
  const parsed = createSchema.safeParse({
    email:     formData.get('email'),
    full_name: formData.get('full_name'),
    role:      formData.get('role'),
    mode:      formData.get('mode'),
  })
  if (!parsed.success) return { error: 'Champs invalides' }

  const supabase = createAdminClient()

  if (parsed.data.mode === 'invite') {
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(parsed.data.email, {
      data: { full_name: parsed.data.full_name, role: parsed.data.role },
    })
    if (error) return { error: error.message }
    if (data.user) {
      await supabase.from('users').update({ role: parsed.data.role, full_name: parsed.data.full_name }).eq('id', data.user.id)
      await logAuditEvent({ userId: adminId, entityType: 'user', entityId: data.user.id, action: 'created', metadata: { mode: 'invite', email: parsed.data.email, role: parsed.data.role } })
    }
  } else {
    const tempPassword = process.env.INITIAL_ADMIN_PASSWORD || 'memoria2026'
    const { data, error } = await supabase.auth.admin.createUser({
      email: parsed.data.email,
      password: tempPassword,
      email_confirm: true,
      app_metadata: { role: parsed.data.role },
      user_metadata: { full_name: parsed.data.full_name, role: parsed.data.role },
    })
    if (error) return { error: error.message }
    if (data.user) {
      await supabase.from('users').update({ role: parsed.data.role, full_name: parsed.data.full_name, must_change_password: true }).eq('id', data.user.id)
      await logAuditEvent({ userId: adminId, entityType: 'user', entityId: data.user.id, action: 'created', metadata: { mode: 'temp_password', email: parsed.data.email, role: parsed.data.role } })
    }
  }

  revalidatePath('/admin/users')
  return { ok: true }
}

const roleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['admin', 'manager', 'chef_equipe']),
})

export async function changeUserRoleAction(formData: FormData) {
  const adminId = await requireAdmin()
  const parsed = roleSchema.safeParse({
    userId: formData.get('userId'),
    role:   formData.get('role'),
  })
  if (!parsed.success) return { error: 'Invalid' }

  // récupérer le rôle avant pour l'audit
  const supabase = createAdminClient()
  const { data: before } = await supabase.from('users').select('role').eq('id', parsed.data.userId).single()
  await updateUserRoleAsAdmin(parsed.data.userId, parsed.data.role as UserRole)
  await logAuditEvent({
    userId: adminId,
    entityType: 'user',
    entityId: parsed.data.userId,
    action: 'role_changed',
    metadata: { from: before?.role, to: parsed.data.role },
  })
  revalidatePath('/admin/users')
  return { ok: true }
}

const forceResetSchema = z.object({ userId: z.string().uuid() })

export async function forcePasswordResetAction(formData: FormData) {
  const adminId = await requireAdmin()
  const parsed = forceResetSchema.safeParse({ userId: formData.get('userId') })
  if (!parsed.success) return { error: 'Invalid' }

  const supabase = createAdminClient()
  const { data: target } = await supabase.from('users').select('role').eq('id', parsed.data.userId).single()
  if (target?.role === 'admin') return { error: 'Reset admin via Supabase Studio uniquement' }

  const tempPassword = process.env.INITIAL_ADMIN_PASSWORD || 'memoria2026'
  await supabase.auth.admin.updateUserById(parsed.data.userId, { password: tempPassword })
  await supabase.from('users').update({ must_change_password: true }).eq('id', parsed.data.userId)
  await logAuditEvent({
    userId: adminId, entityType: 'user', entityId: parsed.data.userId,
    action: 'password_reset_forced', metadata: { temp_password_set: true },
  })
  revalidatePath('/admin/users')
  return { ok: true }
}

const deleteSchema = z.object({ userId: z.string().uuid() })

export async function deleteUserAction(formData: FormData) {
  const adminId = await requireAdmin()
  const parsed = deleteSchema.safeParse({ userId: formData.get('userId') })
  if (!parsed.success) return { error: 'Invalid' }
  if (parsed.data.userId === adminId) return { error: 'Vous ne pouvez pas vous supprimer vous-même' }

  await softDeleteUserAsAdmin(parsed.data.userId)
  await logAuditEvent({
    userId: adminId, entityType: 'user', entityId: parsed.data.userId,
    action: 'soft_deleted',
  })
  revalidatePath('/admin/users')
  return { ok: true }
}
```

- [ ] **Step 10.4 : Créer les composants client**

`CreateUserForm.tsx` :

```tsx
'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createUserAction } from './actions'
import { toast } from 'sonner'

function Submit() {
  const { pending } = useFormStatus()
  return <Button type="submit" disabled={pending}>{pending ? 'Création…' : 'Créer'}</Button>
}

export function CreateUserForm() {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Créer un utilisateur</CardTitle></CardHeader>
      <CardContent>
        <form
          action={async (fd) => {
            const r = await createUserAction(fd)
            if (r?.error) toast.error(r.error)
            else toast.success('Utilisateur créé')
          }}
          className="grid gap-3 md:grid-cols-5"
        >
          <div className="md:col-span-2">
            <Label htmlFor="email" className="text-xs">Email</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <div className="md:col-span-1">
            <Label htmlFor="full_name" className="text-xs">Nom complet</Label>
            <Input id="full_name" name="full_name" required />
          </div>
          <div>
            <Label className="text-xs">Rôle</Label>
            <Select name="role" defaultValue="chef_equipe">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="chef_equipe">Chef d'équipe</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Mode</Label>
            <Select name="mode" defaultValue="invite">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="invite">Inviter par email</SelectItem>
                <SelectItem value="temp_password">Mdp temporaire</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-5 flex justify-end">
            <Submit />
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
```

`UserRoleSelect.tsx` :

```tsx
'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { changeUserRoleAction } from './actions'
import { toast } from 'sonner'
import type { UserRole } from '@/types/db'

export function UserRoleSelect({ userId, currentRole }: { userId: string; currentRole: UserRole }) {
  return (
    <Select
      defaultValue={currentRole}
      onValueChange={async (newRole) => {
        if (newRole === currentRole) return
        const fd = new FormData()
        fd.set('userId', userId)
        fd.set('role', newRole)
        const r = await changeUserRoleAction(fd)
        if (r?.error) toast.error(r.error)
        else toast.success('Rôle mis à jour')
      }}
    >
      <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="admin">Admin</SelectItem>
        <SelectItem value="manager">Manager</SelectItem>
        <SelectItem value="chef_equipe">Chef d'équipe</SelectItem>
      </SelectContent>
    </Select>
  )
}
```

`ForcePasswordResetButton.tsx` :

```tsx
'use client'

import { Button } from '@/components/ui/button'
import { forcePasswordResetAction } from './actions'
import { toast } from 'sonner'

export function ForcePasswordResetButton({ userId, isAdminUser }: { userId: string; isAdminUser: boolean }) {
  if (isAdminUser) {
    return <Button size="sm" variant="ghost" disabled title="Reset admin via Supabase Studio">🔒</Button>
  }
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        if (!confirm('Réinitialiser le mot de passe de cet utilisateur ?')) return
        const fd = new FormData()
        fd.set('userId', userId)
        const r = await forcePasswordResetAction(fd)
        if (r?.error) toast.error(r.error)
        else toast.success('Mot de passe réinitialisé')
      }}
    >
      Reset
    </Button>
  )
}
```

`DeleteUserButton.tsx` :

```tsx
'use client'

import { Button } from '@/components/ui/button'
import { deleteUserAction } from './actions'
import { toast } from 'sonner'

export function DeleteUserButton({ userId, isSelf }: { userId: string; isSelf: boolean }) {
  if (isSelf) {
    return <Button size="sm" variant="ghost" disabled>—</Button>
  }
  return (
    <Button
      size="sm"
      variant="destructive"
      onClick={async () => {
        if (!confirm('Supprimer cet utilisateur ?')) return
        const fd = new FormData()
        fd.set('userId', userId)
        const r = await deleteUserAction(fd)
        if (r?.error) toast.error(r.error)
        else toast.success('Utilisateur supprimé')
      }}
    >
      Supprimer
    </Button>
  )
}
```

- [ ] **Step 10.5 : Créer `app/admin/users/page.tsx`**

```tsx
import { listUsersForAdmin } from '@/lib/db/users'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CreateUserForm } from './CreateUserForm'
import { UserRoleSelect } from './UserRoleSelect'
import { ForcePasswordResetButton } from './ForcePasswordResetButton'
import { DeleteUserButton } from './DeleteUserButton'
import type { UserRole } from '@/types/db'

const ROLE_BADGE: Record<UserRole, string> = {
  admin:       'bg-purple-100 text-purple-700',
  manager:     'bg-blue-100 text-blue-700',
  chef_equipe: 'bg-emerald-100 text-emerald-700',
}

const ROLE_LABEL: Record<UserRole, string> = {
  admin:       'Admin',
  manager:     'Manager',
  chef_equipe: 'Chef d\'équipe',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default async function AdminUsersPage() {
  const [me, users] = await Promise.all([
    getCurrentUserWithProfile(),
    listUsersForAdmin(),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Utilisateurs</h1>
        <p className="text-sm text-muted-foreground">
          {users.length} utilisateur{users.length > 1 ? 's' : ''}. Gestion centralisée — création, rôles, mot de passe.
        </p>
      </div>

      <CreateUserForm />

      <Card>
        <CardHeader><CardTitle className="text-base">Liste</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Email</th>
                  <th className="text-left px-3 py-2">Nom</th>
                  <th className="text-left px-3 py-2">Rôle</th>
                  <th className="text-left px-3 py-2">Mdp</th>
                  <th className="text-left px-3 py-2">Créé le</th>
                  <th className="text-right px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {users.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-xs text-muted-foreground">Aucun utilisateur.</td></tr>
                ) : users.map((u) => (
                  <tr key={u.id} className="hover:bg-muted/20">
                    <td className="px-3 py-2 font-mono text-xs">{u.email}</td>
                    <td className="px-3 py-2 text-xs">{u.full_name || '—'}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Badge className={ROLE_BADGE[u.role]}>{ROLE_LABEL[u.role]}</Badge>
                        <UserRoleSelect userId={u.id} currentRole={u.role} />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {u.must_change_password ? <span className="text-amber-700">À changer</span> : <span className="text-muted-foreground">OK</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{formatDate(u.created_at)}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <ForcePasswordResetButton userId={u.id} isAdminUser={u.role === 'admin'} />
                        <DeleteUserButton userId={u.id} isSelf={me?.id === u.id} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="border-amber-200 bg-amber-50">
        <CardHeader><CardTitle className="text-xs uppercase tracking-wider text-amber-700">Procédure de réinitialisation</CardTitle></CardHeader>
        <CardContent className="text-sm text-amber-900 space-y-2">
          <p>Le bouton <strong>Reset</strong> remet le mot de passe à <code className="bg-white px-1 rounded font-mono">memoria2026</code> et force l'utilisateur à en choisir un nouveau à sa prochaine connexion.</p>
          <p><strong>Comptes admin</strong> : reset désactivé pour des raisons de sécurité ; passer par Supabase Studio.</p>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 10.6 : Test manuel**

Run `npm run dev`, login admin, aller sur `/admin/users` :
- Voir l'admin dans la liste.
- Créer un manager via le form (mode "Mdp temporaire" avec email `manager@memoria.nc`).
- Changer son rôle inline → toast OK + log activity.
- Tester le reset password sur le manager → toast OK.
- Tenter de delete soi-même → bouton désactivé.
- Studio → activity_logs : voir 3 entrées (created, role_changed, password_reset_forced).

- [ ] **Step 10.7 : Commit**

```bash
git add app/admin/
git commit -m "feat(admin): /admin/users complète (create + role + reset + delete) avec audit logging"
```

---

## Task 11 : Page admin/monitoring (activity logs)

**Files:**
- Create: `app/admin/monitoring/page.tsx`
- Create: `app/admin/monitoring/ActivityLogTable.tsx`

- [ ] **Step 11.1 : Créer `app/admin/monitoring/ActivityLogTable.tsx`**

```tsx
import { Badge } from '@/components/ui/badge'
import type { DbActivityLog } from '@/types/db'

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.round(diff / 60000)
  if (m < 1) return 'à l\'instant'
  if (m < 60) return `il y a ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `il y a ${h} h`
  const d = Math.round(h / 24)
  return `il y a ${d} j`
}

const ACTION_LABEL: Record<string, string> = {
  analysis_relaunched:    'Analyse AO relancée',
  status_changed:         'Changement de statut',
  closed:                 'Mission clôturée',
  soft_deleted:           'Suppression',
  role_changed:           'Changement de rôle',
  password_reset_forced:  'Reset MdP forcé',
  validated:              'Rapport validé',
  created:                'Création',
  updated:                'Modification',
}

export function ActivityLogTable({ logs }: { logs: DbActivityLog[] }) {
  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Aucun log.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-2">Quand</th>
            <th className="text-left px-3 py-2">Entité</th>
            <th className="text-left px-3 py-2">Action</th>
            <th className="text-left px-3 py-2">Détails</th>
            <th className="text-left px-3 py-2">Par user</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {logs.map((l) => (
            <tr key={l.id} className="hover:bg-muted/20">
              <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{formatRelative(l.created_at)}</td>
              <td className="px-3 py-2"><Badge variant="outline" className="text-xs">{l.entity_type}</Badge></td>
              <td className="px-3 py-2 text-xs">{ACTION_LABEL[l.action] ?? l.action}</td>
              <td className="px-3 py-2 text-xs font-mono text-muted-foreground">
                {l.metadata ? JSON.stringify(l.metadata).slice(0, 80) + (JSON.stringify(l.metadata).length > 80 ? '…' : '') : '—'}
              </td>
              <td className="px-3 py-2 text-xs font-mono text-muted-foreground">{l.user_id?.slice(0, 8) ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 11.2 : Créer `app/admin/monitoring/page.tsx`**

```tsx
import { listActivityLogs } from '@/lib/db/activity-logs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ActivityLogTable } from './ActivityLogTable'

export default async function AdminMonitoringPage() {
  const logs = await listActivityLogs({ limit: 100 })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Monitoring</h1>
        <p className="text-sm text-muted-foreground">
          Activité récente. Les 100 dernières actions tracées.
        </p>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Activity logs</CardTitle></CardHeader>
        <CardContent className="p-0">
          <ActivityLogTable logs={logs} />
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 11.3 : Test manuel**

Run `npm run dev`, login admin, aller sur `/admin/monitoring` : voir les ~3-4 entrées créées dans Task 10 (création users, role change, password reset).

- [ ] **Step 11.4 : Commit**

```bash
git add app/admin/monitoring/
git commit -m "feat(admin): page /admin/monitoring avec table activity_logs paginée"
```

---

## Task 12 : Tests Vitest + GitHub Actions CI

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`
- Create: `tests/lib/audit-log.test.ts`
- Create: `.github/workflows/ci.yml`
- Modify: `package.json` (devDependencies + scripts si manquant)

- [ ] **Step 12.1 : Installer Vitest et libs de test**

Run :
```bash
npm install -D vitest @vitejs/plugin-react @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 12.2 : Créer `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
```

- [ ] **Step 12.3 : Créer `tests/setup.ts`**

```ts
import '@testing-library/jest-dom'
```

- [ ] **Step 12.4 : Créer `tests/lib/audit-log.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// On mock @/lib/db/activity-logs avant l'import de l'audit module
vi.mock('@/lib/db/activity-logs', () => ({
  insertActivityLog: vi.fn(),
}))

import { insertActivityLog } from '@/lib/db/activity-logs'
import { logAuditEvent } from '@/lib/audit/log'

describe('logAuditEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('appelle insertActivityLog avec les bons paramètres', async () => {
    await logAuditEvent({
      userId: 'user-1',
      entityType: 'mission',
      entityId: 'mission-1',
      action: 'closed',
      metadata: { closed_with_deviation: true },
    })

    expect(insertActivityLog).toHaveBeenCalledWith({
      userId: 'user-1',
      entityType: 'mission',
      entityId: 'mission-1',
      action: 'closed',
      metadata: { closed_with_deviation: true },
    })
  })

  it('ne casse pas le flow métier si l\'insertion log échoue', async () => {
    vi.mocked(insertActivityLog).mockRejectedValueOnce(new Error('DB down'))

    // Doit résoudre, pas throw
    await expect(
      logAuditEvent({
        userId: 'user-1',
        entityType: 'user',
        entityId: 'u-2',
        action: 'role_changed',
      })
    ).resolves.toBeUndefined()
  })

  it('passe metadata vide si non fourni', async () => {
    await logAuditEvent({
      userId: null,
      entityType: 'user',
      entityId: 'u-1',
      action: 'soft_deleted',
    })

    expect(insertActivityLog).toHaveBeenCalledWith({
      userId: null,
      entityType: 'user',
      entityId: 'u-1',
      action: 'soft_deleted',
      metadata: undefined,
    })
  })
})
```

- [ ] **Step 12.5 : Lancer les tests**

Run :
```bash
npm test
```

Attendu : 3 tests passent, sans warning. Si échec : vérifier l'aliasing `@` dans `vitest.config.ts`.

- [ ] **Step 12.6 : Créer `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint --if-present
      - run: npm test
      - run: npm run build
        env:
          NEXT_PUBLIC_SUPABASE_URL: http://localhost:54321
          NEXT_PUBLIC_SUPABASE_ANON_KEY: dummy-anon
          SUPABASE_SERVICE_ROLE_KEY: dummy-service
```

- [ ] **Step 12.7 : Vérifier que le build passe localement**

Run :
```bash
npm run typecheck
npm test
npm run build
```

Tous doivent passer. Si `npm run build` échoue avec erreur env Supabase, c'est OK pour l'instant en local (les env locaux sont posés).

- [ ] **Step 12.8 : Commit**

```bash
git add tests/ vitest.config.ts .github/ package.json
git commit -m "chore: setup Vitest + 3 tests audit-log + GitHub Actions CI"
```

---

## Critères d'acceptance — Plan 1

À l'issue de ces 12 tasks, on doit avoir :

- [ ] `npm run dev` démarre sans erreur, `npm run typecheck` et `npm test` passent.
- [ ] `npm run db:reset && npm run db:bootstrap-admin` produit un admin `admin@memoria.nc`.
- [ ] Login avec `admin@memoria.nc` / `memoria2026` redirige vers `/change-password`, puis vers `/missions`.
- [ ] La sidebar affiche les bonnes entrées selon le rôle (admin voit tout, chef_equipe voit Missions seulement).
- [ ] Dark/light mode fonctionne via le ThemeToggle.
- [ ] PWA installable (manifest correct dans Chrome DevTools).
- [ ] `/admin/users` permet : créer (invite OU mdp temporaire), changer rôle inline, reset password (sauf admin), supprimer (sauf soi-même).
- [ ] Chaque action sensible insère une row `activity_logs`, visible sur `/admin/monitoring`.
- [ ] `middleware.ts` redirige `/missions` vers `/login` quand non authentifié.
- [ ] Aucune requête Supabase faite en dehors de `lib/db/*.ts` (sauf les Server Actions qui passent par ces fonctions).

## Prochaines étapes

Une fois Plan 1 livré et validé : on rédige le **Plan 2 — Bibliothèque AGP** (CRUD knowledge_items, single page, intégration audit, prêt à être consommé par l'orchestrateur IA du Plan 3).

Plans suivants :
- Plan 3 — Couche IA + Module 1 AO
- Plan 4 — Module 2 Terrain + PWA UX
- Plan 5 — Module 3 Rapports + Seed riche + polish

Chaque plan suivant sera rédigé juste avant son exécution, pour intégrer les apprentissages du précédent.
