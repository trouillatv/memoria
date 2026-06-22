# MemorIA

> **La mémoire opérationnelle d'un chantier** — multi-métier (BTP/VRD, nettoyage, MOE, maintenance…).
> Capte ce qui se passe et se dit, s'en souvient, et ramène la bonne information au bon moment.

MemorIA n'est **ni un ERP, ni un drive, ni un outil de tâches**. C'est une *mémoire* :
elle retient ce qui compte (réunions, décisions, actions, obligations, preuves), relie
ces éléments dans le temps autour d'un **Sujet**, et survit aux ruptures humaines
(départ, absence, passation). Le moat n'est pas de *générer du texte* — c'est de
**contextualiser la mémoire** et de **rendre l'expérience réutilisable** d'un chantier à l'autre.

> 🧠 **Avant de lire le code, lis le modèle mental :** [`docs/manuel/01-COMMENT-PENSER-MEMORIA.md`](docs/manuel/01-COMMENT-PENSER-MEMORIA.md).
> 🛠️ **Vérité technique / architecture IA :** [`docs/manuel/02-ARCHITECTURE-IA.md`](docs/manuel/02-ARCHITECTURE-IA.md).
> 📖 **Manuel utilisateur** (rendu dans l'app sur `/manuel`) : [`docs/MODE_EMPLOI.md`](docs/MODE_EMPLOI.md).

---

## Pourquoi

Sur un chantier, la mémoire se perd à trois endroits : **entre les réunions** (« on avait
dit quoi sur le DOE ? »), **entre les documents** (CCTP, mémoire technique, CR parlent du
même sujet sans se relier), et **entre les personnes** (un conducteur part, sa tête avec
lui). Les outils de *stockage* (SharePoint, Drive) gardent des fichiers morts ; les outils
de *tâches* (Trello, Procore) cochent des cases sans raconter d'histoire. MemorIA recolle
ces trois fractures.

---

## Le modèle mental (l'essentiel)

Tout converge vers le **Sujet** = *l'histoire complète d'un problème/ouvrage/livrable dans
le temps* (« DOE », « essais à la plaque », « fissure hall B »). Jamais une personne.

**Six objets, à ne pas confondre :**

| Objet | C'est… | Ce n'est pas… |
|---|---|---|
| **Sujet** | l'histoire d'un fil dans le temps | une personne, une tâche |
| **Action** | un événement ponctuel à faire | un sujet (elle se clôt ; le sujet dure) |
| **Obligation** | ce qui DOIT exister (l'absence est le signal) | une action (l'obligation préexiste) |
| **Réserve** | un défaut à lever | — |
| **Décision** | ce qui a été tranché | — |
| **Preuve** | photo / document / signature qui démontre | un souvenir |

**La chaîne de valeur — du document à la réalité prouvée :**

```
Document (AO/CCTP) → Engagement → Obligation → Sujet → Réunion/QR/Photos → Preuve → Clôture → Passation
                     (IA propose, humain valide)        (l'histoire vivante)
```

Une promesse écrite (**engagement** d'appel d'offres) ne meurt plus dans un contrat : elle
devient une **obligation vivante** rattachée à un **sujet canonique**, qui revient au
briefing et réclame sa **preuve**.

---

## Ce que fait MemorIA

- **Capture** — réunions (audio multi-sources → transcription → CR), photos avant/après
  terrain, notes, déclarations d'entreprises via QR/lien sans login.
- **Structuration** — actions, réserves, décisions, **obligations** (l'objet prescriptif),
  **sujets** (le fil), regroupement par corps d'état / sous-périmètre (bâtiment, zone).
- **Mémoire d'un lieu** — historique chronologique d'un site/sujet, « préparer la réunion »
  (briefing déterministe : récurrents, retards, obligations négligées), recherche par sujet.
- **Preuve & continuité** — dossier de preuve, passation (URL/QR/PDF), QR entreprises
  (Fait/Bloqué + photo + signature), inbox « Nouveau depuis hier ».
- **Copilote AO** — analyse IA d'un appel d'offres (contraintes, risques, checklist, score,
  mémoire technique), **extraction d'engagements typés**, Atelier IA multi-agent,
  **audit documentaire** (PDF + provenance navigable à 3 niveaux de confiance), conversion
  en contrat.
- **Mémoire d'expérience** (déterministe, sans ML) — un sujet canonique agrège ses
  occurrences cross-chantiers : récurrence → **causes** → **facteurs de réussite observés**
  → **impact** (jours de retard, réserves). « Voici ce qui revient quand ce sujet apparaît. »

---

## Doctrine (principes immuables)

1. **La mémoire d'abord, jamais la notation des personnes.** Aucun score d'agent. Les
   chiffres parlent du *lieu* et de la *mémoire*, jamais des gens.
2. **L'IA propose, l'humain valide.** Aucune écriture autonome ne fait foi. L'artefact brut
   (audio, transcription) n'est jamais détruit ; la correction est une couche.
3. **Déterministe d'abord, LLM ensuite.** Tout ce qui peut être *calculé* l'est (retards,
   causes, impact, santé). Le LLM est réservé à la compréhension de langage.
4. **Jamais inventer.** Pas de citation ni de **page** fabriquée — on déclare la confiance
   (`exact` / `section` / `approximate`). Une fausse page détruit la confiance au clic.
5. **Capter une déclaration, pas piloter le travail.** Le QR/lien entreprise capte un fait
   signé ; il ne gère pas l'entreprise (anti-ERP, anti-pointage, anti-RH).
6. **Déclaration ≠ vérité terrain.** Ce que déclare une entreprise et la validation MOE
   restent deux vérités distinctes ; le MOE garde la main.
7. **Sobriété calme** — pas d'alerte dramatisante, pas de gamification.
8. **Test d'admission de toute feature :** *enrichit-elle l'histoire d'un sujet, améliore-t-elle
   l'attention, ou renforce-t-elle la preuve ?* Sinon → on ne construit pas (anti usine à gaz).

Doctrines détaillées : [`docs/superpowers/doctrines/`](docs/superpowers/doctrines/).

---

## Stack

- **Next.js** (App Router, Server Actions, Server Components) — ⚠️ voir `AGENTS.md` :
  *cette version a des breaking changes, lire `node_modules/next/dist/docs/` avant de coder.*
- **TypeScript 5** · **Tailwind v4** (`@theme`) · shadcn/ui + base-ui · PWA (mobile terrain)
- **Supabase Cloud** (Postgres + Auth + Storage + RLS)
- **IA** : Google Gemini (par défaut) / Anthropic / mode `mock` — providers abstraits
- `unpdf` (extraction PDF serverless) · exceljs (Excel) · docxtemplater (Word) ·
  @react-pdf/renderer (PDF) · vitest 4 + @testing-library/react

---

## Architecture

```
app/
  (dashboard)/   écrans desktop superviseur (manager/admin)
  (field)/m/     PWA mobile terrain (chef d'équipe) — capture, livraisons, interventions
  a|i|h|qr|p|c|v/[token]/   routes PUBLIQUES tokenisées (sans login : entreprises, partage)
  api/           routes serveur (analyse AO, crons, status)
lib/
  db/            helpers DB par entité (sujets, obligations, engagements, scopes…)
  tenders/       pipeline d'analyse AO
  ai/            transcription, matching AO↔terrain
  pdf/           contexte/paragraphe/occurrences (déterministe, sur texte balisé)
services/ai/     providers (mock/gemini/anthropic) + agents + orchestrateur + prompts
supabase/migrations/   schéma DB (SQL, appliqué via npm run db:push)
docs/manuel/     documentation pérenne (conceptuel, architecture, plan)
docs/superpowers/  doctrines, plans, specs
```

### Pipeline AO → mémoire vivante (cœur produit)

```
PDF (upload) → unpdf extrait le texte PAGE PAR PAGE + marqueurs [[page N]]
  → route /api/tenders/[id]/analyze (DANS la requête HTTP, maxDuration=300)
  → orchestrateur : 3 agents (Lecteur AO · Mémoire technique · Scoreur) → tender_analyses
  → extraction d'engagements TYPÉS (objectif/obligation/livrable/contrôle/pénalité)
  → curation humaine → conversion en contrat → site
  → matérialisation : engagement → site_obligation (avec provenance CCTP)
  → find-or-create SUJET → getSubjectTimeline (l'histoire, origine en 1er événement)
  → moteur d'expérience : causes · facteurs de réussite · impact (cross-chantiers)
```

### L'IA, en bref

- **Agents** (`services/ai/agents/`) : `lecteur_ao`, `memoire_technique`, `opportunity_scorer`
  (implémentés) ; `terrain`/`conformite`/`contradicteur`/`financier` (stubs, futur).
- **Déterministe vs LLM** : retards, causes, facteurs, impact, santé d'obligation, sujet
  canonique = **calculés**. Résumés, extraction, suggestions = **LLM** (à vérifier).
- **Confiance des citations** (`lib/engagements/citation.ts`) : `exact` (page fiable via
  marqueur) → ouvrir la page ; `section` → ouvrir le doc ; `approximate` → pas de page,
  l'extrait reste la trace. **Jamais de fausse page.**

### Modèle de données (tables clés)

`sites` ◄ `contracts` · `site_reports` (réunions) · **`subjects`** (le centre, site-scopé) ◄
`site_actions` · `site_reserve` · `site_decisions` · `intervention_anomalies` ·
**`site_obligation`** (provenance `origin_*`) · `engagements` (AO, `kind`) · `tenders`/
`tender_analyses` · `action_distributions` (QR) · `memory_scopes` (sous-périmètres) ·
`glossary_terms` (sujet canonique) · `user_feed_state` (inbox).
*Schéma complet : généré depuis `supabase/migrations/` — ne pas recopier à la main.*

---

## Setup local

```bash
git clone https://github.com/trouillatv/memoria.git && cd memoria && npm install
cp .env.example .env.local          # puis remplir (Supabase + provider IA)
npm run db:push                     # applique supabase/migrations/*.sql (idempotent)
npm run db:bootstrap-admin          # crée l'admin initial
npm run dev                         # http://localhost:3001
```

Variables clés de `.env.local` : `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`AI_PROVIDER` (`mock` par défaut · `gemini`/`anthropic` + clé), `GOOGLE_GENAI_API_KEY`,
`INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`.

## Commandes

```bash
npm run typecheck   # tsc --noEmit (0 erreur attendu)
npm run lint
npm test            # vitest (projet `unit` = CI)
npm run build       # next build — SEUL juge fiable de la frontière client/serveur
npm run db:push     # applique les nouvelles migrations
```

### Pièges à connaître (durement appris)

- **`npm run build` est le seul juge** de la frontière client/serveur : importer une
  *valeur* (pas un type) d'un module serveur (cookies/admin) dans un composant client
  casse `next build` mais **pas** `tsc`.
- **Tests** : le projet `unit` (CI GitHub) tourne sans base ; les tests d'intégration
  `lib/db` frappent une **vraie Supabase** (`.env.local`). Nouveau test DB → l'ajouter à
  `tests/integration-tests.ts`. Piège CRLF : Windows local ≠ CI Linux.
- **Vercel coupe `after()`** → tout travail long (analyse AO, transcription) tourne **dans
  la requête HTTP** avec `export const maxDuration = 300`.
- **PDF serverless** : `unpdf` (pas `pdf-parse` — DOMMatrix/worker absents sur Vercel).
- **Migrations** : `npm run db:push` (Management API, idempotent, tracké dans
  `public._migrations_applied`). Numérotées `NNN_nom.sql`.

## Déploiement

Push sur `main` → déploiement automatique **Vercel** (`memorianc.vercel.app`). Le CI GitHub
(projet vitest `unit`) est indépendant du déploiement.

---

## Cartographie des routes

| Zone | Routes | Accès |
|---|---|---|
| Cockpit | `/dashboard` `/aujourdhui` `/semaine` `/planning` `/briefing` `/actions` | admin/manager |
| Chantiers | `/sites` `/sites/[id]` (+ journal, photos, livraisons, reserves, **subjects**, **obligations**, preuves, qr, scopes) | admin/manager |
| Réunions & CR | `/meetings` `/meetings/[id]` (+ `pv/validation`, `briefing`) | admin/manager |
| Contrats/équipes | `/clients` `/contracts` `/missions` `/equipes` `/intervenants` | admin/manager |
| Continuité | `/handovers` (`/continuite` redirige) | admin/manager |
| Mémoire/recherche | `/recherche` `/memoire` | admin/manager |
| AO & biblio | `/tenders` `/tenders/[id]` (+ `engagements`, `audit`, `convert`) `/library` `/documents` `/glossaire` | admin/manager |
| Preuves | `/preuves` `/litige` | admin/manager |
| Terrain (mobile/PWA) | `/m` (+ `site/[siteId]`, `intervention/[id]`, `actions`) | chef_equipe |
| Publics (sans login) | `/a/[token]` actions entreprise · `/i/[token]` intervention · `/h/[token]` passation · `/p/[token]` rapport · `/qr`·`/c`·`/v` | public |
| Admin | `/admin/*` (users, organisations, usage/coûts IA, monitoring, feedback) | admin |
| Manuel | `/manuel` (rend `docs/MODE_EMPLOI.md`) | admin/manager |

---

## Documentation

Trois documents majeurs (utilisation → technique → stratégie), maintenus en **base vivante**
(on rafraîchit, on ne réécrit pas — protocole en tête de chaque manuel) :

1. [`docs/manuel/01-COMMENT-PENSER-MEMORIA.md`](docs/manuel/01-COMMENT-PENSER-MEMORIA.md) — le modèle mental (stable).
2. [`docs/manuel/02-ARCHITECTURE-IA.md`](docs/manuel/02-ARCHITECTURE-IA.md) — la vérité technique.
3. [`docs/manuel/PLAN-MANUEL-UTILISATEUR.md`](docs/manuel/PLAN-MANUEL-UTILISATEUR.md) — structure du manuel utilisateur complet.

Plus : [`docs/MODE_EMPLOI.md`](docs/MODE_EMPLOI.md) (manuel court rendu sur `/manuel`) et
[`docs/manuel/README.md`](docs/manuel/README.md) (index + maintenance).

---

## Sécurité

- **Aucun secret réel commité.** `.env.local` est gitignored. Token exposé → le révoquer
  et le régénérer immédiatement.
- RLS Postgres active ; le client admin (service role) **contourne** la RLS → chaque
  requête admin filtre explicitement `organization_id`.
- `INITIAL_ADMIN_PASSWORD` / mot de passe temporaire : forcé à être changé à la première
  connexion (`must_change_password`).

## Statut

En **pilote** (BTP/Adrien, nettoyage, MOE/BECIB). Le produit est entré dans sa phase de
**validation terrain** : il ne manque plus de briques, il se nourrit de matière réelle.
Roadmap module AO/obligations : voir la mémoire projet et `docs/`.

## Licence

Propriétaire — usage interne MemorIA.
