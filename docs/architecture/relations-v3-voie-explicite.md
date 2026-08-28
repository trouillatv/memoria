# V3 — voie explicite depuis subject_relational_evidence (design + dry-run)

**Statut : DESIGN + DRY-RUN. READ-ONLY, aucune écriture, aucune activation, aucun code branché. HARD STOP.**
**Dry-run PROPRE (0 faux positif) MAIS rendement 0 sur le corpus visite actuel — attendu, et acceptable
(V2 vaut déjà par lui-même). Pas d'activation avant ton GO.**

---

## Doctrine (rappel)
V3 = **2ᵉ voie d'acquisition**, complémentaire, jamais un remplacement du moteur cooccurrence :
- **Voie A** (active) — cooccurrence répétée ≥3 → moteur PV/CR → `canonical_subject_links`.
- **Voie B** (V3) — **preuve explicite forte** (une phrase reliant 2 sujets, conservée par V2) → candidat
  immédiat **cooc=1** → **MÊME juge durci** → **MÊME whitelist serveur** → `canonical_subject_links` suggested.
Les deux voies partagent : juge, whitelist, exclusion acteurs, table, statut `suggested`, preuve obligatoire.
Aucun second moteur métier.

## 1. Sélection
Une ligne `subject_relational_evidence` est candidate ssi : `array_length(subject_ids,1) >= 2` ; sujets business
valides du même site (acteurs exclus) ; `evidence_text` non vide ; paire pas déjà présente (confirmed/suggested/
rejected) dans `canonical_subject_links`. **Bornage >2 sujets** : si une preuve porte >4 sujets → sur-appariement
probable, on n'énumère pas ; sinon toutes les paires (n≤4 → ≤6), dédupliquées globalement par (report, paire, préfixe evidence).

## 2. Le juge reste l'autorité sémantique
Les marqueurs V2 servent à **retenir** une phrase, JAMAIS à qualifier la relation. Seul `qualifyLinkCandidate`
(durci) produit `requires|enables|validates|causes|replaces|no_relation` ; la whitelist serveur décide de la
persistance (`relates_to` rejeté). L'evidence soumise au juge = la phrase V2 (elle mentionne les deux sujets).

## 3. Provenance (décision, PAS de migration opportuniste)
`canonical_subject_link_evidence` porte déjà `evidence_text` (NOT NULL) + `source_proposal_id` (nullable). V3
peut donc écrire la **preuve verbatim** + la proposition source **sans migration**. Un lien fin vers la ligne
`subject_relational_evidence.id` demanderait une colonne additive `subject_relational_evidence_id` →
**NON appliqué ici** (HARD STOP avant migration opportuniste). Recommandation : démarrer sans (evidence_text +
source_proposal_id suffisent à la traçabilité), ajouter la FK plus tard si la traçabilité exacte à la preuve V2 devient utile.

## 4. Idempotence
- Même visite / même preuve / même couple → pas de doublon : contrainte existante `canonical_subject_links`
  UNIQUE(site_id, pair_low_id, pair_high_id) (une relation par paire) + exclusion des paires existantes avant appel juge.
- **Même relation prouvée par plusieurs visites** : la 2ᵉ preuve ne crée pas un 2ᵉ lien (paire déjà présente) ;
  la preuve supplémentaire peut être ajoutée dans `canonical_subject_link_evidence` (N preuves pour 1 lien) —
  le modèle le permet (link_evidence est 1..N). À implémenter à l'activation.

## 5. Dry-run AVANT écriture (`scripts/dry-run-v3-explicit.ts`, corpus visite réel, aucune écriture)
La table V2 étant vide (se remplit aux futures visites), les preuves sont reconstruites par la MÊME extraction
pure que le module V2.

| Mesure | Valeur |
|---|---|
| Preuves V2 reconstruites | 17 |
| avec ≥2 sujets | **2** |
| Paires candidates bornées | 7 |
| Appels juge | 7 |
| no_relation | **7** |
| relates_to rejetés | 0 |
| **SUGGESTED (écriraient)** | **0** |
| acteurs dans le pool | **0** |

**0 faux positif, 0 inversion, 0 mauvais type, 0 acteur, 0 preuve insuffisante écrite.** Le juge durci refuse
correctement les co-mentions multi-sujets d'une même phrase quand aucune dépendance n'est affirmée ENTRE la
paire (règle « relation entre les deux sujets »). Rien à vérifier humainement (0 suggested).

## 6. Témoins
- *nettoyage remplace carrelage* : « carrelage » n'est pas un canonical_subject durable → 0 endpoint valide → pas de relation (correct, on ne force pas).
- *produits repris → revégétalisation* : ni « produits » ni « revégétalisation » ne sont des sujets → 0 endpoint → rien (correct).
- *cadenas avant démarrage* : « démarrage » = événement, pas un sujet → 1 seul sujet → conservé en V2, rien en V3 (correct).
Aucun deuxième endpoint inexistant n'est fabriqué.

## 7–8. Branchement & observabilité (à l'activation, sur GO)
Ordre visite : `reconcile/projection → capture V2 → V3 (evidences ≥2 sujets → juge → whitelist → suggested)`,
best-effort, jamais bloquant. Métriques à logger : preuves V2, preuves ≥2 sujets, paires V3, appels LLM,
no_relation, relates_to rejetés, suggested, doublons, coût — pour comparer plus tard Voie A vs Voie B.

## 9. UX
Écran global Dépendances toujours masqué. Fiche sujet non touchée tant que V3 ne produit pas de vraies relations propres.

---

## Verdict & recommandation
**Critères de GO tous verts sur la sûreté** : 0 FP, 0 inversion, 0 acteur, preuve obligatoire, coût borné
(≤ quelques appels/visite), aucune relation sans 2 canonical_subjects réels. **Idempotence** : garantie par
la contrainte de paire existante (à re-prouver empiriquement à l'activation, la table cible étant non peuplée).

**Rendement actuel = 0** : le corpus visite ne porte pas encore de dépendance sujet↔sujet prouvable — cohérent
avec les audits précédents. Ce n'est PAS un échec : V2 conserve déjà la matière ; V3 se déclenchera dès qu'une
visite exprimera une vraie dépendance entre deux sujets durables.

**Deux options pour toi :**
1. **Activer V3 maintenant** (best-effort, après la capture V2) : sûr (0 écriture aujourd'hui), il se déclenchera
   silencieusement quand la matière arrivera. Coût nul tant que 0 preuve ≥2 sujets.
2. **Garder V3 non branché** jusqu'à ce qu'une vraie dépendance visite apparaisse, puis activer.

**HARD STOP après dry-run. Aucune activation avant ton rapport/GO.** Moteur PV/CR, juge et V2 non touchés.
