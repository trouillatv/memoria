# Base de test MemorIA — Supabase local (Docker)

> **Pourquoi local et pas un projet cloud ?** L'org Supabase « trouillat V » a déjà ses
> **2 projets actifs free** (equippass + MemorIA) ; un 3ᵉ projet cloud actif serait
> payant (Pro ~25 $/mois). Supabase **local** (Docker) est gratuit, isolé, reproductible
> et CI-friendly — c'est le standard pour les tests E2E. **Zéro risque pour la prod**
> (base prod partagée `srixnofmaydxouhucawn` jamais touchée par les tests).

## Prérequis (une fois)
- **Docker Desktop** installé ET **démarré** (le démon doit tourner).
- **Supabase CLI** (déjà dispo via `npx supabase`).

## Démarrer / arrêter la base de test

```bash
npx supabase start     # démarre le stack local + applique supabase/migrations/*.sql
npx supabase stop      # arrête (les données persistent)
npx supabase db reset  # RAZ : ré-applique toutes les migrations (+ seed.sql) sur une base fraîche
npx supabase status    # voir l'état + les URLs/clés locales
```

- API locale : **http://127.0.0.1:54321**
- DB Postgres : **127.0.0.1:54322** (user `postgres`, pass `postgres`)
- Studio (UI) : **http://127.0.0.1:54323**

Les clés `anon` / `service_role` locales sont **standard** (mêmes pour toute install
locale Supabase, dérivées du JWT secret de `config.toml`) — **non secrètes**, mais on
les met dans `.env.test` (gitignoré) par convention.

## Fichier `.env.test`
Généré depuis la CLI : `npx supabase status -o env` donne `API_URL`, `ANON_KEY`,
`SERVICE_ROLE_KEY` → mappés vers les noms attendus par l'app. **Gitignoré.**

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<clé anon locale>
SUPABASE_SERVICE_ROLE_KEY=<clé service_role locale>
```

## Schéma
Les migrations `supabase/migrations/NNN_*.sql` (002 → 085) sont rejouées **dans l'ordre**
sur une base vierge par `supabase start` / `db reset`. La base de test a donc **le même
schéma que la prod**, reconstruit proprement.

## Données de test
- Convention : tout ce que créent les tests est préfixé `__test_` (cf.
  `scripts/dev/cleanup-test-data.ts` pour le nettoyage côté cloud — inutile en local,
  on fait `db reset`).
- Un seed réaliste minimal peut vivre dans `supabase/seed.sql` (auto-rejoué au `db reset`).

## Lancer les tests contre la base de test
Les commandes de test chargent `.env.test` au lieu de `.env.local` :

```bash
npm run test:e2e        # Playwright (à venir) contre http://127.0.0.1:3000 + base locale
```

> ⚠️ Ne JAMAIS pointer les tests d'écriture vers la base prod. Les tests écrivent/effacent ;
> ils doivent tourner **uniquement** sur la base locale (`.env.test`).

## CI (plus tard)
GitHub Actions : `supabase/setup-cli` + `supabase start` dans un job, puis `npm run test:e2e`.
Base éphémère par run → aucune pollution.
