# NetoIAge

SaaS B2B pour entreprises de nettoyage professionnel : appels d'offres avec IA, gestion terrain mobile-first, rapports & bibliothèque AGP.

## Stack

- **Frontend** : Next.js 16 + TypeScript + Tailwind v4 + shadcn/ui
- **Backend** : Supabase Cloud (Postgres + Auth + Storage)
- **IA** : multi-provider (mock / gemini / anthropic) via abstraction commune

## Démarrage local

1. **Cloner le repo** et `cd` dedans
2. **Node.js 20+** requis (via nvm recommandé)
3. **Installer les deps** :
   ```bash
   npm install
   ```
4. **Variables d'environnement** : copier `.env.example` vers `.env.local` et remplir avec les valeurs de votre projet Supabase Cloud (URL + anon key + service_role key + access token).
5. **Appliquer les migrations** sur votre projet Supabase Cloud :
   ```bash
   npm run db:push
   ```
6. **Créer l'admin initial** :
   ```bash
   npm run db:bootstrap-admin
   ```
7. **Démarrer le dev server** :
   ```bash
   npm run dev
   ```
   Ouvrir http://localhost:3000 et se connecter avec les valeurs de `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD`.

## Documentation

- **Spec** : `docs/superpowers/specs/2026-05-09-netoiage-mvp-design.md`
- **Plans d'implémentation** : `docs/superpowers/plans/`
- **Review Plans 1-3** : `docs/REVIEW-PLANS-1-3.md`

## Securite

### Tokens et secrets

- **Aucun secret réel ne doit être commité dans ce repo.** `.env.local` est gitignored.
- Si un token Supabase ou autre clé API a été exposé dans un chat, des logs, un message ou tout canal non-privé : **révoquer immédiatement le token concerné** et en générer un neuf.
  - Tokens Supabase CLI : https://supabase.com/dashboard/account/tokens
  - Service role keys : régénérables depuis le dashboard du projet Supabase
- Le mot de passe `INITIAL_ADMIN_PASSWORD` est temporaire — il est forcé à être changé à la première connexion (`must_change_password` flag).

### Headers HTTP

À activer avant production : Content-Security-Policy, HSTS, X-Frame-Options. Pas configurés au MVP.

## Scripts npm

- `npm run dev` — serveur de dev (Turbopack)
- `npm run build` — build production
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — tests Vitest
- `npm run db:push` — applique les migrations Supabase
- `npm run db:bootstrap-admin` — crée l'utilisateur admin initial
- `npm run gen:icons` — régénère les icônes PWA

## Tests

8 tests Vitest en place (audit logging, knowledge tags, AI mock provider, AI orchestrator). CI GitHub Actions sur push/PR vers main.
