# Outils de recette / audit / rollback déjà construits

Index volontairement court : une ligne par outil suffit pour savoir qu'il existe. Pas d'explication longue — lire le fichier lui-même pour le détail.

Critère d'ajout : est-ce qu'une future session pourrait raisonnablement vouloir reconstruire cet outil parce qu'elle ignore son existence ? Si oui → ajouter une ligne. Si c'est un script jetable, un log ou une exploration ponctuelle liée à une campagne déjà close (ex. `apply-migration-NNN.ts`, un audit lié à un site déjà traité) → ne pas indexer.

| Outil | Type | Sert à | État / sécurité |
|---|---|---|---|
| `scripts/_p6d1b-recette-metier.ts` | recette | Recette métier post-APPLY P6 par site (CONFIRMED/PROVISIONAL, backref CBO, isolation candidates/pending) | prod, lecture seule ; adapter la liste `SITES` avant exécution |
| `scripts/_p6d1a-preflight-global.ts` | préflight | Préflight avant apply global P6, delta réel contre la DB (aucune écriture) | READ-ONLY ; fichier présent en working tree, pas encore commité |
| `scripts/_p6c-recette-rus.ts` | recette | Recette métier P6, variante mono-site (RUS) du pattern `_p6d1b-recette-metier.ts` | lecture seule |
| `scripts/recette-<type>-run.ts` + `scripts/rollback-<type>-test-run.ts` (action, reserve, deadline, visit-item, fact, observation, knowledge-correction, knowledge-lifecycle, relation-claim, schedule-event, watchpoint) | recette + rollback | Harnais réversible générique : exécute le pipeline réel de production, journalise les IDs créés dans un manifeste (`.recette-runs/`, gitignoré), rollback exact via `rollback-<type>-test-run.ts <testRunId>` | écrit puis annule proprement ; jamais de suppression sans manifeste — modèle à réutiliser pour toute nouvelle opération de test réversible |
| `scripts/audit-actions-provenance.ts` | audit | Trace la provenance des actions (pipeline de création, `created_from`) | lecture seule |
| `scripts/verify-canonical-invariants.ts` | verify | Vérifie les invariants canoniques post-backfill (identité, unicité) | lecture seule |
| `scripts/dedup-canonical-subjects-dryrun.ts` + `scripts/dedup-canonical-subjects-apply.ts` | dedup | Déduplication exacte de sujets canoniques : rapport avant validation, puis application | dryrun lecture seule, apply touche la prod |
| `scripts/backfill-actor-link-dryrun.ts` + `scripts/backfill-actor-link-apply.ts` | backfill | Matching `canonical_subject` → `company_contacts`/`companies` | dryrun lecture seule, apply touche la prod |
| `scripts/merge-petro-rollback.ts` | rollback | Restaure l'état pré-merge PETRO via snapshot | dry-run par défaut, `--apply` touche la prod |
| `scripts/verify-pushable.mjs` (`npm run verify:pushable`) | gate CI | Typecheck de l'arbre réellement commité avant push — cf. CLAUDE.md §14 | lecture seule |

## Témoins de tests notables

Aucun témoin de test n'est encore assez distinct d'un test unitaire ordinaire pour justifier une ligne ici (concurrence, rollback DB, recette cross-vues). À ajouter dès qu'un test remplit ce rôle et qu'une session aurait pu perdre du temps à le chercher sans le savoir.
