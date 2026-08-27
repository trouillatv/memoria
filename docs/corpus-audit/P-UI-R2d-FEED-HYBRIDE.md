# P-UI-R2d — Voie sémantique hybride branchée (auto borné / recherche approfondie explicite)

Date : 2026-08-27. Suite de [P-UI-R2c](./P-UI-R2c-FEED-SEMANTIQUE.md). Décision retenue (Vincent) :
**option D** — *automatique quand le coût est réellement borné, sinon proposition explicite ;
jamais silencieux, jamais entièrement caché dans un batch manuel, jamais désactivé en douce.*

## Stratégie livrée

Après chaque import, une fois la voie lexicale passée :
1. **plan GRATUIT** (`buildSemanticFeedPlan`, aucun appel LLM) → compte les paires sémantiques
   candidates (sources touchées × cibles actives, moins lexical/rejeté/pending/accepté) ;
2. `decideSemanticFeedMode(count, capped)` :
   - `≤ budget` → **AUTO** : le feed tourne tout seul (coût borné, non bloquant) ;
   - `> budget` → **DEFER** : aucun appel automatique ; l'humain se voit proposer une
     **recherche approfondie** explicite ;
   - `0` → rien.

Persistance **inchangée** : uniquement `shouldPersistSemanticSuggestion` (same_subject | related+SOH).
Toutes les protections R2c restent (rejet mémorisé, pending non dupliqué, paire normalisée A/B,
acteurs exclus, fusion existante exclue, cap dur, idempotence).

## Budget — seuil initial explicite et journalisé

`SEMANTIC_FEED_AUTO_BUDGET = 40` · `SEMANTIC_FEED_MAX_PAIRS = 300` (plafond dur, y compris manuel).

Estimation (light-tier, séquentiel ; le trigger est *fire-and-forget* donc la latence ne bloque
jamais l'utilisateur — seul le coût/proportion compte) :

| Comparaisons | Appels LLM | Latence approx. (arrière-plan) | Coût |
|---|---|---|---|
| 20 | 20 | ~30–45 s | négligeable |
| 50 | 50 | ~1–1,5 min | très faible |
| 100 | 100 | ~2,5–3 min | faible |
| 200 | 200 | ~5–6 min | modéré |

Le rendement mesuré en R2c (178 appels → 1 suggestion utile, 0,6 %) justifie un budget auto **bas** :
40 garde le travail automatique sous ~1 min d'arrière-plan et un coût trivial, et bascule tout le
reste vers une action humaine visible. Le seuil est une constante unique, journalisée, à réviser
après observation terrain (log `[semantic-feed] AUTO|DEFER …`).

## Surfaces

- **Résultat d'import** (primaire) : `memory-build-result.semanticDeepSearch` (dérivé, idempotent —
  une fois lancée, les paires deviennent pending → le compteur retombe → plus de proposition
  inutile) → `SemanticDeepSearchCta`. Affiché **uniquement** quand le mode est `defer`.
- **Ligne de vie / Rapprochements IA** : bouton « Recherche approfondie des rapprochements »
  (portée site, déclenché par l'humain, rapporte son résultat).

Aucune nouvelle grande page, aucune nouvelle table, aucun second moteur.

## Recette Bella Napoli (aucune écriture, aucune fusion)

- **Chemin A — import 2025 complet (16 sujets touchés)** : `178 paires · mode = DEFER`. **PROUVÉ
  live** : rien n'est lancé automatiquement, le CTA « recherche approfondie » est proposé. ✅
- **Chemin B — 1 sujet source « Dégagement extérieur du Mall »** : `19 paires · mode = AUTO`.
  **PROUVÉ live** : décision de cadence AUTO correcte, exécution tentée, **erreurs par paire
  isolées** (non bloquantes, aucun crash). L'exécution LLM n'a **pas pu aboutir** : les crédits
  Gemini (prepayment) sont **épuisés** (HTTP 429 RESOURCE_EXHAUSTED). ⚠️ **Blocage externe de
  facturation, pas un défaut de code.**
  - La production réelle de la carte témoin a déjà été **prouvée le matin même en R2c** (même juge,
    même gate) : `« Largeur de passage des dégagements réduite (par frigos) » ↔ « Dégagement
    extérieur du Mall »` → `related SOH=true 65 %`.

Note : Mall/food court a déjà été fusionné humainement — le témoin n'est donc pas cette paire mais
la continuité Largeur/​Dégagement, ce qui reste une bonne recette de « carte produite ».

## Vérifications

| Vérification | Résultat |
|---|---|
| Tests ciblés (sélection + décision + gate + contexte) | **PASS** — 32 |
| Typecheck | **PASS** — 0 |
| Lint (fichiers du lot) | **PASS** — 0 erreur (2 warnings préexistants hors périmètre) |
| Recette A (DEFER) | **PROUVÉ** live |
| Recette B (mode AUTO + isolation d'erreur) | **PROUVÉ** live ; exécution LLM **BLOQUÉE** (quota Gemini épuisé) |

## Reste / blocage

- **BLOCAGE facturation** : la voie sémantique automatique et la recherche approfondie ne
  produiront de suggestions qu'une fois les crédits Gemini rechargés (429 actuellement). Le code est
  non bloquant : un import ne casse jamais, les erreurs sont isolées et journalisées.
- Boucle de rapprochement transverse considérée **close côté code** une fois le quota rétabli et une
  recette AUTO live re-passée. Ensuite : **P3-B1** (éligibilité des observations à la mémoire
  longitudinale).

**HARD STOP.**
