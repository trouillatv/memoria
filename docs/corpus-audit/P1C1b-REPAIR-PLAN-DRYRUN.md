# P1-C1b étape 1 — Plan de réparation + dry-run (READ-ONLY, AUCUNE écriture)

Date : 2026-08-27. Réparation des conséquences de Bug A sur Bella Napoli (9 occurrences métier
rattachées à des CS `kind='actor'`). **Aucun UPDATE/DELETE avant GO suivant.** Bug B strictement exclu.
Site `cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6`. Sources : `_p1c1b-deps-schema.mjs`, `_p1c1b-audit.ts`.

## Constat structurant : la pollution est confinée à la mémoire longitudinale

Audit exhaustif des 15 tables référençant `canonical_subject`. Pour les 7 CS acteurs concernés,
**seules deux tables sont polluées** : `subject_thread_identity` (9 threads métier) et
`canonical_subject_occurrence` (7 occurrences). **Tout le reste = 0** :

| Table | Réf. aux 7 CS acteurs |
|---|---|
| `canonical_subject_occurrence` | 7 |
| `subject_thread_identity` (threads métier) | 9 |
| `site_actions` / `site_deadlines` / `site_reserve` / `site_knowledge_proposals` | **0** |
| `canonical_business_object` (+ members) | **0** |
| `canonical_subject_links` (source/target) | **0** |
| `canonical_topic_subject` / `site_visit_preparation_item` / `..._merge` / `..._evolution_shadow` | **0** |

⇒ **Bug A n'a jamais atteint les objets opérationnels** (actions/réserves/échéances) ni les relations,
CBO, préparations de visite. La réparation ne touche que STV + occurrences. C'est le meilleur cas.

## 1. Les 9 transformations

| # | Occurrence / fait (thread) | Date | CS actuel (acteur) | CS métier cible | Catégorie |
|---|---|---|---|---|---|
| 1 | Nettoyage conduits… par KFT (`c7007e35`) | 2024 | KFT | «Nettoyage conduits d'extraction…» (existe) | **A — rejoin** |
| 2 | Appareils de cuisson… par Bureau Veritas (`2ac456a4`) | 2024 | Bureau Veritas | «Contrôle des appareils de cuisson…» (existe) | **A — rejoin** |
| 3 | Système extinction friteuse… par MIES (`b5215bff`) | 2024 | MIES | «Contrôle système d'extinction auto (friteuse)» (existe) | **A — rejoin** |
| 4 | Extincteurs contrôlés par MIES (`81eed86d`) | 2024 | MIES | «Contrôle des extincteurs» (existe, 2025) | **B — LIKELY_EXISTING** |
| 5 | Panneau + marquage / séparation flux (`09d989a8`) | 2024 | CAPSE NC | «Séparation des flux public/personnel…» (existe, 2024) | **B — LIKELY_EXISTING** |
| 6 | Installations électriques… par Bureau Veritas (`d5971c29`) | 2024 | Bureau Veritas | (aucun clair — voir §3) | **B — AMBIGUOUS** |
| 7 | Validation issue Mall (DSCGR) (`3703e1b3`) | 2024 | DSCGR | (Dégagement Mall ? / nouveau ? — voir §3) | **B — AMBIGUOUS** |
| 8 | Contrôles climatisation (VHZ) (`07974f13`) | 2025 | VHZ réfrigération | «Contrôles climatisation» (à créer) | **B — SAFE_CREATE** |
| 9 | Récupération huiles (Velayoudon) (`d020a87a`) | 2025 | Velayoudon | «Récupération des huiles usagées» (à créer) | **B — SAFE_CREATE** |

**Pooling à connaître (§2)** : les occurrences Bureau Veritas (`9468ad12`, ev=2) et MIES (`481dd989`, ev=2)
**poolent chacune DEUX sujets distincts** (#1+#6 cuisson+électrique ; #3+#4 friteuse+extincteurs). Une
occurrence unique ne peut donc pas être « déplacée » — il faut réparer la STV puis **régénérer** les
occurrences (une par CS cible).

## 2. Dépendances DB à déplacer / conserver

- **À réparer** : `subject_thread_identity` (9 threads métier → repointer vers le bon CS) ;
  `canonical_subject_occurrence` (7 occurrences dérivées — à régénérer, pas simplement déplacer, à cause
  du pooling BV/MIES).
- **À CONSERVER intactes** : les STV **acteur** (1 par CS acteur : le thread `company`) — KFT/BV/MIES/…
  restent des acteurs légitimes. Aucune suppression de CS acteur.
- **Rien d'autre** : 0 dépendance dans actions/deadlines/reserve/knowledge/CBO/links/topic/prep/merge.
- **Preuve source préservée** : `source_proposal_id` / `source_ref_id` des propositions inchangés ; la
  régénération relit les mêmes propositions.

## 3. Classement des 6 Phase-2 (le point critique — éviter la fragmentation)

Comparaison de chaque candidat au pool `business_subject` (Jaccard + tokens significatifs communs) :

- **SAFE_CREATE (2)** — aucun sujet métier proche, création sûre :
  - #8 «Contrôles climatisation» (VHZ) — 0 token commun avec tout le pool.
  - #9 «Récupération des huiles usagées» (Velayoudon) — 0 token commun.
- **LIKELY_EXISTING_BUT_MATCHER_MISSES (2)** — un sujet métier existant est manifestement le même, le
  matcher déterministe l'a manqué (verbosité + nom d'acteur). **NE PAS créer de doublon ; rejoindre** :
  - #4 «Extincteurs contrôlés par MIES» → **«Contrôle des extincteurs»** (token commun `extincteurs`).
    Rejoindre crée en bonus la continuité 2024↔2025 sur ce sujet (même sujet, pas une fusion sémantique).
  - #5 «Panneau + marquage» → **«Séparation des flux public/personnel par chaînette»** — la note de
    l'occurrence dit explicitement « pour séparer les flux public/personnel à l'issue du mall ». Même sujet.
