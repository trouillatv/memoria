# Économie de contexte et de tokens — détails

Ce document détaille les règles courtes de CLAUDE.md §27 (Économie de contexte et de tokens). Il n'ajoute aucune règle : il explique le pourquoi et donne les commandes/exemples. Les règles permanentes restent dans CLAUDE.md ; ne pas dupliquer la doctrine ici.

## Graphify — commandes utiles au quotidien

- `graphify query "<question>"` — traversée BFS du graphe pour répondre à une question d'architecture (budget par défaut 2000 tokens de sortie).
- `graphify explain "X"` — explication en langage naturel d'un nœud (fichier/symbole) et de ses voisins directs.
- `graphify affected "X"` — traversée inverse : qui dépend de X / qui est impacté par un changement sur X.
- `graphify path "A" "B"` — plus court chemin entre deux nœuds du graphe.
- `graphify god-nodes` — nœuds les plus connectés (hubs architecturaux), utile pour repérer un point de passage obligé avant une refonte.
- `graphify update .` — ré-extraction incrémentale du code, sans LLM, coût 0 token. À lancer si l'index a plus de 10 commits de retard (cf. CLAUDE.md §23).
- `graphify check-update .` — vérifie le retard de l'index sans avoir à scripter la comparaison de commit soi-même (cron-safe).

## Support SQL

Activé le 2026-09-10 via :

`uv tool install "graphifyy[sql]" --force`

Cette commande installe `tree-sitter-sql` dans l'environnement isolé propre à l'outil Graphify (géré par `uv tool`), sans toucher à l'environnement Python du projet MemorIA ni à aucune dépendance applicative.

Effet de bord observé : la réinstallation a aussi fait passer `graphifyy` de 0.9.28 à 0.9.57, car `uv tool install` résout la dernière version compatible du paquet de base — il n'existe pas d'option pour ajouter uniquement l'extra `[sql]` sans réévaluer la version. Aucun changement de distribution ni de méthode d'installation (toujours `uv tool install`, comme documenté en §23).

Vérifier l'état : `graphify --version`. Après activation, relancer `graphify update <path>` sur chaque worktree à jour : les fichiers `.sql` précédemment « vides » ne sont plus mis en cache comme vides et sont retentés automatiquement.

Même avec le support SQL actif, Graphify aide à **localiser** une migration, une RPC ou une dépendance SQL — il ne remplace jamais la lecture directe du fichier de migration avant une décision touchant un invariant DB, un ordre de verrou, une transaction ou de la concurrence (cf. CLAUDE.md §15 et §23).

## Lectures ciblées — exemple concret

Question type : « quel est l'impact d'un renommage dans `lib/knowledge` ? »

- Sans Graphify : lire tout `lib/knowledge` et grepper largement le dépôt pour trouver les appelants.
- Avec un index frais (< 10 commits de retard) : `graphify affected "lib/knowledge/<symbole>"` donne la liste des appelants réels ; n'ouvrir ensuite que ces fichiers-là.

Ne pas relire un ensemble de fichiers déjà étudié dans la session courante « par sécurité » si aucune hypothèse n'a changé depuis. Réutiliser en priorité : la mémoire de session, les documents canoniques (`docs/10_JOURNAL_DECISIONS.md`, les audits `*-CLOSED.md`), et l'index Graphify.

## Rapports delta-only — exemple

À éviter : lister individuellement les 24 tests exécutés et leur durée quand ils passent tous sans rien de nouveau à signaler.

À préférer : `PASS — 24/24 — 6,2 s`. Ne détailler que ce qui a échoué ou ce qui constitue une anomalie utile à la décision.

## Modèles Claude — détail du routage

| Modèle | Effort | Usage typique |
|---|---|---|
| Haiku 4.5 | Faible/Moyen | Git, Graphify, recherches mécaniques, renommages, petites tâches documentaires |
| Sonnet 5 | Moyen | Développement courant, tests, UI, read-models, corrections ciblées |
| Sonnet 5 | Élevé | Migrations, SQL transactionnel, concurrence, invariants, identité canonique, pré-GO sensible |
| Opus 5 | Élevé | Seulement après un blocage réel de Sonnet, ou un arbitrage architectural réellement difficile |
| Fable 5.1 | Élevé | Exceptionnel, si Opus ne suffit pas |

Principe : le modèle le plus puissant n'est pas le choix par défaut. Une tâche mécanique (renommage, recherche Graphify, mise à jour d'index) reste sur un modèle léger même si le dépôt global est complexe — la complexité du dépôt ne rend pas la tâche elle-même plus difficile.
