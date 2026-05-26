# Harnais de capture de parcours métier (`walkthrough-capture.ts`)

Outil d'**audit UX** : pilote Chromium (Playwright) en se connectant comme
Manager / Chef / Admin, traverse les parcours, et capture pour chaque écran un
**screenshot pleine page + le texte visible + les affordances (boutons/liens)**,
plus une **trace replayable** par rôle. Ce n'est PAS une suite de tests : aucune
assertion, aucune correction — de la matière à juger (cf. `docs/testing/parcours-metier.md`).

## ⚠️ Sécurité — LOCAL uniquement

Les agents qui jouent les rôles **écrivent** (anomalies, photos, accusés…). Tout
doit viser le **Supabase local**, jamais la prod.

- Le script **avorte** (`process.exit(1)`) si une requête part vers `*.supabase.co`.
- Le seed (`reset-and-seed-nc-demo.ts`) **refuse** toute URL non locale.
- `next dev` doit être lancé avec l'**env local forcé** (voir ci-dessous), car
  `.env.local` pointe la prod.

## Prérequis

```bash
# 1. Supabase local démarré
npx supabase start

# 2. Schéma + données réalistes (4 contrats, 6 sites, ~130 interventions, comptes test)
#    Comptes : manager@ / admin@ / chef.noumea@memoria.local — mdp Password123!
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54121 \
SUPABASE_SERVICE_ROLE_KEY=<clé locale> \
npx tsx scripts/dev/reset-and-seed-nc-demo.ts --confirm-reset-on=54121 --yes

# 3. Playwright + Chromium (déjà en devDependencies)
npx playwright install chromium
```

## Env local (`tmp/localenv.sh`)

Fichier **non versionné** (dans `tmp/`, gitignoré). Le créer une fois à partir de
`npx supabase status -o env` (ports selon `supabase/config.toml`) :

```bash
export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54121"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="<ANON_KEY locale>"
export SUPABASE_SERVICE_ROLE_KEY="<SERVICE_ROLE_KEY locale>"
# Clés IA vidées : zéro coût LLM (Atelier IA jugé statiquement).
export OPENAI_API_KEY="" ; export VOYAGE_API_KEY=""
export ANTHROPIC_API_KEY="" ; export GOOGLE_GENAI_API_KEY=""
```

## Lancer

```bash
# Dev server sur l'env LOCAL (sinon il tape la prod via .env.local)
source tmp/localenv.sh && npx next dev -p 3000

# Dans un autre terminal : la capture
source tmp/localenv.sh && npx tsx scripts/dev/walkthrough-capture.ts
```

Surcharger le port : `WT_BASE=http://localhost:3100 npx tsx scripts/dev/walkthrough-capture.ts`

## Sorties (`tmp/walkthrough/`)

- `{manager,chef,admin}/NN_label.png` — screenshots numérotés
- `{manager,chef,admin}/_log.md` — URL, titres, affordances, texte visible
- `trace-{manager,chef,admin}.zip` — traces rejouables :

```bash
npx playwright show-trace tmp/walkthrough/trace-manager.zip
```

## Notes

- **Zéro appel LLM** : l'Atelier IA est visité mais aucun message n'est envoyé ;
  les clés IA sont vidées dans `tmp/localenv.sh`.
- Étendre un parcours = éditer les blocs `MANAGER / CHEF / ADMIN` dans le script.
- `openFirstDetail(page, base, …)` ouvre la 1ʳᵉ fiche `/<base>/<uuid>` (saute la nav).
