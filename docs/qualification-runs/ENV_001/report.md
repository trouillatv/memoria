# ENV_001 — Charte Chantier Propre DREAL Normandie — rapport de qualification (Phase C)

## Verdict sur le 0-proposition : SOUS-EXTRACTION, pas un cas correct

MemorIA a produit **0 proposition** sur ce document. Ce n'est **pas** un résultat correct par absence de contenu métier — c'est une perte de contenu imputable au pipeline.

- Le document est une charte contractuelle prescriptive de 7 pages (« Charte Chantier Propre » puis clauses numérotées `CHANTIER.x.x`, référentiel NF HABITAT HQE / DREAL Normandie).
- La référence indépendante (Phase A, lecture directe du PDF) y identifie **34 prescriptions substantielles** (famille `knowledge_fact`, catégorie `permanent_instruction` : nuisances acoustiques, poussières, déchets, eau/énergie, démolition, information des riverains, FDS, faune/flore, etc.).
- Il est cohérent que la référence ne contienne **aucune** personne, entreprise, action, décision ou échéance nommée : seuls des rôles contractuels génériques sont cités (Maître d'Ouvrage, Maître d'Œuvre, SPS, entreprise de gros œuvre). Ce n'est donc pas un document vide de type gabarit (comme `BTP_008`), c'est un document dense en prescriptions.
- Ce type de contenu (charte / instructions permanentes) est précisément ce que le pipeline MemorIA sait extraire ailleurs dans le même corpus de qualification :

| Corpus | knowledge_fact extraits |
|---|---|
| IND_002 | 50 |
| LRM_01 | 39 |
| JAR_01 | 39 |
| QHSE_004 | 11 |
| VRD_002 | 11 |
| **ENV_001** | **0** |

- La cause technique probable, visible dans `docs/qualification-runs/phase-b-manifest.json` : la 1ère tentative d'extraction sur ENV_001 a échoué avec `no_extractable_text` (PDF scanné sans couche texte native). La 2e tentative (retry) est passée en statut `ready_for_review` mais n'a produit que 14 evidence de type image (rendus de pages) et 0 proposition — alors que la référence Phase A confirme un scan **net et lisible** sur les 7 pages, sans zone OCR illisible.
- Conclusion : la branche de repli OCR/scan a réussi à rasteriser les pages mais **n'a pas réussi à transmettre leur contenu textuel à l'étape d'extraction des propositions** (ou celle-ci a échoué silencieusement). C'est un défaut de la chaîne OCR→extraction sur les PDF scannés sans texte natif, pas une limite du modèle d'extraction lui-même (qui fonctionne sur des chartes équivalentes ailleurs).

## Recall / précision par famille

| Famille | Éléments référence | Appariés (MATCHED/PARTIAL) | Manqués (MISSED) | Recall | Précision |
|---|---|---|---|---|---|
| knowledge_fact | 34 | 0 | 34 | **0 %** | non calculable (0 proposition émise) |
| person / company / action / decision / deadline / reservation | 0 | — | — | n/a (rien à trouver, cohérent) | n/a |

- **Aucun faux positif** (0 proposition, donc aucune hallucination) mais **aucun vrai positif** non plus.
- 34/34 éléments de référence classés **MISSED**.
- 0 proposition non appariée (pas de `FALSE_POSITIVE` ni de `LEGITIMATE_EXTRA` à classer).

## Images

- Référence Phase A : **0 photo/plan/image** dans le PDF (texte pur, en-têtes/pieds de page uniquement).
- MemorIA : **14 evidence de type `image`**, soit 2 par page × 7 pages.
- Examen des métadonnées (bbox, dimensions) : ce sont des **rendus rasterisés des pages du PDF scanné**, pas des photographies de chantier — une paire par page (1 rendu pleine page au format A4, 1 rendu recadré sur le bloc de texte central). C'est un artefact technique du pipeline OCR/scan (déclenché après l'échec initial `no_extractable_text`), sans valeur métier en l'état.
- 6 des 14 evidence portent une légende auto-générée, mais ce sont des **fragments de mots tronqués** issus de l'OCR du titre de page (« Ré », « Absence », « Préparation », « NF HAB », « Dém », « Terrasse », « Tranch ») — aucune n'est exploitable comme légende de photo de chantier.
- **0/14** pertinentes comme photos au sens métier ; **14/14** sont des artefacts de scan à faible valeur ajoutée. Aucune n'est reliée à une proposition (`proposalEvidenceLinks` vide), ce qui confirme qu'aucun pont n'a été fait entre ces images et un quelconque contenu extrait.

## Synthèse

ENV_001 est le cas le plus clair du corpus de qualification d'une **sous-extraction totale** plutôt que d'un document sans substance. La référence prouve la présence de 34 prescriptions réelles et le pipeline MemorIA a démontré, sur des documents analogues (chartes/instructions permanentes), sa capacité à en extraire des dizaines. Ici, le chemin OCR-vers-extraction s'est interrompu quelque part entre la rasterisation des pages (réussie, 14 images) et l'extraction des propositions (0 résultat), malgré un scan net et lisible. À corriger avant de considérer le pipeline fiable sur des PDF scannés sans texte natif — ce cas ne doit pas être compté comme une réussite de non-hallucination dans la synthèse transversale du benchmark.
