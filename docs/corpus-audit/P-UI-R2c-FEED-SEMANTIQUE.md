# P-UI-R2c — Voie sémantique vers les suggestions de rapprochement (cœur + dry-run)

Date : 2026-08-27. Suite de [P-UI-R2b](./P-UI-R2b-RACCORD-CORE.md). Objectif : compléter le
workflow humain de rapprochement pour les paires que la voie **lexicale**
(`generateCandidates`, Jaccard ≥ 0.2) ne produit pas — deux sujets désignant le même objet
réel mais formulés différemment (le cas Mall / food court à l'origine de tout ce travail).

**Aucun second moteur, aucune nouvelle table, aucune nouvelle UI.** Même juge
(`analyzeSubjectPair`), même persistance (`upsertSuggestion`), même gate que R2b
(`shouldPersistSemanticSuggestion`). Ce lot ne fait que **choisir** les paires non lexicales à
soumettre au juge.

## Livré (cœur, testé, PAS branché)

- **`lib/subjects/semantic-feed-candidates.ts`** (pur) — `buildSemanticFeedPairs` : sources
  touchées × cibles actives, exclusions strictes (self, doublon A/B, **lexical-couvert**,
  rejeté, pending, accepté/fusionné), **cap dur → skip total** si trop de paires. Favorise le
  faux négatif : mieux vaut ne rien proposer qu'inonder le juge.
- **`lib/subjects/occurrence-context.ts`** — `loadOccurrenceContextMap` + `formatOccurrenceContext`
  (pur) : contexte compact (label — note récente, borné) transmis au juge. On a prouvé (R2) que
  le libellé seul ne suffit pas toujours à trancher « même objet ? ».
- **`lib/subjects/semantic-feed-run.ts`** — `runSemanticFeed` : orchestre plan → contexte →
  `analyzeSubjectPair` → persistance **uniquement via `shouldPersistSemanticSuggestion`**.
  Acteurs déjà exclus (contexte business-only). `dryRun=true` → aucune écriture.
- **`scripts/dryrun-semantic-feed.ts`** — dry-run reproductible (site/report/cap paramétrables).

Vérifs : 18 tests (`tests/subjects/semantic-feed-candidates.test.ts`) PASS ; typecheck 0 ; lint 0.

## Dry-run Bella Napoli (import 2025, `68c3487e…`, AUCUNE écriture)

16 sujets touchés (sources) × 20 sujets métier actifs (cibles) → **178 paires** après exclusions
(cap relevé à 300 pour OBSERVER le juge ; au cap par défaut 60, le feed skippe et n'appelle rien).

**Qualité du juge (le signal `same_object_hypothesis` fonctionne) :**
- **1 seule paire persistable / 178** — et elle est légitime :
  `« Largeur de passage des dégagements réduite (par frigos) » ↔ « Dégagement extérieur du Mall »`
  → `related SOH=true 65 %` : une vraie question « Même sujet ? » que la voie lexicale
  (Jaccard ≈ 0) ne produirait jamais. L'humain tranche (probablement « Garder séparés », mais
  c'est à lui).
- **Aucune sur-fusion, aucun bruit persistable.** Toutes les paires `related` fortes restent
  `SOH=false` → **pas de carte de fusion** : extincteurs ↔ extinction friteuse (85 %), contrôle
  électrique ↔ cuisson (85 %, « sous-ensemble »), cuisson ↔ arrêt d'urgence (75 %), séparation
  flux ↔ dégagement Mall (65 %, « pas le même objet »).
- **Registre ↔ Contrôle** : `distinct`/`SOH=false` — le contre-exemple visé est respecté.
- **Zéro acteur** (contexte business-only) ; **zéro doublon** (exclusions + normalisation A/B).

**Coût (le point de décision) :** **178 appels LLM pour 1 candidat utile (taux 0,6 %)**. Sur un
chantier réel (100+ sujets, 30 touchés) la voie « touchés × tous les actifs » = **plusieurs
milliers d'appels par import** — l'avalanche que la doctrine interdit. Le cap par défaut (60)
protège en skippant, mais alors le feed **ne tourne quasiment jamais**.

## Décision requise avant de brancher (P-UI-R2d) — HARD STOP

Le cœur est sûr et prouvé. Le **branchement** dépend d'un arbitrage coût/couverture qui est un
choix produit, pas une évidence technique :

- **A — Sur demande / batch (recommandé).** Ne PAS lancer la voie sémantique automatiquement à
  chaque import. L'exposer comme action explicite (bouton « chercher des rapprochements
  sémantiques » sur un chantier) ou balayage périodique. Coût maîtrisé, zéro avalanche, respecte
  favoriser-le-faux-négatif. Le feed reste dispo quand un humain le demande.
- **B — Automatique par import, cap total.** Brancher dans `triggerIncrementalSimilarityAnalysis`
  avec un cap qui skippe dès que c'est gros. Conséquence : ne tourne que sur très petits
  chantiers ; sur les autres, silencieusement inactif (à journaliser, sinon « couvert » à tort).
- **C — Automatique par import, espace réduit.** Restreindre les cibles (ex. même topic +
  sans-thème, comme `generateCandidates`) pour borner sans tout skipper. **Risque prouvé par le
  dry-run** : le seul candidat utile (Largeur/​Dégagement Mall) est probablement **cross-topic** —
  un filtrage par topic ré-introduirait exactement l'angle mort qu'on cherche à couvrir.

Recommandation : **A**. Le taux 0,6 % et le coût par import montrent qu'un balayage sémantique
aveugle à chaque import n'est pas rentable ; en revanche, disponible **à la demande**, il capte
le cas cross-lexical sans coût récurrent. Ton arbitrage attendu avant P-UI-R2d.

**HARD STOP.** Cœur livré + prouvé sur données réelles. Le branchement (cadence + cap) attend ta
décision A / B / C.
