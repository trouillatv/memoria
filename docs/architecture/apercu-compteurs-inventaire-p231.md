# #231 Aperçu Lot C — Inventaire READ-ONLY des compteurs (Phase 1)

**Doctrine (Vincent)** : tout compteur affiché doit permettre à l'utilisateur (1) de
comprendre ce qu'il compte, (2) de savoir si la liste visible est complète ou tronquée,
(3) d'accéder à la population. *Un compteur ne doit jamais annoncer 7 puis afficher
silencieusement 3.*

Périmètre : `SiteOverviewTab.tsx` + `SiteAttentionSection.tsx` (l'onglet Aperçu desktop/mobile).
Mesures : sondes READ-ONLY `scripts/p231-counter-audit.ts` + `scripts/p231-proposals-reports.ts`
(6 chantiers réels). **Aucune écriture.**

## Inventaire

| # | Libellé | Valeur (source) | Population réelle | Affichés | Cap | Destination actuelle | Gap |
|---|---|---|---|---|---|---|---|
| 1 | **Sujets d'action** (StateCard) | `actions.summary.active` | site_actions open/planned dédupliqués par thread | carte (nombre) | — | `/sites/[id]/actions` | OK — destination = population |
| 2 | **Réserves ouvertes** (StateCard) | `reserves.open` | statusSummary reserves | carte | — | `/sites/[id]/reserves` | OK |
| 3 | **Blocages en cours** (StateCard) | `blockages.open` | blocages `date_end IS NULL` | carte | — | **aucune (pas de href)** | **NON NAVIGABLE** — mais destination existante = `/reserves` (les blocages y sont déjà surfacés) → **corrigeable sans UX** |
| 4 | **Actions en retard** (StateCard) | `actions.summary.overdue` | open + explicit + due<today | carte | — | `/sites/[id]/actions` | OK (superset acceptable) |
| 5 | **N actions proposées** (bloc bleu) | `actions.summary.proposed` (**site-wide** : `site_knowledge_proposals` kind=action status=proposed) | toutes les propositions d'action en attente, **tous reports** | `proposed` = top 3 | **3** (silencieux) | « Voir la synthèse et confirmer » → **dernière visite** (`synthesisHref`) | **DOUBLE FAUTE** (voir ci-dessous) |
| 6 | **Depuis le dernier PV** (#230) | `pvActivity.groups[].total` | activité occurrence-first, acteurs exclus | ≤ 8 lignes | 8 (**explicite** : « +N autres ») | « Voir tous les changements » → `/historique?view=synthese` | OK — gelé #230 |
| 7 | **N autres sujets** (Attention) | `items.length − 3` (moteur `deriveCanonicalAttentionItems`, `limit:5`) | sujets canoniques scorés (signaux) | top 3 | **5 puis 3** | **aucune (texte seul)** | **DOUBLE TRONCATURE + IMPASSE** (voir ci-dessous) |
| 8 | **Que reste-t-il à faire ?** | `actions.priority.slice(0,3)` | actions actives priorisées | 3 | 3 (silencieux, priority cappé 5) | « Voir toutes les actions » → `/actions` | Navigable ✓ ; nombre caché non affiché (faible sévérité) |
| 9 | **Prochaine étape** | `nextEvent` (1) | — | 1 | — | Préparer / planning | Pas un compteur |

## Les deux fautes mesurées (chantiers réels)

### Compteur 5 — « N proposées » : troncature silencieuse **+ destination fausse**

`actions.summary.proposed` compte **tout le chantier** (`site_knowledge_proposals`,
kind=action, status=proposed, tous reports). Le lien pointe vers la **dernière visite
seule** (`activity.lastVisit.reportId`).

| Chantier | proposées | dans dernière visite | orphelines (autres reports) | reports porteurs | lien affiché ? |
|---|---|---|---|---|---|
| BELLA NAPOLI | 7 | 0 | **7** | 2 (imports 2024, 2025) | **non** (`lastVisit=null`) |
| OCEF Compostage | 15 | 0 | **15** | 4 (imports PV) | **non** (`lastVisit=null`) |
| Lycée PETRO ATTITI | 3 | 0 | **3** | 3 (visites spontanées) | oui → visite ne contenant **aucune** des 3 |
| Inspection DIMENC | 5 | 5 | 0 | 1 | oui ✓ (fonctionne) |
| POSTE 8 | 1 | 1 | 0 | 1 | oui ✓ |

- **Troncature** : Bella annonce 7, affiche 3, sans « +4 autres ».
- **Destination** : dans le cas courant (Bella, OCEF, PETRO) la destination ne contient
  **pas** la population comptée — voire aucun lien n'apparaît. Chaque proposition est
  bien atteignable **individuellement** via la page de *son* report
  (`/sites/[id]/visites/[reportId]/memoire`), mais **aucune surface existante n'agrège
  les propositions du chantier**. Le « Centre de validation IA » transversal est encore
  une vision, pas une page (mémoire `centre-validation-ia`).
- **Sémantique du compteur** : correcte — `status=proposed` = réellement en attente de
  décision humaine. Ne pas y toucher.

### Compteur 7 — « N autres sujets » (Attention) : double troncature **+ impasse**

Le moteur est appelé avec `limit:5`. La section affiche `top 3` et calcule
`rest = items.length − 3` — donc **au plus 2**, alors que le vrai total est bien plus grand.

| Chantier | total sujets scorés | « N autres » affiché aujourd'hui | vrai reste (total − 3) |
|---|---|---|---|
| OCEF Compostage | **17** | **2** | **14** |
| BELLA / PETRO | 3 | 0 | 0 |
| DIMENC / POSTE 8 | 0 | 0 | 0 |

- **Double troncature** : cap moteur (5) *puis* affichage (3) → OCEF annonce « 2 autres »
  pour **14** réels.
- **Impasse** : « N autres sujets » est un texte, sans lien.
- **Destination** : aucune surface existante ne représente **exactement** la population
  d'attention (`deriveCanonicalAttentionItems`). La plus proche —
  `/historique?view=synthese` (watchlist `computeWatchlist`) — utilise un **autre** score.

## Corrigeable immédiatement, sans nouvelle UX (Phase 2 candidate)

- **Compteur 3 (Blocages)** : ajouter `href={/sites/[id]/reserves}` — les blocages y sont
  déjà surfacés (`toBlocageReasons`). Destination existante, population cohérente.
- **Compteur 5** : rendre la troncature explicite (« +N autres », arithmétiquement exact).
- **Compteur 7** : rendre le nombre honnête (vrai reste, sans toucher sélection/score/limite
  #229 — via un simple comptage séparé).
- **Compteur 8** : optionnellement afficher le nombre restant.

## Gaps nécessitant une décision produit — **HARD STOP local**

Vincent : « Si aucune surface existante ne permet de représenter exactement une population,
documenter le gap et HARD STOP local avant de construire une nouvelle UX. » Deux gaps :

**Gap A — destination des propositions (compteur 5).** Aucune page n'agrège les propositions
en attente d'un chantier. Options :
- **A1 (aucune UX nouvelle, recommandé pour livrer vite)** : chaque ligne de proposition
  pointe vers la page d'arbitrage de *son* report (`…/visites/[reportId]/compte-rendu` ou
  `/memoire`) ; on ajoute « +N autres » ; on **retire** le lien agrégé trompeur « Voir la
  synthèse ». Chaque ligne atteint exactement sa surface d'arbitrage existante. Limite : pas
  de lien agrégé unique « Voir les 7 propositions → » (impossible sans surface d'agrégation).
- **A2 (nouvelle UX)** : créer la vue site « Propositions à confirmer » (= amorce du Centre
  de validation). Correspond littéralement à la cible « Voir les 7 propositions → », mais
  c'est une page neuve → nécessite le GO de Vincent.

**Gap B — destination de l'attention (compteur 7).** Aucune surface = population exacte.
Options :
- **B1 (aucune UX nouvelle, recommandé)** : corriger le nombre (honnête) et rendre « N autres
  sujets » cliquable vers `/historique?view=lifelines` ou `?view=synthese` en **assumant**
  que c'est une vue *voisine* (tous les sujets / watchlist), pas la population d'attention
  stricte — à valider par Vincent.
- **B2 (nouvelle UX)** : page « Sujets à surveiller » = sortie exacte du moteur d'attention.

**Aucun code écrit. Aucune donnée modifiée.** Décision attendue sur Gap A et Gap B avant Phase 2.

---

## Phase 2 — arbitrage Vincent : A1 + B1 (LIVRÉ)

**Invariant architectural #231 (figé)** : `population source unique → compteur exhaustif
→ aperçu éventuellement capé → « +N » exact → destination sur CETTE MÊME population`.
Jamais « compteur A → slice B → lien vers population C ». Aucun recalcul métier côté UI :
la destination consomme le MÊME read-model que le compteur. Formalisé (pur, testé) dans
`lib/knowledge/overview-counter.ts` (`sliceOverview`, `exactRemainder`).

**Gap A — A1 (réutilisation, aucune page neuve).** Nouvelle section « N propositions à
confirmer » (ancre `#propositions`) sur la surface chantier existante `/sites/[id]/actions`,
alimentée par `getSitePendingActionProposals` (`lib/knowledge/site-pending-proposals.ts`) =
EXACTEMENT la population du compteur (`site_knowledge_proposals`, kind=action, status=proposed,
toutes visites), avec provenance (PV/visite, date) ; chaque ligne → page d'arbitrage de son
report. Aperçu : « +N autres » exact + lien « Voir les N propositions → » vers
`/actions#propositions`. Sémantique du compteur inchangée.

**Gap B — B1 (vue sur la page Sujets existante).** Nouveau sous-onglet « Attention » sur la
page Histoire (`/sites/[id]/historique?view=attention`) rendant la population COMPLÈTE de
`deriveCanonicalAttentionItems` (même read-model, carte partagée `components/site/CanonicalAttentionRow`).
Le moteur retourne désormais tout quand `limit` est absent (le cap `5` puis `3` produisait
« 2 pour 14 »). Aperçu : 3 affichés, « +N autres · Voir les X → » exact.

**Corrigés sans gap** : Blocages (StateCard) → `href /reserves`.

**Recette LIVE `scripts/p231-recette-live.ts` (READ-ONLY) — égalité exacte à chaque étage** :
Bella proposées 7=7=7 (+4), attention 3=3=3 ; OCEF proposées 15=15=15 (+12), attention 17=17=17
(**+14, plus « 2 »**) ; PETRO 3=3=3. `visibles + masqués = compteur` partout.

**Gelé** : #229, #230, scoring/sélection Attention (seul le cap d'affichage/comptage change),
définition des propositions, données Bella. Tests purs `overview-counter.test.ts` (7). HARD STOP après #231.