- **AMBIGUOUS (2)** — à trancher, **ne pas écrire** :
  - #6 «Installations électriques contrôlées par Bureau Veritas» — thème électrique **entangled** : un CS
    «Registre de sécurité installations électriques non renseigné» existe (mais registre ≠ contrôle), et
    l'action 2025 « Contrôles électriques… à refaire » est (à tort) sur ce même CS registre. Options :
    (a) SAFE_CREATE «Contrôle des installations électriques» ; (b) rattacher au futur regroupement
    électrique. Risque de re-fragmenter le thème électrique. **Décision requise.**
  - #7 «Validation issue Mall (DSCGR)» — proche de «Dégagement extérieur du Mall» (2024, même PV, token
    `mall`) mais facette distincte (validation réglementaire vs dégagement physique). Rejoindre «Issue de
    Secours du food court» (2025) serait **Bug B** → interdit ici. Options : (a) rejoindre «Dégagement
    extérieur du Mall» ; (b) SAFE_CREATE «Validation issue de secours du Mall». **Décision requise.**

**Bilan écritures possibles après GO** : 3 rejoin (A) + 2 SAFE_CREATE = **5 réparations sûres** ;
**4 en attente de décision** (2 LIKELY_EXISTING + 2 AMBIGUOUS).

## 4. Préserver l'acteur comme acteur (entité liée, pas sujet)

Réparer #1 ne doit pas faire disparaître KFT. Cible conceptuelle : sujet métier «Nettoyage conduits» +
**acteur lié KFT** quand la source le démontre. Mécanismes disponibles vérifiés :
`canonical_subject.company_id/contact_id` (identité acteur — ici les CS acteurs ont `company_id=null`,
`no_match`), `canonical_subject_actor_link`, et **`canonical_subject_occurrence.entity_ids[]`** (aujourd'hui
`[]`). Recommandation : lors de la régénération, renseigner `entity_ids[]` de l'occurrence métier avec
l'entité acteur citée **uniquement quand la source la nomme explicitement** (KFT, BV, MIES, Velayoudon,
VHZ) — sans créer aucune responsabilité (`responsible_for`) nouvelle. Les CS acteurs restent tels quels
pour les intervenants. À cadrer précisément à l'étape 2 (peut être livré en second temps si on veut
d'abord la continuité).

## 5. Stratégie d'écriture (la plus additive possible)

1. **Repointer la STV** des threads métier sûrs (5) : `UPDATE subject_thread_identity SET canonical_subject_id=<cible> WHERE subject_thread_id=<thread>` — capture de l'ancien `canonical_subject_id`.
2. **Créer** les 2 CS SAFE_CREATE (`kind='business_subject'`, `creation_source='historical_pv'`).
3. **Régénérer les occurrences** : supprimer les occurrences historiques désormais erronées sur les CS
   acteurs concernés, puis relancer `ensureHistoricalPdfOccurrences` (idempotent, regroupe par CS) → crée
   les occurrences correctes, gère nativement le split BV/MIES. (Le DELETE est ciblé et borné aux 7
   occurrences fautives ; contenu capturé avant pour rollback.)
4. **Ne pas** : supprimer un CS acteur, modifier une proposition/preuve, recréer des objets opérationnels,
   toucher aux 2 threads AMBIGUOUS (ils restent sur l'acteur jusqu'à décision).

## 6. Rollback exact

- **STV** : table `(subject_thread_id, ancien canonical_subject_id, nouveau canonical_subject_id)` pour les
  5 threads repointés → revert = ré-UPDATE vers l'ancien.
- **CS créés** : `(id, label, creation_source='historical_pv', kind='business_subject')` → revert = delete.
- **Occurrences** : snapshot JSON complet des 7 occurrences supprimées (tous champs) + liste des IDs
  régénérés → revert = delete régénérés + ré-insert des 7 snapshots.
- Tout est capturé dans un fichier de rollback avant la moindre écriture. Aucune preuve/source n'est
  modifiée → rien à restaurer côté propositions.

## 7. Résultat attendu de l'audit P1 après réparation (des 5 sûres)

- **absorptions acteur** : 9 → **2** (les 2 AMBIGUOUS restent, en attente) ; 0 si les 4 en attente sont
  aussi tranchées.
- **spanning_both** : 0 → **≥ 4** — les sujets qui traversent 2024↔2025 après réparation :
  «Contrôle des extincteurs», «Nettoyage conduits d'extraction», «Contrôle système extinction (friteuse)»,
  «Contrôle des appareils de cuisson». (Chiffre exact recalculé après écriture.)
- **WRONG_MERGE** (fait sur acteur) : 9 → 2 (voire 0).
- **chaînes métier correctes** : 0 → ≥ 4.
- **Attendu NON atteint (normal)** : «Dégagement extérieur du Mall» (2024) vs «Issue de Secours du food
  court» (2025) **restent séparés** — c'est **Bug B**, hors périmètre. spanning_both ne sera pas parfait,
  et c'est voulu : on mesure ce que P1-C1 seul répare.

## Suite immédiate

**HARD STOP.** Aucune écriture. J'attends :
1. le **GO écriture** pour les **5 sûres** (3 rejoin + 2 SAFE_CREATE) ;
2. ta **décision** sur les **4 en attente** (#4 extincteurs, #5 flux, #6 électrique, #7 issue Mall) ;
3. ta préférence sur `entity_ids[]` acteur (maintenant vs second temps).
