# P1-C1b — Résultats : A (réparation historique) + B (workflow lien acteur)

Date : 2026-08-27. Bug A uniquement. Doctrine A/B appliquée (Vincent). Bug B strictement exclu.
Site Bella Napoli `cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6`.

## A — Réparation historique (backfill one-time)

Les 9 faits métier absorbés par des acteurs ont été replacés sur des sujets métier durables.
Snapshot rollback : `p1c1b-rollback.json` (22 occurrences + 9 STV + 3 CS créés).

| Métrique | AVANT | APRÈS |
|---|---|---|
| Occurrences métier sur un CS acteur | 9 | **0** |
| spanning_both (2024↔2025) | **0** | **3** |
| WRONG_MERGE | ≥ 8 | **0** |
| Chaînes métier correctes | 0 | 3 |
| CS acteurs préservés | 16 | 16 |

Décisions appliquées : #1 KFT, #2 BV cuisson, #3 MIES friteuse → rejoin existant ; #4 MIES
extincteurs, #5 CAPSE flux → rejoin existant (matcher trop verbeux) ; #6 BV électrique →
**création** «Contrôle des installations électriques» (distinct de «Registre…») ; #7 DSCGR →
rejoin «Dégagement extérieur du Mall» ; #8 VHZ, #9 Velayoudon → création. Chaînes qui traversent
désormais 2024↔2025 : **extincteurs, friteuse, nettoyage**. Preuve acteur conservée dans le texte.

## B — Workflow futur (le vrai livrable : ne plus jamais reproduire le défaut)

Nouveau modèle transverse, alimenté automatiquement à chaque import historique :

- **Table `canonical_subject_occurrence_actor_link`** (mig 356) : `occurrence_id`,
  `actor_subject_id` (FK canonical_subject kind=actor), `relation_type`, `source`, `evidence_cue`,
  unique `(occurrence_id, actor_subject_id, relation_type)`, `ON DELETE CASCADE` sur l'occurrence.
  Lien au niveau **OCCURRENCE** (fait daté), jamais du sujet durable. Acteurs restent dans le
  registre canonique (pas de duplication dans `site_knowledge_entities`).
- **Vocabulaire relation_type** (petit, extensible) : `performed_by`, `proposed_by`,
  `validated_with`, `mentioned`. **Pas de `responsible_for`**.
- **Brique pure `lib/db/actor-citation.ts`** (`detectActorRelations`) : détection déterministe,
  frontières lexicales, label + alias normalisés, phrase contiguë (pas de sous-chaîne
  accidentelle), rôle lu dans les mots précédant la mention. Défaut prudent = `mentioned`.
- **Câblage `ensureHistoricalPdfOccurrences`** : acteurs candidats **restreints au document**
  (propositions person/company du run → CS acteur), jamais tout le site. Lien créé seulement si
  l'acteur est cité dans le texte du fait. Idempotent (upsert), reconstruit à la régénération
  (cascade).

Contrat atteint (futur CR Géant « Vérification SSI réalisée par SOCOTEC » → sujet SSI + acteur
SOCOTEC `performed_by`, jamais sujet=SOCOTEC).

### Recette (workflow appliqué en backfill sur Bella Napoli) — 12 liens

| Occurrence | relation_type | Acteur |
|---|---|---|
| Nettoyage conduits (2024) | performed_by | KFT |
| Contrôle appareils cuisson (2024) | performed_by | Bureau Veritas |
| Contrôle installations électriques (2024) | performed_by | Bureau Veritas |
| Contrôle système extinction friteuse (2024) | performed_by | MIES |
| Contrôle des extincteurs (2024) | performed_by | MIES |
| Séparation des flux (2024) | **proposed_by** | CAPSE NC |
| Dégagement extérieur du Mall (2024) | **validated_with** | DSCGR |
| Contrôles climatisation (2025) | performed_by | VHZ réfrigération |
| Récupération des huiles usagées (2025) | performed_by | Velayoudon |
| Contrôle éclairage de sécurité (2025) | performed_by | Bureau Veritas (alias « Bureau Véritas ») |
| Contrôle des extincteurs (2025) | **mentioned** | MIES (« prochaine échéance … par MIES ») |
| Contrôle système extinction friteuse (2025) | **mentioned** | MIES (idem) |

Les 3 derniers sont des **découvertes génériques** du workflow (au-delà des 9 réparés), toutes
vérifiées dans le texte source. Les deux « échéance … par MIES » sont classés `mentioned` (prudent,
**pas** performed_by ni responsibility) — exactement le niveau de rigueur voulu.

**Invariants** : 12 liens, 12 distincts (0 doublon) ; 0 lien dont l'acteur n'est pas kind=actor ;
0 lien sur une occurrence dont le sujet est kind=actor.

## Vérifications

| Vérification | Résultat |
|---|---|
| Tests ciblés (5 fichiers, 84 tests dont 20 nouveaux actor-citation) | **PASS** |
| Typecheck `tsc --noEmit` | **PASS (0)** |
| Lint | **PASS (0)** |
| Recette liens (invariants) | 0 doublon / 0 acteur-non-acteur / 0 sujet-acteur |

## Ce qui N'est PAS fait (volontairement)

Pas d'unification avec `site_knowledge_entities` ; pas de `responsible_for` ; pas de lien au niveau
du sujet durable ; pas de règle CAPSE ; **pas de P1-C2** (rapprochement sémantique inter-années —
Mall vs food court reste séparé) ; pas d'UI Intervenants (la structure est prête pour elle).

## Reste

- **P1-C2** (séparé, après HARD STOP) : mécanisme de workflow de rapprochement sémantique
  inter-PV, garde-fous anti-sur-fusion. Jamais une fusion Bella Napoli manuelle.
- Cuisson ne traverse pas 2024↔2025 (le signal 2025 est une *observation*, famille non éligible
  aux occurrences historiques) — à examiner hors périmètre si utile.

**HARD STOP** avant P1-C2.
