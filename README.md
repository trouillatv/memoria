# MemorIA

> B2B SaaS pour entreprises de nettoyage français — **système de capital de preuves**.

Pas un logiciel de nettoyage. Pas un outil IA AO. Un système qui transforme chaque
intervention exécutée en preuve réutilisable :

**AO gagné → Engagements extraits → Contrat → Missions → Interventions →
Photos + Validations → Boucle de preuve → Réutilisation dans nouveaux AO**

## Doctrine

Le produit est gouverné par 4 principes immuables :

1. **Le planning sert la preuve, pas la gestion des humains.** Pas d'`assigned_to`,
   pas de `shift`, pas de rotation, pas de calendrier visuel, pas de KPI agent.
2. **Anonymisation par défaut.** Les exports parlent d'"équipe terrain" — jamais
   de prénoms. Override admin uniquement pour usage juridique.
3. **Chaîne immuable.** Engagement → Mission → Intervention → Preuve. Aucun
   bypass de niveau.
4. **Sobriété calme.** Pas d'alerte rouge, pas de gamification, pas de tracking
   analytics côté utilisateur.

Détail complet : [`docs/superpowers/doctrines/planning-doctrine.md`](docs/superpowers/doctrines/planning-doctrine.md)

## Stack

- Next.js 16 (App Router, Turbopack, Server Actions, Server Components)
- TypeScript 5
- Tailwind v4 (CSS-first @theme)
- shadcn/ui + base-ui
- Supabase Cloud (Postgres + Auth + Storage)
- vitest 4 + @testing-library/react
- @react-pdf/renderer pour les exports PDF horodatés
- pg_trgm pour le matching cross-tender (Phase 4)

## Setup local

1. **Cloner et installer**
   ```bash
   git clone https://github.com/trouillatv/memoria.git
   cd memoria
   npm install
   ```

2. **Variables d'environnement** — copier `.env.example` vers `.env.local` et remplir :
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
   SUPABASE_SERVICE_ROLE_KEY=<service-role>
   # AI provider (mock par défaut)
   AI_PROVIDER=mock  # ou 'gemini' / 'anthropic'
   # GOOGLE_GENAI_API_KEY=... ou ANTHROPIC_API_KEY=... selon le provider
   INITIAL_ADMIN_EMAIL=admin@memoria.nc
   INITIAL_ADMIN_PASSWORD=memoria2026
   ```

3. **Appliquer les migrations** (22 migrations `supabase/migrations/*.sql`) :
   ```bash
   npm run db:push
   ```

4. **Créer l'admin initial** :
   ```bash
   npm run db:bootstrap-admin
   ```

5. **Seeder les données de démo** :
   ```bash
   npm run db:seed-demo
   ```
   Crée 3 contrats (CHU Régional / Banque Centrale / École Jean Jaurès) +
   1 AO démo en cours + templates de récurrence + interventions générées.

6. **Lancer le dev server** :
   ```bash
   npm run dev
   ```
   Ouvrir http://localhost:3000 et se connecter avec `INITIAL_ADMIN_EMAIL` /
   `INITIAL_ADMIN_PASSWORD`.

## Commandes utiles

```bash
npm run typecheck     # 0 erreur attendu
npm run lint
npm test              # vitest run — 337 tests (41 files passed, 1 skipped)
npm run build && npm start  # mode prod (plus rapide qu'en dev pour la démo)

# Smoke tests programmatiques (DB réelle, .env.local requis)
npx tsx scripts/phase4-smoke.ts  # cross-tender matching
npx tsx scripts/phase5-smoke.ts  # dossier de preuves
npx tsx scripts/phase6-smoke.ts  # récurrence
```

## Routes principales

| Route | Rôle | Quoi |
|---|---|---|
| `/login` | tous | Auth Supabase |
| `/dashboard` | admin/manager | Cockpit exécutif (contrats actifs, alertes) |
| `/tenders` | admin/manager | Liste AO + import + copilote IA |
| `/tenders/[id]` | admin/manager | Mémoire technique, engagements, panel "Évidence disponible" |
| `/contracts` | admin/manager | Liste contrats avec boucle de preuve |
| `/contracts/[id]` | admin/manager | Cockpit contrat : sites, missions, récurrences, engagements |
| `/missions` | admin/manager | Liste interventions filtrable (site/date/statut) |
| `/preuves` | admin/manager | Dossier de preuves — recherche, détail, export PDF + partage |
| `/m` | chef_equipe | Mobile field : missions du jour, capture photo, anomalies |
| `/p/[token]` | public | Vue partagée d'une preuve (sans login) |
| `/account` | tous | Profil + mot de passe |
| `/admin/users` | admin | Gestion équipe |

## Structure dossier

- `app/(dashboard)/` — écrans desktop superviseur
- `app/(field)/` — écrans mobile agent terrain (`/m`)
- `app/(auth)/` — flow auth
- `app/p/[token]/` — route publique anonymisée
- `lib/db/` — helpers DB par entité (15 modules)
- `lib/recurrence/` — moteur de récurrence
- `lib/pdf/` — générateur PDF preuves
- `services/ai/` — abstraction providers IA (mock/gemini/anthropic)
- `supabase/migrations/` — schéma DB
- `docs/superpowers/` — doctrine, plans, notes, specs

## Branches

- `main` — production, déployé
- `feat/<feature-name>` — feature branches, mergées via PR

## Doc

- [`docs/superpowers/doctrines/planning-doctrine.md`](docs/superpowers/doctrines/planning-doctrine.md) — doctrine immuable
- [`docs/superpowers/notes/2026-05-phase4-cross-tender-matching.md`](docs/superpowers/notes/2026-05-phase4-cross-tender-matching.md)
- [`docs/superpowers/notes/2026-05-phase5-dossier-de-preuves.md`](docs/superpowers/notes/2026-05-phase5-dossier-de-preuves.md)
- [`docs/superpowers/notes/2026-05-phase6-recurrence-simple.md`](docs/superpowers/notes/2026-05-phase6-recurrence-simple.md)
- [`docs/superpowers/notes/2026-05-pilote-terrain-prep.md`](docs/superpowers/notes/2026-05-pilote-terrain-prep.md) — kit handoff pilote terrain

## Sécurité

- **Aucun secret réel ne doit être commité.** `.env.local` est gitignored.
- Si un token Supabase ou autre clé API a été exposé (chat, logs, message) :
  **révoquer immédiatement** et régénérer. Tokens Supabase CLI :
  https://supabase.com/dashboard/account/tokens
- Le mot de passe `INITIAL_ADMIN_PASSWORD` est temporaire — forcé à être changé
  à la première connexion (flag `must_change_password`).
- Headers HTTP à activer avant production : CSP, HSTS, X-Frame-Options.

## License

Propriétaire — usage interne MemorIA / Aurélie Trouillat.
